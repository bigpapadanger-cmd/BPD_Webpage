"use strict";
//Updated File last 9/5/26 10:51pm
// ============================================================
// BPD GAMING NETWORK
// OCR DEBUG TRACE
// ============================================================

const DEBUG_DETAIL_MAX_BYTES =
    12000;

const DEBUG_SENSITIVE_KEY =
    /(?:secret|token|authorization|cookie|password|credential|certificate|private.?key|subject.?token|raw.?response|response|request.?body|image|payload|message|preview|snippet|\btext\b)/i;

const DEBUG_SAFE_RESPONSE_KEY =
    /^(?:responseBytes|responseType)$/i;

// ============================================================
// ENABLED
// ============================================================

export function ocrDebugTraceEnabled(
    env
) {
    return (
        String(
            env?.OCR_DEBUG_TRACE_ENABLED
            || ""
        )
            .trim()
            .toLowerCase()
        === "true"
    );
}

// ============================================================
// NORMALIZATION
// ============================================================

function sanitizeDebugSegment(
    value,
    fallback
) {
    const sanitized =
        String(
            value
            || ""
        )
            .trim()
            .replace(
                /[^a-zA-Z0-9_-]/g,
                "_"
            )
            .slice(
                0,
                100
            );

    return sanitized
        || fallback;
}

function normalizeJobId(
    value
) {
    const jobId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        jobId
    )
        ? jobId
        : "";
}

function sanitizeDiagnosticValue(value) {
    if (Array.isArray(value)) {
        return value.slice(0, 50).map(sanitizeDiagnosticValue);
    }

    if (value && typeof value === "object") {
        const safe = {};
        for (const [key, item] of Object.entries(value)) {
            if (DEBUG_SENSITIVE_KEY.test(key) && !DEBUG_SAFE_RESPONSE_KEY.test(key)) continue;
            safe[key] = sanitizeDiagnosticValue(item);
        }
        return safe;
    }

    if (typeof value === "string") {
        return value
            .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
            .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
            .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
            .slice(0, 2000);
    }

    return value;
}

function sanitizeDebugDetail(detail) {
    if (
        detail === undefined
        || detail === null
    ) {
        return null;
    }

    try {
        const safeDetail = sanitizeDiagnosticValue(detail);
        const serialized = JSON.stringify(safeDetail);

        if (
            serialized.length <=
            DEBUG_DETAIL_MAX_BYTES
        ) {
            return JSON.parse(
                serialized
            );
        }

        return {
            truncated:
                true,
            originalLength:
                serialized.length
        };
    }
    catch (
        error
    ) {
        return {
            serializationFailed:
                true,
            errorName:
                String(error?.name || "Error").slice(0, 80)
        };
    }
}

function createTraceSuffix() {
    try {
        return crypto
            .randomUUID()
            .replace(
                /-/g,
                ""
            )
            .slice(
                0,
                8
            );
    }
    catch {
        return Math
            .random()
            .toString(
                36
            )
            .slice(
                2,
                10
            );
    }
}

// ============================================================
// WRITE TRACE
// ============================================================

export async function writeOcrDebugTrace(
    env,
    {
        jobId,
        component,
        event,
        detail = null
    }
) {
    if (
        !ocrDebugTraceEnabled(
            env
        )
        || !env?.OCR_STORAGE
    ) {
        return false;
    }

    const normalizedJobId =
        normalizeJobId(
            jobId
        );

    if (
        !normalizedJobId
    ) {
        return false;
    }

    const timestamp =
        new Date()
            .toISOString();

    const safeTimestamp =
        timestamp.replace(
            /[:.]/g,
            "-"
        );

    const safeComponent =
        sanitizeDebugSegment(
            component,
            "unknown"
        );

    const safeEvent =
        sanitizeDebugSegment(
            event,
            "event"
        );

    const suffix =
        createTraceSuffix();

    const key =
        (
            "debug/"
            + normalizedJobId
            + "/"
            + safeTimestamp
            + "_"
            + suffix
            + "_"
            + safeComponent
            + "_"
            + safeEvent
            + ".json"
        );

    const payload = {
        timestamp,
        jobId:
            normalizedJobId,
        component:
            safeComponent,
        event:
            safeEvent,
        detail:
            sanitizeDebugDetail(
                detail
            )
    };

    try {
        await env.OCR_STORAGE.put(
            key,
            JSON.stringify(
                payload,
                null,
                2
            ),
            {
                httpMetadata: {
                    contentType:
                        "application/json"
                }
            }
        );

        return true;
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR DEBUG] Trace write failed.",
            {
                jobId:
                    normalizedJobId,
                component:
                    safeComponent,
                event:
                    safeEvent,
                errorName:
                    String(error?.name || "Error").slice(0, 80)
            }
        );

        return false;
    }
}
