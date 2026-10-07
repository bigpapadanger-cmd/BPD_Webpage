"use strict";

export async function readJsonBody(request, maxBytes, signal) {
    if (!request?.body || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        return { success: false, data: null, tooLarge: false };
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > maxBytes) {
        return { success: false, data: null, tooLarge: true };
    }

    const reader = request.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            if (signal?.aborted) return { success: false, data: null, tooLarge: false };
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                return { success: false, data: null, tooLarge: true };
            }
            chunks.push(value);
        }

        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const data = JSON.parse(new TextDecoder().decode(bytes));
        return data && typeof data === "object" && !Array.isArray(data)
            ? { success: true, data, tooLarge: false }
            : { success: false, data: null, tooLarge: false };
    } catch {
        return { success: false, data: null, tooLarge: false };
    } finally {
        signal?.removeEventListener("abort", cancel);
        reader.releaseLock();
    }
}
