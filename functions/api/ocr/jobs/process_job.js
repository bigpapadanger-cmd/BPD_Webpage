// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROCESSOR
// ============================================================

const PROCESS_JOB_VERSION =
    "ocr-process-job-1.7";

const PROCESSING_LEASE_MS =
    120000;

const OCR_PROVIDER_TIMEOUT_MS =
    295000;

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

function isProcessorOwnedStage(
    stage
) {
    const normalizedStage =
        String(
            stage
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        !normalizedStage
    ) {
        return false;
    }

    if (
        normalizedStage ===
        "starting"
    ) {
        return false;
    }

    if (
        normalizedStage ===
        "queued"
    ) {
        return false;
    }

    if (
        normalizedStage ===
        "uploaded"
    ) {
        return false;
    }

    return true;
}
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
                        configError.internalMessage
                        || configError.message
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

        const authorized =
            await isAuthorizedProcessorRequest(
                request,
                env
            );

        if (
            !authorized
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
                        "Processor authentication token was missing or invalid."
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
        // PROCESS REQUEST
        // ====================================================

        const body =
            await readJsonRequest(
                request
            );

        if (
            !body
        ) {
            return loggedFailureResponse(
                {
                    jobId:
                        null,
                    code:
                        "PROCESS_REQUEST_INVALID_JSON",
                    publicMessage:
                        "The OCR processor received an invalid request.",
                    internalMessage:
                        "Processor request body was not a valid JSON object.",
                    httpStatus:
                        400
                }
            );
        }

        jobId =
            sanitizeJobId(
                body.jobId
            );

        if (
            !jobId
        ) {
            return loggedFailureResponse(
                {
                    jobId:
                        null,
                    code:
                        "PROCESS_JOB_ID_INVALID",
                    publicMessage:
                        "The OCR job identifier is missing or invalid.",
                    internalMessage:
                        `Received jobId=${String(body.jobId || "")}`,
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
        // LOAD STATUS
        // ====================================================

        let currentStatus =
            await readRequiredJsonObject(
                env,
                statusKey,
                {
                    missingCode:
                        "JOB_STATUS_NOT_FOUND",
                    missingMessage:
                        "The OCR job status could not be found.",
                    invalidCode:
                        "JOB_STATUS_INVALID",
                    invalidMessage:
                        "The stored OCR job status is invalid."
                }
            );

        validateStatusIdentity(
            currentStatus,
            jobId,
            inputKey,
            requestKey
        );

        // ====================================================
        // COMPLETED IDEMPOTENCY
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
                        sanitizeMatchId(
                            currentStatus.matchId
                        )
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
        // DUPLICATE PROCESSOR GUARD
        // ====================================================

        if (
            currentStatus.status ===
            "processing"
            && isProcessorOwnedStage(
                currentStatus.stage
            )
            && isProcessingLeaseActive(
                currentStatus
            )
        ) {
            return jsonResponse(
                {
                    success:
                        true,
                    jobId,
                    status:
                        "processing",
                    stage:
                        String(
                            currentStatus.stage
                            || "processing"
                        ),
                    progress:
                        normalizeProgress(
                            currentStatus.progress
                        ),
                    message:
                        "OCR job is already being processed.",
                    version:
                        PROCESS_JOB_VERSION
                },
                202
            );
        }

        // ====================================================
        // PROCESSING START / RETRY
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
                        null,
                    cloudRuntimeSeconds:
                        null
                }
            );

        // ====================================================
        // LOAD JOB FILES
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
                `Missing stored objects: input=${Boolean(inputObject)}, request=${Boolean(requestObject)}`
            );
        }

        const requestData =
            await parseStoredJsonObject(
                requestObject,
                "REQUEST_METADATA_INVALID",
                "The stored OCR request data could not be read."
            );

        validateStoredRequestIdentity(
            requestData,
            jobId
        );

        const normalizedFields =
            normalizeRequestFields(
                requestData.fields
            );

        // ====================================================
        // PREPARING IMAGE
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
            || imageBytes.byteLength <= 0
        ) {
            throw createProcessError(
                "INPUT_IMAGE_EMPTY",
                "The stored scoreboard image is empty.",
                `Stored input ${inputKey} contained zero bytes.`
            );
        }

        const contentType =
            normalizeImageContentType(
                inputObject
                    .httpMetadata
                    ?.contentType
            );

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
                normalizedFields
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
        // CALL CLOUD RUN
        // ====================================================

        const ocrResponse =
            await fetchWithTimeout(
                env.OCR_API_URL,
                {
                    method:
                        "POST",
                    headers:
                        upstreamHeaders,
                    body:
                        formData
                },
                OCR_PROVIDER_TIMEOUT_MS
            );

        const result =
            await readUpstreamResponse(
                ocrResponse
            );

        // ====================================================
        // NORMALIZE PROVIDER RESULT
        // ====================================================

        const cloudRuntimeSeconds =
            normalizeRuntimeSeconds(
                result?.runtimeSeconds
            );

        const providerJobId =
            sanitizeProviderId(
                result?.jobId
                || result?.benchmark?.jobId
                || jobId
            );

        const matchId =
            sanitizeMatchId(
                result?.matchId
            );

        const returnedResultKey =
            sanitizeStorageKey(
                result?.storage?.reportKey
            );

        const resultKey =
            returnedResultKey
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
        // PROVIDER FAILURE
        // ====================================================

        if (
            !ocrResponse.ok
            || result?.success !== true
        ) {
            const providerCode =
                sanitizeErrorCode(
                    result?.error?.code
                    || result?.code
                    || `OCR_PROVIDER_HTTP_${ocrResponse.status}`
                );

            const providerMessage =
                getSafeProviderMessage(
                    result
                )
                || getProviderFallbackMessage(
                    ocrResponse.status
                );

            await markJobFailed(
                env,
                statusKey,
                {
                    code:
                        providerCode,
                    publicMessage:
                        providerMessage,
                    internalMessage:
                        buildProviderFailureLogMessage(
                            ocrResponse,
                            result
                        ),
                    providerJobId
                }
            );

            logProcessError(
                {
                    jobId,
                    code:
                        providerCode,
                    publicMessage:
                        providerMessage,
                    internalMessage:
                        buildProviderFailureLogMessage(
                            ocrResponse,
                            result
                        ),
                    httpStatus:
                        ocrResponse.status,
                    providerJobId
                }
            );

            return failureResponse(
                {
                    jobId,
                    code:
                        providerCode,
                    message:
                        providerMessage,
                    httpStatus:
                        normalizeUpstreamErrorStatus(
                            ocrResponse.status
                        )
                }
            );
        }

        // ====================================================
        // SUCCESS VALIDATION
        // ====================================================

        if (
            !matchId
        ) {
            throw createProcessError(
                "MATCH_ID_MISSING",
                "The scoreboard was processed but the result could not be finalized.",
                "OCR provider returned success=true without a valid 16-character matchId."
            );
        }

        if (
            !resultKey
        ) {
            throw createProcessError(
                "RESULT_KEY_MISSING",
                "The scoreboard result could not be located.",
                "OCR provider returned success without a usable report storage key."
            );
        }

        // ====================================================
        // VERIFY RESULT WAS SAVED
        // ====================================================

        const resultObject =
            await env.OCR_STORAGE.head(
                resultKey
            );

        if (
            !resultObject
        ) {
            throw createProcessError(
                "RESULT_REPORT_NOT_FOUND",
                "The scoreboard was processed but its saved result could not be verified.",
                `Expected OCR result was not found in R2 at ${resultKey}.`
            );
        }

        // ====================================================
        // FINALIZING
        // ====================================================

        currentStatus =
            await readStatusSafe(
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
                    cloudRuntimeSeconds,
                    error:
                        null,
                    failureSummary:
                        null
                }
            );

        // ====================================================
        // COMPLETE
        // ====================================================

        const completedAt =
            new Date()
                .toISOString();

        currentStatus =
            await readStatusSafe(
                env,
                statusKey
            )
            || currentStatus;

        const completedStatus = {
            ...currentStatus,
            status:
                "completed",
            stage:
                "completed",
            progress:
                JOB_PROGRESS.COMPLETED,
            message:
                "Scoreboard ready. Nice shot!",
            cloudRuntimeSeconds,
            providerJobId:
                providerJobId
                || currentStatus.providerJobId
                || null,
            matchId,
            resultKey,
            benchmarkKey:
                benchmarkKey
                || currentStatus.benchmarkKey
                || null,
            error:
                null,
            failureSummary:
                null,
            updatedAt:
                completedAt,
            completedAt,
            heartbeatAt:
                completedAt
        };

        await updateStatus(
            env,
            statusKey,
            completedStatus
        );

        console.log(
            `[OCR PROCESS][COMPLETED] ${jobId}`,
            {
                jobId,
                matchId,
                resultKey,
                benchmarkKey:
                    benchmarkKey
                    || null,
                cloudRuntimeSeconds,
                version:
                    PROCESS_JOB_VERSION
            }
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
            normalizePublicMessage(
                error?.publicMessage
                || "The OCR job processor encountered an unexpected error."
            );

        const internalMessage =
            String(
                error?.internalMessage
                || error?.message
                || error
            )
                .trim();

        logProcessError(
            {
                jobId:
                    jobId
                    || null,
                code,
                publicMessage,
                internalMessage,
                stack:
                    error?.stack
                    || null
            }
        );

        if (
            jobId
            && statusKey
            && env?.OCR_STORAGE
        ) {
            try {
                await markJobFailed(
                    env,
                    statusKey,
                    {
                        code,
                        publicMessage,
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
                        originalErrorCode:
                            code,
                        statusWriteError:
                            String(
                                statusError?.message
                                || statusError
                            ),
                        version:
                            PROCESS_JOB_VERSION
                    }
                );
            }
        }

        return failureResponse(
            {
                jobId:
                    jobId
                    || null,
                code,
                message:
                    publicMessage,
                httpStatus:
                    getProcessErrorHttpStatus(
                        error
                    )
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
        !env?.OCR_STORAGE
    ) {
        return configurationFailure(
            "CONFIG_OCR_STORAGE_MISSING",
            "OCR storage is not configured."
        );
    }

    if (
        !hasNonEmptyString(
            env.OCR_API_URL
        )
    ) {
        return configurationFailure(
            "CONFIG_OCR_API_URL_MISSING",
            "OCR service URL is not configured."
        );
    }

    if (
        !isValidServiceUrl(
            env.OCR_API_URL
        )
    ) {
        return configurationFailure(
            "CONFIG_OCR_API_URL_INVALID",
            "OCR service URL is invalid."
        );
    }

    if (
        !hasNonEmptyString(
            env.OCR_API_KEY
        )
    ) {
        return configurationFailure(
            "CONFIG_OCR_API_KEY_MISSING",
            "OCR service authentication is not configured."
        );
    }

    if (
        !hasNonEmptyString(
            env.OCR_JOB_PROCESS_SECURE_TOKEN
        )
    ) {
        return configurationFailure(
            "CONFIG_PROCESS_TOKEN_MISSING",
            "OCR processor authentication is not configured."
        );
    }

    if (
        !hasNonEmptyString(
            env.OCR_JOB_PROGRESS_URL
        )
    ) {
        return configurationFailure(
            "CONFIG_PROGRESS_URL_MISSING",
            "OCR progress reporting is not configured."
        );
    }

    if (
        !isValidServiceUrl(
            env.OCR_JOB_PROGRESS_URL
        )
    ) {
        return configurationFailure(
            "CONFIG_PROGRESS_URL_INVALID",
            "OCR progress reporting URL is invalid."
        );
    }

    return null;
}

function configurationFailure(
    code,
    message
) {
    return {
        code,
        message,
        internalMessage:
            message
    };
}

function hasNonEmptyString(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .length > 0;
}

function isValidServiceUrl(
    value
) {
    try {
        const url =
            new URL(
                String(
                    value
                )
                    .trim()
            );

        if (
            url.protocol === "https:"
        ) {
            return true;
        }

        return (
            url.protocol === "http:"
            && (
                url.hostname === "localhost"
                || url.hostname === "127.0.0.1"
            )
        );
    }
    catch {
        return false;
    }
}

// ============================================================
// INTERNAL AUTHENTICATION
// ============================================================

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
        !suppliedToken
        || !expectedToken
    ) {
        return false;
    }

    return secureStringEquals(
        suppliedToken,
        expectedToken
    );
}

