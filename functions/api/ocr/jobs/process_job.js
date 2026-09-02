// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROCESSOR
// ============================================================

const PROCESS_JOB_VERSION =
    "ocr-process-job-1.1";

// ============================================================
// MAIN
// ============================================================

export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } = context;

    let jobId =
        null;

    try {
        // ====================================================
        // CONFIGURATION
        // ====================================================

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR storage is not configured.",
                    version:
                        PROCESS_JOB_VERSION
                },
                500
            );
        }

        if (
            !env.OCR_API_URL
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR API URL is not configured.",
                    version:
                        PROCESS_JOB_VERSION
                },
                503
            );
        }

        if (
            !env.OCR_API_KEY
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR API authentication is not configured.",
                    version:
                        PROCESS_JOB_VERSION
                },
                503
            );
        }
        const processToken =
            String(
                request.headers.get(
                    "X-OCR-Job-Token"
                )
                || ""
            )
            .trim();

        const expectedToken =
            String(
                env.OCR_JOB_PROCESS_SECURE_TOKEN
                || ""
            )
            .trim();

        if (
            !expectedToken
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job processor authentication is not configured.",
                    version:
                        PROCESS_JOB_VERSION
                },
                503
            );
        }

        if (
            processToken !== expectedToken
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Unauthorized.",
                    version:
                        PROCESS_JOB_VERSION
                },
                401
            );
        }
        // ====================================================
        // REQUEST
        // ====================================================

        let body;

        try {
            body =
                await request.json();
        }
        catch {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Request body must be valid JSON.",
                    version:
                        PROCESS_JOB_VERSION
                },
                400
            );
        }

        jobId =
            sanitizeJobId(
                body?.jobId
            );

        if (
            !jobId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Missing or invalid jobId.",
                    version:
                        PROCESS_JOB_VERSION
                },
                400
            );
        }

        const baseKey =
            `ocr-jobs/${jobId}`;

        const inputKey =
            `${baseKey}/input.png`;

        const requestKey =
            `${baseKey}/request.json`;

        const statusKey =
            `${baseKey}/status.json`;

        // ====================================================
        // LOAD STORED JOB
        // ====================================================

        const [
            inputObject,
            requestObject,
            statusObject
        ] = await Promise.all([
            env.OCR_STORAGE.get(
                inputKey
            ),
            env.OCR_STORAGE.get(
                requestKey
            ),
            env.OCR_STORAGE.get(
                statusKey
            )
        ]);

        if (
            !inputObject
            || !requestObject
            || !statusObject
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job files are incomplete.",
                    jobId,
                    version:
                        PROCESS_JOB_VERSION
                },
                404
            );
        }

        let requestData;
        let statusData;

        try {
            requestData =
                JSON.parse(
                    await requestObject.text()
                );

            statusData =
                JSON.parse(
                    await statusObject.text()
                );
        }
        catch {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job metadata is invalid.",
                    jobId,
                    version:
                        PROCESS_JOB_VERSION
                },
                500
            );
        }

        // ====================================================
        // JOB STATE CHECK
        // ====================================================

        if (
            statusData.status
            === "completed"
        ) {
            return jsonResponse(
                {
                    success: true,
                    jobId,
                    providerJobId:
                        statusData.providerJobId
                        || null,
                    status:
                        "completed",
                    matchId:
                        statusData.matchId
                        || null,
                    resultKey:
                        statusData.resultKey
                        || null,
                    benchmarkKey:
                        statusData.benchmarkKey
                        || null,
                    message:
                        "OCR job is already completed.",
                    version:
                        PROCESS_JOB_VERSION
                },
                200
            );
        }

        const now =
            new Date()
                .toISOString();

        const startedAt =
            statusData.startedAt
            || now;

        const attempt =
            Number(
                statusData.attempt
                || 0
            ) + 1;

        // ====================================================
        // MARK PROCESSING
        // ====================================================

        await updateStatus(
            env,
            statusKey,
            {
                ...statusData,
                status:
                    "processing",
                stage:
                    "preparing_image",
                progress:
                    5,
                startedAt,
                updatedAt:
                    now,
                heartbeatAt:
                    now,
                attempt,
                error:
                    null
            }
        );

        // ====================================================
        // BUILD CLOUD RUN FORM
        // ====================================================

        const imageBytes =
            await inputObject.arrayBuffer();

        const contentType =
            inputObject.httpMetadata
                ?.contentType
            || "image/png";

        const imageBlob =
            new Blob(
                [
                    imageBytes
                ],
                {
                    type:
                        contentType
                }
            );

        const formData =
            new FormData();

        formData.set(
            "file",
            imageBlob,
            "input.png"
        );

        const fields =
            (
                requestData
                && typeof requestData.fields
                    === "object"
                && requestData.fields !== null
            )
                ? requestData.fields
                : {};

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                fields
            )
        ) {
            if (
                value === null
                || value === undefined
            ) {
                continue;
            }

            if (
                Array.isArray(
                    value
                )
            ) {
                for (
                    const item
                    of value
                ) {
                    formData.append(
                        key,
                        String(
                            item
                        )
                    );
                }
            }
            else {
                formData.set(
                    key,
                    String(
                        value
                    )
                );
            }
        }

        // ====================================================
        // UPDATE STATE BEFORE CLOUD RUN
        // ====================================================

        const ocrStartedAt =
            new Date()
                .toISOString();

        await updateStatus(
            env,
            statusKey,
            {
                ...statusData,
                status:
                    "processing",
                stage:
                    "ocr",
                progress:
                    10,
                startedAt,
                updatedAt:
                    ocrStartedAt,
                heartbeatAt:
                    ocrStartedAt,
                attempt,
                error:
                    null
            }
        );

        // ====================================================
        // CALL CLOUD RUN
        // ====================================================

        const upstreamHeaders =
            new Headers();

        upstreamHeaders.set(
            "X-API-Key",
            env.OCR_API_KEY
        );

        upstreamHeaders.set(
            "X-BPD-OCR-Handler-Version",
            PROCESS_JOB_VERSION
        );

        upstreamHeaders.set(
            "X-BPD-OCR-Job-ID",
            jobId
        );

        const ocrResponse =
            await fetch(
                env.OCR_API_URL,
                {
                    method:
                        "POST",
                    headers:
                        upstreamHeaders,
                    body:
                        formData
                }
            );

        const result =
            await readUpstreamResponse(
                ocrResponse
            );

        // ====================================================
        // ISOLATE PROVIDER DATA
        // ====================================================

        const providerJobId =
            result?.jobId
            || result?.benchmark?.jobId
            || null;

        const matchId =
            result?.matchId
            || null;

        const resultKey =
            result?.storage?.reportKey
            || (
                matchId
                    ? `match-reports/${matchId}.json`
                    : null
            );

        const benchmarkKey =
            result?.storage?.benchmarkKey
            || result?.benchmark
                ?.storage
                ?.benchmarkKey
            || (
                providerJobId
                    ? `ocr-benchmarks/${providerJobId}.json`
                    : null
            );

        const providerMessage =
            result?.message
            || result?.error
            || null;

        // ====================================================
        // FAILED OCR
        // ====================================================

        if (
            !ocrResponse.ok
        ) {
            const failedAt =
                new Date()
                    .toISOString();

            const failedStatus = {
                ...statusData,
                status:
                    "failed",
                stage:
                    "failed",
                progress:
                    100,
                startedAt,
                updatedAt:
                    failedAt,
                completedAt:
                    failedAt,
                heartbeatAt:
                    failedAt,
                attempt,
                providerJobId,
                error: {
                    code:
                        `HTTP_${ocrResponse.status}`,
                    message:
                        providerMessage
                        || "OCR processing failed."
                }
            };

            await updateStatus(
                env,
                statusKey,
                failedStatus
            );

            return jsonResponse(
                {
                    success: false,
                    jobId,
                    providerJobId,
                    status:
                        "failed",
                    providerStatus:
                        ocrResponse.status,
                    message:
                        providerMessage
                        || "OCR processing failed.",
                    version:
                        PROCESS_JOB_VERSION
                },
                ocrResponse.status
            );
        }

        // ====================================================
        // COMPLETED OCR
        // ====================================================

        const completedAt =
            new Date()
                .toISOString();

        const completedStatus = {
            ...statusData,
            status:
                "completed",
            stage:
                "completed",
            progress:
                100,
            startedAt,
            updatedAt:
                completedAt,
            completedAt,
            heartbeatAt:
                completedAt,
            attempt,
            providerJobId,
            matchId,
            resultKey,
            benchmarkKey,
            error:
                null
        };

        await updateStatus(
            env,
            statusKey,
            completedStatus
        );

        return jsonResponse(
            {
                success: true,
                jobId,
                providerJobId,
                status:
                    "completed",
                matchId,
                resultKey,
                benchmarkKey,
                version:
                    PROCESS_JOB_VERSION
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR process job failed:",
            error
        );

        if (
            jobId
            && env.OCR_STORAGE
        ) {
            try {
                const statusKey =
                    `ocr-jobs/${jobId}/status.json`;

                const statusObject =
                    await env.OCR_STORAGE.get(
                        statusKey
                    );

                let statusData = {
                    jobId
                };

                if (
                    statusObject
                ) {
                    try {
                        statusData =
                            JSON.parse(
                                await statusObject.text()
                            );
                    }
                    catch {
                        statusData = {
                            jobId
                        };
                    }
                }

                const failedAt =
                    new Date()
                        .toISOString();

                await updateStatus(
                    env,
                    statusKey,
                    {
                        ...statusData,
                        status:
                            "failed",
                        stage:
                            "failed",
                        progress:
                            100,
                        updatedAt:
                            failedAt,
                        completedAt:
                            failedAt,
                        heartbeatAt:
                            failedAt,
                        error: {
                            code:
                                "PROCESS_EXCEPTION",
                            message:
                                String(
                                    error?.message
                                    || error
                                )
                        }
                    }
                );
            }
            catch (
                statusError
            ) {
                console.error(
                    "Unable to persist OCR failure state:",
                    statusError
                );
            }
        }

        return jsonResponse(
            {
                success: false,
                jobId,
                status:
                    "failed",
                message:
                    "Unable to process OCR job.",
                error:
                    String(
                        error?.message
                        || error
                    ),
                version:
                    PROCESS_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// STATUS UPDATE
// ============================================================

async function updateStatus(
    env,
    statusKey,
    statusData
) {
    await env.OCR_STORAGE.put(
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
    );
}

// ============================================================
// UPSTREAM RESPONSE
// ============================================================

async function readUpstreamResponse(
    response
) {
    const contentType =
        String(
            response.headers.get(
                "Content-Type"
            )
            || ""
        )
        .toLowerCase();

    if (
        contentType.includes(
            "application/json"
        )
    ) {
        try {
            return await response.json();
        }
        catch {
            return {
                success: false,
                message:
                    "OCR provider returned invalid JSON."
            };
        }
    }

    const text =
        await response.text();

    return {
        success:
            response.ok,
        message:
            text
            || (
                response.ok
                    ? "OCR request completed."
                    : "OCR provider failed."
            )
    };
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
                "Content-Type":
                    "application/json; charset=utf-8",
                "Cache-Control":
                    "no-store"
            }
        }
    );
}