"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PRESENCE MONITOR WAKE SERVICE

File:
    functions/services/rl/presence/wake_monitor.js

Purpose:
    Wakes the Rocket League presence monitoring system when
    an eligible authenticated Rocket League user becomes
    active on the BPD website.

Flow:
    1. Ask Supabase to activate the presence monitor for the
       authenticated BPD account.
    2. If Supabase confirms the account is eligible, call the
       protected Cloudflare presence Worker /wake endpoint.
    3. The Worker immediately scans all eligible opted-in
       Rocket League players.
    4. The Worker continues every 15 minutes while at least
       one eligible player remains online.

Important:
    - Server-side only.
    - Account ID comes from the authenticated BPD session.
    - PRESENCE_TRIGGER_KEY is never exposed to the browser.
========================================================= */

const REQUEST_TIMEOUT_MS =
    15000;

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

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        console.error(
            "RL PRESENCE WAKE: Supabase wake RPC failed.",
            {
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
                "Rocket League presence monitor wake failed."
            );

        error.code =
            "RL_PRESENCE_WAKE_RPC_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (
        !responseText
    ) {
        return false;
    }

    let payload;

    try {
        payload =
            JSON.parse(
                responseText
            );
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

async function wakePresenceWorker(
    env
) {
    const workerUrl =
        normalizeString(
            env?.RL_PRESENCE_MONITOR_URL
        );

    const triggerKey =
        normalizeString(
            env?.PRESENCE_TRIGGER_KEY
        );

    if (
        !workerUrl
        || !triggerKey
    ) {
        const error =
            new Error(
                "Rocket League presence Worker configuration is unavailable."
            );

        error.code =
            "RL_PRESENCE_WORKER_CONFIGURATION_MISSING";

        error.status =
            500;

        throw error;
    }

    const url =
        new URL(
            "/wake",
            workerUrl
        );

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            REQUEST_TIMEOUT_MS
        );

    try {
        const response =
            await fetch(
                url.href,
                {
                    method:
                        "POST",

                    headers: {
                        Authorization:
                            `Bearer ${triggerKey}`,

                        Accept:
                            "application/json"
                    },

                    signal:
                        controller.signal
                }
            );

        const responseText =
            await response.text();

        if (
            !response.ok
        ) {
            console.error(
                "RL PRESENCE WAKE: Worker wake failed.",
                {
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
                    "Rocket League presence Worker wake failed."
                );

            error.code =
                "RL_PRESENCE_WORKER_WAKE_FAILED";

            error.status =
                response.status;

            throw error;
        }

        return true;
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

export async function wakeRocketLeaguePresenceMonitor(
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

            workerWoken:
                false,

            reason:
                "PRESENCE_MONITOR_NOT_ELIGIBLE"
        };
    }

    await wakePresenceWorker(
        env
    );

    return {
        success:
            true,

        activated:
            true,

        workerWoken:
            true
    };
}