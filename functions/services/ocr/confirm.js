"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR RESULT CONFIRMATION / ADJUSTMENT

File:
    functions/services/ocr/confirm.js

Service:
    OCR result confirmation and adjustment

Purpose:
    Validates and stores user-confirmed or adjusted OCR results.

Description:
    - Requires a valid global BPD session.
    - New OCR results are owned by identity.accounts.id.
    - Existing Epic-owned OCR results remain accessible.
    - Uses originating OCR job metadata when the match report
      does not contain ownerType / ownerVersion metadata.
    - Validates ownership before modifying stored match data.
    - Enforces edit deadlines and review requirements.

Ownership Model:
    Version 2:
        ownerType = "account"
        ownerVersion = 2
        ownerId/submittedBy = HMAC(identity.accounts.id)

    Legacy:
        owner metadata absent
        submittedBy = HMAC(Epic provider subject)
========================================================= */

import {
    getCurrentMatchReport,
    updateCurrentMatchReport
} from "./storage.js";

import {
    getSessionContext,
    getProviderContext
} from "../auth/sessions/session_context.js";

/* =========================================================
VERSION
========================================================= */

const OCR_CONFIRM_VERSION =
    "ocr-confirm-3.0";

const OWNER_TYPE_ACCOUNT =
    "account";

const OWNER_VERSION_ACCOUNT =
    2;

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

const ALLOWED_REVIEW_FIELDS =
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
HELPERS
========================================================= */

