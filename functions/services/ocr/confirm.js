"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR RESULT CONFIRMATION / ADJUSTMENT
   ========================================================= */

import {
    putMatchReport
} from "./storage.js";

import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";

/* =========================================================
   VERSION
   ========================================================= */

const OCR_CONFIRM_VERSION =
    "ocr-confirm-2.0";

/* =========================================================
   MODES
   ========================================================= */

const CONFIRM_MODE_REVIEW =
    "review";

const CONFIRM_MODE_ADJUSTMENT =
    "adjustment";

/* =========================================================
   ALLOWED REVIEW FIELDS
   ========================================================= */

const ALLOWED_REVIEW_FIELDS = new Set([
    "score",
    "goals",
    "assists",
    "demos",
    "saves",
    "shots",
    "damage",
    "ping"
]);

/* =========================================================
   ADJUSTMENT ID
   ========================================================= */

const ADJUSTMENT_ID_LENGTH =
    16;

const ADJUSTMENT_ID_ALPHABET =
    "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/* =========================================================
   RESPONSE
   ========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status:
                status,

            headers: {
                "Content-Type":
                    "application/json",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}

/* =========================================================
   OWNER HASH
   ========================================================= */

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

/* =========================================================
   HELPERS
   ========================================================= */

function normalizeString(
    value
) {
    const normalized =
        String(
            value
            ?? ""
        ).trim();

    return (
        normalized
        || null
    );
}

function normalizeInteger(
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
        return null;
    }

    return numeric;
}

function normalizeMatchId(
    value
) {
    return String(
        value
        ?? ""
    )
        .trim()
        .toUpperCase();
}

function validMatchId(
    value
) {
    return /^[A-Z0-9]{16}$/.test(
        value
    );
}

function normalizePlayerName(
    value
) {
    return String(
        value
        ?? ""
    )
        .trim()
        .toUpperCase();
}

function normalizeConfirmationStatus(
    value
) {
    return String(
        value
        ?? ""
    )
        .trim()
        .toLowerCase();
}

function normalizeMode(
    value
) {
    const normalized =
        String(
            value
            ?? ""
        )
            .trim()
            .toLowerCase();

    if (
        normalized ===
        CONFIRM_MODE_ADJUSTMENT
    ) {
        return CONFIRM_MODE_ADJUSTMENT;
    }

    return CONFIRM_MODE_REVIEW;
}

/* =========================================================
   RANDOM ADJUSTMENT ID
   ========================================================= */

function randomAdjustmentCharacter() {
    const values =
        new Uint32Array(
            1
        );

    crypto.getRandomValues(
        values
    );

    return ADJUSTMENT_ID_ALPHABET[
        values[0]
        % ADJUSTMENT_ID_ALPHABET.length
    ];
}

function generateAdjustmentId() {
    let value =
        "";

    for (
        let index = 0;
        index < ADJUSTMENT_ID_LENGTH;
        index += 1
    ) {
        value +=
            randomAdjustmentCharacter();
    }

    return value;
}

/* =========================================================
   VALIDATE FIELD ENTRY
   ========================================================= */

function normalizeFieldEntry(
    entry
) {
    if (
        !entry
        || typeof entry !==
            "object"
        || Array.isArray(
            entry
        )
    ) {
        return null;
    }

    const team =
        normalizeInteger(
            entry.team
        );

    const player =
        normalizeString(
            entry.player
        );

    const field =
        normalizeString(
            entry.field
        );

    if (
        team !== 1
        && team !== 2
    ) {
        return null;
    }

    if (
        !player
    ) {
        return null;
    }

    if (
        !field
        || !ALLOWED_REVIEW_FIELDS.has(
            field
        )
    ) {
        return null;
    }

    const userValue = (
        entry.userValue === null
        || typeof entry.userValue ===
            "undefined"
        || String(
            entry.userValue
        ).trim() === ""
            ? (
                field === "ping"
                    ? 0
                    : null
            )
            : normalizeInteger(
                entry.userValue
            )
    );

    if (
        userValue === null
    ) {
        return null;
    }

    return {
        team:
            team,

        player:
            player,

        field:
            field,

        userValue:
            userValue
    };
}

/* =========================================================
   FIELD KEY
   ========================================================= */

