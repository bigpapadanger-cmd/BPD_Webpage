
"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROCESSOR
// ============================================================

const PROCESS_JOB_VERSION =
    "ocr-process-job-1.3";

const JOB_PROGRESS =
    Object.freeze({
        LOADING_JOB:
            4,
        PREPARING_IMAGE:
            6,
        BUILDING_REQUEST:
            8,
        CONTACTING_OCR:
            10,
        OCR_STARTED:
            12,
        FINALIZING:
            96,
        COMPLETED:
            100,
        FAILED:
            100
    });

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
        "";

    let statusKey =
        "";

    try {
        // ====================================================
        // CONFIGURATION
        // ====================================================

        const configError =
            validateConfiguration(
                env
            );

        if (
            configError
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        configError,
                    version:
                        PROCESS_JOB_VERSION
                },
                503
            );
        }

        // ====================================================
        // AUTHENTICATION
        // ====================================================

        if (
            !isAuthorizedProcessorRequest(
                request,
                env
            )
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

        const body =
            await readJsonRequest(
                request
            );

        if (
            !body
        ) {
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

        statusKey =
            `${baseKey}/status.json`;

        // ====================================================
        // CURRENT STATUS
        // ====================================================

        let currentStatus =
            await readStatus(
                env,
                statusKey
            );

        if (
            !currentStatus
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job status was not found.",
                    jobId,
                    version:
                        PROCESS_JOB_VERSION
                },
                404
            );
        }

        // ====================================================
        // IDEMPOTENCY
        // ====================================================

        if (
            currentStatus.status
            === "completed"
        ) {
            return jsonResponse(
                {
                    success: true,
                    jobId,
                    status:
                        "completed",
                    matchId:
                        currentStatus.matchId
                        || null,
                    message:
                        "OCR job is already completed.",
                    version:
                        PROCESS_JOB_VERSION
                },
                200
            );
        }

        // ====================================================
        // LOAD JOB
        // ====================================================

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    status:
                        "processing",
                    stage:
                        "loading_job",
                    progress:
                        JOB_PROGRESS.LOADING_JOB,
                    message:
                        "Loading your scoreboard.",
                    ensureStartedAt:
                        true,
                    heartbeat:
                        true,
                    error:
                        null
                }
            );

        const [
            inputObject,
            requestObject
        ] =
            await Promise.all([
                env.OCR_STORAGE.get(
                    inputKey
                ),
                env.OCR_STORAGE.get(
                    requestKey
                )
            ]);

        if (
            !inputObject
            || !requestObject
        ) {
            throw createProcessError(
                "JOB_FILES_INCOMPLETE",
                "OCR job files are incomplete."
            );
        }

        let requestData;

        try {
            requestData =
                JSON.parse(
                    await requestObject.text()
                );
        }
        catch {
            throw createProcessError(
                "REQUEST_METADATA_INVALID",
                "OCR request metadata is invalid."
            );
        }

        // ====================================================
        // PREPARE IMAGE
        // ====================================================

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    stage:
                        "preparing_image",
                    progress:
                        JOB_PROGRESS.PREPARING_IMAGE,
                    message:
                        "Getting the pixels lined up.",
                    heartbeat:
                        true
                }
            );

        const imageBytes =
            await inputObject.arrayBuffer();

        if (
            !imageBytes
            || imageBytes.byteLength === 0
        ) {
            throw createProcessError(
                "INPUT_IMAGE_EMPTY",
                "Stored OCR image is empty."
            );
        }

        const contentType =
            inputObject
                .httpMetadata
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

        // ====================================================
        // BUILD CLOUD RUN REQUEST
        // ====================================================

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    stage:
                        "building_request",
                    progress:
                        JOB_PROGRESS.BUILDING_REQUEST,
                    message:
                        "Building the OCR request.",
                    heartbeat:
                        true
                }
            );

        const formData =
            buildCloudRunForm(
                imageBlob,
                requestData
            );

        const upstreamHeaders =
            buildCloudRunHeaders(
                env,
                jobId
            );

        // ====================================================
        // CONTACT CLOUD RUN
        // ====================================================

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    stage:
                        "contacting_ocr",
                    progress:
                        JOB_PROGRESS.CONTACTING_OCR,
                    message:
                        "Waking up the scoreboard reader.",
                    heartbeat:
                        true
                }
            );

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    stage:
                        "ocr",
                    progress:
                        JOB_PROGRESS.OCR_STARTED,
                    message:
                        "Crunching scoreboard pixels.",
                    heartbeat:
                        true
                }
            );

        // ====================================================
        // CLOUD RUN
        // ====================================================

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
        // PROVIDER RESULT
        // ====================================================

        const providerJobId =
            sanitizeProviderId(
                result?.jobId
                || result?.benchmark?.jobId
            );

        const matchId =
            sanitizeMatchId(
                result?.matchId
            );

        const resultKey =
            sanitizeStorageKey(
                result?.storage?.reportKey
            )
            || (
                matchId
                    ? `match-reports/${matchId}.json`
                    : null
            );

        const benchmarkKey =
            sanitizeStorageKey(
                result?.storage?.benchmarkKey
                || result?.benchmark
                    ?.storage
                    ?.benchmarkKey
            )
            || (
                providerJobId
                    ? `ocr-benchmarks/${providerJobId}.json`
                    : null
            );

        // ====================================================
        // CLOUD RUN FAILURE
        // ====================================================

        if (
            !ocrResponse.ok
        ) {
            const providerMessage =
                getSafeProviderMessage(
                    result
                );

            await markJobFailed(
                env,
                statusKey,
                {
                    code:
                        `HTTP_${ocrResponse.status}`,
                    internalMessage:
                        providerMessage
                        || "OCR provider returned an error.",
                    providerJobId
                }
            );

            console.error(
                `[OCR PROCESS] ${jobId} provider failure HTTP ${ocrResponse.status}:`,
                providerMessage
            );

            return jsonResponse(
                {
                    success: false,
                    jobId,
                    status:
                        "failed",
                    message:
                        "OCR processing failed.",
                    version:
                        PROCESS_JOB_VERSION
                },
                normalizeUpstreamErrorStatus(
                    ocrResponse.status
                )
            );
        }

        // ====================================================
        // VALIDATE RESULT
        // ====================================================

        if (
            !matchId
        ) {
            throw createProcessError(
                "MATCH_ID_MISSING",
                "OCR provider completed without returning a valid matchId."
            );
        }

        // ====================================================
        // FINALIZE
        // ====================================================

        /*
         * Re-read status because Cloud Run may have updated
         * progress through the callback endpoint while this
         * request was waiting for OCR to complete.
         */
        currentStatus =
            await readStatus(
                env,
                statusKey
            )
            || currentStatus;

        currentStatus =
            await transitionStatus(
                env,
                statusKey,
                currentStatus,
                {
                    status:
                        "processing",
                    stage:
                        "finalizing",
                    progress:
                        JOB_PROGRESS.FINALIZING,
                    message:
                        "Putting the finishing touches on your scoreboard.",
                    heartbeat:
                        true,
                    providerJobId:
                        providerJobId
                        || currentStatus.providerJobId
                        || null,
                    matchId,
                    resultKey:
                        resultKey
                        || currentStatus.resultKey
                        || null,
                    benchmarkKey:
                        benchmarkKey
                        || currentStatus.benchmarkKey
                        || null,
                    error:
                        null
                }
            );

        // ====================================================
        // COMPLETE
        // ====================================================

        const completedAt =
            new Date()
                .toISOString();

        /*
         * Re-read one final time so a late provider callback
         * cannot cause us to overwrite newer state blindly.
         */
        currentStatus =
            await readStatus(
                env,
                statusKey
            )
            || currentStatus;

        await updateStatus(
            env,
            statusKey,
            {
                ...currentStatus,
                status:
                    "completed",
                stage:
                    "completed",
                progress:
                    JOB_PROGRESS.COMPLETED,
                message:
                    "Scoreboard ready. Nice shot!",
                updatedAt:
                    completedAt,
                completedAt:
                    completedAt,
                heartbeatAt:
                    completedAt,
                providerJobId:
                    providerJobId
                    || currentStatus.providerJobId
                    || null,
                matchId,
                resultKey:
                    resultKey
                    || currentStatus.resultKey
                    || null,
                benchmarkKey:
                    benchmarkKey
                    || currentStatus.benchmarkKey
                    || null,
                error:
                    null
            }
        );

        console.log(
            `[OCR PROCESS] Completed ${jobId} -> ${matchId}`
        );

        return jsonResponse(
            {
                success: true,
                jobId,
                status:
                    "completed",
                matchId,
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
            `[OCR PROCESS] ${jobId || "UNKNOWN"} failed:`,
            error
        );

        if (
            jobId
            && statusKey
            && env.OCR_STORAGE
        ) {
            try {
                await markJobFailed(
                    env,
                    statusKey,
                    {
                        code:
                            String(
                                error?.code
                                || "PROCESS_EXCEPTION"
                            ),
                        internalMessage:
                            String(
                                error?.message
                                || error
                            )
                    }
                );
            }
            catch (
                statusError
            ) {
                console.error(
                    `[OCR PROCESS] Could not persist failure for ${jobId}:`,
                    statusError
                );
            }
        }

        return jsonResponse(
            {
                success: false,
                jobId:
                    jobId
                    || null,
                status:
                    "failed",
                message:
                    "Unable to process OCR job.",
                version:
                    PROCESS_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// CONFIGURATION
// ============================================================

function validateConfiguration(
    env
) {
    if (
        !env.OCR_STORAGE
    ) {
        return "OCR storage is not configured.";
    }

    if (
        !env.OCR_API_URL
    ) {
        return "OCR API URL is not configured.";
    }

    if (
        !env.OCR_API_KEY
    ) {
        return "OCR API authentication is not configured.";
    }

    if (
        !env.OCR_JOB_PROCESS_SECURE_TOKEN
    ) {
        return "OCR job processor authentication is not configured.";
    }

    if (
        !env.OCR_JOB_PROGRESS_URL
    ) {
        return "OCR progress URL is not configured.";
    }

    if (
        !env.OCR_JOB_PROGRESS_SECURE_TOKEN
    ) {
        return "OCR progress authentication is not configured.";
    }

    return "";
}

// ============================================================
// AUTHENTICATION
// ============================================================

function isAuthorizedProcessorRequest(
    request,
    env
) {
    const suppliedToken =
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

    return (
        Boolean(
            suppliedToken
        )
        && Boolean(
            expectedToken
        )
        && suppliedToken === expectedToken
    );
}

// ============================================================
// JSON REQUEST
// ============================================================

async function readJsonRequest(
    request
) {
    try {
        const body =
            await request.json();

        return (
            body
            && typeof body === "object"
            && !Array.isArray(
                body
            )
        )
            ? body
            : null;
    }
    catch {
        return null;
    }
}

// ============================================================
// CLOUD RUN FORM
// ============================================================

function buildCloudRunForm(
    imageBlob,
    requestData
) {
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
            && !Array.isArray(
                requestData.fields
            )
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
                if (
                    item === null
                    || item === undefined
                ) {
                    continue;
                }

                formData.append(
                    key,
                    String(
                        item
                    )
                );
            }

            continue;
        }

        formData.set(
            key,
            String(
                value
            )
        );
    }

    return formData;
}

