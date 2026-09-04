"use strict";

import {
    writeOcrDebugTrace
} from "./debug.js";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB CLEANUP
// ============================================================

const OCR_QUEUE_STALE_MS =
    2
    * 60
    * 1000;

const OCR_PROCESSING_STALE_MS =
    8
    * 60
    * 1000;

const OCR_TERMINAL_RETENTION_MS =
    24
    * 60
    * 60
    * 1000;

const OCR_LIST_LIMIT =
    1000;

// ============================================================
// MAIN CLEANUP
// ============================================================

export async function cleanupStaleOcrJobs(
    env
) {
    if (
        !env?.OCR_STORAGE
    ) {
        console.warn(
            "[OCR CLEANUP] OCR_STORAGE is not configured."
        );

        return;
    }

    const now =
        Date.now();

    let cursor =
        undefined;

    let scannedStatuses =
        0;

    let timedOutJobs =
        0;

    let deletedJobs =
        0;

    do {
        const listed =
            await env.OCR_STORAGE.list(
                {
                    prefix:
                        "ocr-jobs/",
                    cursor,
                    limit:
                        OCR_LIST_LIMIT
                }
            );

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
            scannedStatuses +=
                1;

            try {
                const result =
                    await cleanupOneOcrJob(
                        env,
                        object.key,
                        now
                    );

                if (
                    result ===
                    "timed_out"
                ) {
                    timedOutJobs +=
                        1;
                }

                if (
                    result ===
                    "deleted"
                ) {
                    deletedJobs +=
                        1;
                }
            }
            catch (
                error
            ) {
                console.error(
                    "[OCR CLEANUP] Job cleanup failed.",
                    {
                        statusKey:
                            object.key,
                        message:
                            String(
                                error?.message
                                || error
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

    console.log(
        "[OCR CLEANUP] Sweep complete.",
        {
            scannedStatuses,
            timedOutJobs,
            deletedJobs
        }
    );
}

// ============================================================
// ONE JOB
// ============================================================

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
        return "missing";
    }

    const status =
        await readStatusObject(
            statusObject
        );

    if (
        !status
    ) {
        console.warn(
            "[OCR CLEANUP] Invalid status object.",
            {
                statusKey
            }
        );

        return "invalid";
    }

    const jobId =
        normalizeJobId(
            status.jobId
        );

    if (
        !jobId
    ) {
        console.warn(
            "[OCR CLEANUP] Invalid jobId in status.",
            {
                statusKey
            }
        );

        return "invalid";
    }

    const expectedStatusKey =
        `ocr-jobs/${jobId}/status.json`;

    if (
        expectedStatusKey !==
        statusKey
    ) {
        console.warn(
            "[OCR CLEANUP] Status path/jobId mismatch.",
            {
                statusKey,
                expectedStatusKey
            }
        );

        return "invalid";
    }

    const normalizedStatus =
        String(
            status.status
            || ""
        )
            .trim()
            .toLowerCase();

    const createdAt =
        parseTimestamp(
            status.createdAt
        );

    const heartbeatAt =
        parseTimestamp(
            status.heartbeatAt
            || status.updatedAt
            || status.startedAt
        );

    const completedAt =
        parseTimestamp(
            status.completedAt
            || status.updatedAt
        );

    // ========================================================
    // QUEUE TIMEOUT
    // ========================================================

    if (
        normalizedStatus ===
        "queued"
        && Number.isFinite(
            createdAt
        )
        && now - createdAt >=
            OCR_QUEUE_STALE_MS
    ) {
        await failStaleOcrJob(
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
            }
        );

        await safeCleanupTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "queue_timeout",
                detail: {
                    createdAt:
                        status.createdAt
                        || null,
                    previousStatus:
                        normalizedStatus,
                    previousProgress:
                        status.progress
                        ?? null
                }
            }
        );

        return "timed_out";
    }

    // ========================================================
    // PROCESSING TIMEOUT
    // ========================================================

    if (
        normalizedStatus ===
        "processing"
        && Number.isFinite(
            heartbeatAt
        )
        && now - heartbeatAt >=
            OCR_PROCESSING_STALE_MS
    ) {
        await failStaleOcrJob(
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
            }
        );

        await safeCleanupTrace(
            env,
            {
                jobId,
                component:
                    "cleanup",
                event:
                    "processing_timeout",
                detail: {
                    heartbeatAt:
                        status.heartbeatAt
                        || null,
                    updatedAt:
                        status.updatedAt
                        || null,
                    previousStage:
                        status.stage
                        || null,
                    previousProgress:
                        status.progress
                        ?? null
                }
            }
        );

        return "timed_out";
    }

    // ========================================================
    // TERMINAL RETENTION
    // ========================================================

    if (
        (
            normalizedStatus ===
            "failed"
            || normalizedStatus ===
            "completed"
        )
        && Number.isFinite(
            completedAt
        )
        && now - completedAt >=
            OCR_TERMINAL_RETENTION_MS
    ) {
        await deleteJobArtifacts(
            env,
            jobId
        );

        console.log(
            "[OCR CLEANUP] Deleted expired terminal job.",
            {
                jobId,
                status:
                    normalizedStatus
            }
        );

        return "deleted";
    }

    return "unchanged";
}

// ============================================================
// STATUS READ
// ============================================================

async function readStatusObject(
    object
) {
    try {
        const status =
            await object.json();

        if (
            !status
            || typeof status !==
                "object"
            || Array.isArray(
                status
            )
        ) {
            return null;
        }

        return status;
    }
    catch {
        return null;
    }
}

// ============================================================
// FAIL STALE JOB
// ============================================================

async function failStaleOcrJob(
    env,
    statusKey,
    status,
    failure
) {
    if (
        status.status ===
        "completed"
        || status.status ===
        "failed"
    ) {
        return status;
    }

    const now =
        new Date()
            .toISOString();

    const progress =
        normalizeProgress(
            status.progress
        );

    const summary =
        `[${failure.code}] ${failure.message}`;

    const nextStatus = {
        ...status,
        status:
            "failed",
        stage:
            failure.stage,
        progress,
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
            code:
                failure.code,
            message:
                failure.message,
            summary
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

    return nextStatus;
}

// ============================================================
// TERMINAL ARTIFACT DELETION
// ============================================================

async function deleteJobArtifacts(
    env,
    jobId
) {
    await deletePrefix(
        env.OCR_STORAGE,
        `ocr-jobs/${jobId}/`
    );

    await deletePrefix(
        env.OCR_STORAGE,
        `debug/${jobId}/`
    );
}

async function deletePrefix(
    bucket,
    prefix
) {
    const keys =
        [];

    let cursor =
        undefined;

    do {
        const listed =
            await bucket.list(
                {
                    prefix,
                    cursor,
                    limit:
                        OCR_LIST_LIMIT
                }
            );

        for (
            const object
            of listed.objects
        ) {
            keys.push(
                object.key
            );
        }

        cursor =
            listed.truncated
                ? listed.cursor
                : undefined;

    } while (
        cursor
    );

    for (
        let index = 0;
        index < keys.length;
        index += OCR_LIST_LIMIT
    ) {
        const chunk =
            keys.slice(
                index,
                index
                + OCR_LIST_LIMIT
            );

        if (
            chunk.length
        ) {
            await bucket.delete(
                chunk
            );
        }
    }
}

// ============================================================
// DEBUG
// ============================================================

async function safeCleanupTrace(
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
                message:
                    String(
                        error?.message
                        || error
                    )
            }
        );
    }
}

// ============================================================
// HELPERS
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

function parseTimestamp(
    value
) {
    return Date.parse(
        String(
            value
            || ""
        )
    );
}