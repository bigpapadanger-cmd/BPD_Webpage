"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR QUEUE CONSUMER
// ============================================================

const CONSUMER_VERSION =
    "ocr-job-consumer-1.0";

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
                    JSON.stringify(
                        {
                            jobId
                        }
                    )
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