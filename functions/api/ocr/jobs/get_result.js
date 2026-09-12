"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR MATCH RESULT

File:
    functions/api/ocr/jobs/get_result.js

Public Route:
    GET /api/ocr/jobs/get_result?matchId={matchId}

Purpose:
    Returns a stored OCR scoreboard result to its owner.

Description:
    - Requires a valid global BPD session.
    - New OCR results are owned by identity.accounts.id.
    - Existing Epic-owned OCR results remain accessible.
    - Uses OCR job lineage when match reports do not yet carry
      the newer ownerType / ownerVersion metadata.
    - Returns only sanitized scoreboard and review data.

Ownership Model:
    Version 2:
        ownerType = "account"
        ownerVersion = 2
        submittedBy = HMAC(identity.accounts.id)

    Legacy:
        owner metadata absent
        submittedBy = HMAC(Epic provider subject)
========================================================= */

import {
    getSessionContext,
    getProviderContext
} from "../../../services/auth/sessions/session_context.js";

import {
    getCurrentMatchReport
} from "../../../services/ocr/storage.js";

/* =========================================================
VERSION
========================================================= */

const OCR_GET_RESULT_VERSION =
    "ocr-get-result-4.0";

const OWNER_TYPE_ACCOUNT =
    "account";

const OWNER_VERSION_ACCOUNT =
    2;

/* =========================================================
ALLOWED SCOREBOARD FIELDS
========================================================= */

const ALLOWED_SCOREBOARD_FIELDS =
    new Set([
        "score",
        "goals",
        "assists",
        "demos",
        "saves",
        "shots",
        "damage",
        "ping"
    ]);

const ALLOWED_CONFIRMATION_STATUSES =
    new Set([
        "pending_review",
        "auto_accepted",
        "confirmed",
        "confirmed_with_disputes"
    ]);

/* =========================================================
MAIN
========================================================= */

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } = context;

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
                        "OCR storage is not configured."
                },
                500
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
                        "OCR owner hashing is not configured."
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
                        "Authentication required."
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
                        "Authenticated account identity is unavailable."
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
                        "This BPD account is not active."
                },
                403
            );
        }

        /* =================================================
        MATCH ID
        ================================================= */

        const url =
            new URL(
                request.url
            );

        const matchId =
            sanitizeMatchId(
                url.searchParams.get(
                    "matchId"
                )
            );

        if (
            !matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_ID_INVALID",
                    message:
                        "Missing or invalid matchId."
                },
                400
            );
        }

        /* =================================================
        LOAD MATCH REPORT
        ================================================= */

        let reportObject =
            await getCurrentMatchReport(
                env.OCR_STORAGE,
                matchId
            );

        /*
         * Temporary legacy fallback.
         *
         * Current:
         * match-reports/{matchId}/current.json
         *
         * Legacy:
         * match-reports/{matchId}.json
         */
        if (
            !reportObject
        ) {
            reportObject =
                await env.OCR_STORAGE.get(
                    `match-reports/${matchId}.json`
                );
        }

        if (
            !reportObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_NOT_FOUND",
                    message:
                        "Stored match report was not found."
                },
                404
            );
        }

        let matchReport;

        try {
            matchReport =
                await reportObject.json();
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_INVALID",
                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

        if (
            !matchReport
            || typeof matchReport !==
                "object"
            || Array.isArray(
                matchReport
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_INVALID",
                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

        /* =================================================
        MATCH ID VERIFICATION
        ================================================= */

        const storedMatchId =
            sanitizeMatchId(
                matchReport?.matchId
            );

        if (
            storedMatchId !==
            matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_ID_MISMATCH",
                    message:
                        "Stored match report does not match this match ID."
                },
                409
            );
        }

        /* =================================================
        JOB LINEAGE
        ================================================= */

        const jobId =
            sanitizeJobId(
                matchReport?.jobId
            );

        /* =================================================
        OWNERSHIP RESOLUTION

        Match reports may not yet contain ownerType and
        ownerVersion because Cloud Run historically only
        propagated submittedBy.

        If needed, inspect the originating OCR job.
        ================================================= */

        const ownership =
            await resolveMatchOwnership(
                env,
                matchReport,
                jobId
            );

        if (
            !ownership
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_OWNER_MISSING",
                    message:
                        "Stored match report has no valid owner."
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
                            ? "A linked Epic account is required to access this legacy OCR result."
                            : "Authenticated account identity is unavailable."
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
                        "MATCH_ACCESS_DENIED",
                    message:
                        "You are not authorized to access this OCR result."
                },
                403
            );
        }

        /* =================================================
        CONFIRMATION STATE
        ================================================= */

        const confirmationStatus =
            sanitizeConfirmationStatus(
                matchReport
                    ?.confirmationStatus
            );

        const requiresPlayerReview = (
            matchReport
                ?.requiresPlayerReview ===
                true
            || matchReport
                ?.reviewRequired ===
                true
            || confirmationStatus ===
                "pending_review"
        );

        /* =================================================
        EDIT DEADLINE
        ================================================= */

        const editDeadlineAt =
            sanitizeTimestamp(
                matchReport
                    ?.editDeadlineAt
            );

        if (
            !editDeadlineAt
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "EDIT_DEADLINE_MISSING",
                    message:
                        "Stored match report does not contain a valid edit deadline."
                },
                409
            );
        }

        const editWindowOpen =
            Date.now() <
            Date.parse(
                editDeadlineAt
            );

        /* =================================================
        SANITIZE SCOREBOARD
        ================================================= */

        const result =
            sanitizePublicScoreboard(
                matchReport,
                {
                    includeReviewEvidence:
                        requiresPlayerReview,
                    editDeadlineAt
                }
            );

        if (
            result.teams.length ===
            0
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "SCOREBOARD_EMPTY",
                    message:
                        "Stored match report contains no scoreboard values."
                },
                409
            );
        }

        /* =================================================
        RESPONSE
        ================================================= */

        return jsonResponse(
            {
                success:
                    true,
                version:
                    OCR_GET_RESULT_VERSION,
                jobId,
                matchId,
                imageUrl:
                    `/api/ocr/jobs/image?matchId=${encodeURIComponent(
                        matchId
                    )}`,
                confirmationStatus,
                requiresPlayerReview,
                reviewRequired:
                    requiresPlayerReview,
                editDeadlineAt,
                editWindowOpen,
                hasDisputes:
                    matchReport
                        ?.hasDisputes ===
                        true,
                disputeCount:
                    normalizeCount(
                        matchReport
                            ?.disputeCount
                    ),
                adjustmentCount:
                    normalizeCount(
                        matchReport
                            ?.adjustmentCount
                    ),
                lastAdjustedAt:
                    sanitizeTimestamp(
                        matchReport
                            ?.lastAdjustedAt
                    ),
                result
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR get result failed:",
            error
        );

        return jsonResponse(
            {
                success:
                    false,
                code:
                    "OCR_RESULT_LOAD_FAILED",
                message:
                    "Unable to load OCR result."
            },
            500
        );
    }
}

