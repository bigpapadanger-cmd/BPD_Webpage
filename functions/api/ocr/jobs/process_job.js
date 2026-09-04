// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROCESSOR
// ============================================================

const PROCESS_JOB_VERSION =
    "ocr-process-job-1.6";

const JOB_PROGRESS = Object.freeze({
    STARTING:
        2,
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
            logProcessError(
                {
                    jobId:
                        null,
                    code:
                        configError.code,
                    publicMessage:
                        configError.message,
                    internalMessage:
                        configError.message
                }
            );

            return failureResponse(
                {
                    jobId:
                        null,
                    code:
                        configError.code,
                    message:
                        configError.message,
                    httpStatus:
                        503
                }
            );
        }

        // ====================================================
        // INTERNAL AUTHENTICATION
        // ====================================================

        if (
            !await isAuthorizedProcessorRequest(
                request,
                env
            )
        ) {
            const failure =
                buildFailure(
                    "PROCESSOR_UNAUTHORIZED",
                    "OCR processor authentication failed."
                );

            logProcessError(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        "The supplied processor token did not match the configured processor token."
                }
            );

            return failureResponse(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    message:
                        failure.message,
                    httpStatus:
                        401
                }
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
            const failure =
                buildFailure(
                    "PROCESS_REQUEST_INVALID_JSON",
                    "The OCR processor received an invalid request."
                );

            logProcessError(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        "Processor request body was not valid JSON."
                }
            );

            return failureResponse(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    message:
                        failure.message,
                    httpStatus:
                        400
                }
            );
        }

        jobId =
            sanitizeJobId(
                body?.jobId
            );

        if (
            !jobId
        ) {
            const failure =
                buildFailure(
                    "PROCESS_JOB_ID_INVALID",
                    "The OCR job identifier is missing or invalid."
                );

            logProcessError(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        `Received jobId: ${String(body?.jobId || "")}`
                }
            );

            return failureResponse(
                {
                    jobId:
                        null,
                    code:
                        failure.code,
                    message:
                        failure.message,
                    httpStatus:
                        400
                }
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
        // LOAD CURRENT STATUS
        // ====================================================

        let currentStatus =
            await readStatus(
                env,
                statusKey
            );

        if (
            !currentStatus
        ) {
            const failure =
                buildFailure(
                    "JOB_STATUS_NOT_FOUND",
                    "The OCR job status could not be found."
                );

            logProcessError(
                {
                    jobId,
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        `Status object was not found at ${statusKey}.`
                }
            );

            return failureResponse(
                {
                    jobId,
                    code:
                        failure.code,
                    message:
                        failure.message,
                    httpStatus:
                        404
                }
            );
        }

        // ====================================================
        // IDEMPOTENCY
        // ====================================================

        if (
            currentStatus.status ===
            "completed"
        ) {
            return jsonResponse(
                {
                    success:
                        true,
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
        // PROCESSING START
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
                        null,
                    failureSummary:
                        null,
                    completedAt:
                        null
                }
            );

        // ====================================================
        // LOAD STORED JOB DATA
        // ====================================================

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
                "OCR job files are incomplete.",
                `Missing stored job files. input=${Boolean(inputObject)}, request=${Boolean(requestObject)}`
            );
        }

        let requestData;

        try {
            requestData =
                JSON.parse(
                    await requestObject.text()
                );
        }
        catch (
            error
        ) {
            throw createProcessError(
                "REQUEST_METADATA_INVALID",
                "The stored OCR request data could not be read.",
                String(
                    error?.message
                    || error
                )
            );
        }

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

        // ====================================================
        // IMAGE
        // ====================================================

        const imageBytes =
            await inputObject.arrayBuffer();

        if (
            !imageBytes
            || imageBytes.byteLength === 0
        ) {
            throw createProcessError(
                "INPUT_IMAGE_EMPTY",
                "The stored scoreboard image is empty.",
                `Stored input object ${inputKey} contained no image bytes.`
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
        // CLOUD RUN REQUEST
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

        // ====================================================
        // CALL CLOUD RUN
        // ====================================================

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

        let ocrResponse;

        try {
            ocrResponse =
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
        }
        catch (
            error
        ) {
            throw createProcessError(
                "OCR_PROVIDER_REQUEST_FAILED",
                "The scoreboard reader could not be reached.",
                String(
                    error?.message
                    || error
                )
            );
        }

        const result =
            await readUpstreamResponse(
                ocrResponse
            );

        const cloudRuntimeSeconds =
            Number(
                result?.runtimeSeconds
            );

        const validCloudRuntimeSeconds =
            Number.isFinite(
                cloudRuntimeSeconds
            )
                ? cloudRuntimeSeconds
                : null;

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
        // UPSTREAM FAILURE
        // ====================================================

        if (
            !ocrResponse.ok
            || result?.success !== true
        ) {
            const providerMessage =
                getSafeProviderMessage(
                    result
                );

            const providerCode =
                sanitizeErrorCode(
                    result?.error?.code
                    || result?.code
                    || `OCR_PROVIDER_HTTP_${ocrResponse.status}`
                );

            const failure =
                buildFailure(
                    providerCode,
                    providerMessage
                    || getProviderFallbackMessage(
                        ocrResponse.status
                    )
                );

            await markJobFailed(
                env,
                statusKey,
                {
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        providerMessage
                        || `Cloud Run returned HTTP ${ocrResponse.status}.`,
                    providerJobId
                }
            );

            logProcessError(
                {
                    jobId,
                    code:
                        failure.code,
                    publicMessage:
                        failure.message,
                    internalMessage:
                        providerMessage
                        || `Cloud Run returned HTTP ${ocrResponse.status}.`,
                    httpStatus:
                        ocrResponse.status,
                    providerJobId
                }
            );

            return failureResponse(
                {
                    jobId,
                    code:
                        failure.code,
                    message:
                        failure.message,
                    httpStatus:
                        normalizeUpstreamErrorStatus(
                            ocrResponse.status
                        )
                }
            );
        }

        // ====================================================
        // VALIDATE SUCCESS RESULT
        // ====================================================

        if (
            !matchId
        ) {
            throw createProcessError(
                "MATCH_ID_MISSING",
                "The scoreboard was processed but the result could not be finalized.",
                "OCR provider returned success without a valid matchId."
            );
        }

        // ====================================================
        // FINALIZING
        // ====================================================

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
                    providerJobId,
                    matchId,
                    resultKey,
                    benchmarkKey,
                    error:
                        null,
                    failureSummary:
                        null
                }
            );

        // ====================================================
        // COMPLETED
        // ====================================================

        const completedAt =
            new Date()
                .toISOString();

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
                cloudRuntimeSeconds:
                    validCloudRuntimeSeconds,
                progress:
                    JOB_PROGRESS.COMPLETED,
                message:
                    "Scoreboard ready. Nice shot!",
                failureSummary:
                    null,
                updatedAt:
                    completedAt,
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
            `[OCR PROCESS][COMPLETED] ${jobId} -> ${matchId}`
        );

        return jsonResponse(
            {
                success:
                    true,
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
        const code =
            sanitizeErrorCode(
                error?.code
                || "PROCESS_EXCEPTION"
            );

        const publicMessage =
            String(
                error?.publicMessage
                || "The OCR job processor encountered an unexpected error."
            )
                .trim();

        const internalMessage =
            String(
                error?.internalMessage
                || error?.message
                || error
            )
                .trim();

        const failure =
            buildFailure(
                code,
                publicMessage
            );

        logProcessError(
            {
                jobId:
                    jobId
                    || null,
                code:
                    failure.code,
                publicMessage:
                    failure.message,
                internalMessage,
                stack:
                    error?.stack
                    || null
            }
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
                            failure.code,
                        publicMessage:
                            failure.message,
                        internalMessage
                    }
                );
            }
            catch (
                statusError
            ) {
                console.error(
                    `[OCR PROCESS][STATUS_WRITE_FAILED] ${jobId}`,
                    {
                        errorCode:
                            failure.code,
                        message:
                            String(
                                statusError?.message
                                || statusError
                            )
                    }
                );
            }
        }

        return failureResponse(
            {
                jobId:
                    jobId
                    || null,
                code:
                    failure.code,
                message:
                    failure.message,
                httpStatus:
                    500
            }
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
        return {
            code:
                "CONFIG_OCR_STORAGE_MISSING",
            message:
                "OCR storage is not configured."
        };
    }

    if (
        !env.OCR_API_URL
    ) {
        return {
            code:
                "CONFIG_OCR_API_URL_MISSING",
            message:
                "OCR service URL is not configured."
        };
    }

    if (
        !env.OCR_API_KEY
    ) {
        return {
            code:
                "CONFIG_OCR_API_KEY_MISSING",
            message:
                "OCR service authentication is not configured."
        };
    }

    if (
        !env.OCR_JOB_PROCESS_SECURE_TOKEN
    ) {
        return {
            code:
                "CONFIG_PROCESS_TOKEN_MISSING",
            message:
                "OCR processor authentication is not configured."
        };
    }

    if (
        !env.OCR_JOB_PROGRESS_URL
    ) {
        return {
            code:
                "CONFIG_PROGRESS_URL_MISSING",
            message:
                "OCR progress reporting is not configured."
        };
    }

    return null;
}

