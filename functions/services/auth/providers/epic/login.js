"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH LOGIN SERVICE

File:
    functions/services/auth/providers/epic/login.js

Public Route:
    GET /api/auth/epic/login

API Route:
    functions/api/auth/epic/login.js

Callback:
    GET /api/auth/epic/callback

Callback Service:
    functions/services/auth/providers/epic/callback.js

Purpose:
    Starts direct Epic Games OAuth authentication.

Flow:
    Browser
        ↓
    Generate OAuth state
        ↓
    Store state in short-lived HttpOnly cookie
        ↓
    Redirect to Epic Games
        ↓
    Epic authenticates user
        ↓
    Epic redirects to /api/auth/epic/callback

Important:
    - This service does NOT create the BPD session.
    - This service does NOT write identity.accounts.
    - This service does NOT write Rocket League data.
    - OAuth state values and credentials must never be logged.
========================================================= */

import {
    json,
    redirect,
    createRandomState
} from "../../../common_helpers/responses.js";

import {
    createCookie
} from "../../sessions/session.js";

import {
    EPIC_AUTHORIZE_URL,
    AUTH_STATE_COOKIE,
    AUTH_STATE_MAX_AGE_SECONDS
} from "../../../config/api_vars.js";


/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value.trim();
}

/* =========================================================
MAIN
========================================================= */

export async function handleEpicLogin(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        const clientId =
            normalizeString(
                env.EPIC_CLIENT_ID
            );

        const redirectUri =
            normalizeString(
                env.EPIC_REDIRECT_URI
            );

        if (
            !clientId
            || !redirectUri
        ) {
            console.error(
                "EPIC LOGIN: OAuth configuration missing.",
                {
                    debugId,

                    hasClientId:
                        Boolean(
                            clientId
                        ),

                    hasRedirectUri:
                        Boolean(
                            redirectUri
                        )
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Epic OAuth configuration is incomplete.",

                    debugId
                },
                503
            );
        }

        try {
            new URL(
                redirectUri
            );
        }
        catch {
            console.error(
                "EPIC LOGIN: Redirect URI invalid.",
                {
                    debugId
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Epic OAuth redirect URI is invalid.",

                    debugId
                },
                500
            );
        }

        const state =
            createRandomState();

        if (
            !state
        ) {
            throw new Error(
                "OAuth state generation failed."
            );
        }

        const authorizeUrl =
            new URL(
                EPIC_AUTHORIZE_URL
            );

        authorizeUrl.searchParams.set(
            "client_id",
            clientId
        );

        authorizeUrl.searchParams.set(
            "response_type",
            "code"
        );

        authorizeUrl.searchParams.set(
            "redirect_uri",
            redirectUri
        );

        authorizeUrl.searchParams.set(
            "scope",
            "basic_profile presence"
        );

        authorizeUrl.searchParams.set(
            "state",
            state
        );

        const stateCookie =
            createCookie(
                request,
                AUTH_STATE_COOKIE,
                state,
                AUTH_STATE_MAX_AGE_SECONDS
            );

        if (
            !stateCookie
        ) {
            throw new Error(
                "OAuth state cookie creation failed."
            );
        }

        console.info(
            "EPIC LOGIN: Authorization started.",
            {
                debugId
            }
        );

        return redirect(
            authorizeUrl.toString(),
            [
                stateCookie
            ]
        );
    }
    catch (
        error
    ) {
        console.error(
            "EPIC LOGIN: Unexpected failure.",
            {
                debugId,

                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error",

                stack:
                    error?.stack
                    || null
            }
        );

        return json(
            {
                success:
                    false,

                message:
                    "Epic login initialization failed.",

                debugId
            },
            500
        );
    }
}