/* =========================================================
OWNERSHIP RESOLUTION
========================================================= */

async function resolveMatchOwnership(
    env,
    matchReport,
    jobId
) {
    const reportOwnerId =
        normalizeString(
            matchReport?.ownerId
            || matchReport?.submittedBy
        );

    const reportOwnerType =
        normalizeString(
            matchReport?.ownerType
        )
            .toLowerCase();

    const reportOwnerVersion =
        normalizePositiveInteger(
            matchReport?.ownerVersion
        );

    /*
     * Explicit account ownership on the report is authoritative.
     */
    if (
        reportOwnerId
        && reportOwnerType ===
            OWNER_TYPE_ACCOUNT
        && reportOwnerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        return {
            ownerId:
                reportOwnerId,
            ownerType:
                OWNER_TYPE_ACCOUNT,
            ownerVersion:
                OWNER_VERSION_ACCOUNT,
            isLegacy:
                false
        };
    }

    /*
     * If a job ID exists, inspect the originating job.
     *
     * This supports new Cloud Run output that still only
     * propagates submittedBy without ownerType/version.
     */
    if (
        jobId
    ) {
        const jobOwnership =
            await resolveJobOwnership(
                env,
                jobId
            );

        if (
            jobOwnership
        ) {
            /*
             * If both the report and job have owner hashes,
             * they must agree.
             */
            if (
                reportOwnerId
                && !constantTimeEqual(
                    reportOwnerId,
                    jobOwnership.ownerId
                )
            ) {
                return null;
            }

            return jobOwnership;
        }
    }

    /*
     * No ownership-version metadata and no usable job lineage
     * means this is treated as a pre-v2 Epic-owned report.
     */
    if (
        reportOwnerId
        && !reportOwnerType
        && reportOwnerVersion ===
            null
    ) {
        return {
            ownerId:
                reportOwnerId,
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
JOB OWNERSHIP RESOLUTION
========================================================= */

async function resolveJobOwnership(
    env,
    jobId
) {
    const baseKey =
        `ocr-jobs/${jobId}`;

    const statusObject =
        await env.OCR_STORAGE.get(
            `${baseKey}/status.json`
        );

    if (
        statusObject
    ) {
        const statusData =
            await readStoredJson(
                statusObject
            );

        if (
            statusData
            && sanitizeJobId(
                statusData?.jobId
            ) ===
                jobId
        ) {
            const ownership =
                normalizeStoredOwnership(
                    statusData?.ownerId,
                    statusData?.ownerType,
                    statusData?.ownerVersion
                );

            if (
                ownership
            ) {
                return ownership;
            }
        }
    }

    const requestObject =
        await env.OCR_STORAGE.get(
            `${baseKey}/request.json`
        );

    if (
        !requestObject
    ) {
        return null;
    }

    const requestData =
        await readStoredJson(
            requestObject
        );

    if (
        !requestData
        || sanitizeJobId(
            requestData?.jobId
        ) !==
            jobId
    ) {
        return null;
    }

    return normalizeStoredOwnership(
        requestData?.ownerId
            || requestData
                ?.fields
                ?.submittedBy,
        requestData?.ownerType
            || requestData
                ?.fields
                ?.ownerType,
        requestData?.ownerVersion
            ?? requestData
                ?.fields
                ?.ownerVersion
    );
}

function normalizeStoredOwnership(
    ownerId,
    ownerType,
    ownerVersion
) {
    const normalizedOwnerId =
        normalizeString(
            ownerId
        );

    const normalizedOwnerType =
        normalizeString(
            ownerType
        )
            .toLowerCase();

    const normalizedOwnerVersion =
        normalizePositiveInteger(
            ownerVersion
        );

    if (
        !normalizedOwnerId
    ) {
        return null;
    }

    if (
        normalizedOwnerType ===
            OWNER_TYPE_ACCOUNT
        && normalizedOwnerVersion ===
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

    if (
        !normalizedOwnerType
        && normalizedOwnerVersion ===
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
PUBLIC SCOREBOARD
========================================================= */

function sanitizePublicScoreboard(
    matchReport,
    {
        includeReviewEvidence = false,
        editDeadlineAt = null
    } = {}
) {
    const teams =
        Array.isArray(
            matchReport?.teams
        )
            ? matchReport.teams
            : [];

    const publicTeams =
        [];

    const storedActiveFields =
        Array.isArray(
            matchReport?.activeFields
        )
            ? matchReport.activeFields
            : [];

    const activeFields =
        storedActiveFields
            .map(
                function(
                    field
                ) {
                    return String(
                        field
                        || ""
                    )
                        .trim()
                        .toLowerCase();
                }
            )
            .filter(
                function(
                    field
                ) {
                    return ALLOWED_SCOREBOARD_FIELDS.has(
                        field
                    );
                }
            );

    const activeFieldSet =
        new Set(
            activeFields
        );

    for (
        let teamArrayIndex = 0;
        teamArrayIndex < teams.length;
        teamArrayIndex += 1
    ) {
        const team =
            teams[
                teamArrayIndex
            ];

        const teamIndex =
            Number(
                team?.team
                ?? team?.teamIndex
                ?? (
                    teamArrayIndex
                    + 1
                )
            );

        if (
            teamIndex !== 1
            && teamIndex !== 2
        ) {
            continue;
        }

        const players =
            Array.isArray(
                team?.players
            )
                ? team.players
                : [];

        const publicPlayers =
            [];

        for (
            const player
            of players
        ) {
            const playerName =
                String(
                    player?.player
                    || player?.matchedName
                    || player?.username
                    || player?.name
                    || ""
                )
                    .trim();

            if (
                !playerName
            ) {
                continue;
            }

            const publicPlayer = {
                player:
                    playerName
            };

            const publicReviewFields =
                {};

            for (
                const field
                of activeFieldSet
            ) {
                const reviewField =
                    player
                        ?.reviewFields
                        ?.[field];

                let effectiveValue =
                    player?.[
                        field
                    ];

                if (
                    (
                        effectiveValue ===
                            null
                        || typeof effectiveValue ===
                            "undefined"
                        || String(
                            effectiveValue
                        )
                            .trim() ===
                            ""
                    )
                    && reviewField
                ) {
                    effectiveValue =
                        reviewField
                            ?.value;
                }

                const numericEffectiveValue =
                    sanitizeScoreboardValue(
                        effectiveValue
                    );

                publicPlayer[
                    field
                ] =
                    numericEffectiveValue;

                if (
                    includeReviewEvidence
                    && reviewField
                    && typeof reviewField ===
                        "object"
                    && !Array.isArray(
                        reviewField
                    )
                ) {
                    publicReviewFields[
                        field
                    ] =
                        sanitizeReviewField(
                            reviewField,
                            numericEffectiveValue
                        );
                }
            }

            if (
                includeReviewEvidence
                && Object.keys(
                    publicReviewFields
                ).length >
                    0
            ) {
                publicPlayer.reviewFields =
                    publicReviewFields;
            }

            publicPlayers.push(
                publicPlayer
            );
        }

        if (
            publicPlayers.length >
                0
        ) {
            publicTeams.push({
                team:
                    teamIndex,
                players:
                    publicPlayers
            });
        }
    }

    return {
        matchId:
            sanitizeMatchId(
                matchReport?.matchId
            ),
        matchType:
            sanitizeText(
                matchReport?.matchType
            ),
        middleStat:
            sanitizeMiddleStat(
                matchReport?.middleStat
            ),
        activeFields,
        editDeadlineAt,
        teams:
            publicTeams
    };
}

/* =========================================================
REVIEW FIELD
========================================================= */

function sanitizeReviewField(
    reviewField,
    fallbackValue
) {
    const value =
        sanitizeScoreboardValue(
            reviewField?.value
        );

    const sanitizedValue =
        value !==
            null
            ? value
            : fallbackValue;

    return {
        value:
            sanitizedValue,
        requiresVerification:
            reviewField
                ?.requiresVerification ===
                true,
        engine:
            sanitizeText(
                reviewField?.engine
            ),
        confidence:
            sanitizeConfidence(
                reviewField?.confidence
            ),
        template:
            sanitizeEngineEvidence(
                reviewField?.template
            ),
        tesseract:
            sanitizeEngineEvidence(
                reviewField?.tesseract
            ),
        paddle:
            sanitizeEngineEvidence(
                reviewField?.paddle
            )
    };
}

/* =========================================================
ENGINE EVIDENCE
========================================================= */

function sanitizeEngineEvidence(
    evidence
) {
    if (
        evidence === null
        || typeof evidence ===
            "undefined"
    ) {
        return null;
    }

    if (
        typeof evidence !==
            "object"
        || Array.isArray(
            evidence
        )
    ) {
        const value =
            sanitizeScoreboardValue(
                evidence
            );

        return value !==
            null
            ? value
            : null;
    }

    const sanitized = {};

    const value =
        sanitizeScoreboardValue(
            evidence?.value
            ?? evidence?.selectedValue
        );

    if (
        value !==
            null
    ) {
        sanitized.value =
            value;
    }

    const text =
        sanitizeText(
            evidence?.text
        );

    if (
        text
    ) {
        sanitized.text =
            text;
    }

    const confidence =
        sanitizeConfidence(
            evidence?.confidence
        );

    if (
        confidence !==
            null
    ) {
        sanitized.confidence =
            confidence;
    }

    return Object.keys(
        sanitized
    ).length ===
        0
        ? null
        : sanitized;
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

function normalizeCount(
    value
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isInteger(
            numeric
        )
        || numeric < 0
    ) {
        return 0;
    }

    return numeric;
}

/* =========================================================
SCOREBOARD VALUE
========================================================= */

function sanitizeScoreboardValue(
    value
) {
    if (
        value === null
        || typeof value ===
            "undefined"
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
        || numeric < 0
    ) {
        return null;
    }

    return numeric;
}

/* =========================================================
MIDDLE STAT
========================================================= */

function sanitizeMiddleStat(
    value
) {
    const middleStat =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    return [
        "assists",
        "demos",
        "damage"
    ].includes(
        middleStat
    )
        ? middleStat
        : null;
}

/* =========================================================
CONFIRMATION STATUS
========================================================= */

function sanitizeConfirmationStatus(
    value
) {
    const status =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    return ALLOWED_CONFIRMATION_STATUSES.has(
        status
    )
        ? status
        : null;
}

/* =========================================================
TIMESTAMP
========================================================= */

function sanitizeTimestamp(
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
TEXT
========================================================= */

function sanitizeText(
    value
) {
    const text =
        String(
            value
            ?? ""
        )
            .trim();

    return text
        || null;
}

/* =========================================================
CONFIDENCE
========================================================= */

function sanitizeConfidence(
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
        !Number.isFinite(
            numeric
        )
        || numeric < 0
    ) {
        return null;
    }

    return numeric;
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
CONSTANT-TIME STRING COMPARE
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