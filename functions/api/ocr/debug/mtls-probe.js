"use strict";

import {
    ADMIN_PERMISSIONS,
    authorizeAdminPermission
} from "../../../services/admin/permissions.js";

// Temporary diagnostic route; remove after the deployed handshake is verified.
const GOOGLE_STS_URL =
    "https://sts.mtls.googleapis.com/v1/token";

const GOOGLE_STS_HOSTNAME =
    "sts.mtls.googleapis.com";

const PROBE_TIMEOUT_MS =
    10000;

const MAX_ERROR_BODY_BYTES =
    8192;

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        }
    );
}

function emptyDiagnostic(
    env
) {
    return {
        bindingExists: Boolean(env?.OCR_GCP_MTLS),
        bindingFetchIsFunction:
            typeof env?.OCR_GCP_MTLS?.fetch === "function",
        destinationHostname: GOOGLE_STS_HOSTNAME,
        httpStatus: null,
        googleError: null,
        googleErrorDescription: null
    };
}

function sanitizeGoogleText(
    value
) {
    if (typeof value !== "string") {
        return null;
    }

    const sanitized = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
        .replace(/\b((?:[A-Z0-9_]*_)?API[_ -]?KEY|(?:subject|access|id)[_ -]?token|authorization)\b\s*[:=]\s*["']?[^,\s"'<>]+/gi, "$1=[REDACTED]")
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
        .trim()
        .slice(0, 512);

    return sanitized || null;
}

async function cancelResponseBody(
    response
) {
    try {
        await response.body?.cancel();
    }
    catch {
        // Nothing from an unread response body is needed for this probe.
    }
}

async function readGoogleErrorFields(
    response
) {
    const contentLength = Number(
        response.headers.get("Content-Length")
    );

    if (
        Number.isFinite(contentLength)
        && contentLength > MAX_ERROR_BODY_BYTES
    ) {
        await cancelResponseBody(response);
        return {
            googleError: null,
            googleErrorDescription: null
        };
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return {
            googleError: null,
            googleErrorDescription: null
        };
    }

    const chunks = [];
    let byteLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        byteLength += value.byteLength;
        if (byteLength > MAX_ERROR_BODY_BYTES) {
            await reader.cancel();
            return {
                googleError: null,
                googleErrorDescription: null
            };
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                googleError: null,
                googleErrorDescription: null
            };
        }

        return {
            googleError: sanitizeGoogleText(parsed.error),
            googleErrorDescription:
                sanitizeGoogleText(parsed.error_description)
        };
    }
    catch {
        return {
            googleError: null,
            googleErrorDescription: null
        };
    }
}

function logProbeDiagnostic(
    diagnostic,
    env,
    options = {}
) {
    const headers = new Headers(options.headers || {});
    const body = typeof options.body === "string"
        ? options.body
        : "";
    let bodyFieldNames = [];
    try {
        const parsedBody = JSON.parse(body);
        if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
            bodyFieldNames = Object.keys(parsedBody).sort();
        }
    }
    catch {
        // Never log the raw request body.
    }

    console.info(
        "[OCR mTLS probe]",
        {
            sameBindingObject: Boolean(env?.OCR_GCP_MTLS),
            bindingFetchType: typeof env?.OCR_GCP_MTLS?.fetch,
            requestMethod: String(options.method || "GET").toUpperCase(),
            hostname: GOOGLE_STS_HOSTNAME,
            hasSignal: Boolean(options.signal),
            contentType: headers.get("Content-Type"),
            bodyLength: new TextEncoder().encode(body).byteLength,
            bodyFieldNames,
            responseStatus: diagnostic.httpStatus,
            googleError: diagnostic.googleError,
            googleErrorDescription: diagnostic.googleErrorDescription
        }
    );
}

export async function runMtlsProbe(
    env
) {
    const diagnostic = emptyDiagnostic(env);
    if (!diagnostic.bindingFetchIsFunction) {
        logProbeDiagnostic(diagnostic, env);
        return jsonResponse(
            {
                probeCompleted: false,
                ...diagnostic
            },
            503
        );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        PROBE_TIMEOUT_MS
    );
    const requestOptions = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "",
        redirect: "manual",
        signal: controller.signal
    };

    try {
        const response = await env.OCR_GCP_MTLS.fetch(
            GOOGLE_STS_URL,
            requestOptions
        );

        diagnostic.httpStatus = Number(response.status) || 0;

        if (response.ok) {
            await cancelResponseBody(response);
        }
        else {
            Object.assign(
                diagnostic,
                await readGoogleErrorFields(response)
            );
        }

        logProbeDiagnostic(diagnostic, env, requestOptions);
        return jsonResponse({
            probeCompleted: true,
            ...diagnostic
        });
    }
    catch {
        logProbeDiagnostic(diagnostic, env, requestOptions);
        return jsonResponse(
            {
                probeCompleted: false,
                ...diagnostic,
                error: "MTLS_PROBE_REQUEST_FAILED"
            },
            502
        );
    }
    finally {
        clearTimeout(timeout);
    }
}

export async function onRequestPost(
    context
) {
    try {
        await authorizeAdminPermission(
            context.request,
            context.env,
            ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE
        );
    }
    catch (error) {
        const errorStatus = Number(error?.status);
        const status = errorStatus === 401 || errorStatus === 403
            ? errorStatus
            : 503;

        return jsonResponse(
            {
                probeCompleted: false,
                error: status === 401
                    ? "AUTHENTICATION_REQUIRED"
                    : status === 403
                        ? "ADMIN_PERMISSION_REQUIRED"
                        : "AUTHORIZATION_UNAVAILABLE"
            },
            status
        );
    }

    return runMtlsProbe(context.env);
}
