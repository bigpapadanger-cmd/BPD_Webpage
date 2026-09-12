"use strict";

/* =========================================================
BPD GAMING NETWORK
OAUTH STATE HELPERS

File:
    functions/services/auth/oauth/state.js

Purpose:
    Centralizes temporary OAuth state and cookie handling for
    Supabase-backed authentication flows.

Description:
    - Reads OAuth provider context.
    - Reads OAuth operation mode.
    - Reads PKCE verification data.
    - Reads explicit account-link targets.
    - Reads and validates local return destinations.
    - Clears temporary OAuth cookies after completion.

Important:
    - Temporary OAuth cookies are HttpOnly.
    - Return destinations must remain local.
    - Missing mode defaults to login for compatibility.
========================================================= */

import {
    OAUTH_MODE_COOKIE,
    OAUTH_PROVIDER_COOKIE,
    OAUTH_PKCE_COOKIE,
    OAUTH_RETURN_COOKIE,
    OAUTH_ACCOUNT_COOKIE
} from "../../config/api_vars.js";

import {
    getCookie,
    clearCookie
} from "../sessions/session.js";

/* =========================================================
CONSTANTS
========================================================= */

export const OAUTH_MODE_LOGIN =
    "login";

export const OAUTH_MODE_LINK =
    "link";

const DEFAULT_RETURN_TO =
    "/Account";

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
OAUTH MODE
========================================================= */

export function getOAuthMode(
    request
) {
    const mode =
        normalizeString(
            getCookie(
                request,
                OAUTH_MODE_COOKIE
            )
        )
            .toLowerCase();

    if (
        !mode
    ) {
        return OAUTH_MODE_LOGIN;
    }

    if (
        mode === OAUTH_MODE_LOGIN
        || mode === OAUTH_MODE_LINK
    ) {
        return mode;
    }

    return null;
}

/* =========================================================
PROVIDER
========================================================= */

export function getOAuthProvider(
    request
) {
    return normalizeString(
        getCookie(
            request,
            OAUTH_PROVIDER_COOKIE
        )
    )
        .toLowerCase();
}

/* =========================================================
PKCE VERIFIER
========================================================= */

export function getOAuthPkceVerifier(
    request
) {
    return normalizeString(
        getCookie(
            request,
            OAUTH_PKCE_COOKIE
        )
    );
}

/* =========================================================
ACCOUNT LINK TARGET
========================================================= */

export function getOAuthAccountId(
    request
) {
    return normalizeString(
        getCookie(
            request,
            OAUTH_ACCOUNT_COOKIE
        )
    );
}

/* =========================================================
RETURN DESTINATION
========================================================= */

export function normalizeReturnTo(
    value
) {
    const returnTo =
        normalizeString(
            value
        );

    if (
        !returnTo
        || !returnTo.startsWith(
            "/"
        )
        || returnTo.startsWith(
            "//"
        )
    ) {
        return DEFAULT_RETURN_TO;
    }

    return returnTo;
}

export function getOAuthReturnTo(
    request
) {
    return normalizeReturnTo(
        getCookie(
            request,
            OAUTH_RETURN_COOKIE
        )
    );
}

/* =========================================================
CLEAR OAUTH COOKIES
========================================================= */

export function getOAuthClearCookies(
    request
) {
    return [
        clearCookie(
            request,
            OAUTH_PKCE_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_PROVIDER_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_MODE_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_ACCOUNT_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_RETURN_COOKIE
        )
    ]
        .filter(
            Boolean
        );
}