"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PRESENCE MONITOR ACTIVATION SERVICE

File:
    functions/services/rl/presence/wake_monitor.js

Purpose:
    Activates scheduled monitoring after an eligible account
    explicitly enables presence sharing.

Flow:
    1. Ask Supabase to activate the presence monitor for the
       authenticated BPD account.
    2. The existing 15-minute Worker schedule performs the
       next provider check; this request never calls a Worker.

Important:
    - Server-side only.
    - Account ID comes from the authenticated BPD session.
    - The service calls Supabase only; it never calls the provider Worker.
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

async function wakeSupabaseMonitor(
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
            "rpc/wake_rl_presence_monitor",
            configuration.url
        );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "POST",

                headers: {
                    apikey:
                        configuration.apiKey,

                    Authorization:
                        `Bearer ${configuration.apiKey}`,

                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept-Profile":
                        "api"
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
        console.error(
            "RL PRESENCE WAKE: Supabase wake RPC failed.",
            {
                status:
                    response.status
            }
        );

        const error =
            new Error(
                "Rocket League presence monitor wake failed."
            );

        error.code =
            "RL_PRESENCE_WAKE_RPC_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (response.status === 204) {
        return false;
    }

    let payload;

    try {
        payload = await response.json();
    }
    catch {
        return false;
    }

    if (
        payload === true
    ) {
        return true;
    }

    if (
        Array.isArray(
            payload
        )
    ) {
        return payload[0] ===
            true;
    }

    return false;
}

export async function activateRocketLeaguePresenceMonitor(
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

    const activated =
        await wakeSupabaseMonitor(
            env,
            normalizedAccountId
        );

    /*
     * Supabase rejected the account as ineligible.
     *
     * Do not wake the Worker.
     */
    if (
        activated !==
        true
    ) {
        return {
            success:
                true,

            activated:
                false,

            reason:
                "PRESENCE_MONITOR_NOT_ELIGIBLE"
        };
    }

    return {
        success:
            true,

        activated:
            true
    };
}
