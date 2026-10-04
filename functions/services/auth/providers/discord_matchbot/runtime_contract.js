"use strict";

export const PROVIDER_RUNTIME_CALLER_SECRET_MIN_LENGTH = 64;
export const PROVIDER_RUNTIME_CALLER_SECRET_MAX_LENGTH = 256;
export const PROVIDER_RUNTIME_TIMEOUT_MS = 30_000;
export const PROVIDER_RUNTIME_CLEANUP_TIMEOUT_MS = 1_000;

export function isValidProviderRuntimeCallerSecret(value) {
    return typeof value === "string"
        && value.length >= PROVIDER_RUNTIME_CALLER_SECRET_MIN_LENGTH
        && value.length <= PROVIDER_RUNTIME_CALLER_SECRET_MAX_LENGTH
        && value.trim() === value
        && !/\s/u.test(value);
}

export async function withAbortTimeout(operation, timeoutMs, onTimeout = null) {
    const controller = new AbortController();
    let timer;
    let cleanupTimer;
    let timedOut = false;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    const guardedOperation = operationPromise.then(
        result => timedOut ? timeout : result,
        error => timedOut ? timeout : Promise.reject(error)
    );
    timer = setTimeout(async () => {
        timedOut = true;
        controller.abort();
        try {
            await Promise.race([
                Promise.resolve().then(() => onTimeout?.()).catch(() => {}),
                new Promise(resolve => { cleanupTimer = setTimeout(resolve, PROVIDER_RUNTIME_CLEANUP_TIMEOUT_MS); })
            ]);
        } catch { /* Best-effort cancellation. */ }
        finally { clearTimeout(cleanupTimer); }
        rejectTimeout(Object.assign(new Error("PROVIDER_RUNTIME_TIMEOUT"), { code: "PROVIDER_RUNTIME_TIMEOUT" }));
    }, timeoutMs);
    try {
        return await Promise.race([guardedOperation, timeout]);
    } finally {
        clearTimeout(timer);
    }
}
