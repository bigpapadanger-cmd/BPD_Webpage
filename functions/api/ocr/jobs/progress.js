"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROGRESS
// TEMPORARY CLOUD RUN PROGRESS + SIMULATED FALLBACK
// ============================================================

const PROGRESS_VERSION =
    "ocr-job-progress-2.0";

const OCR_PROGRESS_PREFIX =
    "jobs";

const SIMULATED_PROGRESS_MIN =
    12;

const SIMULATED_PROGRESS_MAX =
    95;

const PROVIDER_PROGRESS_MAX =
    97;

const DEFAULT_OCR_RUNTIME_MS =
    35000;

const MIN_OCR_RUNTIME_MS =
    20000;

const MAX_OCR_RUNTIME_MS =
    75000;

const REAL_PROGRESS_HOLD_MS =
    2500;

// ============================================================
// SIMULATED TIMELINE
// ============================================================

const OCR_PROGRESS_TIMELINE =
    Object.freeze([
        {
            fraction:
                0.00,
            progress:
                12,
            stage:
                "ocr"
        },
        {
            fraction:
                0.10,
            progress:
                16,
            stage:
                "ocr"
        },
        {
            fraction:
                0.20,
            progress:
                21,
            stage:
                "ocr",
            message:
                "Validating image..."
        },
        {
            fraction:
                0.30,
            progress:
                27,
            stage:
                "normalization"
        },
        {
            fraction:
                0.40,
            progress:
                33,
            stage:
                "headers"
        },
        {
            fraction:
                0.50,
            progress:
                39,
            stage:
                "anchors"
        },
        {
            fraction:
                0.60,
            progress:
                45,
            stage:
                "rows"
        },
        {
            fraction:
                0.66,
            progress:
                50,
            stage:
                "cells"
        },
        {
            fraction:
                0.72,
            progress:
                56,
            stage:
                "cells"
        },
        {
            fraction:
                0.77,
            progress:
                62,
            stage:
                "numeric_prepare"
        },
        {
            fraction:
                0.81,
            progress:
                66,
            stage:
                "numeric_matcher"
        },
        {
            fraction:
                0.85,
            progress:
                70,
            stage:
                "numeric_tesseract"
        },
        {
            fraction:
                0.89,
            progress:
                76,
            stage:
                "numeric_tesseract"
        },
        {
            fraction:
                0.92,
            progress:
                82,
            stage:
                "numeric_paddle"
        },
        {
            fraction:
                0.95,
            progress:
                86,
            stage:
                "numeric_resolution"
        },
        {
            fraction:
                0.97,
            progress:
                89,
            stage:
                "validation"
        },
        {
            fraction:
                0.99,
            progress:
                94,
            stage:
                "training_capture"
        },
        {
            fraction:
                1.00,
            progress:
                95,
            stage:
                "saving"
        }
    ]);

// ============================================================
// POST
// CLOUD RUN PROGRESS CALLBACK
// ============================================================