async function secureStringEquals(
    left,
    right
) {
    const encoder =
        new TextEncoder();

    const [
        leftDigest,
        rightDigest
    ] =
        await Promise.all([
            crypto.subtle.digest(
                "SHA-256",
                encoder.encode(
                    left
                )
            ),
            crypto.subtle.digest(
                "SHA-256",
                encoder.encode(
                    right
                )
            )
        ]);

    const leftBytes =
        new Uint8Array(
            leftDigest
        );

    const rightBytes =
        new Uint8Array(
            rightDigest
        );

    if (
        leftBytes.length !==
        rightBytes.length
    ) {
        return false;
    }

    let difference =
        0;

    for (
        let index = 0;
        index < leftBytes.length;
        index += 1
    ) {
        difference |=
            leftBytes[index]
            ^ rightBytes[index];
    }

    return difference === 0;
}

// ============================================================
// PROCESS REQUEST
// ============================================================

async function readJsonRequest(
    request
) {
    try {
        const body =
            await request.json();

        if (
            !body
            || typeof body !== "object"
            || Array.isArray(
                body
            )
        ) {
            return null;
        }

        return body;
    }
    catch {
        return null;
    }
}

// ============================================================
// STORED REQUEST VALIDATION
// ============================================================

function validateStoredRequestIdentity(
    requestData,
    jobId
) {
    if (
        !requestData
        || typeof requestData !== "object"
        || Array.isArray(
            requestData
        )
    ) {
        throw createProcessError(
            "REQUEST_METADATA_INVALID",
            "The stored OCR request data is invalid.",
            "Stored request.json was not a JSON object."
        );
    }

    const storedJobId =
        sanitizeJobId(
            requestData.jobId
        );

    if (
        !storedJobId
    ) {
        throw createProcessError(
            "REQUEST_JOB_ID_MISSING",
            "The stored OCR request is incomplete.",
            "request.json did not contain a valid jobId."
        );
    }

    if (
        storedJobId !== jobId
    ) {
        throw createProcessError(
            "REQUEST_JOB_ID_MISMATCH",
            "The stored OCR request does not match this job.",
            `Processor jobId=${jobId}, stored request jobId=${storedJobId}.`
        );
    }

    if (
        !requestData.fields
        || typeof requestData.fields !== "object"
        || Array.isArray(
            requestData.fields
        )
    ) {
        throw createProcessError(
            "REQUEST_FIELDS_MISSING",
            "The stored OCR request is incomplete.",
            "request.json did not contain a valid fields object."
        );
    }
}

