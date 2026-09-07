"use strict";

import {
    writeOcrDebugTrace
} from "./debug.js";

import {
    getCurrentMatchReport,
    updateCurrentMatchReport
} from "./storage.js";

const CLEANUP_VERSION =
    "ocr-cleanup-1.3";

const OCR_QUEUE_STALE_MS =
    2
    * 60
    * 1000;

const OCR_PROCESSING_STALE_MS =
    7
    * 60
    * 1000;

const OCR_FAILED_RETENTION_MS =
    24
    * 60
    * 60
    * 1000;

const OCR_COMPLETED_MIN_RETENTION_MS =
    24
    * 60
    * 60
    * 1000;

const OCR_EDIT_DEADLINE_GRACE_MS =
    24
    * 60
    * 60
    * 1000;

const OCR_PROGRESS_STALE_MS =
    24
    * 60
    * 60
    * 1000;

const OCR_PROGRESS_PREFIX =
    "jobs";

const FAILED_PROGRESS_MAX =
    97;

/* =========================================================
   PUBLIC CLEANUP
   ========================================================= */

export async function cleanupStaleOcrJobs(
    env
) {
    if (
        !env?.OCR_STORAGE
    ) {
        return;
    }

    const now =
        Date.now();

    await cleanupDurableJobs(
        env,
        now
    );

    await cleanupOrphanedProgress(
        env,
        now
    );
}

/* =========================================================
   DURABLE JOB SWEEP
   ========================================================= */

async function cleanupDurableJobs(
    env,
    now
) {
    let cursor =
        undefined;

    do {
        const listed =
            await env.OCR_STORAGE.list({
                prefix:
                    "ocr-jobs/",
                cursor,
                limit:
                    1000
            });

        const statusObjects =
            listed.objects.filter(
                function(
                    object
                ) {
                    return object.key.endsWith(
                        "/status.json"
                    );
                }
            );

        for (
            const object
            of statusObjects
        ) {
            try {
                await cleanupOneOcrJob(
                    env,
                    object.key,
                    now
                );
            }
            catch (
                error
            ) {
                console.error(
                    "[OCR CLEANUP] Job cleanup failed.",
                    {
                        key:
                            object.key,
                        message:
                            normalizeErrorMessage(
                                error
                            )
                    }
                );
            }
        }

        cursor =
            listed.truncated
                ? listed.cursor
                : undefined;

    } while (
        cursor
    );
}

/* =========================================================
   ONE JOB
   ========================================================= */