// ============================================================
// CLOUD RUN HEADERS
// ============================================================

function buildCloudRunHeaders(
    env,
    jobId
) {
    const headers =
        new Headers();

    headers.set(
        "X-API-Key",
        String(
            env.OCR_API_KEY
        )
    );

    headers.set(
        "X-BPD-OCR-Handler-Version",
        PROCESS_JOB_VERSION
    );

    headers.set(
        "X-BPD-OCR-Job-ID",
        jobId
    );

    headers.set(
        "X-BPD-OCR-Progress-URL",
        String(
            env.OCR_JOB_PROGRESS_URL
        )
            .trim()
    );

    headers.set(
        "X-BPD-OCR-Progress-Token",
        String(
            env.OCR_JOB_PROGRESS_SECURE_TOKEN
        )
            .trim()
    );

    return headers;
}

// ============================================================
// STATUS
// ============================================================

async function readStatus(
    env,
    statusKey
) {
    const object =
        await env.OCR_STORAGE.get(
            statusKey
        );

    if (
        !object
    ) {
        return null;
    }

    try {
        const status =
            JSON.parse(
                await object.text()
            );

        return (
            status
            && typeof status === "object"
            && !Array.isArray(
                status
            )
        )
            ? status
            : null;
    }
    catch {
        return null;
    }
}

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

    return statusData;
}

