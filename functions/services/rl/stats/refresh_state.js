"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE STATS REFRESH STATE SERVICE

File:
    functions/services/rl/stats/refresh_state.js

Purpose:
    Loads the server-side state required to determine whether
    Rocket League stats/MMR should be refreshed.

Returns:
    - canonical BPD account ID
    - Rocket League player UUID
    - account/Rocket League active state
    - account last seen timestamp
    - latest stored stats/MMR refresh timestamp
    - linked Rocket League Epic account ID

Important:
    - Server-side only.
    - Read-only.
    - Browser never supplies or receives provider secrets.
    - Uses the exposed api schema.
    - The underlying RPC only returns completed Rocket League
      profiles eligible for MMR refresh consideration.
========================================================= */

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const url =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !url
        || !apiKey
    ) {
        return null;
    }

    return {
        url:
            url.endsWith("/")
                ? url
                : `${url}/`,

        apiKey
    };
}

/* =========================================================
GET REFRESH STATE
========================================================= */

export async function getStatsRefreshState(
    env,
    accountId
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        const error =
            new Error(
                "Account ID is required."
            );

        error.code =
            "ACCOUNT_ID_REQUIRED";

        error.status =
            400;

        throw error;
    }

    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        const error =
            new Error(
                "Supabase configuration is unavailable."
            );

        error.code =
            "SUPABASE_CONFIGURATION_MISSING";

        error.status =
            500;

        throw error;
    }

    const url =
        new URL(
            "rpc/get_stats_refresh_state",
            configuration.url
        );

    console.info(
        "STATS REFRESH STATE: RPC starting.",
        {
            accountId:
                normalizedAccountId
        }
    );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept-Profile":
                        "api"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            normalizedAccountId
                    })
            }
        );

    const responseText =
        await response.text();

    console.info(
        "STATS REFRESH STATE: RPC response received.",
        {
            accountId:
                normalizedAccountId,

            status:
                response.status,

            ok:
                response.ok
        }
    );

    if (
        !response.ok
    ) {
        console.error(
            "STATS REFRESH STATE: RPC failed.",
            {
                accountId:
                    normalizedAccountId,

                status:
                    response.status,

                response:
                    responseText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .slice(
                            0,
                            300
                        )
            }
        );

        const error =
            new Error(
                "Stats refresh state lookup failed."
            );

        error.code =
            "STATS_REFRESH_STATE_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (
        !responseText
    ) {
        console.info(
            "STATS REFRESH STATE: No eligible state returned.",
            {
                accountId:
                    normalizedAccountId
            }
        );

        return null;
    }

    let rows;

    try {
        rows =
            JSON.parse(
                responseText
            );
    }
    catch {
        console.error(
            "STATS REFRESH STATE: Invalid JSON returned.",
            {
                accountId:
                    normalizedAccountId,

                response:
                    responseText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .slice(
                            0,
                            300
                        )
            }
        );

        const error =
            new Error(
                "Stats refresh state returned invalid JSON."
            );

        error.code =
            "STATS_REFRESH_STATE_INVALID";

        error.status =
            502;

        throw error;
    }

    const row =
        Array.isArray(
            rows
        )
            ? rows[0]
                || null
            : rows;

    if (
        !row
    ) {
        console.info(
            "STATS REFRESH STATE: No eligible row returned.",
            {
                accountId:
                    normalizedAccountId
            }
        );

        return null;
    }

    const returnedAccountId =
        normalizeNullableString(
            row.account_id
        );

    if (
        returnedAccountId
        && returnedAccountId !==
            normalizedAccountId
    ) {
        console.error(
            "STATS REFRESH STATE: Account mismatch.",
            {
                requestedAccountId:
                    normalizedAccountId,

                returnedAccountId
            }
        );

        const error =
            new Error(
                "Stats refresh state returned an unexpected account."
            );

        error.code =
            "STATS_REFRESH_STATE_ACCOUNT_MISMATCH";

        error.status =
            502;

        throw error;
    }

    const result = {
        accountId:
            returnedAccountId,

        rlPlayerId:
            normalizeNullableString(
                row.rl_player_id
            ),

        active:
            row.active ===
            true,

        lastSeenAt:
            normalizeNullableString(
                row.last_seen_at
            ),

        lastRefreshAt:
            normalizeNullableString(
                row.last_refresh_at
            ),

        epicAccountId:
            normalizeNullableString(
                row.epic_account_id
            )
    };

    console.info(
        "STATS REFRESH STATE: State resolved.",
        {
            accountId:
                result.accountId
                || normalizedAccountId,

            rlPlayerId:
                result.rlPlayerId,

            active:
                result.active,

            lastSeenAt:
                result.lastSeenAt,

            lastRefreshAt:
                result.lastRefreshAt,

            hasEpicAccountId:
                Boolean(
                    result.epicAccountId
                )
        }
    );

    return result;
}