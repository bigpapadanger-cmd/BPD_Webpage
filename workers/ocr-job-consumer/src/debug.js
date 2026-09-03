"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR DEBUG TRACE
// ============================================================

export function ocrDebugTraceEnabled(
    env
) {
    return (
        String(
            env.OCR_DEBUG_TRACE_ENABLED
            || ""
        )
            .trim()
            .toLowerCase()
        === "true"
    );
}

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
        || !env.OCR_STORAGE
    ) {
        return;
    }

    const normalizedJobId =
        String(
            jobId
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{16}$/.test(
            normalizedJobId
        )
    ) {
        return;
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

    const key =
        (
            "debug/"
            + normalizedJobId
            + "/"
            + safeTimestamp
            + "_"
            + safeComponent
            + "_"
            + safeEvent
            + ".json"
        );

    try {
        await env.OCR_STORAGE.put(
            key,
            JSON.stringify(
                {
                    timestamp,

                    jobId:
                        normalizedJobId,

                    component:
                        safeComponent,

                    event:
                        safeEvent,

                    detail
                },
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
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR DEBUG] Trace write failed.",
            error
        );
    }
}