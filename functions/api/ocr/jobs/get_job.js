"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR JOB STATUS READER

File:
    functions/api/ocr/jobs/get_job.js

Public Route:
    GET /api/ocr/jobs/get_job?jobId={jobId}

Purpose:
    Returns the authenticated user's OCR job status.

Description:
    - Requires a valid global BPD session.
    - Verifies ownership before returning job information.
    - New OCR jobs are owned by identity.accounts.id.
    - Legacy OCR jobs remain accessible through the linked
      Epic provider identity used when those jobs were created.
    - Merges temporary Cloud Run progress with stored state.

Ownership Model:
    Version 2:
        ownerType = "account"
        ownerVersion = 2
        ownerId = HMAC(identity.accounts.id)

    Legacy:
        ownerType absent
        ownerVersion absent
        submittedBy/ownerId = HMAC(Epic provider subject)
========================================================= */

import {
    getSessionContext,
    getProviderContext
} from "../../../services/auth/sessions/session_context.js";

/* =========================================================
VERSION
========================================================= */

const GET_JOB_VERSION =
    "ocr-get-job-2.0";

const OWNER_TYPE_ACCOUNT =
    "account";

const OWNER_VERSION_ACCOUNT =
    2;

/* =========================================================
STATUS
========================================================= */

const ALLOWED_STATUSES =
    new Set([
        "created",
        "uploading",
        "queued",
        "processing",
        "completed",
        "failed"
    ]);

const MAX_MESSAGE_LENGTH =
    160;

const MAX_STAGE_LENGTH =
    64;

/* =========================================================
MAIN
========================================================= */

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } =
        context;

    try {
        /* =================================================
        CONFIGURATION
        ================================================= */

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR storage is not configured.",

                    version:
                        GET_JOB_VERSION
                },
                503
            );
        }

        if (
            !env.OCR_PROGRESS
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR progress storage is not configured.",

                    version:
                        GET_JOB_VERSION
                },
                503
            );
        }

        if (
            !env.OCR_OWNER_SECRET
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR owner verification is not configured.",

                    version:
                        GET_JOB_VERSION
                },
                503
            );
        }

        /* =================================================
        GLOBAL BPD SESSION
        ================================================= */

        const session =
            await getSessionContext(
                request,
                env
            );

        if (
            session.authenticated !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required.",

                    version:
                        GET_JOB_VERSION
                },
                401
            );
        }

        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    message:
                        "Authenticated account identity is unavailable.",

                    version:
                        GET_JOB_VERSION
                },
                409
            );
        }

        if (
            session.active !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "This BPD account is not active.",

                    version:
                        GET_JOB_VERSION
                },
                403
            );
        }

        /* =================================================
        JOB ID
        ================================================= */

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
                        GET_JOB_VERSION
                },
                400
            );
        }

        const baseKey =
            `ocr-jobs/${jobId}`;

        const statusKey =
            `${baseKey}/status.json`;

        const requestKey =
            `${baseKey}/request.json`;

        /* =================================================
        LOAD STATUS
        ================================================= */

        const statusObject =
            await env.OCR_STORAGE.get(
                statusKey
            );

        if (
            !statusObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job was not found.",

                    version:
                        GET_JOB_VERSION
                },
                404
            );
        }

        const statusData =
            await readStoredJson(
                statusObject
            );

        if (
            !statusData
        ) {
            console.error(
                `[OCR GET JOB] Invalid status metadata for ${jobId}.`
            );

            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job metadata is invalid.",

                    version:
                        GET_JOB_VERSION
                },
                500
            );
        }

        /* =================================================
        VERIFY JOB IDENTIFIER
        ================================================= */

        const storedJobId =
            sanitizeJobId(
                statusData?.jobId
            );

        if (
            storedJobId !==
            jobId
        ) {
            console.error(
                `[OCR GET JOB] Job metadata mismatch for ${jobId}.`
            );

            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job metadata is inconsistent.",

                    version:
                        GET_JOB_VERSION
                },
                409
            );
        }

        /* =================================================
        RESOLVE OWNERSHIP METADATA

        New jobs store ownership on status.json directly.

        Older jobs may only contain fields.submittedBy in
        request.json, so retain that fallback temporarily.
        ================================================= */

        const ownership =
            await resolveStoredOwnership(
                env,
                {
                    jobId,
                    statusData,
                    requestKey
                }
            );

        if (
            !ownership
        ) {
            console.error(
                `[OCR GET JOB] Missing or invalid owner for ${jobId}.`
            );

            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job ownership is invalid.",

                    version:
                        GET_JOB_VERSION
                },
                409
            );
        }

        /* =================================================
        AUTHENTICATED OWNER
        ================================================= */

        const authenticatedOwnerId =
            await resolveAuthenticatedOwnerHash(
                session,
                ownership,
                env.OCR_OWNER_SECRET
            );

        if (
            !authenticatedOwnerId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        ownership.isLegacy
                            ? "EPIC_ACCOUNT_REQUIRED"
                            : "ACCOUNT_IDENTITY_MISSING",

                    message:
                        ownership.isLegacy
                            ? "A linked Epic account is required to access this legacy OCR job."
                            : "Authenticated account identity is unavailable.",

                    version:
                        GET_JOB_VERSION
                },
                ownership.isLegacy
                    ? 403
                    : 409
            );
        }

        /* =================================================
        VERIFY OWNERSHIP
        ================================================= */

        if (
            !constantTimeEqual(
                ownership.ownerId,
                authenticatedOwnerId
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "OCR_JOB_ACCESS_DENIED",

                    message:
                        "You are not authorized to access this OCR job.",

                    version:
                        GET_JOB_VERSION
                },
                403
            );
        }

        /* =================================================
        MERGE TEMPORARY CLOUD OCR PROGRESS
        ================================================= */

        const responseStatusData =
            await mergeCloudProgress(
                env,
                jobId,
                statusData
            );

        /* =================================================
        RESPONSE
        ================================================= */

        return jsonResponse(
            {
                success:
                    true,

                version:
                    GET_JOB_VERSION,

                job:
                    sanitizeJobResponse(
                        responseStatusData
                    )
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR get job failed:",
            error
        );

        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Unable to read OCR job.",

                version:
                    GET_JOB_VERSION
            },
            500
        );
    }
}