function buildFieldKey(
    team,
    player,
    field
) {
    return [
        Number(
            team
        ),
        normalizePlayerName(
            player
        ),
        String(
            field
            || ""
        ).trim()
    ].join(
        "|"
    );
}

/* =========================================================
   FIND TEAM
   ========================================================= */

function findStoredTeam(
    teams,
    requestedTeam
) {
    return (
        teams.find(
            function(
                candidate
            ) {
                return (
                    Number(
                        candidate?.team
                        ?? candidate?.teamIndex
                        ?? 0
                    )
                    === requestedTeam
                );
            }
        )
        || null
    );
}

/* =========================================================
   FIND PLAYER
   ========================================================= */

function findStoredPlayer(
    team,
    requestedPlayer
) {
    if (
        !team
        || !Array.isArray(
            team.players
        )
    ) {
        return null;
    }

    const normalizedRequestedPlayer =
        normalizePlayerName(
            requestedPlayer
        );

    return (
        team.players.find(
            function(
                candidate
            ) {
                const storedName =
                    normalizePlayerName(
                        candidate?.player
                        || candidate?.matchedName
                        || candidate?.username
                        || ""
                    );

                return (
                    storedName ===
                    normalizedRequestedPlayer
                );
            }
        )
        || null
    );
}

/* =========================================================
   CURRENT EFFECTIVE VALUE
   ========================================================= */

function getCurrentPlayerValue(
    player,
    field
) {
    const storedValue =
        player?.[
            field
        ];

    if (
        storedValue === null
        || typeof storedValue ===
            "undefined"
        || String(
            storedValue
        ).trim() === ""
    ) {
        return (
            field === "ping"
                ? 0
                : null
        );
    }

    return normalizeInteger(
        storedValue
    );
}

/* =========================================================
   REVIEW FIELD
   ========================================================= */

function getStoredReviewField(
    player,
    field
) {
    const reviewField =
        player
            ?.reviewFields
            ?.[
                field
            ];

    if (
        !reviewField
        || typeof reviewField !==
            "object"
        || Array.isArray(
            reviewField
        )
    ) {
        return null;
    }

    return reviewField;
}

/* =========================================================
   ORIGINAL OCR VALUE
   ========================================================= */

function getConfirmationOcrValue(
    report,
    team,
    player,
    field
) {
    const fields = (
        Array.isArray(
            report
                ?.confirmation
                ?.fields
        )
            ? report.confirmation.fields
            : []
    );

    const requestedKey =
        buildFieldKey(
            team,
            player,
            field
        );

    for (
        const entry
        of fields
    ) {
        if (
            buildFieldKey(
                entry?.team,
                entry?.player,
                entry?.field
            )
            !== requestedKey
        ) {
            continue;
        }

        const value =
            normalizeInteger(
                entry?.ocrValue
            );

        if (
            value !== null
        ) {
            return value;
        }
    }

    return null;
}

function getAdjustmentOcrValue(
    report,
    team,
    player,
    field
) {
    const adjustments = (
        Array.isArray(
            report?.adjustments
        )
            ? report.adjustments
            : []
    );

    const requestedKey =
        buildFieldKey(
            team,
            player,
            field
        );

    for (
        const adjustment
        of adjustments
    ) {
        const fields = (
            Array.isArray(
                adjustment?.fields
            )
                ? adjustment.fields
                : []
        );

        for (
            const entry
            of fields
        ) {
            if (
                buildFieldKey(
                    entry?.team,
                    entry?.player,
                    entry?.field
                )
                !== requestedKey
            ) {
                continue;
            }

            const value =
                normalizeInteger(
                    entry?.ocrValue
                );

            if (
                value !== null
            ) {
                return value;
            }
        }
    }

    return null;
}

