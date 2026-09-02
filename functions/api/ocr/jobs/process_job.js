// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROCESSOR
// ============================================================
const PROCESS_JOB_VERSION =
    "ocr-process-job-1.0";
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
        const body =
            await request.json();
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
        const requestData =
            JSON.parse(
                await requestObject.text()
            );
        const statusData =
            JSON.parse(
                await statusObject.text()
            );
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
                    message:
                        "OCR job is already completed.",
                    jobId,
                    status:
                        "completed",
                    version:
                        PROCESS_JOB_VERSION
                },
                200
            );
        }
        const startedAt =
            statusData.startedAt
            || new Date().toISOString();
        const attempt =
            Number(
                statusData.attempt
                || 0
            ) + 1;
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
                    new Date().toISOString(),
                heartbeatAt:
                    new Date().toISOString(),
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
        const formData =
            new FormData();
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
        // UPDATE STATE BEFORE OCR
        // ====================================================
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
                    new Date().toISOString(),
                heartbeatAt:
                    new Date().toISOString(),
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
        // FAILED OCR
        // ====================================================
        if (
            !ocrResponse.ok
        ) {
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
                    new Date().toISOString(),
                completedAt:
                    new Date().toISOString(),
                heartbeatAt:
                    new Date().toISOString(),
                attempt,
                error: {
                    code:
                        `HTTP_${ocrResponse.status}`,
                    message:
                        result?.message
                        || result?.error
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
                    status:
                        "failed",
                    providerStatus:
                        ocrResponse.status,
                    result,
                    version:
                        PROCESS_JOB_VERSION
                },
                ocrResponse.status
            );
        }
        // ====================================================
        // COMPLETED OCR
        // ====================================================
        const matchId =
            result?.matchId
            || null;
        const resultKey =
            matchId
                ? `match-reports/${matchId}.json`
                : null;
        const benchmarkKey =
            `ocr-benchmarks/${jobId}.json`;
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
                new Date().toISOString(),
            completedAt:
                new Date().toISOString(),
            heartbeatAt:
                new Date().toISOString(),
            attempt,
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
                status:
                    "completed",
                matchId,
                resultKey,
                benchmarkKey,
                result,
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
                    statusData =
                        JSON.parse(
                            await statusObject.text()
                        );
                }
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
                            new Date().toISOString(),
                        completedAt:
                            new Date().toISOString(),
                        heartbeatAt:
                            new Date().toISOString(),
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