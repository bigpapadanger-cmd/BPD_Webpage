// Legacy log boundaries may retain only operational fields. Callers must supply
// server-generated debug IDs and explicit fixed-code allowlists, never raw errors.
export function sanitizeLogMetadata(fields, allowedCodes = []) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
    const output = {};
    const numeric = new Set(["elapsedMs", "durationMs", "count", "rowCount", "candidateCount", "attempted", "succeeded", "failed", "checked", "healthy", "degraded", "unknown", "total", "retryAfterSeconds"]);
    const flags = new Set(["ok", "success", "changed", "refreshed", "gated", "active", "cacheExists", "hasAccountId", "hasSessionId", "hasRedirect", "createdAccount", "createdIdentity", "linkedIdentity", "alreadyLinked", "timeout"]);
    const codes = new Set(["UPSTREAM_TIMEOUT", "UPSTREAM_REJECTED", "UPSTREAM_UNAVAILABLE", "UNRECOGNIZED_ERROR", ...allowedCodes]);
    for (const [key, value] of Object.entries(fields)) {
        if (key === "debugId" && typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) output[key] = value;
        else if (["status", "upstreamStatus"].includes(key) && Number.isInteger(value) && value >= 100 && value <= 599) output[key] = value;
        else if (numeric.has(key) && Number.isSafeInteger(value) && value >= 0) output[key] = value;
        else if (flags.has(key) && typeof value === "boolean") output[key] = value;
        else if (key === "provider" && ["epic", "google", "discord", "steam"].includes(value)) output[key] = value;
        else if (key === "mode" && ["login", "link", "reauthorize"].includes(value)) output[key] = value;
        else if (key === "method" && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(value)) output[key] = value;
        else if (["code", "errorCode", "upstreamCode"].includes(key)) output[key] = value == null ? null : codes.has(value) ? value : "UNRECOGNIZED_ERROR";
    }
    return output;
}

// Request-local diagnostics: never accept a browser-provided ID or serialize errors.
export function createRequestDiagnostics({ label, operation, codes, timeoutCode = null, playlistId = null, transportField = "transportErrorClass" }) {
    const debugId = crypto.randomUUID();
    const started = performance.now();
    const gameMode = { 10: "1v1", 11: "2v2", 13: "3v3" }[playlistId];
    const playlist = gameMode ? { playlistId, gameMode, rowCount: null, snapshotStatus: null } : null;
    const transportErrorClasses = new Set(["invalid_url", "invalid_header", "request_construction", "abort", "aborted", "network_failure", "fetch_type_error", "unknown_transport"]);
    const exceptionNames = new Set(["TypeError", "AbortError", "DOMException", "Error", "RangeError"]);
    let context = { stage: "route", operation, rpc: null, upstreamStatus: null, code: null, timeout: false };
    return {
        debugId,
        mark(stage, rpc = null) { context = { stage, operation, rpc, upstreamStatus: rpc && rpc === context.rpc ? context.upstreamStatus : null, code: null, timeout: false }; },
        rows(count) { if (playlist) playlist.rowCount = Number.isSafeInteger(count) && count >= 0 && count <= 20000 ? count : null; },
        snapshot(status) { if (playlist) playlist.snapshotStatus = ["not_started", "in_progress", "already_complete", "completed", "failed", "recording_failed"].includes(status) ? status : null; },
        markTimeout() { context.timeout = true; },
        transportFailure(transportErrorClass, exceptionName = null) {
            if (!transportErrorClasses.has(transportErrorClass)) return;
            context = {
                ...context,
                [transportField]: transportErrorClass,
                ...(exceptionNames.has(exceptionName) ? { exceptionName } : {})
            };
        },
        upstream(status, code) {
            context.upstreamStatus = status === undefined ? context.upstreamStatus : Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
            context.code = codes.has(code) ? code : code ? "UPSTREAM_REJECTED" : null;
        },
        finish(error = null) {
            const code = error?.code;
            console.info(label, { debugId, ...context, ...(playlist || {}),
                code: context.code || (codes.has(code) ? code : error ? "UNRECOGNIZED_ERROR" : null),
                timeout: context.timeout || code === "UPSTREAM_TIMEOUT" || (timeoutCode !== null && code === timeoutCode),
                deadlineState: context.timeout || code === "UPSTREAM_TIMEOUT" || (timeoutCode !== null && code === timeoutCode) ? "expired" : "not_expired",
                elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
        }
    };
}