function normalizeString(
    value
) {
    const normalized =
        String(
            value
            ?? ""
        )
            .trim();

    return normalized
        || null;
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

function normalizeInteger(
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
OWNERSHIP RESOLUTION
========================================================= */

async function resolveMatchOwnership(
    env,
    matchReport
) {
    const reportOwnerId =
        normalizeString(
            matchReport?.ownerId
            || matchReport?.submittedBy
        );

    const reportOwnerType =
        String(
            matchReport?.ownerType
            || ""
        )
            .trim()
            .toLowerCase();

    const reportOwnerVersion =
        normalizePositiveInteger(
            matchReport?.ownerVersion
        );

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

    const jobId =
        sanitizeJobId(
            matchReport?.jobId
        );

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
     * Historical reports contain only submittedBy and that
     * value was derived from the Epic account identifier.
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
JOB OWNERSHIP
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
        String(
            ownerType
            || ""
        )
            .trim()
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
        )
            .trim() ===
            ""
            ? (
                field ===
                    "ping"
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
        team,
        player,
        field,
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
        )
            .trim()
    ]
        .join(
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

                return storedName ===
                    normalizedRequestedPlayer;
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
        )
            .trim() ===
            ""
    ) {
        return field ===
            "ping"
            ? 0
            : null;
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
            ?.[field];

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
    const fields =
        Array.isArray(
            report
                ?.confirmation
                ?.fields
        )
            ? report.confirmation.fields
            : [];

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
            !==
            requestedKey
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
    const adjustments =
        Array.isArray(
            report?.adjustments
        )
            ? report.adjustments
            : [];

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
        const fields =
            Array.isArray(
                adjustment?.fields
            )
                ? adjustment.fields
                : [];

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
                !==
                requestedKey
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
            field ===
                "ping"
            && (
                reviewField.value ===
                    null
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
        confirmationValue !==
        null
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
        adjustmentValue !==
        null
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

        const players =
            Array.isArray(
                team?.players
            )
                ? team.players
                : [];

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

            const reviewFields =
                player?.reviewFields
                && typeof player.reviewFields ===
                    "object"
                && !Array.isArray(
                    player.reviewFields
                )
                    ? player.reviewFields
                    : {};

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
        expectedFieldKeys.size ===
            0
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
                        "Stored team could not be matched "
                        + `for team ${entry.team}.`
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
                        "Stored player could not be matched: "
                        + entry.player
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
                        "Stored OCR review evidence is missing "
                        + `for ${entry.player} / ${entry.field}.`
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
                        "Stored OCR value is invalid "
                        + `for ${entry.player} / ${entry.field}.`
                }
            };
        }

        const disputed =
            entry.userValue !==
            ocrValue;

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

            ocrValue,

            userValue:
                entry.userValue,

            finalValue:
                entry.userValue,

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
        ] =
            entry.userValue;
    }

    const disputes =
        authoritativeFields.filter(
            function(
                entry
            ) {
                return entry.disputed ===
                    true;
            }
        );

    const confirmationStatus =
        disputes.length > 0
            ? "confirmed_with_disputes"
            : "confirmed";

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

        confirmedAt,

        hasDisputes:
            disputes.length > 0,

        disputeCount:
            disputes.length,

        fields:
            authoritativeFields,

        disputes
    };

    return {
        success:
            true,

        mode:
            CONFIRM_MODE_REVIEW,

        confirmationStatus,

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
                        "Stored team could not be matched "
                        + `for team ${entry.team}.`
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
                        "Stored player could not be matched: "
                        + entry.player
                }
            };
        }

        const previousValue =
            getCurrentPlayerValue(
                player,
                entry.field
            );

        if (
            previousValue ===
            null
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        "Stored scoreboard value is invalid "
                        + `for ${entry.player} / ${entry.field}.`
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
            ocrValue ===
            null
        ) {
            return {
                error: {
                    status:
                        409,

                    message:
                        "Original OCR value could not be established "
                        + `for ${entry.player} / ${entry.field}.`
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

            ocrValue,

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
        ] =
            entry.userValue;
    }

    if (
        adjustmentFields.length ===
        0
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

    const adjustments =
        Array.isArray(
            existingReport
                ?.adjustments
        )
            ? existingReport.adjustments
            : [];

    adjustments.push({
        adjustmentId,

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

    return {
        success:
            true,

        mode:
            CONFIRM_MODE_ADJUSTMENT,

        confirmationStatus:
            currentStatus,

        adjustedAt,

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
                        "OCR storage binding is not configured."
                },
                503
            );
        }

        const ownerSecret =
            String(
                env.OCR_OWNER_SECRET
                || ""
            )
                .trim();

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

        /* =================================================
        GLOBAL BPD SESSION
        ================================================= */

        const session =
            await getSessionContext(
                request,
                env
            );

        if (
            session.authenticated !==
            true
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
            session.active !==
            true
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
        REQUEST BODY
        ================================================= */

        let body;

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

        const rawFields =
            Array.isArray(
                body?.fields
            )
                ? body.fields
                : [];

        if (
            rawFields.length ===
            0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        mode ===
                            CONFIRM_MODE_ADJUSTMENT
                            ? "At least one adjusted field is required."
                            : "At least one reviewed field is required."
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
        LOAD CURRENT REPORT
        ================================================= */

        const existingObject =
            await getCurrentMatchReport(
                env.OCR_STORAGE,
                matchId
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

        let existingReport;

        try {
            existingReport =
                await existingObject.json();
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

        if (
            !existingReport
            || typeof existingReport !==
                "object"
            || Array.isArray(
                existingReport
            )
        ) {
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
            ) !==
            matchId
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

        const ownership =
            await resolveMatchOwnership(
                env,
                existingReport
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

        const authenticatedOwnerId =
            await resolveAuthenticatedOwnerHash(
                session,
                ownership,
                ownerSecret
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
                            ? "A linked Epic account is required to modify this legacy OCR result."
                            : "Authenticated account identity is unavailable."
                },
                ownership.isLegacy
                    ? 403
                    : 409
            );
        }

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
                        mode ===
                            CONFIRM_MODE_ADJUSTMENT
                            ? "You are not authorized to adjust this match."
                            : "You are not authorized to confirm this match."
                },
                403
            );
        }

        /* =================================================
        STORED TEAMS
        ================================================= */

        const teams =
            Array.isArray(
                existingReport?.teams
            )
                ? existingReport.teams
                : [];

        if (
            teams.length ===
            0
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
        EDIT DEADLINE
        ================================================= */

        const editDeadlineAt =
            String(
                existingReport
                    ?.editDeadlineAt
                || ""
            )
                .trim();

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

        const result =
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
        STORE UPDATED CURRENT REPORT
        ================================================= */

        const storageResult =
            await updateCurrentMatchReport(
                env.OCR_STORAGE,
                matchId,
                existingReport
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
                    ),

                currentReportKey:
                    storageResult.objectKey
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