// ============================================================
// INTERNAL AUTHENTICATION
// ============================================================

async function getTokenFingerprint(
    value
) {
    const token =
        String(
            value
            || ""
        )
            .trim();

    if (
        !token
    ) {
        return {
            present:
                false,
            length:
                0,
            fingerprint:
                null
        };
    }

    const bytes =
        new TextEncoder()
            .encode(
                token
            );

    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            bytes
        );

    const fingerprint =
        Array.from(
            new Uint8Array(
                digest
            )
        )
            .slice(
                0,
                6
            )
            .map(
                function(
                    byte
                ) {
                    return byte
                        .toString(
                            16
                        )
                        .padStart(
                            2,
                            "0"
                        );
                }
            )
            .join(
                ""
            );

    return {
        present:
            true,
        length:
            token.length,
        fingerprint
    };
}

async function isAuthorizedProcessorRequest(
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

    if (
        suppliedToken
        && expectedToken
        && suppliedToken === expectedToken
    ) {
        return true;
    }

    const [
        supplied,
        expected
    ] =
        await Promise.all([
            getTokenFingerprint(
                suppliedToken
            ),
            getTokenFingerprint(
                expectedToken
            )
        ]);

    console.error(
        "[OCR PROCESS][PROCESSOR_UNAUTHORIZED] Processor authentication failed.",
        {
            supplied,
            expected
        }
    );

    return false;
}

