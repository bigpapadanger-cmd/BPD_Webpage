"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE ACCOUNT LINK SERVICE

File:
    functions/services/rl/link_account.js

Purpose:
    Links an existing Rocket League player record to the
    canonical BPD identity account by matching Epic account ID.

Important:
    - Server-side only.
    - Uses immutable Epic account ID.
    - Never trusts a browser-supplied account ID.
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

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

export async function linkRocketLeagueAccount(
    env,
    {
        accountId,
        epicAccountId
    }
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    const normalizedEpicAccountId =
        normalizeString(
            epicAccountId
        );

    if (
        !normalizedAccountId
        || !normalizedEpicAccountId
    ) {
        return {
            success:
                false,

            linked:
                false,

            reason:
                "LINK_DATA_MISSING"
        };
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
            "rpc/link_rl_player_account",
            configuration.url
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
                            normalizedAccountId,

                        p_epic_account_id:
                            normalizedEpicAccountId
                    })
            }
        );

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        const error =
            new Error(
                "Rocket League account linking failed."
            );

        error.code =
            "RL_ACCOUNT_LINK_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (
        !responseText
    ) {
        return {
            success:
                true,

            linked:
                false
        };
    }

    try {
        return JSON.parse(
            responseText
        );
    }
    catch {
        return {
            success:
                true,

            linked:
                true
        };
    }
}