/* =========================================================
OWNERSHIP RESOLUTION
========================================================= */

async function resolveStoredOwnership(
    env,
    {
        jobId,
        statusData,
        requestKey
    }
) {
    let ownerId =
        normalizeString(
            statusData?.ownerId
        );

    let ownerType =
        normalizeString(
            statusData?.ownerType
        )
            .toLowerCase();

    let ownerVersion =
        normalizePositiveInteger(
            statusData?.ownerVersion
        );

    if (
        ownerId
    ) {
        return normalizeOwnership({
            ownerId,
            ownerType,
            ownerVersion
        });
    }

    /* =====================================================
    LEGACY REQUEST FALLBACK
    ===================================================== */

    const requestObject =
        await env.OCR_STORAGE.get(
            requestKey
        );

    if (
        !requestObject
    ) {
        console.error(
            `[OCR GET JOB] Legacy request metadata missing for ${jobId}.`
        );

        return null;
    }

    const requestData =
        await readStoredJson(
            requestObject
        );

    if (
        !requestData
    ) {
        console.error(
            `[OCR GET JOB] Legacy request metadata invalid for ${jobId}.`
        );

        return null;
    }

    const requestJobId =
        sanitizeJobId(
            requestData?.jobId
        );

    if (
        requestJobId !==
        jobId
    ) {
        console.error(
            `[OCR GET JOB] Legacy request job mismatch for ${jobId}.`
        );

        return null;
    }

    ownerId =
        normalizeString(
            requestData?.ownerId
            || requestData
                ?.fields
                ?.submittedBy
        );

    ownerType =
        normalizeString(
            requestData?.ownerType
            || requestData
                ?.fields
                ?.ownerType
        )
            .toLowerCase();

    ownerVersion =
        normalizePositiveInteger(
            requestData?.ownerVersion
            ?? requestData
                ?.fields
                ?.ownerVersion
        );

    return normalizeOwnership({
        ownerId,
        ownerType,
        ownerVersion
    });
}

function normalizeOwnership(
    {
        ownerId,
        ownerType,
        ownerVersion
    }
) {
    const normalizedOwnerId =
        normalizeString(
            ownerId
        );

    if (
        !normalizedOwnerId
    ) {
        return null;
    }

    if (
        ownerType ===
            OWNER_TYPE_ACCOUNT
        && ownerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        return {
            ownerId:
                normalizedOwnerId,

            ownerType:
                OWNER_TYPE_ACCOUNT,

            ownerVersion:
                OWNER_VERSION_ACCOUNT,

            isLegacy:
                false
        };
    }

    /*
     * Historical jobs did not store ownerType/ownerVersion.
     * Their submittedBy value was generated from EpicUniqueId.
     */
    if (
        !ownerType
        && ownerVersion ===
            null
    ) {
        return {
            ownerId:
                normalizedOwnerId,

            ownerType:
                "epic",

            ownerVersion:
                1,

            isLegacy:
                true
        };
    }

    return null;
}

/* =========================================================
AUTHENTICATED OWNER
========================================================= */

