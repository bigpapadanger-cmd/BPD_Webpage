"use strict";

/* =========================================================
BPD GAMING NETWORK
GOOGLE OAUTH LOGIN SERVICE

File:
    functions/services/auth/providers/google/login.js

Public Route:
    GET /api/auth/google/login

API Route:
    functions/api/auth/google/login.js

Callback:
    GET /api/auth/_oauth/callback

Callback Service:
    functions/services/auth/oauth/callback.js

Purpose:
    Starts a NORMAL Google authentication flow through
    Supabase Auth using PKCE.

Flow:
    Browser
        ↓
    Generate PKCE verifier + challenge
        ↓
    Mark OAuth operation as "login"
        ↓
    Clear any stale account-link target
        ↓
    Store temporary OAuth context in HttpOnly cookies
        ↓
    Redirect to Supabase Auth
        ↓
    Supabase redirects to Google
        ↓
    Google returns to Supabase
        ↓
    Supabase redirects to /api/auth/_oauth/callback
        ↓
    Callback calls api.resolve_google_identity

Important:
    - This is a NORMAL LOGIN flow, not provider linking.
    - PKCE verifier is never exposed in the redirect URL.
    - PKCE verifier is stored only in an HttpOnly cookie.
    - This service does not create the BPD session.
    - This service does not write identity.accounts.
    - The centralized callback resolves the global account.
    - Stale link-flow account context is explicitly cleared.
========================================================= */

import {
    json,
    redirect
} from "../../../common_helpers/responses.js";

import {
    createCookie,
    clearCookie
} from "../../sessions/session.js";

import {
    SUPABASE_OAUTH_AUTHORIZE_URL,
    OAUTH_RETURN_URL
} from "../../../config/api_vars.js";

/* =========================================================
CONSTANTS
========================================================= */

const GOOGLE_PROVIDER =
    "google";

const OAUTH_MODE_LOGIN =
    "login";

const PKCE_COOKIE =
    "bpd_oauth_pkce";

const OAUTH_PROVIDER_COOKIE =
    "bpd_oauth_provider";

const OAUTH_MODE_COOKIE =
    "bpd_oauth_mode";

const OAUTH_ACCOUNT_COOKIE =
    "bpd_oauth_account";

const OAUTH_COOKIE_MAX_AGE_SECONDS =
    600;

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
BASE64 URL
========================================================= */

function toBase64Url(
    bytes
) {
    let binary =
        "";

    for (
        const byte
        of bytes
    ) {
        binary +=
            String.fromCharCode(
                byte
            );
    }

    return btoa(
        binary
    )
        .replaceAll(
            "+",
            "-"
        )
        .replaceAll(
            "/",
            "_"
        )
        .replace(
            /=+$/g,
            ""
        );
}

/* =========================================================
PKCE VERIFIER
========================================================= */

function createPkceVerifier() {
    const bytes =
        new Uint8Array(
            64
        );

    crypto.getRandomValues(
        bytes
    );

    return toBase64Url(
        bytes
    );
}

/* =========================================================
PKCE CHALLENGE
========================================================= */

async function createPkceChallenge(
    verifier
) {
    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder()
                .encode(
                    verifier
                )
        );

    return toBase64Url(
        new Uint8Array(
            digest
        )
    );
}

/* =========================================================
CONFIGURATION
========================================================= */

function getOAuthConfiguration() {
    const authorizeUrl =
        normalizeString(
            SUPABASE_OAUTH_AUTHORIZE_URL
        );

    const returnUrl =
        normalizeString(
            OAUTH_RETURN_URL
        );

    if (
        !authorizeUrl
        || !returnUrl
    ) {
        return null;
    }

    try {
        return {
            authorizeUrl:
                new URL(
                    authorizeUrl
                ),

            returnUrl:
                new URL(
                    returnUrl
                )
                    .toString()
        };
    }
    catch {
        return null;
    }
}

/* =========================================================
MAIN
========================================================= */

export async function handleGoogleLogin(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        const configuration =
            getOAuthConfiguration();

        if (
            !configuration
        ) {
            console.error(
                "GOOGLE LOGIN: OAuth configuration invalid.",
                {
                    debugId
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Google OAuth configuration is invalid.",

                    debugId
                },
                500
            );
        }

        const verifier =
            createPkceVerifier();

        const challenge =
            await createPkceChallenge(
                verifier
            );

        if (
            !verifier
            || !challenge
        ) {
            console.error(
                "GOOGLE LOGIN: PKCE generation failed.",
                {
                    debugId
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Unable to initialize Google login.",

                    debugId
                },
                500
            );
        }

        const authorizeUrl =
            new URL(
                configuration
                    .authorizeUrl
                    .toString()
            );

        authorizeUrl.searchParams.set(
            "provider",
            GOOGLE_PROVIDER
        );

        authorizeUrl.searchParams.set(
            "redirect_to",
            configuration.returnUrl
        );

        authorizeUrl.searchParams.set(
            "code_challenge",
            challenge
        );

        authorizeUrl.searchParams.set(
            "code_challenge_method",
            "s256"
        );

        /* =================================================
        TEMPORARY OAUTH CONTEXT
        ================================================= */

        const verifierCookie =
            createCookie(
                request,
                PKCE_COOKIE,
                verifier,
                OAUTH_COOKIE_MAX_AGE_SECONDS
            );

        const providerCookie =
            createCookie(
                request,
                OAUTH_PROVIDER_COOKIE,
                GOOGLE_PROVIDER,
                OAUTH_COOKIE_MAX_AGE_SECONDS
            );

        const modeCookie =
            createCookie(
                request,
                OAUTH_MODE_COOKIE,
                OAUTH_MODE_LOGIN,
                OAUTH_COOKIE_MAX_AGE_SECONDS
            );

        /*
         * A normal login must never inherit a previous link
         * flow's target identity.accounts ID.
         */
        const clearAccountCookie =
            clearCookie(
                request,
                OAUTH_ACCOUNT_COOKIE
            );

        if (
            !verifierCookie
            || !providerCookie
            || !modeCookie
            || !clearAccountCookie
        ) {
            console.error(
                "GOOGLE LOGIN: OAuth cookies could not be created.",
                {
                    debugId
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Unable to initialize Google login.",

                    debugId
                },
                500
            );
        }

        console.info(
            "GOOGLE LOGIN: Authorization started.",
            {
                debugId,

                provider:
                    GOOGLE_PROVIDER,

                mode:
                    OAUTH_MODE_LOGIN
            }
        );

        return redirect(
            authorizeUrl.toString(),
            [
                verifierCookie,
                providerCookie,
                modeCookie,
                clearAccountCookie
            ]
        );
    }
    catch (
        error
    ) {
        console.error(
            "GOOGLE LOGIN: Unexpected failure.",
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
                    "Google login initialization failed.",

                debugId
            },
            500
        );
    }
}