// ============================================================
// REQUEST FIELD NORMALIZATION
// ============================================================

function normalizeRequestFields(
    fields
) {
    if (
        !fields
        || typeof fields !== "object"
        || Array.isArray(
            fields
        )
    ) {
        throw createProcessError(
            "REQUEST_FIELDS_INVALID",
            "The OCR request data is invalid.",
            "Request fields were missing or were not an object."
        );
    }

    const playersPerTeam =
        Number(
            fields.playersPerTeam
        );

    if (
        !Number.isInteger(
            playersPerTeam
        )
        || playersPerTeam < 1
        || playersPerTeam > 4
    ) {
        throw createProcessError(
            "PLAYERS_PER_TEAM_INVALID",
            "The selected match size is invalid.",
            `playersPerTeam received ${JSON.stringify(fields.playersPerTeam)}.`
        );
    }

    const expectedPlayerNames =
        parseExpectedPlayerNames(
            fields.expectedPlayerNames
        );

    const expectedPlayerCount =
        playersPerTeam * 2;

    if (
        expectedPlayerNames.length !==
        expectedPlayerCount
    ) {
        throw createProcessError(
            "EXPECTED_PLAYER_COUNT_INVALID",
            "The submitted player list does not match the selected match size.",
            `playersPerTeam=${playersPerTeam} requires ${expectedPlayerCount} names but received ${expectedPlayerNames.length}.`
        );
    }

    const canonicalMatchType =
        `${playersPerTeam}v${playersPerTeam}`;

    const submittedMatchType =
        String(
            fields.matchType
            || canonicalMatchType
        )
            .trim()
            .toLowerCase();

    if (
        submittedMatchType !==
        canonicalMatchType
    ) {
        throw createProcessError(
            "MATCH_TYPE_MISMATCH",
            "The selected match type is inconsistent.",
            `playersPerTeam=${playersPerTeam}, matchType=${JSON.stringify(fields.matchType)}.`
        );
    }

    const normalized = {
        ...fields,
        playersPerTeam:
            String(
                playersPerTeam
            ),
        expectedPlayerNames:
            JSON.stringify(
                expectedPlayerNames
            ),
        matchType:
            canonicalMatchType
    };

    return normalized;
}

