// ============================================================
// BPD GAMING NETWORK
// OCR JOB SUBMISSION
// ============================================================

const SUBMIT_JOB_VERSION = "ocr-submit-job-1.0";

export async function onRequestPost(context) {
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
                    version: SUBMIT_JOB_VERSION
                },
                500
            );
        }

        const contentType =
            request.headers.get("content-type") || "";

        if (
            !contentType.includes(
                "multipart/form-data"
            )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "Expected multipart/form-data.",
                    version: SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const formData =
            await request.formData();

        const image =
            formData.get("image");

        if (
            !image
            ||
            typeof image.arrayBuffer !== "function"
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "Missing OCR image.",
                    version: SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const imageBytes =
            await image.arrayBuffer();

        if (
            !imageBytes
            ||
            imageBytes.byteLength === 0
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "OCR image is empty.",
                    version: SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const jobId =
            createJobId();

        const now =
            new Date().toISOString();

        const baseKey =
            `ocr-jobs/${jobId}`;

        const inputKey =
            `${baseKey}/input.png`;

        const requestKey =
            `${baseKey}/request.json`;

        const statusKey =
            `${baseKey}/status.json`;

        const requestData =
            buildRequestData(
                formData,
                jobId,
                now
            );

        const statusData = {
            version:
                "ocr-job-state-1.0",

            jobId,

            status:
                "queued",

            stage:
                "queued",

            progress:
                0,

            uploadStatus:
                "completed",

            createdAt:
                now,

            startedAt:
                null,

            updatedAt:
                now,

            completedAt:
                null,

            heartbeatAt:
                null,

            attempt:
                0,

            matchId:
                null,

            inputKey,

            requestKey,

            resultKey:
                null,

            benchmarkKey:
                null,

            error:
                null
        };

        await Promise.all([
            env.OCR_STORAGE.put(
                inputKey,
                imageBytes,
                {
                    httpMetadata: {
                        contentType:
                            image.type
                            || "image/png"
                    },
                    customMetadata: {
                        jobId,
                        uploadedAt:
                            now
                    }
                }
            ),

            env.OCR_STORAGE.put(
                requestKey,
                JSON.stringify(
                    requestData,
                    null,
                    2
                ),
                {
                    httpMetadata: {
                        contentType:
                            "application/json"
                    }
                }
            ),

            env.OCR_STORAGE.put(
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
            )
        ]);

        return jsonResponse(
            {
                success: true,

                version:
                    SUBMIT_JOB_VERSION,

                jobId,

                status:
                    "queued",

                stage:
                    "queued",

                progress:
                    0,

                uploadStatus:
                    "completed"
            },
            202
        );
    }
    catch (error) {
        console.error(
            "OCR submit job failed:",
            error
        );

        return jsonResponse(
            {
                success: false,

                message:
                    "Unable to create OCR job.",

                error:
                    String(
                        error?.message
                        || error
                    ),

                version:
                    SUBMIT_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// REQUEST DATA
// ============================================================

function buildRequestData(
    formData,
    jobId,
    createdAt
) {
    const fields = {};

    for (
        const [
            key,
            value
        ]
        of formData.entries()
    ) {
        if (
            key === "image"
        ) {
            continue;
        }

        if (
            typeof value === "string"
        ) {
            if (
                Object.prototype.hasOwnProperty.call(
                    fields,
                    key
                )
            ) {
                if (
                    !Array.isArray(
                        fields[key]
                    )
                ) {
                    fields[key] = [
                        fields[key]
                    ];
                }

                fields[key].push(
                    value
                );
            }
            else {
                fields[key] =
                    value;
            }
        }
    }

    return {
        version:
            "ocr-job-request-1.0",

        jobId,

        createdAt,

        fields
    };
}

// ============================================================
// JOB ID
// ============================================================

function createJobId() {
    return crypto
        .randomUUID()
        .replaceAll(
            "-",
            ""
        )
        .slice(
            0,
            16
        )
        .toUpperCase();
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