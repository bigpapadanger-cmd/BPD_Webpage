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
    - Supports login, link, and reauthorize modes.
    - Reads PKCE verification data.
    - Reads explicit account targets for link/reauthorize.
    - Reads and validates local return destinations.
    - Clears temporary OAuth cookies after completion.

OAuth Modes:
    login
        Provider authentication establishes or refreshes the
        user's BPD browser login.

    link
        Provider authentication proves ownership of a provider
        that is not yet linked to the current BPD account.

    reauthorize
        Provider authentication proves ownership again for a
        provider already linked to the current BPD account.

Important:
    - Temporary OAuth cookies are HttpOnly.
    - Return destinations must remain local.
    - Missing mode defaults to login for compatibility.
    - Link and reauthorize targets must come from trusted
      server-created OAuth context.
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

export const OAUTH_MODE_REAUTHORIZE =
    "reauthorize";

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

    /*
     * Compatibility behavior:
     *
     * Older login flows may not have written an explicit
     * mode cookie.
     */
    if (
        !mode
    ) {
        return OAUTH_MODE_LOGIN;
    }

    if (
        mode === OAUTH_MODE_LOGIN
        || mode === OAUTH_MODE_LINK
        || mode === OAUTH_MODE_REAUTHORIZE
    ) {
        return mode;
    }

    return null;
}

/* =========================================================
MODE HELPERS
========================================================= */

export function isOAuthLoginMode(
    mode
) {
    return normalizeString(
        mode
    )
        .toLowerCase() ===
        OAUTH_MODE_LOGIN;
}

export function isOAuthLinkMode(
    mode
) {
    return normalizeString(
        mode
    )
        .toLowerCase() ===
        OAUTH_MODE_LINK;
}

export function isOAuthReauthorizeMode(
    mode
) {
    return normalizeString(
        mode
    )
        .toLowerCase() ===
        OAUTH_MODE_REAUTHORIZE;
}

export function isOAuthExistingAccountMode(
    mode
) {
    const normalizedMode =
        normalizeString(
            mode
        )
            .toLowerCase();

    return (
        normalizedMode ===
            OAUTH_MODE_LINK
        || normalizedMode ===
            OAUTH_MODE_REAUTHORIZE
    );
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
ACCOUNT TARGET

Used by explicit provider link and reauthorization flows.

The value originates from trusted server-created OAuth
context and must never be accepted directly from arbitrary
browser input as account ownership.
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