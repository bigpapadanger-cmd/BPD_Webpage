
"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR QUEUE CONSUMER
// ============================================================

const CONSUMER_VERSION =
    "ocr-job-consumer-1.1";

const OCR_JOB_STATUS_PREFIX =
    "ocr-jobs";

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
        throw new Error(
            `OCR status was not found for ${jobId}.`
        );
    }

    const status =
        await object.json();

    if (
        !status
        || typeof status !== "object"
        || Array.isArray(
            status
        )
    ) {
        throw new Error(
            `OCR status is invalid for ${jobId}.`
        );
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

    await writeJobStatus(
        statusKey,
        {
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
        },
        env
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
        String(
            message?.body?.jobId
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        throw new Error(
            "Queue message contains an invalid jobId."
        );
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

    await markJobStarting(
        jobId,
        env
    );

    const response =
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

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        throw new Error(
            (
                "OCR processor returned HTTP "
                + response.status
                + ": "
                + responseText
            )
        );
    }

    console.log(
        `[OCR QUEUE] Completed ${jobId}`
    );
}


// ============================================================
// WORKER
// ============================================================

export default {
    async queue(
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

                message.retry();
            }
        }
    }
};