// ============================================================
// REQUEST JSON
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

    formData.append(
        "image",
        imageBlob,
        "scoreboard.png"
    );

    if (
        requestData
        && typeof requestData === "object"
    ) {
        for (
            const [
                key,
                value
            ]
            of Object.entries(
                requestData
            )
        ) {
            if (
                value === undefined
                || value === null
            ) {
                continue;
            }

            if (
                typeof value === "object"
            ) {
                formData.append(
                    key,
                    JSON.stringify(
                        value
                    )
                );
            }
            else {
                formData.append(
                    key,
                    String(
                        value
                    )
                );
            }
        }
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

    const callbackUrl =
        String(
            env.OCR_JOB_PROGRESS_URL
            || ""
        )
            .trim();

    if (
        callbackUrl
    ) {
        headers.set(
            "X-BPD-OCR-Progress-URL",
            callbackUrl
        );
    }

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

    delete nextStatus.ensureStartedAt;
    delete nextStatus.heartbeat;

    if (
        changes?.heartbeat === true
    ) {
        nextStatus.heartbeatAt =
            now;
    }

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
        publicMessage,
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

    if (
        currentStatus.status ===
        "completed"
    ) {
        return currentStatus;
    }

    const failure =
        buildFailure(
            code,
            publicMessage
        );

    const failedAt =
        new Date()
            .toISOString();

    const failedStatus = {
        ...currentStatus,
        status:
            "failed",
        stage:
            "failed",
        progress:
            normalizeProgress(
                currentStatus.progress
            ),
        message:
            "The scoreboard reader hit a bump.",
        failureSummary:
            failure.summary,
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
                failure.code,
            message:
                failure.message,
            summary:
                failure.summary
        }
    };

    await updateStatus(
        env,
        statusKey,
        failedStatus
    );

    console.error(
        `[OCR PROCESS][${failure.code}] Stored failed job ${currentStatus.jobId || "UNKNOWN"}.`,
        {
            errorCode:
                failure.code,
            internalMessage:
                String(
                    internalMessage
                    || ""
                )
        }
    );

    return failedStatus;
}

