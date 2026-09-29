"use strict";

const INTERNAL_OCR_URL = "https://ocr-google-transport.internal/api/ocr";

export async function fetchOcrThroughGoogleWorker(env, body, headers = {}, signal) {
    const binding = env?.OCR_GOOGLE_TRANSPORT;
    if (!binding || typeof binding.fetch !== "function") {
        const error = new Error("OCR transport is not configured.");
        error.code = "OCR_GOOGLE_TRANSPORT_UNAVAILABLE";
        error.httpStatus = 503;
        throw error;
    }

    const transportSecret = String(env?.OCR_GOOGLE_TRANSPORT_SECRET || "");
    if (transportSecret.length < 32 || transportSecret.length > 256) {
        const error = new Error("OCR transport is not configured.");
        error.code = "OCR_GOOGLE_TRANSPORT_AUTH_NOT_CONFIGURED";
        error.httpStatus = 503;
        throw error;
    }

    const requestHeaders = new Headers(headers);
    requestHeaders.set("Authorization", `Bearer ${transportSecret}`);
    const request = new Request(INTERNAL_OCR_URL, {
        method: "POST",
        headers: requestHeaders,
        body,
        ...(signal ? { signal } : {})
    });

    return binding.fetch(request);
}
