// ============================================================
// BPD GAMING NETWORK
// OCR JOB STATUS READER
// ============================================================

const GET_JOB_VERSION = "ocr-get-job-1.0";

export async function onRequestGet(context) {
    const {
        request,
        env
    } = context;

    try {
        if (!env.OCR_STORAGE) {
            return jsonResponse(
                {
                    success: false,
                    message: "OCR storage is not configured.",
                    version: GET_JOB_VERSION
                },
                500
            );
        }

        const url =
            new URL(
                request.url
            );

        const jobId =
            sanitizeJobId(
                url.searchParams.get(
                    "jobId"
                )
            );

        if (!jobId) {
            return jsonResponse(
                {
                    success: false,
                    message: "Missing or invalid jobId.",
                    version: GET_JOB_VERSION
                },
                400
            );
        }

        const statusKey =
            `ocr-jobs/${jobId}/status.json`;

        const statusObject =
            await env.OCR_STORAGE.get(
                statusKey
            );

        if (!statusObject) {
            return jsonResponse(
                {
                    success: false,
                    message: "OCR job was not found.",
                    jobId,
                    version: GET_JOB_VERSION
                },
                404
            );
        }

        const statusText =
            await statusObject.text();

        let statusData;

        try {
            statusData =
                JSON.parse(
                    statusText
                );
        }
        catch (error) {
            console.error(
                "OCR job status JSON parse failed:",
                error
            );

            return jsonResponse(
                {
                    success: false,
                    message: "OCR job status is invalid.",
                    jobId,
                    version: GET_JOB_VERSION
                },
                500
            );
        }

        return jsonResponse(
            {
                success: true,
                version: GET_JOB_VERSION,
                job: sanitizeJobResponse(
                    statusData
                )
            },
            200
        );
    }
    catch (error) {
        console.error(
            "OCR get job failed:",
            error
        );

        return jsonResponse(
            {
                success: false,
                message: "Unable to read OCR job.",
                error:
                    String(
                        error?.message
                        || error
                    ),
                version: GET_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// JOB RESPONSE
// ============================================================

function sanitizeJobResponse(
    statusData
) {
    return {
        jobId:
            statusData?.jobId
            || null,

        status:
            statusData?.status
            || "unknown",

        stage:
            statusData?.stage
            || "unknown",

        progress:
            normalizeProgress(
                statusData?.progress
            ),

        uploadStatus:
            statusData?.uploadStatus
            || null,

        createdAt:
            statusData?.createdAt
            || null,

        startedAt:
            statusData?.startedAt
            || null,

        updatedAt:
            statusData?.updatedAt
            || null,

        completedAt:
            statusData?.completedAt
            || null,

        heartbeatAt:
            statusData?.heartbeatAt
            || null,

        attempt:
            Number(
                statusData?.attempt
                || 0
            ),

        matchId:
            statusData?.matchId
            || null,

        resultKey:
            statusData?.resultKey
            || null,

        benchmarkKey:
            statusData?.benchmarkKey
            || null,

        error:
            sanitizeError(
                statusData?.error
            )
    };
}

// ============================================================
// ERROR RESPONSE
// ============================================================

function sanitizeError(
    error
) {
    if (!error) {
        return null;
    }

    if (
        typeof error === "string"
    ) {
        return {
            message:
                error
        };
    }

    return {
        code:
            error.code
            || null,

        message:
            error.message
            || "OCR processing failed."
    };
}

// ============================================================
// PROGRESS
// ============================================================

function normalizeProgress(
    value
) {
    const progress =
        Number(
            value
        );

    if (
        !Number.isFinite(
            progress
        )
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            progress
        )
    );
}

// ============================================================
// JOB ID
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

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return null;
    }

    return jobId;
}

// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
    data,
    status=200
) {
    return new Response(
        JSON.stringify(
            data
        ),
        {
            status,

            headers: {
                "content-type":
                    "application/json; charset=utf-8",

                "cache-control":
                    "no-store"
            }
        }
    );
}