async function cleanupOneOcrJob(
    env,
    statusKey,
    now
) {
    const statusObject =
        await env.OCR_STORAGE.get(
            statusKey
        );

    if (
        !statusObject
    ) {
        return;
    }

    let status;

    try {
        status =
            await statusObject.json();
    }
    catch (
        error
    ) {
        await safeWriteOcrDebugTrace(
            env,
            {
                component:
                    "cleanup",
                event:
                    "invalid_status_skipped",
                detail: {
                    version:
                        CLEANUP_VERSION,
                    statusKey,
                    message:
                        normalizeErrorMessage(
                            error
                        )
                }
            }
        );

        return;
    }

    if (
        !status
        || typeof status !==
            "object"
        || Array.isArray(
            status
        )
    ) {
        return;
    }

    const jobId =
        sanitizeJobId(
            status?.jobId
        );

    if (
        !jobId
    ) {
        return;
    }

    const baseKey =
        `ocr-jobs/${jobId}`;

    const inputKey =
        `${baseKey}/input.png`;

    const requestKey =
        `${baseKey}/request.json`;

    const resultKey =
        `${baseKey}/result.json`;

    const progressKey =
        `${OCR_PROGRESS_PREFIX}/${jobId}.json`;

    const normalizedStatus =
        String(
            status?.status
            || ""
        )
            .trim()
            .toLowerCase();

    const createdAt =
        parseTimestamp(
            status?.createdAt
        );

    const heartbeatAt =
        parseTimestamp(
            status?.heartbeatAt
            || status?.updatedAt
            || status?.startedAt
        );

    const completedAt =
        parseTimestamp(
            status?.completedAt
            || status?.updatedAt
        );

    const editDeadlineAt =
        parseTimestamp(
            status?.editDeadlineAt
        );

    /* =====================================================
       QUEUED TOO LONG
       ===================================================== */

    if (
        normalizedStatus ===
            "queued"
        && Number.isFinite(
            createdAt
        )
        && now - createdAt >=
            OCR_QUEUE_STALE_MS
    ) {
        await failAndTrimOcrJob(
            env,
            statusKey,
            status,
            {
                stage:
                    "queue_timeout",
                code:
                    "QUEUE_TIMEOUT",
                message:
                    "OCR job expired before processing started."
            },
            inputKey,
            requestKey,
            progressKey
        );

        await safeWriteOcrDebugTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "queue_timeout",
                detail: {
                    version:
                        CLEANUP_VERSION,
                    createdAt:
                        status?.createdAt
                        || null,
                    previousStatus:
                        normalizedStatus
                }
            }
        );

        return;
    }

    /* =====================================================
       PROCESSING TOO LONG
       ===================================================== */

    if (
        normalizedStatus ===
            "processing"
        && Number.isFinite(
            heartbeatAt
        )
        && now - heartbeatAt >=
            OCR_PROCESSING_STALE_MS
    ) {
        await failAndTrimOcrJob(
            env,
            statusKey,
            status,
            {
                stage:
                    "processing_timeout",
                code:
                    "PROCESSING_TIMEOUT",
                message:
                    "OCR processing stopped reporting progress."
            },
            inputKey,
            requestKey,
            progressKey
        );

        await safeWriteOcrDebugTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "processing_timeout",
                detail: {
                    version:
                        CLEANUP_VERSION,
                    heartbeatAt:
                        status?.heartbeatAt
                        || null,
                    updatedAt:
                        status?.updatedAt
                        || null,
                    previousStage:
                        status?.stage
                        || null,
                    previousProgress:
                        status?.progress
                        ?? null
                }
            }
        );

        return;
    }

    /* =====================================================
       COMPLETED EDIT WINDOW EXPIRED
       ===================================================== */

    if (
        normalizedStatus ===
            "completed"
        && Number.isFinite(
            editDeadlineAt
        )
        && now >=
            editDeadlineAt
    ) {
        status =
            await sealExpiredEditWindow(
                env,
                statusKey,
                status,
                now
            );
    }

    /* =====================================================
       FAILED RETENTION
       ===================================================== */

    if (
        normalizedStatus ===
            "failed"
        && Number.isFinite(
            completedAt
        )
        && now - completedAt >=
            OCR_FAILED_RETENTION_MS
    ) {
        await safeWriteOcrDebugTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "failed_job_deleted",
                detail: {
                    version:
                        CLEANUP_VERSION,
                    completedAt:
                        status?.completedAt
                        || null
                }
            }
        );

        await Promise.all([
            env.OCR_STORAGE.delete(
                statusKey
            ),
            env.OCR_STORAGE.delete(
                inputKey
            ),
            env.OCR_STORAGE.delete(
                requestKey
            ),
            env.OCR_STORAGE.delete(
                resultKey
            ),
            deleteProgressObject(
                env,
                progressKey
            )
        ]);

        return;
    }

    /* =====================================================
       COMPLETED RETENTION
       ===================================================== */

    if (
        normalizedStatus ===
            "completed"
        && shouldDeleteCompletedJob(
            status,
            now
        )
    ) {
        await safeWriteOcrDebugTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "completed_job_trimmed",
                detail: {
                    version:
                        CLEANUP_VERSION,
                    completedAt:
                        status?.completedAt
                        || null,
                    editDeadlineAt:
                        status?.editDeadlineAt
                        || null,
                    resultPreserved:
                        true,
                    currentReportPreserved:
                        true,
                    originalReportPreserved:
                        true
                }
            }
        );

        /*
         * Preserve:
         *
         * ocr-jobs/{jobId}/result.json
         * match-reports/{matchId}/current.json
         * match-reports/{matchId}/original/{jobId}.json
         *
         * result.json preserves the durable job result.
         *
         * current.json preserves the effective scoreboard that
         * may contain player confirmations or later adjustments.
         *
         * original/{jobId}.json preserves the immutable OCR
         * match-report snapshot from the original OCR job.
         *
         * Normal completed-job cleanup must never modify or
         * delete either match-report object.
         */

        await Promise.all([
            env.OCR_STORAGE.delete(
                statusKey
            ),
            env.OCR_STORAGE.delete(
                inputKey
            ),
            env.OCR_STORAGE.delete(
                requestKey
            ),
            deleteProgressObject(
                env,
                progressKey
            )
        ]);
    }
}

/* =========================================================
   COMPLETED RETENTION POLICY
   ========================================================= */