export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } = context;

    try {
        const configError =
            validateEnvironment(
                env,
                true
            );

        if (
            configError
        ) {
            return jsonResponse(
                configError.body,
                configError.status
            );
        }

        if (
            !await isAuthorizedProgressRequest(
                request,
                env
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "Unauthorized.",
                    version:
                        PROGRESS_VERSION
                },
                401
            );
        }

        const body =
            await readJsonRequest(
                request
            );

        if (
            !body
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "Request body must be valid JSON.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const jobId =
            sanitizeJobId(
                body.jobId
            );

        if (
            !jobId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "Missing or invalid jobId.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const status =
            await readDurableStatus(
                env,
                jobId
            );

        if (
            !status
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    jobId,
                    message:
                        "OCR job status was not found.",
                    version:
                        PROGRESS_VERSION
                },
                404
            );
        }

        if (
            isTerminalStatus(
                status
            )
        ) {
            return jsonResponse(
                buildProgressResponse(
                    jobId,
                    status,
                    null,
                    {
                        source:
                            "terminal"
                    }
                ),
                200
            );
        }

        const requestedProgress =
            Math.min(
                PROVIDER_PROGRESS_MAX,
                normalizeProgress(
                    body.progress
                )
            );

        if (
            requestedProgress <= 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    jobId,
                    message:
                        "Progress value must be greater than zero.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const existingProgress =
            await readTemporaryProgress(
                env,
                jobId
            );

        const previousProgress =
            Math.min(
                PROVIDER_PROGRESS_MAX,
                normalizeProgress(
                    existingProgress?.progress
                )
            );

        const confirmedProgress =
            Math.max(
                previousProgress,
                requestedProgress
            );

        const useIncomingMetadata = (
            requestedProgress >=
            previousProgress
        );

        const now =
            new Date()
                .toISOString();

        const stage = (
            useIncomingMetadata
                ? sanitizeStage(
                    body.stage
                )
                : ""
        )
        || sanitizeStage(
            existingProgress?.stage
        )
        || sanitizeStage(
            status?.stage
        )
        || "ocr";

        const message = (
            useIncomingMetadata
                ? sanitizeMessage(
                    body.message
                )
                : ""
        )
        || sanitizeMessage(
            existingProgress?.message
        )
        || sanitizeMessage(
            status?.message
        )
        || "Reading your scoreboard.";

        const work = (
            useIncomingMetadata
                ? sanitizeWork(
                    body.work
                )
                : null
        )
        || sanitizeWork(
            existingProgress?.work
        );

        const ocrStartedAt =
            normalizeTimestamp(
                existingProgress
                    ?.ocrStartedAt
            )
            || normalizeTimestamp(
                status
                    ?.ocrStartedAt
            )
            || (
                confirmedProgress >=
                    SIMULATED_PROGRESS_MIN
                    ? now
                    : null
            );

        const expectedRuntimeMs =
            normalizeExpectedRuntimeMs(
                body?.expectedRuntimeMs
                ?? body?.expectedRuntimeSeconds
                ?? existingProgress
                    ?.expectedRuntimeMs
                ?? status
                    ?.expectedRuntimeMs
                ?? status
                    ?.expectedRuntimeSeconds
            );

        const nextProgress = {
            version:
                PROGRESS_VERSION,
            jobId,
            status:
                "processing",
            stage,
            progress:
                confirmedProgress,
            confirmedProgress,
            progressSource:
                "cloud_run",
            message,
            work,
            ocrStartedAt,
            expectedRuntimeMs,
            updatedAt:
                now,
            heartbeatAt:
                now
        };

        await writeTemporaryProgress(
            env,
            jobId,
            nextProgress
        );

        return jsonResponse(
            buildProgressResponse(
                jobId,
                status,
                nextProgress,
                {
                    progress:
                        confirmedProgress,
                    confirmedProgress,
                    simulatedProgress:
                        confirmedProgress,
                    source:
                        "cloud_run"
                }
            ),
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR PROGRESS][POST] Failed.",
            {
                message:
                    String(
                        error?.message
                        || error
                    ),
                version:
                    PROGRESS_VERSION
            }
        );

        return jsonResponse(
            {
                success:
                    false,
                message:
                    "Unable to update OCR progress.",
                version:
                    PROGRESS_VERSION
            },
            500
        );
    }
}

// ============================================================
// GET
// PROGRESS POLLING
// ============================================================

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } = context;

    try {
        const configError =
            validateEnvironment(
                env,
                false
            );

        if (
            configError
        ) {
            return jsonResponse(
                configError.body,
                configError.status
            );
        }

        const requestUrl =
            new URL(
                request.url
            );

        const jobId =
            sanitizeJobId(
                requestUrl
                    .searchParams
                    .get(
                        "jobId"
                    )
            );

        if (
            !jobId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "Missing or invalid jobId.",
                    version:
                        PROGRESS_VERSION
                },
                400
            );
        }

        const status =
            await readDurableStatus(
                env,
                jobId
            );

        if (
            !status
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    jobId,
                    message:
                        "OCR job status was not found.",
                    version:
                        PROGRESS_VERSION
                },
                404
            );
        }

        if (
            isTerminalStatus(
                status
            )
        ) {
            return jsonResponse(
                buildProgressResponse(
                    jobId,
                    status,
                    null,
                    {
                        source:
                            "terminal"
                    }
                ),
                200
            );
        }

        const temporaryProgress =
            await readTemporaryProgress(
                env,
                jobId
            );

        const calculated =
            calculateHybridProgress(
                status,
                temporaryProgress
            );

        return jsonResponse(
            buildProgressResponse(
                jobId,
                status,
                temporaryProgress,
                calculated
            ),
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR PROGRESS][GET] Failed.",
            {
                message:
                    String(
                        error?.message
                        || error
                    ),
                version:
                    PROGRESS_VERSION
            }
        );

        return jsonResponse(
            {
                success:
                    false,
                message:
                    "Unable to read OCR progress.",
                version:
                    PROGRESS_VERSION
            },
            500
        );
    }
}

