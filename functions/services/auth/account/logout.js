"use strict";

/* =========================================================
BPD GAMING NETWORK
GLOBAL LOGOUT SERVICE

File:
    functions/services/auth/account/logout.js

Purpose:
    Ends the complete BPD Gaming Network browser session.

Description:
    - Deletes the centralized BPD session from Cloudflare KV.
    - Clears the BPD browser session cookie.
    - Clears outstanding Epic OAuth state.
    - Clears outstanding Google/Supabase OAuth context.
    - Redirects the user back to the site root.

Important:
    - This signs the user out of the BPD session regardless
      of which provider authenticated it.
    - Provider identities remain linked in identity schema.
    - Provider unlinking is a separate operation.
    - Logging out does NOT delete identity.accounts.
    - Logging out does NOT delete provider identities.
========================================================= */

import {
    json,
    redirect
} from "../../common_helpers/responses.js";

import {
    clearCookie,
    destroyRequestSession
} from "../sessions/session.js";

import { OAUTH_MODE_COOKIE, OAUTH_PROVIDER_COOKIE, OAUTH_ACCOUNT_COOKIE,
        OAUTH_PKCE_COOKIE, AUTH_STATE_COOKIE
} from "../../config/api_vars.js";




/* =========================================================
MAIN
========================================================= */

export async function handleLogout(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    console.info(
        "LOGOUT SERVICE: Started.",
        {
            debugId,

            method:
                request.method
        }
    );

    try {
        /* =================================================
        CENTRAL BPD SESSION

        Deletes the KV session and returns an expired
        bpd_session browser cookie.
        ================================================= */

        const sessionCookie =
            await destroyRequestSession(
                request,
                env
            );

        /* =================================================
        EPIC OAUTH STATE
        ================================================= */

        const stateCookie =
            clearCookie(
                request,
                AUTH_STATE_COOKIE
            );

        /* =================================================
        GOOGLE / SUPABASE OAUTH CONTEXT
        ================================================= */

        const pkceCookie =
            clearCookie(
                request,
                OAUTH_PKCE_COOKIE
            );

        const providerCookie =
            clearCookie(
                request,
                OAUTH_PROVIDER_COOKIE
            );

        const modeCookie =
            clearCookie(
                request,
                OAUTH_MODE_COOKIE
            );

        const accountCookie =
            clearCookie(
                request,
                OAUTH_ACCOUNT_COOKIE
            );

        /* =================================================
        COMPLETE
        ================================================= */

        console.info(
            "LOGOUT SERVICE: Completed.",
            {
                debugId
            }
        );

        return redirect(
            "/",
            [
                sessionCookie,
                stateCookie,
                pkceCookie,
                providerCookie,
                modeCookie,
                accountCookie
            ]
                .filter(
                    Boolean
                )
        );
    }
    catch (
        error
    ) {
        console.error(
            "LOGOUT SERVICE: Failed.",
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

                code:
                    "LOGOUT_FAILED",

                message:
                    "Logout failed.",

                debugId
            },
            500
        );
    }
}