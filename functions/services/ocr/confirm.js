"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR RESULT CONFIRMATION
   ========================================================= */

import {
    putMatchReport
} from "./storage.js";

import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";


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

            headers:
                {
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


/* =========================================================
   VALIDATE FIELD ENTRY
   ========================================================= */

function normalizeFieldEntry(
    entry
) {
    if (
        !entry
        || typeof entry !== "object"
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
        || typeof entry.userValue
            === "undefined"
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
                    storedName
                    === normalizedRequestedPlayer
                );
            }
        )
        || null
    );
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
            request.method !== "POST"
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
           OWNER HASH CONFIGURATION
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

        let body = null;

        try {
            body =
                await request.json();

        } catch {
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
                        "At least one reviewed field is required."
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
            fields.length
            !== rawFields.length
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "One or more confirmation fields are invalid."
                },
                400
            );
        }


        /* =================================================
           SUBMITTED FIELD SET / DUPLICATES
           ================================================= */

        const submittedFieldKeys =
            new Set();

        for (
            const entry
            of fields
        ) {
            const key = [
                entry.team,
                normalizePlayerName(
                    entry.player
                ),
                entry.field
            ].join(
                "|"
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
                            "Duplicate review fields were submitted."
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

        let existingReport = null;

        try {
            existingReport =
                JSON.parse(
                    await existingObject.text()
                );

        } catch {
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
           OWNERSHIP CHECK
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
            submittedBy
            !== authenticatedOwnerId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "You are not authorized to confirm this match."
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
           EXPECTED REVIEW FIELD SET
           ================================================= */

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
                    && typeof player.reviewFields
                        === "object"
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
                        [
                            teamIndex,
                            playerName,
                            fieldName
                        ].join(
                            "|"
                        )
                    );
                }
            }
        }

        if (
            expectedFieldKeys.size === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report contains no reviewable fields."
                },
                409
            );
        }


        /* =================================================
           REQUIRE COMPLETE REVIEW
           ================================================= */

        if (
            submittedFieldKeys.size
            !== expectedFieldKeys.size
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "All scoreboard fields must be reviewed before confirmation."
                },
                400
            );
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
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            "All scoreboard fields must be reviewed before confirmation."
                    },
                    400
                );
            }
        }


        /* =================================================
           BUILD AUTHORITATIVE REVIEW DATA
           ================================================= */

        const authoritativeFields = [];

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
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            (
                                "Stored team could not be matched "
                                + `for team ${entry.team}.`
                            )
                    },
                    409
                );
            }

            const player =
                findStoredPlayer(
                    team,
                    entry.player
                );

            if (
                !player
            ) {
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            (
                                "Stored player could not be matched: "
                                + entry.player
                            )
                    },
                    409
                );
            }

            const reviewField = (
                player?.reviewFields?.[
                    entry.field
                ]
            );

            if (
                !reviewField
                || typeof reviewField
                    !== "object"
                || Array.isArray(
                    reviewField
                )
            ) {
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            (
                                "Stored OCR review evidence is missing "
                                + `for ${entry.player} / ${entry.field}.`
                            )
                    },
                    409
                );
            }


            /* =============================================
               ORIGINAL OCR VALUE
               ============================================= */

            const storedOcrValue = (
                reviewField.value
                ?? player?.[
                    entry.field
                ]
                ?? null
            );

            const ocrValue = (
                storedOcrValue === null
                || typeof storedOcrValue
                    === "undefined"
                    ? (
                        entry.field === "ping"
                            ? 0
                            : null
                    )
                    : normalizeInteger(
                        storedOcrValue
                    )
            );

            if (
                ocrValue === null
            ) {
                return jsonResponse(
                    {
                        success:
                            false,

                        message:
                            (
                                "Stored OCR value is invalid "
                                + `for ${entry.player} / ${entry.field}.`
                            )
                    },
                    409
                );
            }


            /* =============================================
               USER VALUE
               ============================================= */

            let userValue =
                entry.userValue;

            if (
                entry.field === "ping"
                && (
                    userValue === null
                    || typeof userValue
                        === "undefined"
                )
            ) {
                userValue = 0;
            }


            /* =============================================
               DISPUTE
               ============================================= */

            const disputed = (
                userValue
                !== ocrValue
            );

            const authoritativeEntry = {
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
                    userValue,

                finalValue:
                    userValue,

                disputed:
                    disputed,

                requiresVerification:
                    (
                        reviewField.requiresVerification
                        === true
                    ),

                ocrEvidence:
                    {
                        selectedValue:
                            reviewField.value
                            ?? null,

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
                    }
            };

            authoritativeFields.push(
                authoritativeEntry
            );


            /* =============================================
               APPLY FINAL VALUE
               ============================================= */

            player[
                entry.field
            ] = userValue;
        }


        /* =================================================
           DISPUTES
           ================================================= */

        const disputes =
            authoritativeFields.filter(
                function(
                    entry
                ) {
                    return (
                        entry.disputed
                        === true
                    );
                }
            );


        /* =================================================
           SERVER-DERIVED STATUS
           ================================================= */

        const confirmationStatus = (
            disputes.length > 0
                ? "confirmed_with_disputes"
                : "confirmed"
        );


        /* =================================================
           CONFIRMATION METADATA
           ================================================= */

        const confirmedAt =
            new Date().toISOString();

        existingReport.confirmationStatus =
            confirmationStatus;

        existingReport.hasDisputes = (
            disputes.length > 0
        );

        existingReport.disputeCount = (
            disputes.length
        );

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

    Successful confirmation intentionally returns
    no OCR or storage metadata to the browser.
    ================================================= */

    return new Response(
        null,
        {
            status:
                204,

            headers: {
                "Cache-Control":
                    "no-store"
            }
        }
    );

    } catch (
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