function getOriginalOcrValue(
    report,
    player,
    team,
    playerName,
    field
) {
    const reviewField =
        getStoredReviewField(
            player,
            field
        );

    if (
        reviewField
    ) {
        const reviewValue =
            normalizeInteger(
                reviewField.value
            );

        if (
            reviewValue !== null
        ) {
            return reviewValue;
        }

        if (
            field === "ping"
            && (
                reviewField.value === null
                || typeof reviewField.value ===
                    "undefined"
            )
        ) {
            return 0;
        }
    }

    const confirmationValue =
        getConfirmationOcrValue(
            report,
            team,
            playerName,
            field
        );

    if (
        confirmationValue !== null
    ) {
        return confirmationValue;
    }

    const adjustmentValue =
        getAdjustmentOcrValue(
            report,
            team,
            playerName,
            field
        );

    if (
        adjustmentValue !== null
    ) {
        return adjustmentValue;
    }

    return getCurrentPlayerValue(
        player,
        field
    );
}

/* =========================================================
   OCR EVIDENCE
   ========================================================= */

function buildOcrEvidence(
    reviewField,
    ocrValue
) {
    if (
        !reviewField
    ) {
        return {
            selectedValue:
                ocrValue,

            selectedEngine:
                null,

            confidence:
                null,

            template:
                null,

            tesseract:
                null,

            paddle:
                null
        };
    }

    return {
        selectedValue:
            reviewField.value
            ?? ocrValue,

        selectedEngine:
            reviewField.engine
            ?? null,

        confidence:
            reviewField.confidence
            ?? null,

        template:
            reviewField.template
            ?? null,

        tesseract:
            reviewField.tesseract
            ?? null,

        paddle:
            reviewField.paddle
            ?? null
    };
}

/* =========================================================
   EXPECTED REVIEW FIELD SET
   ========================================================= */

function buildExpectedReviewFieldKeys(
    teams
) {
    const expectedFieldKeys =
        new Set();

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

        const players = (
            Array.isArray(
                team?.players
            )
                ? team.players
                : []
        );

        for (
            const player
            of players
        ) {
            const playerName =
                normalizePlayerName(
                    player?.player
                    || player?.matchedName
                    || player?.username
                    || ""
                );

            if (
                !playerName
            ) {
                continue;
            }

            const reviewFields = (
                player?.reviewFields
                && typeof player.reviewFields ===
                    "object"
                && !Array.isArray(
                    player.reviewFields
                )
                    ? player.reviewFields
                    : {}
            );

            for (
                const fieldName
                of Object.keys(
                    reviewFields
                )
            ) {
                if (
                    !ALLOWED_REVIEW_FIELDS.has(
                        fieldName
                    )
                ) {
                    continue;
                }

                expectedFieldKeys.add(
                    buildFieldKey(
                        teamIndex,
                        playerName,
                        fieldName
                    )
                );
            }
        }
    }

    return expectedFieldKeys;
}

/* =========================================================
   REVIEW MODE
   ========================================================= */

