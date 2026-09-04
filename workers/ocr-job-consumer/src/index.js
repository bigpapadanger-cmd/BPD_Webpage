"use strict";

import { apiFetch } from "../../../public/scripts/apiConnection.js";
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
    "ocr-job-consumer-1.5";

const OCR_JOB_STATUS_PREFIX =
    "ocr-jobs";

const PROCESSOR_FETCH_TIMEOUT_MS =
    300000;

const PROCESSING_LEASE_MS =
    120000;

const MAX_PROCESSOR_RESPONSE_LENGTH =
    8000;

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
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .slice(
            0,
            1000
        );
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

// ============================================================
// PROCESSOR OWNERSHIP
// ============================================================

function isProcessorOwnedStage(
    stage
) {
    const normalizedStage =
        String(
            stage
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        !normalizedStage
    ) {
        return false;
    }

    return !(
        normalizedStage ===
            "queued"
        || normalizedStage ===
            "uploaded"
        || normalizedStage ===
            "starting"
    );
}

function isProcessingLeaseActive(
    status
) {
    if (
        status?.status !==
        "processing"
    ) {
        return false;
    }

    const timestamp =
        Date.parse(
            status.heartbeatAt
            || status.updatedAt
            || ""
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        return false;
    }

    const age =
        Date.now()
        - timestamp;

    return (
        age >= 0
        && age <
            PROCESSING_LEASE_MS
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
        !env?.OCR_STORAGE
    ) {
        const error =
            new Error(
                "OCR_STORAGE is not configured."
            );

        error.code =
            "OCR_STORAGE_NOT_CONFIGURED";

        throw error;
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
        || typeof status !==
            "object"
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

        error.permanent =
            true;

        throw error;
    }

    const storedJobId =
        normalizeJobId(
            status.jobId
        );

    if (
        storedJobId
        && storedJobId !==
            jobId
    ) {
        const error =
            new Error(
                `OCR status jobId mismatch for ${jobId}.`
            );

        error.code =
            "JOB_STATUS_ID_MISMATCH";

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

// ============================================================
// START JOB
// ============================================================

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
        status.status ===
        "completed"
    ) {
        return {
            statusKey,
            status,
            terminal:
                true,
            alreadyActive:
                false
        };
    }

    /*
     * Never reset a genuinely active processor-owned stage
     * back to "starting".
     *
     * This protects against duplicate queue deliveries.
     */
    if (
        status.status ===
        "processing"
        && isProcessorOwnedStage(
            status.stage
        )
        && isProcessingLeaseActive(
            status
        )
    ) {
        return {
            statusKey,
            status,
            terminal:
                false,
            alreadyActive:
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
                status.attempt
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
                normalizeProgress(
                    status.progress
                )
            ),
        message:
            "Starting scoreboard reader.",
        startedAt:
            status.startedAt
            || now,
        updatedAt:
            now,
        heartbeatAt:
            now,
        completedAt:
            null,
        attempt,
        error:
            null,
        failureSummary:
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
            false,
        alreadyActive:
            false
    };
}

// ============================================================
// FAILURE STATUS
// ============================================================

async function markJobFailed(
    jobId,
    error,
    env
) {
    if (
        !jobId
        || !env?.OCR_STORAGE
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
            "[OCR QUEUE] Could not read status while marking failure.",
            {
                jobId,
                message:
                    normalizeErrorMessage(
                        statusError
                    )
            }
        );

        return;
    }

    if (
        current.status.status ===
        "completed"
        || current.status.status ===
        "failed"
    ) {
        return;
    }

    const now =
        new Date()
            .toISOString();

    const code =
        String(
            error?.code
            || "QUEUE_PROCESSING_FAILED"
        )
            .trim()
            .toUpperCase();

    const message =
        normalizeErrorMessage(
            error
        );

    const summary =
        `[${code}] ${message}`;

    const nextStatus = {
        ...current.status,
        status:
            "failed",
        stage:
            "consumer_failed",
        progress:
            normalizeProgress(
                current.status.progress
            ),
        message:
            "The scoreboard reader hit a bump.",
        failureSummary:
            summary,
        updatedAt:
            now,
        completedAt:
            now,
        heartbeatAt:
            now,
        error: {
            code,
            message,
            summary
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
            {
                jobId,
                message:
                    normalizeErrorMessage(
                        writeError
                    )
            }
        );
    }
}

