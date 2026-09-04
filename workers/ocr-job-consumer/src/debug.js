"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR DEBUG TRACE
// ============================================================

const DEBUG_DETAIL_MAX_BYTES =
    12000;

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

function sanitizeDebugDetail(
    detail
) {
    if (
        detail === undefined
        || detail === null
    ) {
        return null;
    }

    try {
        const serialized =
            JSON.stringify(
                detail
            );

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
                serialized.length,
            preview:
                serialized.slice(
                    0,
                    DEBUG_DETAIL_MAX_BYTES
                )
        };
    }
    catch (
        error
    ) {
        return {
            serializationFailed:
                true,
            message:
                String(
                    error?.message
                    || error
                )
                    .slice(
                        0,
                        500
                    )
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
                message:
                    String(
                        error?.message
                        || error
                    )
            }
        );

        return false;
    }
}