// ============================================================
// HYBRID PROGRESS
// ============================================================

function calculateHybridProgress(
    status,
    temporaryProgress
) {
    const storedProgress =
        normalizeProgress(
            status?.progress
        );

    const providerProgress =
        Math.min(
            PROVIDER_PROGRESS_MAX,
            normalizeProgress(
                temporaryProgress?.progress
            )
        );

    const confirmedProgress =
        Math.max(
            storedProgress,
            providerProgress
        );

    if (
        confirmedProgress >=
        96
    ) {
        return {
            progress:
                Math.min(
                    PROVIDER_PROGRESS_MAX,
                    confirmedProgress
                ),
            confirmedProgress,
            simulatedProgress:
                Math.min(
                    PROVIDER_PROGRESS_MAX,
                    confirmedProgress
                ),
            simulatedStage:
                null,
            source:
                providerProgress >=
                    storedProgress
                    ? "cloud_run"
                    : "worker"
        };
    }

    const now =
        Date.now();

    const lastRealAt =
        parseTimestamp(
            temporaryProgress
                ?.updatedAt
        );

    if (
        Number.isFinite(
            lastRealAt
        )
        && now - lastRealAt <
            REAL_PROGRESS_HOLD_MS
    ) {
        return {
            progress:
                confirmedProgress,
            confirmedProgress,
            simulatedProgress:
                confirmedProgress,
            simulatedStage:
                null,
            source:
                providerProgress >=
                    storedProgress
                    ? "cloud_run"
                    : "worker"
        };
    }

    const ocrStartedAt =
        getOcrStartedAt(
            status,
            temporaryProgress
        );

    if (
        !Number.isFinite(
            ocrStartedAt
        )
    ) {
        return {
            progress:
                confirmedProgress,
            confirmedProgress,
            simulatedProgress:
                confirmedProgress,
            simulatedStage:
                null,
            source:
                providerProgress >=
                    storedProgress
                    && providerProgress > 0
                    ? "cloud_run"
                    : "worker"
        };
    }

    const expectedRuntimeMs =
        getExpectedRuntimeMs(
            status,
            temporaryProgress
        );

    const elapsedMs =
        Math.max(
            0,
            now - ocrStartedAt
        );

    const elapsedFraction =
        Math.max(
            0,
            Math.min(
                1,
                elapsedMs
                / expectedRuntimeMs
            )
        );

    const simulated =
        calculateTimelineProgress(
            elapsedFraction
        );

    const simulatedProgress =
        simulated.progress;

    const progress =
        Math.min(
            SIMULATED_PROGRESS_MAX,
            Math.max(
                confirmedProgress,
                simulatedProgress
            )
        );

    let source =
        "simulated";

    if (
        providerProgress >=
        simulatedProgress
        && providerProgress >=
            storedProgress
    ) {
        source =
            "cloud_run";
    }
    else if (
        storedProgress >=
        simulatedProgress
    ) {
        source =
            "worker";
    }

    return {
        progress,
        confirmedProgress,
        simulatedProgress,
        simulatedStage:
            simulated.stage,
        simulatedMessage:
            simulated.message
            || null,
        source
    };
}

// ============================================================
// TIMELINE INTERPOLATION
// ============================================================

function calculateTimelineProgress(
    fraction
) {
    const normalizedFraction =
        Math.max(
            0,
            Math.min(
                1,
                Number(
                    fraction
                )
                || 0
            )
        );

    for (
        let index = 1;
        index <
            OCR_PROGRESS_TIMELINE.length;
        index += 1
    ) {
        const previous =
            OCR_PROGRESS_TIMELINE[
                index - 1
            ];

        const next =
            OCR_PROGRESS_TIMELINE[
                index
            ];

        if (
            normalizedFraction <=
            next.fraction
        ) {
            const segmentLength =
                next.fraction
                - previous.fraction;

            const segmentFraction =
                segmentLength > 0
                    ? (
                        (
                            normalizedFraction
                            - previous.fraction
                        )
                        / segmentLength
                    )
                    : 1;

            const progress =
                previous.progress
                + (
                    (
                        next.progress
                        - previous.progress
                    )
                    * segmentFraction
                );

            const message =
                normalizedFraction >=
                    next.fraction
                    ? (
                        next.message
                        || previous.message
                        || null
                    )
                    : (
                        previous.message
                        || null
                    );

            return {
                progress:
                    Math.round(
                        progress
                    ),
                stage:
                    previous.stage,
                message
            };
        }
    }

    return {
        progress:
            SIMULATED_PROGRESS_MAX,
        stage:
            "saving"
    };
}

