"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR MATCH RESULT
// ============================================================

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

const OCR_GET_RESULT_VERSION =
    "ocr-get-result-3.0";

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

// ============================================================
// MAIN
// ============================================================

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } = context;

    try {
        // ====================================================
        // CONFIGURATION
        // ====================================================

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

        // ====================================================
        // AUTHENTICATION
        // ====================================================

        const session =
            await getStoredSession(
                request,
                env
            );

        if (
            !session
            || !session.sessionData
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Authentication required."
                },
                401
            );
        }

        const epicUniqueId =
            String(
                session
                    .sessionData
                    .EpicUniqueId
                || ""
            )
                .trim();

        if (
            !epicUniqueId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Authenticated account is missing an EpicUniqueId."
                },
                401
            );
        }

        const authenticatedOwnerId =
            await createOwnerHash(
                epicUniqueId,
                env.OCR_OWNER_SECRET
            );

        // ====================================================
        // MATCH ID
        // ====================================================

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

        // ====================================================
        // LOAD MATCH REPORT
        // ====================================================

        const reportObject =
            await env.OCR_STORAGE.get(
                `match-reports/${matchId}.json`
            );

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
                JSON.parse(
                    await reportObject.text()
                );
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

        // ====================================================
        // MATCH ID VERIFICATION
        // ====================================================

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

        // ====================================================
        // OWNERSHIP VERIFICATION
        // ====================================================

        const submittedBy =
            String(
                matchReport?.submittedBy
                || ""
            )
                .trim();

        if (
            !submittedBy
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "MATCH_OWNER_MISSING",

                    message:
                        "Stored match report has no owner."
                },
                409
            );
        }

        if (
            !constantTimeEqual(
                submittedBy,
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

        // ====================================================
        // JOB LINEAGE
        // ====================================================

        const jobId =
            sanitizeJobId(
                matchReport?.jobId
            );

        // ====================================================
        // CONFIRMATION STATE
        // ====================================================

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

        // ====================================================
        // EDIT DEADLINE
        // ====================================================

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

        // ====================================================
        // SANITIZE SCOREBOARD
        // ====================================================

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

        // ====================================================
        // RESPONSE
        // ====================================================

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

// ============================================================
// PUBLIC SCOREBOARD
// ============================================================

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
                of ALLOWED_SCOREBOARD_FIELDS
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
                        effectiveValue === null
                        || typeof effectiveValue ===
                            "undefined"
                        || String(
                            effectiveValue
                        ).trim() === ""
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

                if (
                    numericEffectiveValue !==
                        null
                ) {
                    publicPlayer[
                        field
                    ] =
                        numericEffectiveValue;
                }

                if (
                    includeReviewEvidence
                    && reviewField
                    && typeof reviewField ===
                        "object"
                    && !Array.isArray(
                        reviewField
                    )
                ) {
                    const sanitizedReviewField =
                        sanitizeReviewField(
                            reviewField,
                            numericEffectiveValue
                        );

                    if (
                        sanitizedReviewField
                    ) {
                        publicReviewFields[
                            field
                        ] =
                            sanitizedReviewField;
                    }
                }
            }

            if (
                includeReviewEvidence
                && Object.keys(
                    publicReviewFields
                ).length > 0
            ) {
                publicPlayer.reviewFields =
                    publicReviewFields;
            }

            publicPlayers.push(
                publicPlayer
            );
        }

        if (
            publicPlayers.length > 0
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

        editDeadlineAt,

        teams:
            publicTeams
    };
}

// ============================================================
// REVIEW FIELD
// ============================================================

function sanitizeReviewField(
    reviewField,
    fallbackValue
) {
    const value =
        sanitizeScoreboardValue(
            reviewField?.value
        );

    const sanitizedValue =
        value !== null
            ? value
            : fallbackValue;

    if (
        sanitizedValue ===
            null
    ) {
        return null;
    }

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

// ============================================================
// ENGINE EVIDENCE
// ============================================================

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

        return (
            value !== null
                ? value
                : null
        );
    }

    const sanitized =
        {};

    const value =
        sanitizeScoreboardValue(
            evidence?.value
            ?? evidence?.selectedValue
        );

    if (
        value !== null
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

    if (
        Object.keys(
            sanitized
        ).length ===
            0
    ) {
        return null;
    }

    return sanitized;
}

// ============================================================
// SCOREBOARD VALUE
// ============================================================

function sanitizeScoreboardValue(
    value
) {
    if (
        value === null
        || typeof value ===
            "undefined"
        || String(
            value
        ).trim() === ""
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

// ============================================================
// CONFIRMATION STATUS
// ============================================================

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

    return (
        ALLOWED_CONFIRMATION_STATUSES.has(
            status
        )
            ? status
            : null
    );
}

// ============================================================
// COUNT
// ============================================================

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

// ============================================================
// TIMESTAMP
// ============================================================

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

// ============================================================
// TEXT
// ============================================================

function sanitizeText(
    value
) {
    const text =
        String(
            value
            ?? ""
        )
            .trim();

    return (
        text
        || null
    );
}

// ============================================================
// CONFIDENCE
// ============================================================

function sanitizeConfidence(
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
// OWNER HASH
// ============================================================

async function createOwnerHash(
    epicUniqueId,
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
                    epicUniqueId
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

// ============================================================
// CONSTANT-TIME STRING COMPARE
// ============================================================

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

    if (
        firstBytes.length !==
            secondBytes.length
    ) {
        return false;
    }

    let difference =
        0;

    for (
        let index = 0;
        index < firstBytes.length;
        index += 1
    ) {
        difference |=
            firstBytes[
                index
            ]
            ^ secondBytes[
                index
            ];
    }

    return difference ===
        0;
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
// MATCH ID
// ============================================================

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

    if (
        !/^[A-Z0-9]{16}$/.test(
            matchId
        )
    ) {
        return null;
    }

    return matchId;
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