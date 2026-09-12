"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PLAYER INITIALIZER

File:
    functions/services/supabase/rocketleague/ensure_player.js

Purpose:
    Ensures that an authenticated BPD account has a
    corresponding Rocket League player row.

Description:
    - Uses identity.accounts.id as the canonical ownership key.
    - Calls api.ensure_rocketleague_player.
    - Lets Supabase resolve the linked Epic identity.
    - Never trusts a browser-supplied Epic account ID.
    - Returns the authoritative Rocket League player state.
    - Does not determine authentication itself.

Database RPC:
    api.ensure_rocketleague_player

Identity:
    accountId
        = identity.accounts.id

Important:
    - accountId must come from the authenticated BPD session.
    - Epic identity resolution happens inside Supabase.
    - Browser-submitted Epic IDs must never be used.
========================================================= */

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
            url.endsWith(
                "/"
            )
                ? url
                : `${url}/`,

        apiKey
    };
}

/* =========================================================
RPC ERROR
========================================================= */

async function createRpcError(
    response,
    fallbackMessage
) {
    let data =
        null;

    try {
        data =
            await response.json();
    }
    catch {
        // Ignore malformed upstream response.
    }

    const message =
        normalizeString(
            data?.message
        )
        || normalizeString(
            data?.error
        )
        || fallbackMessage;

    const error =
        new Error(
            message
        );

    error.upstreamStatus =
        response.status;

    error.upstreamCode =
        normalizeNullableString(
            data?.code
        );

    return error;
}

/* =========================================================
CALL ENSURE PLAYER RPC
========================================================= */

async function callEnsureRocketLeaguePlayer(
    env,
    accountId
) {
    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        throw new Error(
            "Supabase configuration is unavailable."
        );
    }

    const response =
        await fetch(
            `${configuration.url}rpc/ensure_rocketleague_player`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Content-Profile":
                        "api",

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            accountId
                    })
            }
        );

    if (
        !response.ok
    ) {
        throw await createRpcError(
            response,
            "Rocket League player initialization failed."
        );
    }

    let result;

    try {
        result =
            await response.json();
    }
    catch {
        throw new Error(
            "Rocket League player initialization returned an invalid response."
        );
    }

    if (
        !result
        || typeof result !==
            "object"
        || Array.isArray(
            result
        )
    ) {
        throw new Error(
            "Rocket League player initialization returned no result."
        );
    }

    return result;
}

/* =========================================================
NORMALIZE RESULT
========================================================= */

function normalizeEnsureResult(
    result,
    accountId
) {
    const returnedAccountId =
        normalizeString(
            result.account_id
            ?? result.user_id
        );

    if (
        !returnedAccountId
        || returnedAccountId !==
            accountId
    ) {
        throw new Error(
            "Rocket League player initialization returned an unexpected account."
        );
    }

    const rlPlayerId =
        normalizeString(
            result.rl_player_id
        );

    if (
        !rlPlayerId
    ) {
        throw new Error(
            "Rocket League player initialization returned no player ID."
        );
    }

    return {
        accountId:
            returnedAccountId,

        rlPlayerId,

        epicAccountId:
            normalizeNullableString(
                result.epic_account_id
            ),

        epicDisplayName:
            normalizeNullableString(
                result.epic_display_name
            ),

        role:
            normalizeString(
                result.role
            )
            || "user",

        active:
            result.active ===
            true,

        registrationStatus:
            normalizeString(
                result.registration_status
            )
            || "incomplete",

        profileComplete:
            result.profile_complete ===
            true,

        rocketLeagueAccess:
            result.rocket_league_access ===
            true,

        createdPlayer:
            result.created_player ===
            true,

        adoptedPlayer:
            result.adopted_player ===
            true
    };
}

/* =========================================================
MAIN
========================================================= */

export async function ensureRocketLeaguePlayer(
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
        throw new Error(
            "Rocket League player initialization requires an account ID."
        );
    }

    let result;

    try {
        result =
            await callEnsureRocketLeaguePlayer(
                env,
                normalizedAccountId
            );
    }
    catch (
        error
    ) {
        if (
            error?.message ===
            "EPIC_IDENTITY_NOT_LINKED"
        ) {
            error.code =
                "EPIC_ACCOUNT_REQUIRED";
        }

        throw error;
    }

    return normalizeEnsureResult(
        result,
        normalizedAccountId
    );
}