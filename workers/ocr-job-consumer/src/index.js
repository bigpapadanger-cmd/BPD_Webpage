"use strict";

import {
    cleanupStaleOcrJobs
} from "./cleanup.js";

import {
    writeOcrDebugTrace
} from "./debug.js";

// ============================================================
// BPD GAMING NETWORK
// OCR QUEUE CONSUMER
// ============================================================

const CONSUMER_VERSION =
    "ocr-job-consumer-1.2";

const OCR_JOB_STATUS_PREFIX =
    "ocr-jobs";

// ============================================================
// NORMALIZATION
// ============================================================

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

function normalizeErrorMessage(
    error
) {
    return String(
        error?.message
        || error
        || "Unknown queue error."
    )
        .slice(
            0,
            1000
        );
}

// ============================================================
// STATUS
// ============================================================

async function readJobStatus(
    jobId,
    env
) {
    if (
        !env.OCR_STORAGE
    ) {
        throw new Error(
            "OCR_STORAGE is not configured."
        );
    }

    const statusKey =
        `${OCR_JOB_STATUS_PREFIX}/${jobId}/status.json`;

    const object =
        await env.OCR_STORAGE.get(
            statusKey
        );

    if (
        !object
    ) {
        const error =
            new Error(
                `OCR status was not found for ${jobId}.`
            );

        error.code =
            "JOB_STATUS_NOT_FOUND";

        throw error;
    }

    let status;

    try {
        status =
            await object.json();
    }
    catch {
        const error =
            new Error(
                `OCR status is invalid for ${jobId}.`
            );

        error.code =
            "JOB_STATUS_INVALID";

        throw error;
    }

    if (
        !status
        || typeof status !== "object"
        || Array.isArray(
            status
        )
    ) {
        const error =
            new Error(
                `OCR status is invalid for ${jobId}.`
            );

        error.code =
            "JOB_STATUS_INVALID";

        throw error;
    }

    return {
        statusKey,
        status
    };
}

async function writeJobStatus(
    statusKey,
    status,
    env
) {
    await env.OCR_STORAGE.put(
        statusKey,
        JSON.stringify(
            status,
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

async function markJobStarting(
    jobId,
    env
) {
    const {
        statusKey,
        status
    } =
        await readJobStatus(
            jobId,
            env
        );

    if (
        status?.status === "completed"
        || status?.status === "failed"
    ) {
        return {
            statusKey,
            status,
            terminal:
                true
        };
    }

    const now =
        new Date()
            .toISOString();

    const attempt =
        Math.max(
            0,
            Number(
                status?.attempt
            )
            || 0
        )
        + 1;

    const nextStatus = {
        ...status,

        status:
            "processing",

        stage:
            "starting",

        progress:
            Math.max(
                2,
                Number(
                    status?.progress
                )
                || 0
            ),

        startedAt:
            status?.startedAt
            || now,

        updatedAt:
            now,

        heartbeatAt:
            now,

        attempt,

        error:
            null
    };

    await writeJobStatus(
        statusKey,
        nextStatus,
        env
    );

    return {
        statusKey,
        status:
            nextStatus,
        terminal:
            false
    };
}

// ============================================================
// PERMANENT FAILURE DETECTION
// ============================================================

function isPermanentProcessorFailure(
    status
) {
    return (
        status === 400
        || status === 401
        || status === 403
        || status === 404
        || status === 409
        || status === 422
    );
}

// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(
    message,
    env
) {
    const jobId =
        normalizeJobId(
            message?.body?.jobId
        );

    if (
        !jobId
    ) {
        const error =
            new Error(
                "Queue message contains an invalid jobId."
            );

        error.code =
            "INVALID_JOB_ID";

        error.permanent =
            true;

        throw error;
    }

    if (
        !env.OCR_STORAGE
    ) {
        throw new Error(
            "OCR_STORAGE is not configured."
        );
    }

    if (
        !env.OCR_JOB_PROCESS_URL
    ) {
        throw new Error(
            "OCR_JOB_PROCESS_URL is not configured."
        );
    }

    if (
        !env.OCR_JOB_PROCESS_SECURE_TOKEN
    ) {
        throw new Error(
            "OCR_JOB_PROCESS_SECURE_TOKEN is not configured."
        );
    }

    await writeOcrDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "message_received",

            detail: {
                version:
                    CONSUMER_VERSION
            }
        }
    );

    const starting =
        await markJobStarting(
            jobId,
            env
        );

    if (
        starting.terminal
    ) {
        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "consumer",

                event:
                    "terminal_job_skipped",

                detail: {
                    status:
                        starting.status?.status
                        || null,

                    stage:
                        starting.status?.stage
                        || null
                }
            }
        );

        return {
            jobId,
            skipped:
                true
        };
    }

    await writeOcrDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "processing_started",

            detail: {
                attempt:
                    starting.status?.attempt
                    || 1,

                version:
                    CONSUMER_VERSION
            }
        }
    );

    let response;

    try {
        response =
            await fetch(
                env.OCR_JOB_PROCESS_URL,
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "X-OCR-Job-Token":
                            env.OCR_JOB_PROCESS_SECURE_TOKEN,

                        "X-BPD-OCR-Queue-Version":
                            CONSUMER_VERSION
                    },

                    body:
                        JSON.stringify({
                            jobId
                        })
                }
            );
    }
    catch (
        error
    ) {
        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "consumer",

                event:
                    "processor_fetch_failed",

                detail: {
                    message:
                        normalizeErrorMessage(
                            error
                        )
                }
            }
        );

        throw error;
    }

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        const error =
            new Error(
                (
                    "OCR processor returned HTTP "
                    + response.status
                    + ": "
                    + responseText.slice(
                        0,
                        1000
                    )
                )
            );

        error.code =
            `PROCESSOR_HTTP_${response.status}`;

        error.httpStatus =
            response.status;

        error.permanent =
            isPermanentProcessorFailure(
                response.status
            );

        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "consumer",

                event:
                    "processor_rejected",

                detail: {
                    httpStatus:
                        response.status,

                    permanent:
                        error.permanent,

                    response:
                        responseText.slice(
                            0,
                            1000
                        )
                }
            }
        );

        throw error;
    }

    await writeOcrDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "processor_completed",

            detail: {
                httpStatus:
                    response.status
            }
        }
    );

    console.log(
        `[OCR QUEUE] Completed ${jobId}`
    );

    return {
        jobId,
        skipped:
            false
    };
}