function parseExpectedPlayerNames(
    value
) {
    let parsed =
        value;

    if (
        typeof value === "string"
    ) {
        const trimmed =
            value.trim();

        if (
            !trimmed
        ) {
            throw createProcessError(
                "EXPECTED_PLAYER_NAMES_MISSING",
                "The expected player list is missing.",
                "expectedPlayerNames was an empty string."
            );
        }

        try {
            parsed =
                JSON.parse(
                    trimmed
                );
        }
        catch (
            error
        ) {
            throw createProcessError(
                "EXPECTED_PLAYER_NAMES_INVALID_JSON",
                "The submitted player list is invalid.",
                `expectedPlayerNames could not be parsed: ${String(error?.message || error)}`
            );
        }
    }

    if (
        !Array.isArray(
            parsed
        )
    ) {
        throw createProcessError(
            "EXPECTED_PLAYER_NAMES_INVALID",
            "The submitted player list is invalid.",
            "expectedPlayerNames was not an array."
        );
    }

    const normalizedNames =
        parsed.map(
            function(
                value,
                index
            ) {
                const name =
                    String(
                        value
                        ?? ""
                    )
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim();

                if (
                    !name
                ) {
                    throw createProcessError(
                        "EXPECTED_PLAYER_NAME_EMPTY",
                        "One of the submitted player names is empty.",
                        `expectedPlayerNames[${index}] was empty.`
                    );
                }

                if (
                    name.length > 128
                ) {
                    throw createProcessError(
                        "EXPECTED_PLAYER_NAME_TOO_LONG",
                        "One of the submitted player names is invalid.",
                        `expectedPlayerNames[${index}] exceeded 128 characters.`
                    );
                }

                return name;
            }
        );

    if (
        normalizedNames.length < 2
        || normalizedNames.length > 8
    ) {
        throw createProcessError(
            "EXPECTED_PLAYER_NAMES_COUNT_INVALID",
            "The submitted player list is invalid.",
            `Received ${normalizedNames.length} expected player names.`
        );
    }

    return normalizedNames;
}