async function transitionStatus(
    env,
    statusKey,
    currentStatus,
    changes
) {
    const now =
        new Date()
            .toISOString();

    const currentProgress =
        normalizeProgress(
            currentStatus?.progress
        );

    const requestedProgress =
        normalizeProgress(
            changes?.progress
        );

    const progress =
        Math.max(
            currentProgress,
            requestedProgress
        );

    const startedAt =
        changes?.ensureStartedAt
            ? (
                currentStatus?.startedAt
                || now
            )
            : (
                currentStatus?.startedAt
                || null
            );

    const nextStatus = {
        ...currentStatus,
        ...changes,
        progress,
        startedAt,
        updatedAt:
            now
    };

    if (
        changes?.heartbeat === true
    ) {
        nextStatus.heartbeatAt =
            now;
    }

    delete nextStatus.ensureStartedAt;
    delete nextStatus.heartbeat;

    return updateStatus(
        env,
        statusKey,
        nextStatus
    );
}

// ============================================================
// FAILED STATUS
// ============================================================

async function markJobFailed(
    env,
    statusKey,
    {
        code,
        internalMessage,
        providerJobId = null
    }
) {
    const currentStatus =
        await readStatus(
            env,
            statusKey
        )
        || {};

    /*
     * Never let a late error overwrite a job that has
     * already reached a successful terminal state.
     */
    if (
        currentStatus.status
        === "completed"
    ) {
        return currentStatus;
    }

    const failedAt =
        new Date()
            .toISOString();

    return updateStatus(
        env,
        statusKey,
        {
            ...currentStatus,
            status:
                "failed",
            stage:
                "failed",
            progress:
                JOB_PROGRESS.FAILED,
            message:
                "The scoreboard reader hit a bump.",
            updatedAt:
                failedAt,
            completedAt:
                failedAt,
            heartbeatAt:
                failedAt,
            providerJobId:
                providerJobId
                || currentStatus.providerJobId
                || null,
            error: {
                code:
                    String(
                        code
                        || "OCR_PROCESSING_FAILED"
                    ),
                message:
                    String(
                        internalMessage
                        || "OCR processing failed."
                    )
                    .slice(
                        0,
                        1000
                    )
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
            const data =
                await response.json();

            return (
                data
                && typeof data === "object"
            )
                ? data
                : {};
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
// SAFE PROVIDER MESSAGE
// ============================================================

function getSafeProviderMessage(
    result
) {
    const value =
        result?.message
        || result?.error
        || "";

    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value
        .trim()
        .slice(
            0,
            1000
        );
}

// ============================================================
// ERROR STATUS
// ============================================================

function normalizeUpstreamErrorStatus(
    status
) {
    const numeric =
        Number(
            status
        );

    if (
        numeric >= 400
        && numeric <= 599
    ) {
        return numeric;
    }

    return 502;
}

// ============================================================
// PROCESS ERROR
// ============================================================

function createProcessError(
    code,
    message
) {
    const error =
        new Error(
            message
        );

    error.code =
        code;

    return error;
}

// ============================================================
// NORMALIZATION
// ============================================================

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

function sanitizeProviderId(
    value
) {
    const providerId =
        String(
            value
            || ""
        )
            .trim();

    if (
        !providerId
        || providerId.length > 128
    ) {
        return null;
    }

    return providerId;
}

function sanitizeStorageKey(
    value
) {
    const key =
        String(
            value
            || ""
        )
            .trim();

    if (
        !key
        || key.length > 1024
        || key.includes(
            ".."
        )
    ) {
        return null;
    }

    return key;
}

// ============================================================
// RESPONSE
// ============================================================

function jsonResponse(
    data,
    status = 200
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