function processReviewConfirmation(
    existingReport,
    teams,
    fields,
    submittedFieldKeys
) {
    const currentStatus =
        normalizeConfirmationStatus(
            existingReport
                ?.confirmationStatus
        );

    if (
        currentStatus
        && currentStatus !==
            "pending_review"
    ) {
        return {
            error: {
                status:
                    409,

                message:
                    "This scoreboard is no longer awaiting review."
            }
        };
    }

    const expectedFieldKeys =
        buildExpectedReviewFieldKeys(
            teams
        );

    if (
        expectedFieldKeys.size === 0
    ) {
        return {
            error: {
                status:
                    409,

                message:
                    "Stored match report contains no reviewable fields."
            }
        };
    }

    if (
        submittedFieldKeys.size !==
        expectedFieldKeys.size
    ) {
        return {
            error: {
                status:
                    400,

                message:
                    "All scoreboard fields must be reviewed before confirmation."
            }
        };
    }

    for (
        const expectedKey
        of expectedFieldKeys
    ) {
        if (
            !submittedFieldKeys.has(
                expectedKey
            )
        ) {
            return {
                error: {
                    status:
                        400,

                    message:
                        "All scoreboard fields must be reviewed before confirmation."
                }
            };
        }
    }

    const authoritativeFields =
        [];

    for (
        const entry
        of fields
    ) {
        const team =
            findStoredTeam(
                teams,
                entry.team
            );

        if (
            !team
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored team could not be matched "
                            + `for team ${entry.team}.`
                        )
                }
            };
        }

        const player =
            findStoredPlayer(
                team,
                entry.player
            );

        if (
            !player
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored player could not be matched: "
                            + entry.player
                        )
                }
            };
        }

        const reviewField =
            getStoredReviewField(
                player,
                entry.field
            );

        if (
            !reviewField
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored OCR review evidence is missing "
                            + `for ${entry.player} / ${entry.field}.`
                        )
                }
            };
        }

        const ocrValue =
            getOriginalOcrValue(
                existingReport,
                player,
                entry.team,
                entry.player,
                entry.field
            );

        if (
            ocrValue === null
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored OCR value is invalid "
                            + `for ${entry.player} / ${entry.field}.`
                        )
                }
            };
        }

        const disputed = (
            entry.userValue !==
            ocrValue
        );

        authoritativeFields.push({
            team:
                entry.team,

            player:
                String(
                    player?.player
                    || entry.player
                ),

            field:
                entry.field,

            ocrValue:
                ocrValue,

            userValue:
                entry.userValue,

            finalValue:
                entry.userValue,

            disputed:
                disputed,

            requiresVerification:
                reviewField
                    .requiresVerification ===
                true,

            ocrEvidence:
                buildOcrEvidence(
                    reviewField,
                    ocrValue
                )
        });

        player[
            entry.field
        ] = entry.userValue;
    }

    const disputes =
        authoritativeFields.filter(
            function(
                entry
            ) {
                return (
                    entry.disputed ===
                    true
                );
            }
        );

    const confirmationStatus = (
        disputes.length > 0
            ? "confirmed_with_disputes"
            : "confirmed"
    );

    const confirmedAt =
        new Date()
            .toISOString();

    existingReport.confirmationStatus =
        confirmationStatus;

    existingReport.requiresPlayerReview =
        false;

    existingReport.reviewRequired =
        false;

    existingReport.hasDisputes =
        disputes.length > 0;

    existingReport.disputeCount =
        disputes.length;

    existingReport.confirmation = {
        status:
            confirmationStatus,

        confirmedAt:
            confirmedAt,

        hasDisputes:
            disputes.length > 0,

        disputeCount:
            disputes.length,

        fields:
            authoritativeFields,

        disputes:
            disputes
    };

    return {
        success:
            true,

        mode:
            CONFIRM_MODE_REVIEW,

        confirmationStatus:
            confirmationStatus,

        confirmedAt:
            confirmedAt,

        hasDisputes:
            disputes.length > 0,

        disputeCount:
            disputes.length
    };
}

/* =========================================================
   ADJUSTMENT MODE
   ========================================================= */