// ============================================================
// CLOUD RUN FORM
// ============================================================

function buildCloudRunForm(
    imageBlob,
    normalizedFields
) {
    if (
        !(imageBlob instanceof Blob)
        || imageBlob.size <= 0
    ) {
        throw createProcessError(
            "FORM_IMAGE_INVALID",
            "The scoreboard image could not be prepared.",
            "buildCloudRunForm received an empty or invalid Blob."
        );
    }

    if (
        !normalizedFields
        || typeof normalizedFields !== "object"
        || Array.isArray(
            normalizedFields
        )
    ) {
        throw createProcessError(
            "FORM_FIELDS_INVALID",
            "The OCR request could not be prepared.",
            "buildCloudRunForm received invalid normalizedFields."
        );
    }

    const formData =
        new FormData();

    formData.append(
        "image",
        imageBlob,
        "scoreboard.png"
    );

    for (
        const [
            key,
            value
        ]
        of Object.entries(
            normalizedFields
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

            continue;
        }

        formData.append(
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
            .trim()
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

    return headers;
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(
    url,
    options,
    timeoutMs
) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            function() {
                controller.abort(
                    "OCR provider timeout"
                );
            },
            timeoutMs
        );

    try {
        return await fetch(
            url,
            {
                ...options,
                signal:
                    controller.signal
            }
        );
    }
    catch (
        error
    ) {
        if (
            controller.signal.aborted
        ) {
            throw createProcessError(
                "OCR_PROVIDER_TIMEOUT",
                "The scoreboard reader took too long to respond.",
                `OCR provider request exceeded ${timeoutMs}ms.`
            );
        }

        throw createProcessError(
            "OCR_PROVIDER_REQUEST_FAILED",
            "The scoreboard reader could not be reached.",
            String(
                error?.message
                || error
            )
        );
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

// ============================================================
// STATUS IDENTITY
// ============================================================

function validateStatusIdentity(
    status,
    jobId,
    inputKey,
    requestKey
) {
    const storedJobId =
        sanitizeJobId(
            status?.jobId
        );

    if (
        storedJobId
        && storedJobId !== jobId
    ) {
        throw createProcessError(
            "JOB_STATUS_ID_MISMATCH",
            "The OCR job status does not match this request.",
            `status.jobId=${storedJobId}, processor jobId=${jobId}.`
        );
    }

    if (
        status?.inputKey
        && status.inputKey !== inputKey
    ) {
        throw createProcessError(
            "JOB_INPUT_KEY_MISMATCH",
            "The OCR job input reference is invalid.",
            `status.inputKey=${String(status.inputKey)}, expected=${inputKey}.`
        );
    }

    if (
        status?.requestKey
        && status.requestKey !== requestKey
    ) {
        throw createProcessError(
            "JOB_REQUEST_KEY_MISMATCH",
            "The OCR job request reference is invalid.",
            `status.requestKey=${String(status.requestKey)}, expected=${requestKey}.`
        );
    }
}

// ============================================================
// PROCESSING LEASE
// ============================================================

function isProcessingLeaseActive(
    status
) {
    if (
        status?.status !==
        "processing"
    ) {
        return false;
    }

    const heartbeatTime =
        Date.parse(
            status.heartbeatAt
            || status.updatedAt
            || ""
        );

    if (
        !Number.isFinite(
            heartbeatTime
        )
    ) {
        return false;
    }

    const ageMs =
        Date.now()
        - heartbeatTime;

    return (
        ageMs >= 0
        && ageMs <
            PROCESSING_LEASE_MS
    );
}

// ============================================================
// R2 JSON
// ============================================================

async function readRequiredJsonObject(
    env,
    key,
    {
        missingCode,
        missingMessage,
        invalidCode,
        invalidMessage
    }
) {
    const object =
        await env.OCR_STORAGE.get(
            key
        );

    if (
        !object
    ) {
        throw createProcessError(
            missingCode,
            missingMessage,
            `Required R2 object was not found at ${key}.`
        );
    }

    return parseStoredJsonObject(
        object,
        invalidCode,
        invalidMessage
    );
}

async function parseStoredJsonObject(
    object,
    errorCode,
    publicMessage
) {
    let text;

    try {
        text =
            await object.text();
    }
    catch (
        error
    ) {
        throw createProcessError(
            errorCode,
            publicMessage,
            `Failed reading stored object: ${String(error?.message || error)}`
        );
    }

    let parsed;

    try {
        parsed =
            JSON.parse(
                text
            );
    }
    catch (
        error
    ) {
        throw createProcessError(
            errorCode,
            publicMessage,
            `Stored object contained invalid JSON: ${String(error?.message || error)}`
        );
    }

    if (
        !parsed
        || typeof parsed !== "object"
        || Array.isArray(
            parsed
        )
    ) {
        throw createProcessError(
            errorCode,
            publicMessage,
            "Stored JSON root was not an object."
        );
    }

    return parsed;
}

async function readStatusSafe(
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
        const parsed =
            JSON.parse(
                await object.text()
            );

        if (
            !parsed
            || typeof parsed !== "object"
            || Array.isArray(
                parsed
            )
        ) {
            return null;
        }

        return parsed;
    }
    catch {
        return null;
    }
}

// ============================================================
// STATUS WRITE
// ============================================================

async function updateStatus(
    env,
    statusKey,
    statusData
) {
    if (
        !statusData
        || typeof statusData !== "object"
        || Array.isArray(
            statusData
        )
    ) {
        throw createProcessError(
            "STATUS_WRITE_DATA_INVALID",
            "OCR job status could not be updated.",
            "updateStatus received invalid status data."
        );
    }

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

// ============================================================
// STATUS TRANSITION
// ============================================================

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

    const hasRequestedProgress =
        changes?.progress !==
        undefined;

    const requestedProgress =
        hasRequestedProgress
            ? normalizeProgress(
                changes.progress
            )
            : currentProgress;

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
        await readStatusSafe(
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
            jobId:
                currentStatus.jobId
                || null,
            internalMessage:
                String(
                    internalMessage
                    || ""
                ),
            version:
                PROCESS_JOB_VERSION
        }
    );

    return failedStatus;
}

// ============================================================
// FAILURE RESPONSE HELPERS
// ============================================================

function loggedFailureResponse(
    {
        jobId = null,
        code,
        publicMessage,
        internalMessage,
        httpStatus
    }
) {
    logProcessError(
        {
            jobId,
            code,
            publicMessage,
            internalMessage,
            httpStatus
        }
    );

    return failureResponse(
        {
            jobId,
            code,
            message:
                publicMessage,
            httpStatus
        }
    );
}

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
                message:
                    failure.message,
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

    const safeMessage =
        normalizePublicMessage(
            message
            || "OCR processing failed."
        );

    return {
        code:
            safeCode,
        message:
            safeMessage,
        summary:
            `[${safeCode}] ${safeMessage}`
    };
}