async function resolveAuthenticatedOwnerHash(
    session,
    ownership,
    secret
) {
    if (
        ownership.ownerType ===
            OWNER_TYPE_ACCOUNT
        && ownership.ownerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            return null;
        }

        return createOwnerHash(
            accountId,
            secret
        );
    }

    if (
        ownership.isLegacy ===
            true
    ) {
        const epic =
            getProviderContext(
                session,
                "epic"
            );

        const epicAccountId =
            normalizeString(
                epic?.accountId
            );

        if (
            epic?.linked !== true
            || !epicAccountId
        ) {
            return null;
        }

        return createOwnerHash(
            epicAccountId,
            secret
        );
    }

    return null;
}

/* =========================================================
STORED JSON
========================================================= */

async function readStoredJson(
    object
) {
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
        ) {
            return null;
        }

        return data;
    }
    catch {
        return null;
    }
}

/* =========================================================
TEMPORARY CLOUD OCR PROGRESS
========================================================= */

async function mergeCloudProgress(
    env,
    jobId,
    statusData
) {
    const status =
        normalizeStatus(
            statusData?.status
        );

    if (
        status === "completed"
        || status === "failed"
    ) {
        return statusData;
    }

    let progressObject;

    try {
        progressObject =
            await env.OCR_PROGRESS.get(
                `jobs/${jobId}.json`
            );
    }
    catch (
        error
    ) {
        console.warn(
            `[OCR GET JOB] Progress read failed for ${jobId}.`,
            error
        );

        return statusData;
    }

    if (
        !progressObject
    ) {
        return statusData;
    }

    const cloudProgress =
        await readStoredJson(
            progressObject
        );

    if (
        !cloudProgress
        || sanitizeJobId(
            cloudProgress.jobId
        ) !==
            jobId
    ) {
        return statusData;
    }

    const storedProgress =
        normalizeProgress(
            statusData?.progress
        );

    const providerProgress =
        Math.min(
            97,
            normalizeProgress(
                cloudProgress?.progress
            )
        );

    const progress =
        Math.max(
            storedProgress,
            providerProgress
        );

    const useProvider =
        providerProgress >=
            storedProgress;

    return {
        ...statusData,

        status:
            "processing",

        stage:
            useProvider
                ? cloudProgress.stage
                : statusData.stage,

        progress,

        message:
            useProvider
                ? cloudProgress.message
                : statusData.message,

        updatedAt:
            useProvider
                ? (
                    cloudProgress.updatedAt
                    || statusData.updatedAt
                )
                : statusData.updatedAt,

        heartbeatAt:
            useProvider
                ? (
                    cloudProgress.updatedAt
                    || statusData.heartbeatAt
                )
                : statusData.heartbeatAt,

        work:
            useProvider
                ? cloudProgress.work
                : statusData.work,

        progressSource:
            useProvider
                ? "cloud_run"
                : "worker"
    };
}

/* =========================================================
SAFE JOB RESPONSE
========================================================= */

function sanitizeJobResponse(
    statusData
) {
    const status =
        normalizeStatus(
            statusData?.status
        );

    const progress =
        status ===
            "completed"
            ? 100
            : normalizeProgress(
                statusData?.progress
            );

    return {
        jobId:
            sanitizeJobId(
                statusData?.jobId
            ),

        status,

        stage:
            normalizeStage(
                statusData?.stage
            ),

        progress,

        message:
            normalizeMessage(
                statusData?.message,
                status
            ),

        uploadStatus:
            normalizeUploadStatus(
                statusData?.uploadStatus
            ),

        createdAt:
            normalizeTimestamp(
                statusData?.createdAt
            ),

        startedAt:
            normalizeTimestamp(
                statusData?.startedAt
            ),

        updatedAt:
            normalizeTimestamp(
                statusData?.updatedAt
            ),

        completedAt:
            normalizeTimestamp(
                statusData?.completedAt
            ),

        heartbeatAt:
            normalizeTimestamp(
                statusData?.heartbeatAt
            ),

        progressSource:
            normalizeProgressSource(
                statusData?.progressSource,
                status
            ),

        work:
            sanitizeWork(
                statusData?.work
            ),

        reviewRequired:
            statusData?.reviewRequired ===
                true
            || statusData?.requiresPlayerReview ===
                true
            || normalizeConfirmationStatus(
                statusData?.confirmationStatus
            ) ===
                "pending_review",

        confirmationStatus:
            normalizeConfirmationStatus(
                statusData?.confirmationStatus
            ),

        error:
            status ===
                "failed"
                ? sanitizeError(
                    statusData?.error
                )
                : null,

        matchId:
            status ===
                "completed"
                ? sanitizeMatchId(
                    statusData?.matchId
                )
                : null
    };
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !==
            "string"
    ) {
        return "";
    }

    return value.trim();
}