function processAdjustment(
    existingReport,
    teams,
    fields
) {
    const currentStatus =
        normalizeConfirmationStatus(
            existingReport
                ?.confirmationStatus
        );

    if (
        currentStatus ===
        "pending_review"
    ) {
        return {
            error: {
                status:
                    409,

                message:
                    "This scoreboard must complete review before adjustments can be made."
            }
        };
    }

    if (
        ![
            "auto_accepted",
            "confirmed",
            "confirmed_with_disputes",
            "adjusted"
        ].includes(
            currentStatus
        )
    ) {
        return {
            error: {
                status:
                    409,

                message:
                    "This scoreboard is not in a state that can be adjusted."
            }
        };
    }

    const adjustmentFields =
        [];

    for (
        const entry
        of fields
    ) {
        const team =
            findStoredTeam(
                teams,
                entry.team
            );

        if (
            !team
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored team could not be matched "
                            + `for team ${entry.team}.`
                        )
                }
            };
        }

        const player =
            findStoredPlayer(
                team,
                entry.player
            );

        if (
            !player
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored player could not be matched: "
                            + entry.player
                        )
                }
            };
        }

        const previousValue =
            getCurrentPlayerValue(
                player,
                entry.field
            );

        if (
            previousValue === null
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Stored scoreboard value is invalid "
                            + `for ${entry.player} / ${entry.field}.`
                        )
                }
            };
        }

        if (
            previousValue ===
            entry.userValue
        ) {
            continue;
        }

        const reviewField =
            getStoredReviewField(
                player,
                entry.field
            );

        const ocrValue =
            getOriginalOcrValue(
                existingReport,
                player,
                entry.team,
                entry.player,
                entry.field
            );

        if (
            ocrValue === null
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        (
                            "Original OCR value could not be established "
                            + `for ${entry.player} / ${entry.field}.`
                        )
                }
            };
        }

        adjustmentFields.push({
            team:
                entry.team,

            player:
                String(
                    player?.player
                    || entry.player
                ),

            field:
                entry.field,

            ocrValue:
                ocrValue,

            previousValue:
                previousValue,

            newValue:
                entry.userValue,

            differsFromOcr:
                entry.userValue !==
                ocrValue,

            ocrEvidence:
                buildOcrEvidence(
                    reviewField,
                    ocrValue
                )
        });

        player[
            entry.field
        ] = entry.userValue;
    }

    if (
        adjustmentFields.length === 0
    ) {
        return {
            error: {
                status:
                    400,

                message:
                    "No scoreboard values were changed."
            }
        };
    }

    const adjustmentId =
        generateAdjustmentId();

    const adjustedAt =
        new Date()
            .toISOString();

    const adjustments = (
        Array.isArray(
            existingReport
                ?.adjustments
        )
            ? existingReport.adjustments
            : []
    );

    adjustments.push({
        adjustmentId:
            adjustmentId,

        adjustedAt:
            adjustedAt,

        previousConfirmationStatus:
            currentStatus,

        fields:
            adjustmentFields
    });

    existingReport.adjustments =
        adjustments;

    existingReport.lastAdjustedAt =
        adjustedAt;

    existingReport.adjustmentCount =
        adjustments.length;

    /*
     * Keep confirmationStatus as the acceptance lineage.
     *
     * auto_accepted remains auto_accepted.
     * confirmed remains confirmed.
     * confirmed_with_disputes remains confirmed_with_disputes.
     *
     * The presence of adjustments[] tells us the effective
     * scoreboard has been edited after acceptance.
     */

    return {
        success:
            true,

        mode:
            CONFIRM_MODE_ADJUSTMENT,

        confirmationStatus:
            currentStatus,

        adjustedAt:
            adjustedAt,

        adjustmentId:
            adjustmentId,

        adjustmentCount:
            adjustments.length,

        changedFieldCount:
            adjustmentFields.length
    };
}

/* =========================================================
   MAIN
   ========================================================= */