function shouldDeleteCompletedJob(
    status,
    now
) {
    const completedAt =
        parseTimestamp(
            status?.completedAt
            || status?.updatedAt
        );

    if (
        !Number.isFinite(
            completedAt
        )
    ) {
        return false;
    }

    const minimumRetentionUntil =
        completedAt
        + OCR_COMPLETED_MIN_RETENTION_MS;

    const editDeadlineAt =
        parseTimestamp(
            status?.editDeadlineAt
        );

    let retentionUntil =
        minimumRetentionUntil;

    if (
        Number.isFinite(
            editDeadlineAt
        )
    ) {
        retentionUntil =
            Math.max(
                retentionUntil,
                editDeadlineAt
                + OCR_EDIT_DEADLINE_GRACE_MS
            );
    }

    return (
        now >=
        retentionUntil
    );
}

/* =========================================================
   SEAL EXPIRED EDIT WINDOW
   ========================================================= */

async function sealExpiredEditWindow(
    env,
    statusKey,
    status,
    now
) {
    if (
        status?.editWindowOpen ===
            false
        && status?.editWindowClosedAt
    ) {
        return status;
    }

    const closedAt =
        new Date(
            now
        )
            .toISOString();

    const nextStatus = {
        ...status,
        editWindowOpen:
            false,
        editWindowClosedAt:
            status?.editWindowClosedAt
            || closedAt,
        updatedAt:
            closedAt
    };

    await env.OCR_STORAGE.put(
        statusKey,
        JSON.stringify(
            nextStatus,
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

    await synchronizeExpiredMatchReport(
        env,
        nextStatus,
        closedAt
    );

    await safeWriteOcrDebugTrace(
        env,
        {
            jobId:
                nextStatus.jobId,
            component:
                "cleanup",
            event:
                "edit_window_closed",
            detail: {
                version:
                    CLEANUP_VERSION,
                matchId:
                    nextStatus?.matchId
                    || null,
                editDeadlineAt:
                    nextStatus
                        ?.editDeadlineAt
                    || null,
                editWindowClosedAt:
                    closedAt,
                confirmationStatus:
                    nextStatus
                        ?.confirmationStatus
                    || null,
                requiresPlayerReview:
                    nextStatus
                        ?.requiresPlayerReview ===
                    true
            }
        }
    );

    return nextStatus;
}

/* =========================================================
   MATCH REPORT DEADLINE SYNC
   ========================================================= */

async function synchronizeExpiredMatchReport(
    env,
    status,
    closedAt
) {
    const matchId =
        sanitizeMatchId(
            status?.matchId
        );

    if (
        !matchId
    ) {
        return;
    }

    /*
     * Only the mutable canonical match report is synchronized.
     *
     * Never read from or write to:
     *
     * match-reports/{matchId}/original/{jobId}.json
     *
     * The original object is immutable OCR evidence.
     */
    const reportObject =
        await getCurrentMatchReport(
            env.OCR_STORAGE,
            matchId
        );

    if (
        !reportObject
    ) {
        return;
    }

    let report;

    try {
        report =
            await reportObject.json();
    }
    catch {
        return;
    }

    if (
        !report
        || typeof report !==
            "object"
        || Array.isArray(
            report
        )
    ) {
        return;
    }

    if (
        report?.editWindowOpen ===
            false
        && report?.editWindowClosedAt
    ) {
        return;
    }

    const nextReport = {
        ...report,
        editWindowOpen:
            false,
        editWindowClosedAt:
            report?.editWindowClosedAt
            || closedAt
    };

    await updateCurrentMatchReport(
        env.OCR_STORAGE,
        matchId,
        nextReport
    );
}

/* =========================================================
   FAIL + TRIM
   ========================================================= */

async function failAndTrimOcrJob(
    env,
    statusKey,
    status,
    failure,
    inputKey,
    requestKey,
    progressKey
) {
    const now =
        new Date()
            .toISOString();

    const currentProgress =
        normalizeProgress(
            status?.progress
        );

    const nextStatus = {
        ...status,
        status:
            "failed",
        stage:
            failure.stage,
        progress:
            Math.min(
                FAILED_PROGRESS_MAX,
                currentProgress
            ),
        progressSource:
            "worker",
        message:
            failure.message,
        requiresPlayerReview:
            false,
        reviewRequired:
            false,
        confirmationStatus:
            null,
        editDeadlineAt:
            null,
        editWindowOpen:
            false,
        updatedAt:
            now,
        completedAt:
            now,
        heartbeatAt:
            now,
        error: {
            code:
                failure.code,
            message:
                failure.message
        }
    };

    await env.OCR_STORAGE.put(
        statusKey,
        JSON.stringify(
            nextStatus,
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

    await Promise.all([
        env.OCR_STORAGE.delete(
            inputKey
        ),
        env.OCR_STORAGE.delete(
            requestKey
        ),
        deleteProgressObject(
            env,
            progressKey
        )
    ]);
}

/* =========================================================
   ORPHANED TEMPORARY PROGRESS
   ========================================================= */

async function cleanupOrphanedProgress(
    env,
    now
) {
    if (
        !env?.OCR_PROGRESS
    ) {
        return;
    }

    let cursor =
        undefined;

    do {
        const listed =
            await env.OCR_PROGRESS.list({
                prefix:
                    `${OCR_PROGRESS_PREFIX}/`,
                cursor,
                limit:
                    1000
            });

        for (
            const object
            of listed.objects
        ) {
            try {
                await cleanupOneProgressObject(
                    env,
                    object,
                    now
                );
            }
            catch (
                error
            ) {
                console.warn(
                    "[OCR CLEANUP] Progress sweep failed.",
                    {
                        key:
                            object?.key
                            || null,
                        message:
                            normalizeErrorMessage(
                                error
                            )
                    }
                );
            }
        }

        cursor =
            listed.truncated
                ? listed.cursor
                : undefined;

    } while (
        cursor
    );
}

/* =========================================================
   ONE TEMPORARY PROGRESS OBJECT
   ========================================================= */

async function cleanupOneProgressObject(
    env,
    object,
    now
) {
    const progressKey =
        String(
            object?.key
            || ""
        )
            .trim();

    const jobId =
        extractProgressJobId(
            progressKey
        );

    if (
        !jobId
    ) {
        return;
    }

    const durableStatus =
        await env.OCR_STORAGE.get(
            `ocr-jobs/${jobId}/status.json`
        );

    if (
        durableStatus
    ) {
        return;
    }

    const uploadedAt =
        parseTimestamp(
            object?.uploaded
        );

    /*
     * If R2 returned no usable upload timestamp, do not
     * aggressively delete the object.
     */
    if (
        !Number.isFinite(
            uploadedAt
        )
    ) {
        return;
    }

    if (
        now - uploadedAt <
            OCR_PROGRESS_STALE_MS
    ) {
        return;
    }

    await deleteProgressObject(
        env,
        progressKey
    );

    await safeWriteOcrDebugTrace(
        env,
        {
            jobId,
            component:
                "cleanup",
            event:
                "orphan_progress_deleted",
            detail: {
                version:
                    CLEANUP_VERSION,
                progressKey,
                uploadedAt:
                    new Date(
                        uploadedAt
                    )
                        .toISOString()
            }
        }
    );
}

/* =========================================================
   PROGRESS CLEANUP
   ========================================================= */

async function deleteProgressObject(
    env,
    progressKey
) {
    if (
        !env?.OCR_PROGRESS
        || !progressKey
    ) {
        return;
    }

    try {
        await env.OCR_PROGRESS.delete(
            progressKey
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR CLEANUP] Could not delete temporary progress.",
            {
                progressKey,
                message:
                    normalizeErrorMessage(
                        error
                    )
            }
        );
    }
}

/* =========================================================
   PROGRESS JOB ID
   ========================================================= */

function extractProgressJobId(
    progressKey
) {
    const match =
        /^jobs\/([A-Z0-9]{16})\.json$/i.exec(
            progressKey
        );

    if (
        !match
    ) {
        return "";
    }

    return sanitizeJobId(
        match[1]
    );
}

/* =========================================================
   JOB ID
   ========================================================= */

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

/* =========================================================
   MATCH ID
   ========================================================= */

function sanitizeMatchId(
    value
) {
    const matchId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        matchId
    )
        ? matchId
        : "";
}

/* =========================================================
   PROGRESS NORMALIZATION
   ========================================================= */

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

/* =========================================================
   TIMESTAMP
   ========================================================= */

function parseTimestamp(
    value
) {
    if (
        value instanceof Date
    ) {
        const timestamp =
            value.getTime();

        return Number.isFinite(
            timestamp
        )
            ? timestamp
            : NaN;
    }

    const timestamp =
        Date.parse(
            String(
                value
                || ""
            )
        );

    return timestamp;
}

/* =========================================================
   ERROR
   ========================================================= */

function normalizeErrorMessage(
    error
) {
    return String(
        error?.message
        || error
        || "Unknown cleanup error."
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

/* =========================================================
   NON-BLOCKING DEBUG SAFETY
   ========================================================= */

async function safeWriteOcrDebugTrace(
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
            "[OCR CLEANUP] Debug trace failed.",
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
}