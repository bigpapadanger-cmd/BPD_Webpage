"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROGRESS CALLBACK
// ============================================================

const PROGRESS_VERSION =
    "ocr-job-progress-1.0";

// ============================================================
// MAIN
// ============================================================

export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } = context;

    try {


        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR storage is not configured.",
                    version:
                        PROGRESS_VERSION
                },
                503
            );
        }

        if (
            !env.OCR_JOB_PROGRESS_SECURE_TOKEN
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR progress authentication is not configured.",
                    version:
                        PROGRESS_VERSION
                },
                503
            );
        }

        if (
            !isAuthorizedProgressRequest(
                request,
                env
            )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Unauthorized.",
                    version:
                        PROGRESS_VERSION
                },
                401
            );
        }

        const body =
            await readJsonRequest(
                request
            );

        if (
            !body
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Request body must be valid JSON.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const jobId =
            sanitizeJobId(
                body?.jobId
            );

        if (
            !jobId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Missing or invalid jobId.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const statusKey =
            `ocr-jobs/${jobId}/status.json`;

        const currentStatus =
            await readStatus(
                env,
                statusKey
            );

        if (
            !currentStatus
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job status was not found.",
                    jobId,
                    version:
                        PROGRESS_VERSION
                },
                404
            );
        }

        if (
            currentStatus.status ===
                "completed"
            || currentStatus.status ===
                "failed"
        ) {
            return jsonResponse(
                {
                    success: true,
                    jobId,
                    status:
                        currentStatus.status,
                    ignored:
                        true,
                    version:
                        PROGRESS_VERSION
                },
                200
            );
        }

        const requestedProgress =
            normalizeProgress(
                body?.progress
            );

        const currentProgress =
            normalizeProgress(
                currentStatus?.progress
            );

        const nextProgress =
            Math.max(
                currentProgress,
                requestedProgress
            );

        const stage =
            sanitizeStage(
                body?.stage
            )
            || currentStatus.stage
            || "ocr";

        const message =
            sanitizeMessage(
                body?.message
            )
            || currentStatus.message
            || "Reading your scoreboard.";

        const now =
            new Date()
                .toISOString();

        const nextStatus = {
            ...currentStatus,

            status:
                "processing",

            stage,

            progress:
                nextProgress,

            message,

            updatedAt:
                now,

            heartbeatAt:
                now,

            error:
                null
        };

        await updateStatus(
            env,
            statusKey,
            nextStatus
        );

        return jsonResponse(
            {
                success: true,
                jobId,
                status:
                    nextStatus.status,
                stage:
                    nextStatus.stage,
                progress:
                    nextStatus.progress,
                version:
                    PROGRESS_VERSION
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR PROGRESS] Callback failed:",
            error
        );

        return jsonResponse(
            {
                success: false,
                message:
                    "Unable to update OCR progress.",
                version:
                    PROGRESS_VERSION
            },
            500
        );
    }
}

// ============================================================
// AUTHENTICATION
// ============================================================

function isAuthorizedProgressRequest(
    request,
    env
) {
    const suppliedToken =
        String(
            request.headers.get(
                "X-BPD-OCR-Progress-Token"
            )
            || ""
        )
            .trim();

    const expectedToken =
        String(
            env.OCR_JOB_PROGRESS_SECURE_TOKEN
            || ""
        )
            .trim();

    return (
        Boolean(
            suppliedToken
        )
        && Boolean(
            expectedToken
        )
        && suppliedToken === expectedToken
    );
}

// ============================================================
// JSON REQUEST
// ============================================================

async function readJsonRequest(
    request
) {
    try {
        const body =
            await request.json();

        return (
            body
            && typeof body === "object"
            && !Array.isArray(
                body
            )
        )
            ? body
            : null;
    }
    catch {
        return null;
    }
}

// ============================================================
// STATUS
// ============================================================

async function readStatus(
    env,
    statusKey
) {
    const object =
        await env.OCR_STORAGE.get(
            statusKey
        );

    if (
        !object
    ) {
        return null;
    }

    try {
        const status =
            JSON.parse(
                await object.text()
            );

        return (
            status
            && typeof status === "object"
            && !Array.isArray(
                status
            )
        )
            ? status
            : null;
    }
    catch {
        return null;
    }
}

async function updateStatus(
    env,
    statusKey,
    statusData
) {
    await env.OCR_STORAGE.put(
        statusKey,
        JSON.stringify(
            statusData,
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

// ============================================================
// NORMALIZATION
// ============================================================

function sanitizeJobId(
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

function normalizeProgress(
    value
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(
                numeric
            )
        )
    );
}

function sanitizeStage(
    value
) {
    const stage =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        !stage
        || stage.length > 64
        || !/^[a-z0-9_-]+$/.test(
            stage
        )
    ) {
        return "";
    }

    return stage;
}

function sanitizeMessage(
    value
) {
    const message =
        String(
            value
            || ""
        )
            .trim();

    if (
        !message
    ) {
        return "";
    }

    return message.slice(
        0,
        300
    );
}

// ============================================================
// RESPONSE
// ============================================================

function jsonResponse(
    data,
    status = 200
) {
    return new Response(
        JSON.stringify(
            data
        ),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}