// ============================================================
// FAILURE RESPONSE
// ============================================================

function failureResponse(
    {
        jobId = null,
        code,
        message,
        httpStatus = 500
    }
) {
    const failure =
        buildFailure(
            code,
            message
        );

    return jsonResponse(
        {
            success:
                false,
            jobId:
                jobId
                || null,
            status:
                "failed",
            message:
                "The scoreboard reader hit a bump.",
            failureSummary:
                failure.summary,
            error: {
                code:
                    failure.code,
                summary:
                    failure.summary
            },
            version:
                PROCESS_JOB_VERSION
        },
        httpStatus
    );
}

// ============================================================
// FAILURE BUILDING
// ============================================================

function buildFailure(
    code,
    message
) {
    const safeCode =
        sanitizeErrorCode(
            code
        );

    let safeMessage =
        String(
            message
            || "OCR processing failed."
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    if (
        safeMessage.length > 180
    ) {
        safeMessage =
            safeMessage.slice(
                0,
                177
            )
            + "...";
    }

    return {
        code:
            safeCode,
        message:
            safeMessage,
        summary:
            `[${safeCode}] ${safeMessage}`
    };
}

// ============================================================
// ERROR CODE
// ============================================================

function sanitizeErrorCode(
    value
) {
    const code =
        String(
            value
            || "OCR_PROCESSING_FAILED"
        )
            .trim()
            .toUpperCase()
            .replace(
                /[^A-Z0-9_-]/g,
                "_"
            )
            .slice(
                0,
                80
            );

    return (
        code
        || "OCR_PROCESSING_FAILED"
    );
}

// ============================================================
// ERROR LOGGING
// ============================================================

function logProcessError(
    {
        jobId = null,
        code,
        publicMessage,
        internalMessage,
        httpStatus = null,
        providerJobId = null,
        stack = null
    }
) {
    const safeCode =
        sanitizeErrorCode(
            code
        );

    console.error(
        `[OCR PROCESS][${safeCode}] ${jobId || "UNKNOWN"}`,
        {
            errorCode:
                safeCode,
            jobId:
                jobId
                || null,
            providerJobId:
                providerJobId
                || null,
            httpStatus:
                httpStatus
                || null,
            publicMessage:
                String(
                    publicMessage
                    || ""
                ),
            internalMessage:
                String(
                    internalMessage
                    || ""
                ),
            stack:
                stack
                || null,
            version:
                PROCESS_JOB_VERSION
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
                success:
                    false,
                error: {
                    code:
                        "OCR_PROVIDER_INVALID_JSON",
                    message:
                        "OCR provider returned invalid JSON."
                }
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
        || result?.error?.message
        || result?.error?.summary
        || (
            typeof result?.error ===
            "string"
                ? result.error
                : ""
        )
        || "";

    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value
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

// ============================================================
// PROVIDER FALLBACK MESSAGE
// ============================================================

function getProviderFallbackMessage(
    status
) {
    const numeric =
        Number(
            status
        );

    if (
        numeric === 400
    ) {
        return "The scoreboard request was rejected.";
    }

    if (
        numeric === 401
        || numeric === 403
    ) {
        return "The scoreboard reader could not authenticate the request.";
    }

    if (
        numeric === 404
    ) {
        return "The scoreboard reader endpoint could not be found.";
    }

    if (
        numeric === 408
        || numeric === 504
    ) {
        return "The scoreboard reader took too long to respond.";
    }

    if (
        numeric === 413
    ) {
        return "The scoreboard image is too large to process.";
    }

    if (
        numeric === 422
    ) {
        return "The scoreboard image could not be validated.";
    }

    if (
        numeric === 429
    ) {
        return "The scoreboard reader is temporarily busy.";
    }

    if (
        numeric >= 500
    ) {
        return "The scoreboard reader encountered a server error.";
    }

    return "OCR processing failed.";
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
    publicMessage,
    internalMessage = ""
) {
    const error =
        new Error(
            String(
                internalMessage
                || publicMessage
                || "OCR processing failed."
            )
        );

    error.code =
        sanitizeErrorCode(
            code
        );

    error.publicMessage =
        String(
            publicMessage
            || "OCR processing failed."
        );

    error.internalMessage =
        String(
            internalMessage
            || error.message
        );

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
// JSON RESPONSE
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