// ============================================================
// OCR START TIME
// ============================================================

function getOcrStartedAt(
    status,
    temporaryProgress
) {
    const temporary =
        parseTimestamp(
            temporaryProgress
                ?.ocrStartedAt
        );

    if (
        Number.isFinite(
            temporary
        )
    ) {
        return temporary;
    }

    const explicit =
        parseTimestamp(
            status?.ocrStartedAt
        );

    if (
        Number.isFinite(
            explicit
        )
    ) {
        return explicit;
    }

    if (
        normalizeProgress(
            status?.progress
        ) >=
        SIMULATED_PROGRESS_MIN
    ) {
        const updated =
            parseTimestamp(
                status?.updatedAt
            );

        if (
            Number.isFinite(
                updated
            )
        ) {
            return updated;
        }
    }

    const started =
        parseTimestamp(
            status?.startedAt
        );

    if (
        Number.isFinite(
            started
        )
    ) {
        return started;
    }

    return NaN;
}

// ============================================================
// EXPECTED RUNTIME
// ============================================================

function getExpectedRuntimeMs(
    status,
    temporaryProgress
) {
    const temporaryRuntime =
        normalizeExpectedRuntimeMs(
            temporaryProgress
                ?.expectedRuntimeMs
        );

    if (
        temporaryRuntime
    ) {
        return temporaryRuntime;
    }

    const statusRuntime =
        normalizeExpectedRuntimeMs(
            status?.expectedRuntimeMs
            ?? status?.expectedRuntimeSeconds
        );

    if (
        statusRuntime
    ) {
        return statusRuntime;
    }

    return DEFAULT_OCR_RUNTIME_MS;
}

function normalizeExpectedRuntimeMs(
    value
) {
    let runtime =
        Number(
            value
        );

    if (
        !Number.isFinite(
            runtime
        )
        || runtime <= 0
    ) {
        return null;
    }

    /*
     * Values below 1000 are treated as seconds.
     */
    if (
        runtime < 1000
    ) {
        runtime *=
            1000;
    }

    return Math.max(
        MIN_OCR_RUNTIME_MS,
        Math.min(
            MAX_OCR_RUNTIME_MS,
            Math.round(
                runtime
            )
        )
    );
}

// ============================================================
// RESPONSE BUILDING
// ============================================================