export async function handleOcrConfirmation(
    {
        request,
        env
    }
) {
    try {

        /* =================================================
           METHOD
           ================================================= */

        if (
            request.method !==
            "POST"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Method not allowed."
                },
                405
            );
        }

        /* =================================================
           STORAGE
           ================================================= */

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR storage binding is not configured."
                },
                503
            );
        }

        /* =================================================
           AUTHENTICATED SESSION
           ================================================= */

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
            ).trim();

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

        /* =================================================
           OWNER HASH
           ================================================= */

        const ownerSecret =
            String(
                env.OCR_OWNER_SECRET
                || ""
            ).trim();

        if (
            !ownerSecret
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

        const authenticatedOwnerId =
            await createOwnerHash(
                epicUniqueId,
                ownerSecret
            );

        /* =================================================
           REQUEST BODY
           ================================================= */

        let body =
            null;

        try {
            body =
                await request.json();
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Invalid JSON body."
                },
                400
            );
        }

        /* =================================================
           MODE
           ================================================= */

        const mode =
            normalizeMode(
                body?.mode
            );

        /* =================================================
           MATCH ID
           ================================================= */

        const matchId =
            normalizeMatchId(
                body?.matchId
            );

        if (
            !validMatchId(
                matchId
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "A valid 16-character matchId is required."
                },
                400
            );
        }

        /* =================================================
           FIELD DATA
           ================================================= */

        const rawFields = (
            Array.isArray(
                body?.fields
            )
                ? body.fields
                : []
        );

        if (
            rawFields.length === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        (
                            mode ===
                            CONFIRM_MODE_ADJUSTMENT
                                ? "At least one adjusted field is required."
                                : "At least one reviewed field is required."
                        )
                },
                400
            );
        }

        const fields =
            rawFields
                .map(
                    normalizeFieldEntry
                )
                .filter(
                    Boolean
                );

        if (
            fields.length !==
            rawFields.length
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "One or more scoreboard fields are invalid."
                },
                400
            );
        }

        /* =================================================
           DUPLICATES
           ================================================= */

        const submittedFieldKeys =
            new Set();

        for (
            const entry
            of fields
        ) {
            const key =
                buildFieldKey(
                    entry.team,
                    entry.player,
                    entry.field
                );

            if (
                submittedFieldKeys.has(
                    key
                )
            ) {
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            "Duplicate scoreboard fields were submitted."
                    },
                    400
                );
            }

            submittedFieldKeys.add(
                key
            );
        }

        /* =================================================
           LOAD STORED REPORT
           ================================================= */

        const reportKey =
            `match-reports/${matchId}.json`;

        const existingObject =
            await env.OCR_STORAGE.get(
                reportKey
            );

        if (
            !existingObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report was not found."
                },
                404
            );
        }

        let existingReport =
            null;

        try {
            existingReport =
                JSON.parse(
                    await existingObject.text()
                );
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

        /* =================================================
           VERIFY STORED MATCH
           ================================================= */

        if (
            normalizeMatchId(
                existingReport?.matchId
            )
            !== matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report ID does not match the request."
                },
                409
            );
        }

        /* =================================================
           OWNERSHIP
           ================================================= */

        const submittedBy =
            String(
                existingReport?.submittedBy
                || ""
            ).trim();

        if (
            !submittedBy
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report has no owner."
                },
                409
            );
        }

        if (
            submittedBy !==
            authenticatedOwnerId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        (
                            mode ===
                            CONFIRM_MODE_ADJUSTMENT
                                ? "You are not authorized to adjust this match."
                                : "You are not authorized to confirm this match."
                        )
                },
                403
            );
        }

        /* =================================================
           STORED TEAMS
           ================================================= */

        const teams = (
            Array.isArray(
                existingReport?.teams
            )
                ? existingReport.teams
                : []
        );

        if (
            teams.length === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report contains no teams."
                },
                409
            );
        }
        /* =================================================
           EXPIRATION CHECK MODE
           ================================================= */
        const editDeadlineAt =
            String(
                existingReport?.editDeadlineAt
                || ""
            ).trim();

        const editDeadlineMs =
            Date.parse(
                editDeadlineAt
            );

        if (
            !Number.isFinite(
                editDeadlineMs
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "The scoreboard modification deadline is unavailable."
                },
                409
            );
        }

        if (
            Date.now() >
                editDeadlineMs
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "EDIT_WINDOW_CLOSED",

                    message:
                        "The deadline to review or modify this scoreboard has passed.",

                    editDeadlineAt
                },
                409
            );
        }
        /* =================================================
           PROCESS MODE
           ================================================= */

        const result = (
            mode ===
            CONFIRM_MODE_ADJUSTMENT
                ? processAdjustment(
                    existingReport,
                    teams,
                    fields
                )
                : processReviewConfirmation(
                    existingReport,
                    teams,
                    fields,
                    submittedFieldKeys
                )
        );

        if (
            result?.error
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        result.error.message
                },
                result.error.status
            );
        }

        /* =================================================
           STORE UPDATED REPORT
           ================================================= */

        await putMatchReport(
            env.OCR_STORAGE,
            {
                matchId:
                    matchId,

                report:
                    existingReport
            }
        );

        /* =================================================
           RESPONSE
           ================================================= */

        return jsonResponse(
            {
                success:
                    true,

                version:
                    OCR_CONFIRM_VERSION,

                matchId:
                    matchId,

                mode:
                    result.mode,

                confirmationStatus:
                    result.confirmationStatus,

                confirmedAt:
                    result.confirmedAt
                    || null,

                adjustedAt:
                    result.adjustedAt
                    || null,

                hasDisputes:
                    result.hasDisputes ===
                    true,

                disputeCount:
                    Number(
                        result.disputeCount
                        || 0
                    ),

                adjustmentId:
                    result.adjustmentId
                    || null,

                adjustmentCount:
                    Number(
                        result.adjustmentCount
                        || existingReport
                            ?.adjustmentCount
                        || 0
                    ),

                changedFieldCount:
                    Number(
                        result.changedFieldCount
                        || 0
                    )
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR result confirmation failed:",
            error
        );

        return jsonResponse(
            {
                success:
                    false,

                message:
                    "OCR result confirmation failed."
            },
            500
        );
    }
}