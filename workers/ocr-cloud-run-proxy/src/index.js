"use strict";

import { getGoogleCloudRunIdToken } from "../../../functions/services/ocr/googleCloudAuth.js";

const INTERNAL_PATH = "/api/ocr";
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 295000;
const INTERNAL_HOSTNAME = "ocr-google-transport.internal";

function configuredTimeout(env) {
    const value = Number(env?.OCR_PROVIDER_TIMEOUT_MS);
    return Number.isInteger(value) && value >= 1000 && value <= 300000
        ? value
        : REQUEST_TIMEOUT_MS;
}

function jsonResponse(body, status) {
    return Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store" }
    });
}

function transportError(code, status = 503) {
    return jsonResponse({
        success: false,
        code,
        message: "OCR provider is temporarily unavailable."
    }, status);
}

function constantTimeEqual(left, right) {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    let difference = leftBytes.length ^ rightBytes.length;
    const length = Math.max(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
        difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }
    return difference === 0;
}

function authorizeTransportRequest(request, env) {
    const expected = String(env?.OCR_GOOGLE_TRANSPORT_SECRET || "");
    if (expected.length < 32 || expected.length > 256) {
        return transportError("OCR_TRANSPORT_AUTH_NOT_CONFIGURED");
    }
    const authorization = request.headers.get("Authorization") || "";
    const provided = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
    if (!provided || provided.length > 256 || !constantTimeEqual(provided, expected)) {
        return jsonResponse({ success: false, code: "UNAUTHORIZED", message: "OCR transport authorization required." }, 401);
    }
    return null;
}

async function readBoundedBody(request, limit) {
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
        return null;
    }

    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();

    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    }
    catch {
        try { await reader.cancel(); } catch { /* Ignore stream cleanup errors. */ }
        throw new Error("OCR_REQUEST_BODY_READ_FAILED");
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function validateMultipartPayload(request, bytes) {
    const contentType = request.headers.get("Content-Type") || "";
    if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) return false;

    try {
        const clone = new Request(request.url, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: bytes
        });
        const form = await clone.formData();
        const image = form.get("image") || form.get("file");
        return Boolean(
            image
            && typeof image.arrayBuffer === "function"
            && image.size > 0
            && image.size <= MAX_IMAGE_BYTES
        );
    }
    catch {
        return false;
    }
}

async function readBoundedResponse(response) {
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        return null;
    }
    const bytes = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    return bytes;
}

function redactResponseCredentials(bytes, credentials) {
    let body = new TextDecoder().decode(bytes);
    for (const credential of credentials.filter(value => typeof value === "string" && value)) {
        const variants = [credential];
        try {
            variants.push(encodeURIComponent(credential), JSON.stringify(credential).slice(1, -1));
        }
        catch { /* Exact credential redaction remains available. */ }
        for (const variant of variants) {
            body = body.split(variant).join("[REDACTED]");
        }
    }
    return new TextEncoder().encode(body);
}

async function processOcr(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST") return transportError("METHOD_NOT_ALLOWED", 405);
    if (url.pathname !== INTERNAL_PATH || url.search) return transportError("NOT_FOUND", 404);
    const publicHostname = String(env?.OCR_PUBLIC_HOSTNAME || "").trim().toLowerCase();
    if (url.hostname.toLowerCase() !== INTERNAL_HOSTNAME && (!publicHostname || url.hostname.toLowerCase() !== publicHostname)) {
        return transportError("NOT_FOUND", 404);
    }
    const unauthorized = authorizeTransportRequest(request, env);
    if (unauthorized) return unauthorized;
    if (typeof env?.OCR_GCP_MTLS?.fetch !== "function") {
        console.error("[OCR transport] required mTLS binding unavailable");
        return transportError("OCR_GOOGLE_MTLS_BINDING_MISSING");
    }
    if (!String(env?.OCR_API_KEY || "").trim()) {
        console.error("[OCR transport] application credential unavailable");
        return transportError("OCR_API_KEY_MISSING");
    }
    if (!String(env?.OCR_API_URL || "").trim()) {
        console.error("[OCR transport] upstream configuration unavailable");
        return transportError("OCR_API_URL_MISSING");
    }

    let bytes;
    try {
        bytes = await readBoundedBody(request, MAX_REQUEST_BYTES);
    }
    catch {
        return transportError("OCR_REQUEST_INVALID", 400);
    }
    if (!bytes) return transportError("OCR_REQUEST_TOO_LARGE", 413);
    if (!await validateMultipartPayload(request, bytes)) {
        return transportError("OCR_REQUEST_INVALID", 400);
    }

    let idToken;
    try {
        idToken = await getGoogleCloudRunIdToken(env, env.OCR_API_URL);
    }
    catch (error) {
        const code = /^OCR_GOOGLE_[A-Z0-9_]+$/.test(String(error?.code || ""))
            ? error.code
            : "OCR_GOOGLE_AUTH_UNAVAILABLE";
        console.error("[OCR transport] Google authentication failed", { code });
        return transportError(code);
    }

    const headers = new Headers({
        "Accept": "application/json",
        "Authorization": `Bearer ${idToken}`,
        "X-API-Key": String(env.OCR_API_KEY),
        "X-BPD-OCR-Handler-Version": "ocr-handler-3.0"
    });
    const jobId = request.headers.get("X-BPD-OCR-Job-ID");
    if (jobId && /^[A-Z0-9]{16}$/.test(jobId)) {
        headers.set("X-BPD-OCR-Job-ID", jobId);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("OCR provider timeout"), configuredTimeout(env));
    try {
        const upstream = await fetch(env.OCR_API_URL, {
            method: "POST",
            headers: {
                ...Object.fromEntries(headers),
                "Content-Type": request.headers.get("Content-Type")
            },
            body: bytes,
            signal: controller.signal
        });
        const responseBytes = await readBoundedResponse(upstream);
        if (!responseBytes) {
            console.error("[OCR transport] provider response exceeded limit", { status: upstream.status });
            return transportError("OCR_PROVIDER_RESPONSE_TOO_LARGE", 502);
        }
        const sanitizedResponse = redactResponseCredentials(
            responseBytes,
            [idToken, String(env.OCR_API_KEY)]
        );
        const responseHeaders = new Headers({ "Cache-Control": "no-store" });
        const contentType = upstream.headers.get("Content-Type");
        if (contentType) responseHeaders.set("Content-Type", contentType);
        return new Response(sanitizedResponse, {
            status: upstream.status,
            headers: responseHeaders
        });
    }
    catch (error) {
        const timedOut = controller.signal.aborted;
        console.error("[OCR transport] provider request failed", {
            kind: timedOut ? "timeout" : "network",
            code: timedOut ? "OCR_PROVIDER_TIMEOUT" : "OCR_PROVIDER_TRANSPORT_FAILED"
        });
        return transportError(timedOut ? "OCR_PROVIDER_TIMEOUT" : "OCR_PROVIDER_TRANSPORT_FAILED", 502);
    }
    finally {
        clearTimeout(timeout);
        idToken = null;
    }
}

export async function handleRequest(request, env) {
    try {
        return await processOcr(request, env);
    }
    catch {
        console.error("[OCR transport] request rejected by internal handler");
        return transportError("OCR_TRANSPORT_FAILED", 502);
    }
}

export default { fetch: handleRequest };