function buildProgressResponse(
    jobId,
    status,
    temporaryProgress,
    calculated = {}
) {
    const statusName =
        String(
            status?.status
            || "processing"
        )
            .trim()
            .toLowerCase();

    let progress =
        calculated.progress;

    if (
        progress === undefined
    ) {
        progress =
            Math.max(
                normalizeProgress(
                    status?.progress
                ),
                Math.min(
                    PROVIDER_PROGRESS_MAX,
                    normalizeProgress(
                        temporaryProgress
                            ?.progress
                    )
                )
            );
    }

    if (
        statusName ===
        "completed"
    ) {
        progress =
            100;
    }
    else {
        progress =
            Math.min(
                PROVIDER_PROGRESS_MAX,
                progress
            );
    }

    const confirmedProgress =
        calculated.confirmedProgress
        ?? Math.max(
            normalizeProgress(
                status?.progress
            ),
            Math.min(
                PROVIDER_PROGRESS_MAX,
                normalizeProgress(
                    temporaryProgress
                        ?.progress
                )
            )
        );

    const simulatedProgress =
        calculated.simulatedProgress
        ?? confirmedProgress;

    const source =
        calculated.source
        || (
            temporaryProgress
                ? "cloud_run"
                : "worker"
        );

    let stage =
        status?.stage
        || "ocr";

    let message =
        status?.message
        || "Reading your scoreboard.";

    let work =
        status?.work
        || null;

    if (
        source ===
        "cloud_run"
        && temporaryProgress
    ) {
        stage =
            temporaryProgress.stage
            || stage;

        message =
            temporaryProgress.message
            || message;

        work =
            temporaryProgress.work
            || work;
    }
    else if (
        source ===
        "simulated"
    ) {
        if (
            calculated.simulatedStage
        ) {
            stage =
                calculated.simulatedStage;
        }

        if (
            calculated.simulatedMessage
        ) {
            message =
                calculated.simulatedMessage;
        }
    }

    return {
        success:
            true,
        jobId,
        status:
            statusName,
        stage:
            sanitizeStage(
                stage
            )
            || "ocr",
        progress:
            normalizeProgress(
                progress
            ),
        confirmedProgress:
            Math.min(
                PROVIDER_PROGRESS_MAX,
                normalizeProgress(
                    confirmedProgress
                )
            ),
        simulatedProgress:
            Math.min(
                SIMULATED_PROGRESS_MAX,
                normalizeProgress(
                    simulatedProgress
                )
            ),
        progressSource:
            source,
        message:
            sanitizeMessage(
                message
            )
            || "Reading your scoreboard.",
        startedAt:
            normalizeTimestamp(
                status?.startedAt
            ),
        ocrStartedAt:
            normalizeTimestamp(
                temporaryProgress
                    ?.ocrStartedAt
            )
            || normalizeTimestamp(
                status?.ocrStartedAt
            ),
        updatedAt:
            normalizeTimestamp(
                temporaryProgress
                    ?.updatedAt
            )
            || normalizeTimestamp(
                status?.updatedAt
            ),
        heartbeatAt:
            normalizeTimestamp(
                temporaryProgress
                    ?.heartbeatAt
            )
            || normalizeTimestamp(
                status?.heartbeatAt
            ),
        completedAt:
            normalizeTimestamp(
                status?.completedAt
            ),
        matchId:
            statusName ===
                "completed"
                ? sanitizeMatchId(
                    status?.matchId
                )
                : null,
        reviewRequired:
            status?.reviewRequired ===
                true
            || status
                ?.requiresPlayerReview ===
                true
            || String(
                status
                    ?.confirmationStatus
                || ""
            )
                .trim()
                .toLowerCase() ===
                "pending_review",
        confirmationStatus:
            normalizeConfirmationStatus(
                status
                    ?.confirmationStatus
            ),
        work:
            sanitizeWork(
                work
            ),
        error:
            statusName ===
                "failed"
                ? sanitizeError(
                    status?.error
                )
                : null,
        version:
            PROGRESS_VERSION
    };
}

// ============================================================
// DURABLE STATUS
// ============================================================

function getStatusKey(
    jobId
) {
    return (
        `ocr-jobs/${jobId}/status.json`
    );
}

async function readDurableStatus(
    env,
    jobId
) {
    const object =
        await env.OCR_STORAGE.get(
            getStatusKey(
                jobId
            )
        );

    if (
        !object
    ) {
        return null;
    }

    try {
        const data =
            JSON.parse(
                await object.text()
            );

        return (
            data
            && typeof data ===
                "object"
            && !Array.isArray(
                data
            )
        )
            ? data
            : null;
    }
    catch {
        return null;
    }
}

// ============================================================
// TEMPORARY PROGRESS
// ============================================================

function getProgressKey(
    jobId
) {
    return (
        `${OCR_PROGRESS_PREFIX}/${jobId}.json`
    );
}

async function readTemporaryProgress(
    env,
    jobId
) {
    const object =
        await env.OCR_PROGRESS.get(
            getProgressKey(
                jobId
            )
        );

    if (
        !object
    ) {
        return null;
    }

    try {
        const data =
            JSON.parse(
                await object.text()
            );

        if (
            !data
            || typeof data !==
                "object"
            || Array.isArray(
                data
            )
            || sanitizeJobId(
                data.jobId
            ) !== jobId
        ) {
            return null;
        }

        return data;
    }
    catch {
        return null;
    }
}

async function writeTemporaryProgress(
    env,
    jobId,
    progressData
) {
    await env.OCR_PROGRESS.put(
        getProgressKey(
            jobId
        ),
        JSON.stringify(
            progressData,
            null,
            2
        ),
        {
            httpMetadata: {
                contentType:
                    "application/json"
            },

            customMetadata: {
                jobId,

                temporary:
                    "true"
            }
        }
    );
}