function normalizePublicMessage(
    value
) {
    let message =
        String(
            value
            || "OCR processing failed."
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    if (
        !message
    ) {
        message =
            "OCR processing failed.";
    }

    if (
        message.length > 180
    ) {
        message =
            message.slice(
                0,
                177
            )
            + "...";
    }

    return message;
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
                Number.isFinite(
                    Number(
                        httpStatus
                    )
                )
                    ? Number(
                        httpStatus
                    )
                    : null,
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

    const rawText =
        await response.text();

    if (
        !rawText
    ) {
        return {
            success:
                false,
            error: {
                code:
                    "OCR_PROVIDER_EMPTY_RESPONSE",
                message:
                    "OCR provider returned an empty response."
            }
        };
    }

    if (
        contentType.includes(
            "application/json"
        )
        || looksLikeJson(
            rawText
        )
    ) {
        try {
            const parsed =
                JSON.parse(
                    rawText
                );

            if (
                parsed
                && typeof parsed === "object"
                && !Array.isArray(
                    parsed
                )
            ) {
                return parsed;
            }

            return {
                success:
                    false,
                error: {
                    code:
                        "OCR_PROVIDER_INVALID_JSON_ROOT",
                    message:
                        "OCR provider returned an invalid JSON response."
                }
            };
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

    return {
        success:
            response.ok,
        message:
            rawText.slice(
                0,
                1000
            )
    };
}

function looksLikeJson(
    text
) {
    const trimmed =
        String(
            text
            || ""
        )
            .trim();

    return (
        trimmed.startsWith(
            "{"
        )
        || trimmed.startsWith(
            "["
        )
    );
}

// ============================================================
// PROVIDER FAILURE
// ============================================================

function getSafeProviderMessage(
    result
) {
    const candidate =
        result?.error?.message
        || result?.message
        || result?.error?.summary
        || (
            typeof result?.error ===
            "string"
                ? result.error
                : ""
        )
        || "";

    if (
        typeof candidate !==
        "string"
    ) {
        return "";
    }

    return candidate
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .slice(
            0,
            180
        );
}

function buildProviderFailureLogMessage(
    response,
    result
) {
    const providerMessage =
        getSafeProviderMessage(
            result
        );

    return [
        `Cloud Run returned HTTP ${response.status}.`,
        providerMessage
            ? `Provider message: ${providerMessage}`
            : ""
    ]
        .filter(
            Boolean
        )
        .join(
            " "
        );
}

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
    internalMessage = "",
    httpStatus = null
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
        normalizePublicMessage(
            publicMessage
            || "OCR processing failed."
        );

    error.internalMessage =
        String(
            internalMessage
            || error.message
        );

    if (
        Number.isInteger(
            httpStatus
        )
        && httpStatus >= 400
        && httpStatus <= 599
    ) {
        error.httpStatus =
            httpStatus;
    }

    return error;
}

function getProcessErrorHttpStatus(
    error
) {
    const explicitStatus =
        Number(
            error?.httpStatus
        );

    if (
        Number.isInteger(
            explicitStatus
        )
        && explicitStatus >= 400
        && explicitStatus <= 599
    ) {
        return explicitStatus;
    }

    const code =
        sanitizeErrorCode(
            error?.code
        );

    if (
        code.endsWith(
            "_NOT_FOUND"
        )
    ) {
        return 404;
    }

    if (
        code.includes(
            "INVALID"
        )
        || code.includes(
            "MISSING"
        )
        || code.includes(
            "MISMATCH"
        )
        || code.includes(
            "INCOMPLETE"
        )
    ) {
        return 400;
    }

    if (
        code ===
        "OCR_PROVIDER_TIMEOUT"
    ) {
        return 504;
    }

    if (
        code ===
        "OCR_PROVIDER_REQUEST_FAILED"
    ) {
        return 502;
    }

    return 500;
}

// ============================================================
// IMAGE CONTENT TYPE
// ============================================================

function normalizeImageContentType(
    value
) {
    const contentType =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        contentType.startsWith(
            "image/"
        )
    ) {
        return contentType;
    }

    return "image/png";
}

// ============================================================
// RUNTIME
// ============================================================

function normalizeRuntimeSeconds(
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
        || numeric < 0
    ) {
        return null;
    }

    return numeric;
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

    if (
        /[\u0000-\u001f\u007f]/.test(
            providerId
        )
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
        || key.startsWith(
            "/"
        )
        || key.includes(
            ".."
        )
        || key.includes(
            "\\"
        )
        || /[\u0000-\u001f\u007f]/.test(
            key
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