// ============================================================
// NON-BLOCKING DEBUG
// ============================================================

function scheduleDebugTrace(
    env,
    trace,
    ctx
) {
    const operation =
        writeOcrDebugTrace(
            env,
            trace
        )
            .catch(
                function(
                    error
                ) {
                    console.warn(
                        "[OCR QUEUE] Debug trace failed.",
                        {
                            jobId:
                                trace?.jobId
                                || null,
                            event:
                                trace?.event
                                || null,
                            message:
                                normalizeErrorMessage(
                                    error
                                )
                        }
                    );
                }
            );

    if (
        ctx
        && typeof ctx.waitUntil ===
            "function"
    ) {
        ctx.waitUntil(
            operation
        );

        return;
    }

    void operation;
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
        || status === 413
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
        const parsed =
            JSON.parse(
                text
            );

        return (
            parsed
            && typeof parsed ===
                "object"
            && !Array.isArray(
                parsed
            )
        )
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}

function getProcessorFailureMessage(
    responseData,
    fallback
) {
    return normalizeErrorMessage(
        responseData?.error?.message
        || responseData?.failureSummary
        || responseData?.message
        || fallback
    );
}

// ============================================================
// FETCH PROCESSOR
// ============================================================

async function fetchProcessor(
    env,
    jobId
) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            function() {
                controller.abort(
                    "Processor request timeout"
                );
            },
            PROCESSOR_FETCH_TIMEOUT_MS
        );

    try {
        return await apiFetch(
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
                    JSON.stringify(
                        {
                            jobId
                        }
                    ),
                signal:
                    controller.signal
            }
        );
    }
    catch (
        error
    ) {
        if (
            controller.signal.aborted
        ) {
            const timeoutError =
                new Error(
                    "OCR processor request timed out."
                );

            timeoutError.code =
                "PROCESSOR_FETCH_TIMEOUT";

            timeoutError.permanent =
                false;

            throw timeoutError;
        }

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

        throw fetchError;
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(
    message,
    env,
    ctx
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
        !env?.OCR_STORAGE
    ) {
        const error =
            new Error(
                "OCR_STORAGE is not configured."
            );

        error.code =
            "OCR_STORAGE_NOT_CONFIGURED";

        throw error;
    }

    scheduleDebugTrace(
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
        },
        ctx
    );

    const starting =
        await markJobStarting(
            jobId,
            env
        );

    // ========================================================
    // TERMINAL
    // ========================================================

    if (
        starting.terminal
    ) {
        scheduleDebugTrace(
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
            },
            ctx
        );

        return {
            jobId,
            skipped:
                true,
            reason:
                "terminal"
        };
    }

    // ========================================================
    // DUPLICATE ACTIVE DELIVERY
    // ========================================================

    if (
        starting.alreadyActive
    ) {
        scheduleDebugTrace(
            env,
            {
                jobId,
                component:
                    "consumer",
                event:
                    "processor_already_active",
                detail: {
                    stage:
                        starting.status?.stage
                        || null,
                    progress:
                        starting.status?.progress
                        ?? null,
                    version:
                        CONSUMER_VERSION
                }
            },
            ctx
        );

        console.log(
            `[OCR QUEUE] Active job skipped ${jobId}`
        );

        return {
            jobId,
            skipped:
                true,
            reason:
                "already_active"
        };
    }

    scheduleDebugTrace(
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
        },
        ctx
    );

    // ========================================================
    // CONFIGURATION
    // ========================================================

    if (
        !String(
            env.OCR_JOB_PROCESS_URL
            || ""
        )
            .trim()
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
        !String(
            env.OCR_JOB_PROCESS_SECURE_TOKEN
            || ""
        )
            .trim()
    ) {
        const error =
            new Error(
                "OCR_JOB_PROCESS_SECURE_TOKEN is not configured."
            );

        error.code =
            "PROCESS_TOKEN_NOT_CONFIGURED";

        throw error;
    }

    // ========================================================
    // CALL PROCESSOR
    // ========================================================

    let response;

    try {
        response =
            await fetchProcessor(
                env,
                jobId
            );
    }
    catch (
        error
    ) {
        scheduleDebugTrace(
            env,
            {
                jobId,
                component:
                    "consumer",
                event:
                    error?.code ===
                    "PROCESSOR_FETCH_TIMEOUT"
                        ? "processor_fetch_timeout"
                        : "processor_fetch_failed",
                detail: {
                    code:
                        error?.code
                        || null,
                    message:
                        normalizeErrorMessage(
                            error
                        )
                }
            },
            ctx
        );

        throw error;
    }

    let responseText =
        await response.text();

    if (
        responseText.length >
        MAX_PROCESSOR_RESPONSE_LENGTH
    ) {
        responseText =
            responseText.slice(
                0,
                MAX_PROCESSOR_RESPONSE_LENGTH
            );
    }

    const responseData =
        parseProcessorResponse(
            responseText
        );

    // ========================================================
    // PROCESSOR ALREADY ACTIVE
    // ========================================================

    if (
        response.status ===
        202
    ) {
        scheduleDebugTrace(
            env,
            {
                jobId,
                component:
                    "consumer",
                event:
                    "processor_already_active",
                detail: {
                    httpStatus:
                        response.status,
                    stage:
                        responseData?.stage
                        || null,
                    progress:
                        responseData?.progress
                        ?? null,
                    version:
                        CONSUMER_VERSION
                }
            },
            ctx
        );

        console.log(
            `[OCR QUEUE] Processor already active ${jobId}`
        );

        return {
            jobId,
            skipped:
                true,
            reason:
                "processor_already_active",
            response:
                responseData
        };
    }

    // ========================================================
    // HTTP FAILURE
    // ========================================================

    if (
        !response.ok
    ) {
        const error =
            new Error(
                getProcessorFailureMessage(
                    responseData,
                    (
                        "OCR processor returned HTTP "
                        + response.status
                    )
                )
            );

        error.code =
            String(
                responseData?.error?.code
                || responseData?.code
                || `PROCESSOR_HTTP_${response.status}`
            );

        error.httpStatus =
            response.status;

        error.permanent =
            isPermanentProcessorFailure(
                response.status
            );

        scheduleDebugTrace(
            env,
            {
                jobId,
                component:
                    "consumer",
                event:
                    "processor_rejected",
                detail: {
                    code:
                        error.code,
                    httpStatus:
                        response.status,
                    permanent:
                        error.permanent,
                    response:
                        responseText
                }
            },
            ctx
        );

        throw error;
    }

    // ========================================================
    // INVALID SUCCESS RESPONSE
    // ========================================================

    if (
        !responseData
        || responseData.success !==
            true
    ) {
        const error =
            new Error(
                getProcessorFailureMessage(
                    responseData,
                    "OCR processor returned an unsuccessful response."
                )
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
            responseData?.permanent ===
            true;

        scheduleDebugTrace(
            env,
            {
                jobId,
                component:
                    "consumer",
                event:
                    "processor_rejected",
                detail: {
                    code:
                        error.code,
                    httpStatus:
                        response.status,
                    permanent:
                        error.permanent,
                    response:
                        responseText
                }
            },
            ctx
        );

        throw error;
    }

    // ========================================================
    // COMPLETED
    // ========================================================

    scheduleDebugTrace(
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
                    responseData.matchId
                    || null,
                version:
                    CONSUMER_VERSION
            }
        },
        ctx
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

