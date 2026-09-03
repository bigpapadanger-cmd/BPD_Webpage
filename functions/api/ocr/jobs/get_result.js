"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR JOB RESULT
// ============================================================

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

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
        // JOB ID
        // ====================================================

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
                        "Missing or invalid jobId."
                },
                400
            );
        }


        // ====================================================
        // LOAD JOB STATUS
        // ====================================================

        const statusObject =
            await env.OCR_STORAGE.get(
                `ocr-jobs/${jobId}/status.json`
            );

        if (
            !statusObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job was not found."
                },
                404
            );
        }

        let statusData;

        try {
            statusData =
                JSON.parse(
                    await statusObject.text()
                );
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored OCR job status is invalid."
                },
                500
            );
        }


        // ====================================================
        // JOB STATE
        // ====================================================

        const status =
            String(
                statusData?.status
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            status === "failed"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        statusData?.error
                            ?.message
                        || "OCR job failed."
                },
                409
            );
        }

        if (
            status !== "completed"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job is not completed yet."
                },
                409
            );
        }


        // ====================================================
        // MATCH ID
        // ====================================================

        const matchId =
            sanitizeMatchId(
                statusData?.matchId
            );

        if (
            !matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Completed OCR job does not contain a valid matchId."
                },
                409
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

                    message:
                        "Completed match report was not found."
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
            storedMatchId
            !== matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report does not match this OCR job."
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

                    message:
                        "You are not authorized to access this OCR result."
                },
                403
            );
        }


        // ====================================================
        // SANITIZE SCOREBOARD
        // ====================================================

        const result =
            sanitizePublicScoreboard(
                matchReport
            );

        if (
            result.teams.length === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

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

                matchId,

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
    matchReport
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

            for (
                const field
                of ALLOWED_SCOREBOARD_FIELDS
            ) {
                let value =
                    player?.[
                        field
                    ];

                if (
                    (
                        value === null
                        || typeof value
                            === "undefined"
                    )
                    && player?.reviewFields?.[
                        field
                    ]
                ) {
                    value =
                        player
                            .reviewFields[
                                field
                            ]
                            ?.value;
                }

                if (
                    value === null
                    || typeof value
                        === "undefined"
                    || String(
                        value
                    ).trim() === ""
                ) {
                    continue;
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
                    continue;
                }

                publicPlayer[
                    field
                ] =
                    numeric;
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
        teams:
            publicTeams
    };
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
        firstBytes.length
        !== secondBytes.length
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

    return difference === 0;
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