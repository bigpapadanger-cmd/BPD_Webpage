export const UPSTREAM_TIMEOUT_MS = 10_000;
export const UPSTREAM_MAX_BYTES = 256 * 1024;

function failure(code) {
    return Object.assign(new Error("Upstream service unavailable."), { code, status: 503 });
}

// The caller's complete operation (including parsing and validation) runs within
// this deadline. Promise.race also bounds non-cooperative fetch/stream mocks.
export async function withUpstreamDeadline(operation, timeoutMs = UPSTREAM_TIMEOUT_MS) {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(failure("UPSTREAM_TIMEOUT"));
        }, timeoutMs);
    });
    try {
        const value = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
        if (controller.signal.aborted || Date.now() >= deadline) {
            controller.abort();
            throw failure("UPSTREAM_TIMEOUT");
        }
        return value;
    } finally { clearTimeout(timer); }
}

const SAFE_ERROR_CODES = new Set(["23505", "P0001", "ACCOUNT_INACTIVE", "ACCOUNT_LINK_CONFLICT",
    "PROVIDER_IDENTITY_ALREADY_LINKED", "LINK_ACCOUNT_MISMATCH", "OAUTH_ACCOUNT_MISMATCH", "EPIC_IDENTITY_NOT_LINKED"]);
export function safeUpstreamErrorCode(value) {
    return SAFE_ERROR_CODES.has(value) ? value : "UPSTREAM_REJECTED";
}
export function safeUpstreamErrorMessage(value, fallback) {
    return SAFE_ERROR_CODES.has(value) && value !== "23505" && value !== "P0001" ? value : fallback;
}

// Stream/count decompressed bytes before constructing a bounded in-memory
// Response. Never trust Content-Length alone. Call inside withUpstreamDeadline.
export async function fetchBoundedResponse(input, init, maxBytes = UPSTREAM_MAX_BYTES, fetcher = fetch) {
    const signal = init?.signal;
    if (!signal || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw failure("UPSTREAM_CONFIGURATION_INVALID");
    if (signal.aborted) throw failure("UPSTREAM_TIMEOUT");
    let response;
    try { response = await fetcher(input, init); }
    catch (error) { throw failure(signal.aborted || error?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE"); }
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw failure("UPSTREAM_RESPONSE_TOO_LARGE");
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        if (reader) {
            while (true) {
                if (signal.aborted) throw failure("UPSTREAM_TIMEOUT");
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxBytes) { cancel(); throw failure("UPSTREAM_RESPONSE_TOO_LARGE"); }
                chunks.push(value);
            }
        }
        if (signal.aborted) throw failure("UPSTREAM_TIMEOUT");
    } catch (error) {
        cancel();
        throw failure(signal.aborted ? "UPSTREAM_TIMEOUT"
            : error?.code === "UPSTREAM_RESPONSE_TOO_LARGE" ? error.code : "UPSTREAM_RESPONSE_INVALID");
    } finally {
        signal.removeEventListener("abort", cancel);
        reader?.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers
    });
}