function normalizePositiveInteger(
    value
) {
    if (
        value === null
        || value === undefined
        || String(
            value
        )
            .trim() ===
            ""
    ) {
        return null;
    }

    const numeric =
        Number(
            value
        );

    if (
        !Number.isInteger(
            numeric
        )
        || numeric <= 0
    ) {
        return null;
    }

    return numeric;
}

/* =========================================================
PROGRESS DETAILS
========================================================= */

function normalizeProgressSource(
    value,
    status
) {
    if (
        status === "completed"
        || status === "failed"
    ) {
        return "stored";
    }

    const source =
        String(
            value
            || "stored"
        )
            .trim()
            .toLowerCase();

    return [
        "stored",
        "worker",
        "cloud_run"
    ].includes(
        source
    )
        ? source
        : "stored";
}

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

    const safe = {};

    for (
        const key
        of allowedKeys
    ) {
        const numeric =
            Number(
                work[key]
            );

        if (
            !Number.isFinite(
                numeric
            )
            || numeric < 0
        ) {
            continue;
        }

        safe[key] =
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
                MAX_MESSAGE_LENGTH
            );

    return {
        code,
        message
    };
}

/* =========================================================
OWNER HASH
========================================================= */

async function createOwnerHash(
    ownerIdentity,
    secret
) {
    const encoder =
        new TextEncoder();

    const key =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(
                String(
                    secret
                )
            ),
            {
                name:
                    "HMAC",

                hash:
                    "SHA-256"
            },
            false,
            [
                "sign"
            ]
        );

    const signature =
        await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(
                String(
                    ownerIdentity
                )
            )
        );

    return Array.from(
        new Uint8Array(
            signature
        )
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
}

/* =========================================================
CONSTANT-TIME COMPARE
========================================================= */

function constantTimeEqual(
    first,
    second
) {
    const encoder =
        new TextEncoder();

    const firstBytes =
        encoder.encode(
            String(
                first
                || ""
            )
        );

    const secondBytes =
        encoder.encode(
            String(
                second
                || ""
            )
        );

    const maxLength =
        Math.max(
            firstBytes.length,
            secondBytes.length
        );

    let difference =
        firstBytes.length
        ^ secondBytes.length;

    for (
        let index = 0;
        index < maxLength;
        index += 1
    ) {
        difference |=
            (
                firstBytes[index]
                || 0
            )
            ^ (
                secondBytes[index]
                || 0
            );
    }

    return difference ===
        0;
}

/* =========================================================
STATUS
========================================================= */

function normalizeStatus(
    value
) {
    const status =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    return ALLOWED_STATUSES.has(
        status
    )
        ? status
        : "unknown";
}

/* =========================================================
STAGE
========================================================= */

function normalizeStage(
    value
) {
    const stage =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase()
            .slice(
                0,
                MAX_STAGE_LENGTH
            );

    if (
        !stage
    ) {
        return "unknown";
    }

    return /^[a-z0-9_-]+$/.test(
        stage
    )
        ? stage
        : "unknown";
}

/* =========================================================
MESSAGE
========================================================= */

function normalizeMessage(
    value,
    status
) {
    const message =
        String(
            value
            || ""
        )
            .trim()
            .slice(
                0,
                MAX_MESSAGE_LENGTH
            );

    if (
        message
    ) {
        return message;
    }

    switch (
        status
    ) {
        case "queued":
            return "Waiting for the scoreboard reader.";

        case "processing":
            return "Reading your scoreboard.";

        case "completed":
            return "Scoreboard ready. Nice shot!";

        case "failed":
            return "The scoreboard reader hit a bump.";

        default:
            return "Preparing your scoreboard.";
    }
}

/* =========================================================
PROGRESS
========================================================= */

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
            Math.round(
                progress
            )
        )
    );
}

/* =========================================================
UPLOAD STATUS
========================================================= */

function normalizeUploadStatus(
    value
) {
    const status =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        [
            "pending",
            "uploading",
            "completed",
            "failed"
        ].includes(
            status
        )
    ) {
        return status;
    }

    return null;
}

/* =========================================================
TIMESTAMP
========================================================= */

function normalizeTimestamp(
    value
) {
    const timestamp =
        String(
            value
            || ""
        )
            .trim();

    if (
        !timestamp
    ) {
        return null;
    }

    const parsed =
        Date.parse(
            timestamp
        );

    if (
        !Number.isFinite(
            parsed
        )
    ) {
        return null;
    }

    return new Date(
        parsed
    )
        .toISOString();
}

/* =========================================================
JOB ID
========================================================= */

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
        : null;
}

/* =========================================================
MATCH ID
========================================================= */

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

/* =========================================================
RESPONSE
========================================================= */

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