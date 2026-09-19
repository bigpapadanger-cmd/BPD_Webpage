"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT LAST LOGIN SERVICE

File:
    functions/services/auth/account/last_login.js

Purpose:
    Handles authenticated account activity on page load.

    - Updates identity.accounts.last_seen_at.
    - Triggers the Rocket League stats refresh service.
    - Keeps account identity server-controlled.

Important:
    - Server-side only.
    - Browser never supplies accountId.
    - Uses SUPABASE_AUTH.
    - RPC is exposed through the api schema.
    - Stats refresh throttling remains centralized in
      services/rl/stats/refresh.js.
========================================================= */

import {
    refreshStatsWithGate
} from "../../rl/stats/refresh_with_gate.js";

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
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
TOUCH ACCOUNT LAST SEEN
========================================================= */

export async function touchAccountLastSeen(
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
            "rpc/touch_account_last_seen",
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
                            normalizedAccountId
                    })
            }
        );

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        console.error(
            "LAST LOGIN SERVICE: RPC failed.",
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
                "Account activity RPC failed."
            );

        error.code =
            "LAST_LOGIN_RPC_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (
        !responseText
    ) {
        return null;
    }

    try {
        return JSON.parse(
            responseText
        );
    }
    catch {
        return responseText;
    }
}

/* =========================================================
HANDLE ACCOUNT LOGIN ACTIVITY

Called after the server has already authenticated the
browser session and obtained identity.accounts.id.

Stats refresh failures do not cause the login/activity
request itself to fail.
========================================================= */

export async function handleAccountLastLogin(
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

    const lastSeenAt =
        await touchAccountLastSeen(
            env,
            normalizedAccountId
        );

    let statsRefresh =
        null;

    try {
        statsRefresh =
            await refreshStatsWithGate(
                env,
                normalizedAccountId
            );

        console.info(
            "LAST LOGIN SERVICE: Background refresh completed.",
            {
                accountId:
                    normalizedAccountId,

                result:
                    statsRefresh
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "LAST LOGIN SERVICE: Background refresh failed.",
            {
                accountId:
                    normalizedAccountId,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                upstreamCode:
                    error?.upstreamCode
                    || null,

                upstreamStatus:
                    error?.upstreamStatus
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        statsRefresh = {
            success:
                false,

            code:
                error?.code
                || "STATS_REFRESH_FAILED"
        };
    }

    return {
        lastSeenAt,
        statsRefresh
    };
}