// ============================================================
// MESSAGE FAILURE TRACE
// ============================================================

async function traceMessageFailure(
    message,
    error,
    env
) {
    const jobId =
        normalizeJobId(
            message?.body?.jobId
        );

    if (
        !jobId
    ) {
        return;
    }

    await writeOcrDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "message_failed",

            detail: {
                code:
                    String(
                        error?.code
                        || "QUEUE_PROCESSING_FAILED"
                    ),

                message:
                    normalizeErrorMessage(
                        error
                    ),

                permanent:
                    error?.permanent
                    === true,

                httpStatus:
                    Number.isFinite(
                        Number(
                            error?.httpStatus
                        )
                    )
                        ? Number(
                            error.httpStatus
                        )
                        : null
            }
        }
    );
}

// ============================================================
// QUEUE
// ============================================================

async function handleQueueBatch(
    batch,
    env
) {
    for (
        const message
        of batch.messages
    ) {
        try {
            await processMessage(
                message,
                env
            );

            message.ack();
        }
        catch (
            error
        ) {
            console.error(
                "[OCR QUEUE] Job failed:",
                error
            );

            try {
                await traceMessageFailure(
                    message,
                    error,
                    env
                );
            }
            catch (
                debugError
            ) {
                console.warn(
                    "[OCR QUEUE] Could not write failure trace.",
                    debugError
                );
            }

            if (
                error?.permanent
                === true
            ) {
                /*
                 * Permanent failures should not consume
                 * additional queue retries.
                 *
                 * Examples:
                 *
                 * - invalid job ID
                 * - job no longer exists
                 * - authentication rejected
                 * - malformed processor request
                 */

                message.ack();

                continue;
            }

            message.retry();
        }
    }
}

// ============================================================
// SCHEDULED CLEANUP
// ============================================================

async function handleScheduledCleanup(
    env
) {
    console.log(
        "[OCR CLEANUP] Scheduled cleanup started."
    );

    try {
        await cleanupStaleOcrJobs(
            env
        );

        console.log(
            "[OCR CLEANUP] Scheduled cleanup completed."
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR CLEANUP] Scheduled cleanup failed:",
            error
        );

        throw error;
    }
}

// ============================================================
// WORKER
// ============================================================

export default {
    async queue(
        batch,
        env
    ) {
        await handleQueueBatch(
            batch,
            env
        );
    },

    async scheduled(
        _controller,
        env,
        ctx
    ) {
        ctx.waitUntil(
            handleScheduledCleanup(
                env
            )
        );
    }
};