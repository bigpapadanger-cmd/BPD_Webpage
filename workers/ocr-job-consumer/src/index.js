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
    "ocr-job-consumer-1.4-AUTODEPLOY-ENABLED";

const OCR_JOB_STATUS_PREFIX =
    "ocr-jobs";

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeJobId(value) {
    const jobId =
        String(value || "")
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(jobId)
        ? jobId
        : "";
}

function normalizeErrorMessage(error) {
    return String(
        error?.message
        || error
        || "Unknown queue error."
    ).slice(
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

        error.permanent =
            true;

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

        error.permanent =
            true;

        throw error;
    }

    if (
        !status
        || typeof status !== "object"
        || Array.isArray(status)
    ) {
        const error =
            new Error(
                `OCR status is invalid for ${jobId}.`
            );

        error.code =
            "JOB_STATUS_INVALID";

        error.permanent =
            true;

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
            Number(status?.attempt) || 0
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

        message:
            "Starting scoreboard reader.",

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

async function markJobFailed(
    jobId,
    error,
    env
) {
    if (
        !jobId
        || !env.OCR_STORAGE
    ) {
        return;
    }

    let current;

    try {
        current =
            await readJobStatus(
                jobId,
                env
            );
    }
    catch (
        statusError
    ) {
        console.warn(
            "[OCR QUEUE] Could not read job status while marking failure.",
            statusError
        );

        return;
    }

    if (
        current.status?.status === "completed"
        || current.status?.status === "failed"
    ) {
        return;
    }

    const now =
        new Date()
            .toISOString();

    const nextStatus = {
        ...current.status,

        status:
            "failed",

        stage:
            "consumer_failed",

        progress:
            100,

        updatedAt:
            now,

        completedAt:
            now,

        heartbeatAt:
            now,

        error: {
            code:
                String(
                    error?.code
                    || "QUEUE_PROCESSING_FAILED"
                ),

            message:
                normalizeErrorMessage(
                    error
                )
        }
    };

    try {
        await writeJobStatus(
            current.statusKey,
            nextStatus,
            env
        );
    }
    catch (
        writeError
    ) {
        console.warn(
            "[OCR QUEUE] Could not mark job as failed.",
            writeError
        );
    }
}

// ============================================================
// DEBUG
// ============================================================

async function safeWriteDebugTrace(
    env,
    trace
) {
    try {
        await writeOcrDebugTrace(
            env,
            trace
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR QUEUE] Could not write debug trace.",
            error
        );
    }
}

// ============================================================
// PROCESSOR RESPONSE
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

function parseProcessorResponse(
    text
) {
    if (
        !text
    ) {
        return null;
    }

    try {
        return JSON.parse(
            text
        );
    }
    catch {
        return null;
    }
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
        const error =
            new Error(
                "OCR_STORAGE is not configured."
            );

        error.code =
            "OCR_STORAGE_NOT_CONFIGURED";

        throw error;
    }

    await safeWriteDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "message_received",

            detail: {
                version:
                    CONSUMER_VERSION,

                queueAttempt:
                    Number(
                        message?.attempts
                    )
                    || null
            }
        }
    );

    /*
     * Mark the job as processing immediately after the
     * queue message is received.
     *
     * This prevents a consumer/configuration failure from
     * leaving the R2 status permanently stuck at:
     *
     * status: queued
     * attempt: 0
     * startedAt: null
     */
    const starting =
        await markJobStarting(
            jobId,
            env
        );

    if (
        starting.terminal
    ) {
        await safeWriteDebugTrace(
            env,
            {
                jobId,

                component:
                    "consumer",

                event:
                    "terminal_job_skipped",

                detail: {
                    status:
                        starting.status?.status || null,

                    stage:
                        starting.status?.stage || null
                }
            }
        );

        return {
            jobId,

            skipped:
                true
        };
    }

    await safeWriteDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "processing_started",

            detail: {
                attempt:
                    starting.status?.attempt || 1,

                version:
                    CONSUMER_VERSION
            }
        }
    );

    /*
     * Validate processor configuration after marking the
     * job as started so configuration failures are visible
     * in the persisted job state.
     */

    if (
        !env.OCR_JOB_PROCESS_URL
    ) {
        const error =
            new Error(
                "OCR_JOB_PROCESS_URL is not configured."
            );

        error.code =
            "PROCESS_URL_NOT_CONFIGURED";

        throw error;
    }

    if (
        !env.OCR_JOB_PROCESS_SECURE_TOKEN
    ) {
        const error =
            new Error(
                "OCR_JOB_PROCESS_SECURE_TOKEN is not configured."
            );

        error.code =
            "PROCESS_TOKEN_NOT_CONFIGURED";

        throw error;
    }

    let response;

    try {
        response =
            await fetch(
                env.OCR_JOB_PROCESS_URL,
                {
                    method:
                        "POST",

                    headers: {
                        "Accept":
                            "application/json",

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
        const fetchError =
            new Error(
                normalizeErrorMessage(
                    error
                )
            );

        fetchError.code =
            "PROCESSOR_FETCH_FAILED";

        fetchError.permanent =
            false;

        await safeWriteDebugTrace(
            env,
            {
                jobId,

                component:
                    "consumer",

                event:
                    "processor_fetch_failed",

                detail: {
                    message:
                        fetchError.message
                }
            }
        );

        throw fetchError;
    }

    const responseText =
        await response.text();

    const responseData =
        parseProcessorResponse(
            responseText
        );

    /*
     * HTTP failures.
     */
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

        await safeWriteDebugTrace(
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

    /*
     * A 2xx response is not enough.
     *
     * process_job must explicitly report success.
     */
    if (
        !responseData
        || responseData?.success !== true
    ) {
        const error =
            new Error(
                responseData?.message
                || responseData?.error
                || "OCR processor returned an unsuccessful response."
            );

        error.code =
            String(
                responseData?.error?.code
                || responseData?.code
                || "PROCESSOR_RESULT_FAILED"
            );

        error.httpStatus =
            response.status;

        error.permanent =
            responseData?.permanent === true;

        await safeWriteDebugTrace(
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

    await safeWriteDebugTrace(
        env,
        {
            jobId,

            component:
                "consumer",

            event:
                "processor_completed",

            detail: {
                httpStatus:
                    response.status,

                matchId:
                    responseData?.matchId || null,

                version:
                    CONSUMER_VERSION
            }
        }
    );

    console.log(
        `[OCR QUEUE] Completed ${jobId}`
    );

    return {
        jobId,

        skipped:
            false,

        response:
            responseData
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

    await safeWriteDebugTrace(
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
                    error?.permanent === true,

                httpStatus:
                    Number.isFinite(
                        Number(
                            error?.httpStatus
                        )
                    )
                        ? Number(
                            error.httpStatus
                        )
                        : null,

                queueAttempt:
                    Number(
                        message?.attempts
                    )
                    || null
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
        const jobId =
            normalizeJobId(
                message?.body?.jobId
            );

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
                {
                    jobId:
                        jobId || null,

                    code:
                        error?.code || null,

                    message:
                        normalizeErrorMessage(
                            error
                        ),

                    permanent:
                        error?.permanent === true
                }
            );

            await traceMessageFailure(
                message,
                error,
                env
            );

            if (
                error?.permanent === true
            ) {
                await markJobFailed(
                    jobId,
                    error,
                    env
                );

                message.ack();

                continue;
            }

            /*
             * Transient failures are retried by Cloudflare.
             *
             * The persisted job remains processing and its
             * attempt number increases when the message is
             * delivered again.
             */
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