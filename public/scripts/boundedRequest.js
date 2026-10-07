// Bound the complete request, including body decoding, even if a transport
// ignores abort. Private callers retain their existing no-store policy.
export async function boundedJson(url, options = {}, { fetcher = fetch, timeoutMs = 12000 } = {}) {
    const controller = new AbortController();
    let rejectAbort;
    const abort = () => { controller.abort(); rejectAbort?.(Object.assign(new Error("Request cancelled."), { name: "AbortError" })); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let timer;
    try {
        return await Promise.race([
            new Promise((_, reject) => { rejectAbort = reject; if (controller.signal.aborted) reject(Object.assign(new Error("Request cancelled."), { name: "AbortError" })); }),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("The request timed out. Try again.")); }, timeoutMs); }),
            (async () => {
                const response = await fetcher(url, { ...options, signal: controller.signal });
                const payload = await response.json();
                if (controller.signal.aborted) throw Object.assign(new Error("Request cancelled."), { name: "AbortError" });
                return { response, payload };
            })()
        ]);
    } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
