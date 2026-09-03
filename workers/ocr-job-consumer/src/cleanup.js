"use strict";

import {
    writeOcrDebugTrace
} from "./debug.js";

const OCR_QUEUE_STALE_MS =
    2
    * 60
    * 1000;

const OCR_PROCESSING_STALE_MS =
    7
    * 60
    * 1000;

const OCR_TERMINAL_RETENTION_MS =
    24
    * 60
    * 60
    * 1000;

export async function cleanupStaleOcrJobs(
    env
) {
    if (
        !env.OCR_STORAGE
    ) {
        return;
    }

    const now =
        Date.now();

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
                    "[OCR CLEANUP] Failed:",
                    object.key,
                    error
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
    catch {
        return;
    }

    if (
        !status
        || typeof status !== "object"
        || Array.isArray(
            status
        )
    ) {
        return;
    }

    const jobId =
        String(
            status?.jobId
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return;
    }

    const baseKey =
        `ocr-jobs/${jobId}`;

    const inputKey =
        `${baseKey}/input.png`;

    const requestKey =
        `${baseKey}/request.json`;

    const normalizedStatus =
        String(
            status?.status
            || ""
        )
            .trim()
            .toLowerCase();

    const createdAt =
        Date.parse(
            status?.createdAt
            || ""
        );

    const heartbeatAt =
        Date.parse(
            status?.heartbeatAt
            || status?.updatedAt
            || status?.startedAt
            || ""
        );

    const completedAt =
        Date.parse(
            status?.completedAt
            || status?.updatedAt
            || ""
        );

    if (
        normalizedStatus === "queued"
        && Number.isFinite(
            createdAt
        )
        && now - createdAt
            >= OCR_QUEUE_STALE_MS
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
            requestKey
        );

        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "cleanup",

                event:
                    "queue_timeout",

                detail: {
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

    if (
        normalizedStatus === "processing"
        && Number.isFinite(
            heartbeatAt
        )
        && now - heartbeatAt
            >= OCR_PROCESSING_STALE_MS
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
            requestKey
        );

        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "cleanup",

                event:
                    "processing_timeout",

                detail: {
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

    if (
        (
            normalizedStatus === "failed"
            || normalizedStatus === "completed"
        )
        && Number.isFinite(
            completedAt
        )
        && now - completedAt
            >= OCR_TERMINAL_RETENTION_MS
    ) {
        await writeOcrDebugTrace(
            env,
            {
                jobId,

                component:
                    "cleanup",

                event:
                    "terminal_status_deleted",

                detail: {
                    status:
                        normalizedStatus,

                    completedAt:
                        status?.completedAt
                        || null
                }
            }
        );

        await env.OCR_STORAGE.delete(
            statusKey
        );
    }
}

async function failAndTrimOcrJob(
    env,
    statusKey,
    status,
    failure,
    inputKey,
    requestKey
) {
    const now =
        new Date()
            .toISOString();

    await env.OCR_STORAGE.put(
        statusKey,
        JSON.stringify(
            {
                ...status,

                status:
                    "failed",

                stage:
                    failure.stage,

                progress:
                    100,

                message:
                    failure.message,

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

    await Promise.all([
        env.OCR_STORAGE.delete(
            inputKey
        ),

        env.OCR_STORAGE.delete(
            requestKey
        )
    ]);
}