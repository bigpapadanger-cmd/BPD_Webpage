"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB PROGRESS
// REAL + SIMULATED FALLBACK
// ============================================================

const PROGRESS_VERSION =
    "ocr-job-progress-1.1";

const SIMULATED_PROGRESS_MIN =
    12;

const SIMULATED_PROGRESS_MAX =
    95;

const DEFAULT_OCR_RUNTIME_MS =
    75000;

const MIN_OCR_RUNTIME_MS =
   20000;

const MAX_OCR_RUNTIME_MS =
    35000;

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
                "ocr"
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
// REAL CLOUD RUN PROGRESS CALLBACK
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

        const statusKey =
            getStatusKey(
                jobId
            );

        const currentStatus =
            await readStatus(
                env,
                statusKey
            );

        if (
            !currentStatus
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "OCR job status was not found.",
                    jobId,
                    version:
                        PROGRESS_VERSION
                },
                404
            );
        }

        if (
            isTerminalStatus(
                currentStatus
            )
        ) {
            return jsonResponse(
                buildProgressResponse(
                    jobId,
                    currentStatus,
                    {
                        source:
                            "terminal"
                    }
                ),
                200
            );
        }

        const requestedProgress =
            normalizeProgress(
                body.progress
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

        const now =
            new Date()
                .toISOString();

        const storedConfirmedProgress =
            getConfirmedProgress(
                currentStatus
            );

        const confirmedProgress =
            Math.max(
                storedConfirmedProgress,
                requestedProgress
            );

        const stage =
            sanitizeStage(
                body.stage
            )
            || currentStatus.stage
            || "ocr";

        const message =
            sanitizeMessage(
                body.message
            )
            || currentStatus.message
            || "Reading your scoreboard.";

        const nextStatus = {
            ...currentStatus,
            status:
                "processing",
            stage,
            progress:
                confirmedProgress,
            confirmedProgress,
            progressSource:
                "real",
            lastRealProgress:
                confirmedProgress,
            lastRealProgressAt:
                now,
            message,
            updatedAt:
                now,
            heartbeatAt:
                now,
            error:
                null
        };

        if (
            !nextStatus.ocrStartedAt
            && confirmedProgress >=
                SIMULATED_PROGRESS_MIN
        ) {
            nextStatus.ocrStartedAt =
                now;
        }

        await updateStatus(
            env,
            statusKey,
            nextStatus
        );

        return jsonResponse(
            buildProgressResponse(
                jobId,
                nextStatus,
                {
                    source:
                        "real"
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
// CLIENT PROGRESS POLLING
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

        const statusKey =
            getStatusKey(
                jobId
            );

        const currentStatus =
            await readStatus(
                env,
                statusKey
            );

        if (
            !currentStatus
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "OCR job status was not found.",
                    jobId,
                    version:
                        PROGRESS_VERSION
                },
                404
            );
        }

        if (
            isTerminalStatus(
                currentStatus
            )
        ) {
            return jsonResponse(
                buildProgressResponse(
                    jobId,
                    currentStatus,
                    {
                        source:
                            "terminal"
                    }
                ),
                200
            );
        }

        const calculated =
            calculateHybridProgress(
                currentStatus
            );

        return jsonResponse(
            buildProgressResponse(
                jobId,
                currentStatus,
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
    status
) {
    const storedProgress =
        normalizeProgress(
            status.progress
        );

    const confirmedProgress =
        getConfirmedProgress(
            status
        );

    if (
        storedProgress >= 96
    ) {
        return {
            progress:
                storedProgress,
            confirmedProgress,
            simulatedProgress:
                storedProgress,
            source:
                "real"
        };
    }

    const now =
        Date.now();

    const lastRealAt =
        parseTimestamp(
            status.lastRealProgressAt
        );

    if (
        Number.isFinite(
            lastRealAt
        )
        && now - lastRealAt <
            REAL_PROGRESS_HOLD_MS
    ) {
        return {
            progress,
            confirmedProgress,
            simulatedProgress,
            simulatedStage:
                simulated.stage,
            source
        };
    }

    const ocrStartedAt =
        getOcrStartedAt(
            status
        );

    if (
        !Number.isFinite(
            ocrStartedAt
        )
    ) {
        return {
            progress:
                Math.max(
                    storedProgress,
                    confirmedProgress
                ),
            confirmedProgress,
            simulatedProgress:
                Math.max(
                    storedProgress,
                    confirmedProgress
                ),
            source:
                confirmedProgress > 0
                    ? "real"
                    : "stored"
        };
    }

    const expectedRuntimeMs =
        getExpectedRuntimeMs(
            status
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
                storedProgress,
                confirmedProgress,
                simulatedProgress
            )
        );

    let source =
        "simulated";

    if (
        confirmedProgress >=
        simulatedProgress
    ) {
        source =
            "real";
    }

    return {
        progress,
        confirmedProgress,
        simulatedProgress,
        simulatedStage:
            simulated.stage,
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

            return {
                progress:
                    Math.round(
                        progress
                    ),
                stage:
                    previous.stage
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
// CONFIRMED PROGRESS
// ============================================================

function getConfirmedProgress(
    status
) {
    const confirmed =
        normalizeProgress(
            status.confirmedProgress
        );

    const real =
        normalizeProgress(
            status.lastRealProgress
        );

    const stored =
        normalizeProgress(
            status.progress
        );

    return Math.max(
        confirmed,
        real,
        stored
    );
}

// ============================================================
// OCR START TIME
// ============================================================

function getOcrStartedAt(
    status
) {
    const explicit =
        parseTimestamp(
            status.ocrStartedAt
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
            status.progress
        ) >=
        SIMULATED_PROGRESS_MIN
    ) {
        const updated =
            parseTimestamp(
                status.updatedAt
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
            status.startedAt
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
    status
) {
    let expectedRuntimeMs =
        Number(
            status.expectedRuntimeMs
        );

    if (
        !Number.isFinite(
            expectedRuntimeMs
        )
        || expectedRuntimeMs <= 0
    ) {
        const expectedRuntimeSeconds =
            Number(
                status.expectedRuntimeSeconds
            );

        if (
            Number.isFinite(
                expectedRuntimeSeconds
            )
            && expectedRuntimeSeconds > 0
        ) {
            expectedRuntimeMs =
                expectedRuntimeSeconds
                * 1000;
        }
    }

    if (
        !Number.isFinite(
            expectedRuntimeMs
        )
        || expectedRuntimeMs <= 0
    ) {
        expectedRuntimeMs =
            DEFAULT_OCR_RUNTIME_MS;
    }

    return Math.max(
        MIN_OCR_RUNTIME_MS,
        Math.min(
            MAX_OCR_RUNTIME_MS,
            expectedRuntimeMs
        )
    );
}

// ============================================================
// RESPONSE BUILDING
// ============================================================

function buildProgressResponse(
    jobId,
    status,
    calculated = {}
) {
    let progress =
        calculated.progress;

    if (
        progress === undefined
    ) {
        progress =
            normalizeProgress(
                status.progress
            );
    }

    if (
        status.status ===
        "completed"
    ) {
        progress =
            100;
    }

    const confirmedProgress =
        calculated.confirmedProgress
        ?? getConfirmedProgress(
            status
        );

    const simulated =
    calculateTimelineProgress(
        elapsedFraction
    );

    const simulatedProgress =
        simulated.progress;

    return {
        success:
            true,
        jobId,
        status:
            status.status
            || "processing",
        stage:
            (
                calculated.source ===
                    "simulated"
                && calculated.simulatedStage
            )
                ? calculated.simulatedStage
                : (
                    status.stage
                    || "ocr"
                ),
        progress:
            normalizeProgress(
                progress
            ),
        confirmedProgress:
            normalizeProgress(
                confirmedProgress
            ),
        simulatedProgress:
            normalizeProgress(
                simulatedProgress
            ),
        progressSource:
            calculated.source
            || status.progressSource
            || "stored",
        message:
            status.message
            || "Reading your scoreboard.",
        startedAt:
            status.startedAt
            || null,
        ocrStartedAt:
            status.ocrStartedAt
            || null,
        updatedAt:
            status.updatedAt
            || null,
        heartbeatAt:
            status.heartbeatAt
            || null,
        completedAt:
            status.completedAt
            || null,
        matchId:
            status.matchId
            || null,
        error:
            status.error
            || null,
        version:
            PROGRESS_VERSION
    };
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
        requireProgressToken
        && !String(
            env.OCR_JOB_PROGRESS_SECURE_TOKEN
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
            env.OCR_JOB_PROGRESS_SECURE_TOKEN
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
            leftBytes[index]
            ^ rightBytes[index];
    }

    return difference === 0;
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
// STATUS
// ============================================================

function getStatusKey(
    jobId
) {
    return `ocr-jobs/${jobId}/status.json`;
}

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
            && typeof status ===
                "object"
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