function traceMessageFailure(
    message,
    error,
    env,
    ctx
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

    scheduleDebugTrace(
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
                    error?.permanent ===
                    true,
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
        },
        ctx
    );
}

// ============================================================
// QUEUE
// ============================================================

async function handleQueueBatch(
    batch,
    env,
    ctx
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
                env,
                ctx
            );

            message.ack();
        }
        catch (
            error
        ) {
            console.error(
                "[OCR QUEUE] Job failed.",
                {
                    jobId:
                        jobId
                        || null,
                    code:
                        error?.code
                        || null,
                    message:
                        normalizeErrorMessage(
                            error
                        ),
                    permanent:
                        error?.permanent ===
                        true,
                    queueAttempt:
                        Number(
                            message?.attempts
                        )
                        || null
                }
            );

            traceMessageFailure(
                message,
                error,
                env,
                ctx
            );

            if (
                error?.permanent ===
                true
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
             * Transient failures remain retryable.
             *
             * Do not force them to 100%.
             * Cloudflare will redeliver the message.
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
            "[OCR CLEANUP] Scheduled cleanup failed.",
            {
                message:
                    normalizeErrorMessage(
                        error
                    )
            }
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
        env,
        ctx
    ) {
        await handleQueueBatch(
            batch,
            env,
            ctx
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