// ============================================================
// CONFIGURATION
// ============================================================

function validateEnvironment(
    env,
    requireProgressToken
) {
    if (
        !env?.OCR_STORAGE
    ) {
        return {
            status:
                503,

            body: {
                success:
                    false,

                message:
                    "OCR storage is not configured.",

                version:
                    PROGRESS_VERSION
            }
        };
    }

    if (
        !env?.OCR_PROGRESS
    ) {
        return {
            status:
                503,

            body: {
                success:
                    false,

                message:
                    "OCR temporary progress storage is not configured.",

                version:
                    PROGRESS_VERSION
            }
        };
    }

    if (
        requireProgressToken
        && !String(
            env
                .OCR_JOB_PROGRESS_SECURE_TOKEN
            || ""
        )
            .trim()
    ) {
        return {
            status:
                503,

            body: {
                success:
                    false,

                message:
                    "OCR progress authentication is not configured.",

                version:
                    PROGRESS_VERSION
            }
        };
    }

    return null;
}

// ============================================================
// AUTHENTICATION
// ============================================================

async function isAuthorizedProgressRequest(
    request,
    env
) {
    const suppliedToken =
        String(
            request.headers.get(
                "X-BPD-OCR-Progress-Token"
            )
            || ""
        )
            .trim();

    const expectedToken =
        String(
            env
                .OCR_JOB_PROGRESS_SECURE_TOKEN
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

    let difference =
        0;

    for (
        let index = 0;
        index < leftBytes.length;
        index += 1
    ) {
        difference |=
            leftBytes[
                index
            ]
            ^ rightBytes[
                index
            ];
    }

    return difference ===
        0;
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
            && typeof body ===
                "object"
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
// TERMINAL STATUS
// ============================================================

function isTerminalStatus(
    status
) {
    return (
        status?.status ===
            "completed"
        || status?.status ===
            "failed"
    );
}

// ============================================================
// WORK
// ============================================================

function sanitizeWork(
    work
) {
    if (
        !work
        || typeof work !==
            "object"
        || Array.isArray(
            work
        )
    ) {
        return null;
    }

    const allowedKeys = [
        "totalFields",
        "totalUnits",
        "completedUnits",
        "completedFields",
        "successfulFields",
        "reviewFields",
        "warningFields",
        "failedFields",
        "inputBytes"
    ];

    const safe =
        {};

    for (
        const key
        of allowedKeys
    ) {
        const numeric =
            Number(
                work[
                    key
                ]
            );

        if (
            !Number.isFinite(
                numeric
            )
            || numeric < 0
        ) {
            continue;
        }

        safe[
            key
        ] =
            Math.round(
                numeric
            );
    }

    return Object.keys(
        safe
    ).length > 0
        ? safe
        : null;
}

// ============================================================
// ERROR
// ============================================================

function sanitizeError(
    error
) {
    if (
        !error
        || typeof error !==
            "object"
        || Array.isArray(
            error
        )
    ) {
        return null;
    }

    const code =
        String(
            error.code
            || "OCR_FAILED"
        )
            .trim()
            .toUpperCase()
            .slice(
                0,
                80
            );

    const message =
        String(
            error.message
            || "The image could not be processed."
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim()
            .slice(
                0,
                600
            );

    return {
        code,
        message
    };
}

// ============================================================
// CONFIRMATION STATUS
// ============================================================

function normalizeConfirmationStatus(
    value
) {
    const status =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    return [
        "pending_review",
        "auto_accepted",
        "confirmed",
        "confirmed_with_disputes"
    ].includes(
        status
    )
        ? status
        : null;
}

// ============================================================
// NORMALIZATION
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
        : null;
}

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

function sanitizeStage(
    value
) {
    const stage =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        !stage
        || stage.length > 64
        || !/^[a-z0-9_-]+$/.test(
            stage
        )
    ) {
        return "";
    }

    return stage;
}

function sanitizeMessage(
    value
) {
    const message =
        String(
            value
            || ""
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    if (
        !message
    ) {
        return "";
    }

    return message.slice(
        0,
        300
    );
}

function normalizeTimestamp(
    value
) {
    const timestamp =
        String(
            value
            || ""
        )
            .trim();

    return (
        timestamp
        || null
    );
}

function parseTimestamp(
    value
) {
    return Date.parse(
        String(
            value
            || ""
        )
    );
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