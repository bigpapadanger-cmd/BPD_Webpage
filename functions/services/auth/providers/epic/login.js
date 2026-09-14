"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH LOGIN / AUTHORIZATION START SERVICE

File:
    functions/services/auth/providers/epic/login.js

Public Route:
    POST /api/auth/epic/login

API Route:
    functions/api/auth/epic/login.js

Callback:
    GET /api/auth/epic/callback

Callback Service:
    functions/services/auth/providers/epic/callback.js

Purpose:
    Starts direct Epic Games OAuth authentication for both
    global login and authenticated provider linking.

Description:
    - Starts direct Epic Games OAuth.
    - Supports normal login mode.
    - Supports authenticated account-link mode.
    - Generates secure OAuth state.
    - Stores OAuth context in short-lived HttpOnly cookies.
    - Stores the target BPD account ID only for link mode.
    - Returns the Epic authorization URL.
    - Normal login requests remain Turnstile protected.

Modes:
    login
        User is signing into BPD with Epic.

    link
        Existing authenticated BPD account is linking Epic.

Security:
    - Link mode accountId must come from trusted server-side
      session authorization.
    - Browser input must never determine the accountId used
      for link mode.
    - OAuth state must be verified by the callback.
    - Link mode must later verify that the current BPD
      session account matches the stored target account.
    - Epic access tokens are never stored here.

Important:
    - This service does NOT create identity.accounts.
    - This service does NOT link identity.account_identities.
    - Final identity handling occurs in the Epic callback.
========================================================= */

import {
    createRandomState
} from "../../../common_helpers/responses.js";

import {
    createCookie
} from "../../sessions/session.js";

import {
    verifyTurnstile
} from "../../../security/turnstile.js";

import {
    EPIC_AUTHORIZE_URL,
    AUTH_STATE_COOKIE,
    AUTH_STATE_MAX_AGE_SECONDS,
    OAUTH_RETURN_COOKIE,
    OAUTH_MODE_COOKIE,
    OAUTH_ACCOUNT_COOKIE
} from "../../../config/api_vars.js";

/* =========================================================
CONSTANTS
========================================================= */

const DEFAULT_RETURN_TO =
    "/Account";

const OAUTH_MODE_LOGIN =
    "login";

const OAUTH_MODE_LINK =
    "link";

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

function normalizeMode(
    value
) {
    const mode =
        normalizeString(
            value
        )
            .toLowerCase();

    return (
        mode === OAUTH_MODE_LINK
        ? OAUTH_MODE_LINK
        : OAUTH_MODE_LOGIN
    );
}

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200,
    cookies = []
) {
    const headers =
        new Headers();

    headers.set(
        "Content-Type",
        "application/json; charset=utf-8"
    );

    headers.set(
        "Cache-Control",
        "no-store"
    );

    for (
        const cookie
        of cookies
    ) {
        if (
            cookie
        ) {
            headers.append(
                "Set-Cookie",
                cookie
            );
        }
    }

    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,
            headers
        }
    );
}

/* =========================================================
RETURN DESTINATION
========================================================= */

function normalizeReturnTo(
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

/* =========================================================
REQUEST BODY
========================================================= */

async function readRequestBody(
    request
) {
    const contentType =
        normalizeString(
            request.headers.get(
                "content-type"
            )
        )
            .toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        throw new Error(
            "INVALID_CONTENT_TYPE"
        );
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        throw new Error(
            "INVALID_JSON"
        );
    }

    if (
        !body
        || typeof body !==
            "object"
        || Array.isArray(
            body
        )
    ) {
        throw new Error(
            "INVALID_BODY"
        );
    }

    return body;
}

/* =========================================================
EPIC CONFIGURATION
========================================================= */

function getEpicConfiguration(
    env
) {
    const clientId =
        normalizeString(
            env?.EPIC_CLIENT_ID
        );

    const redirectUri =
        normalizeString(
            env?.EPIC_REDIRECT_URI
        );

    if (
        !clientId
        || !redirectUri
    ) {
        return {
            valid:
                false,

            clientId,
            redirectUri
        };
    }

    try {
        new URL(
            redirectUri
        );
    }
    catch {
        return {
            valid:
                false,

            clientId,
            redirectUri
        };
    }

    return {
        valid:
            true,

        clientId,
        redirectUri
    };
}

/* =========================================================
AUTHORIZATION URL
========================================================= */

function buildEpicAuthorizeUrl(
    clientId,
    redirectUri,
    state
) {
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

    return authorizeUrl.toString();
}

/* =========================================================
START EPIC AUTHORIZATION

This function is reusable by:
    - normal Epic login
    - authenticated Epic linking

For link mode:
    accountId MUST already have been derived from the
    authenticated server-side BPD session.
========================================================= */

export function startEpicAuthorization(
    request,
    env,
    {
        mode = OAUTH_MODE_LOGIN,
        accountId = null,
        returnTo = DEFAULT_RETURN_TO
    } = {}
) {
    const normalizedMode =
        normalizeMode(
            mode
        );

    const normalizedAccountId =
        normalizeString(
            accountId
        );

    const normalizedReturnTo =
        normalizeReturnTo(
            returnTo
        );

    if (
        normalizedMode ===
            OAUTH_MODE_LINK
        && !normalizedAccountId
    ) {
        throw new Error(
            "EPIC_LINK_ACCOUNT_REQUIRED"
        );
    }

    const configuration =
        getEpicConfiguration(
            env
        );

    if (
        configuration.valid !==
        true
    ) {
        const error =
            new Error(
                "EPIC_OAUTH_NOT_CONFIGURED"
            );

        error.configuration = {
            hasClientId:
                Boolean(
                    configuration.clientId
                ),

            hasRedirectUri:
                Boolean(
                    configuration.redirectUri
                )
        };

        throw error;
    }

    const state =
        createRandomState();

    if (
        !state
    ) {
        throw new Error(
            "OAUTH_STATE_GENERATION_FAILED"
        );
    }

    const stateCookie =
        createCookie(
            request,
            AUTH_STATE_COOKIE,
            state,
            AUTH_STATE_MAX_AGE_SECONDS
        );

    const returnCookie =
        createCookie(
            request,
            OAUTH_RETURN_COOKIE,
            normalizedReturnTo,
            AUTH_STATE_MAX_AGE_SECONDS
        );

    const modeCookie =
        createCookie(
            request,
            OAUTH_MODE_COOKIE,
            normalizedMode,
            AUTH_STATE_MAX_AGE_SECONDS
        );

    if (
        !stateCookie
        || !returnCookie
        || !modeCookie
    ) {
        throw new Error(
            "OAUTH_COOKIE_CREATION_FAILED"
        );
    }

    const cookies = [
        stateCookie,
        returnCookie,
        modeCookie
    ];

    if (
        normalizedMode ===
        OAUTH_MODE_LINK
    ) {
        const accountCookie =
            createCookie(
                request,
                OAUTH_ACCOUNT_COOKIE,
                normalizedAccountId,
                AUTH_STATE_MAX_AGE_SECONDS
            );

        if (
            !accountCookie
        ) {
            throw new Error(
                "OAUTH_ACCOUNT_COOKIE_CREATION_FAILED"
            );
        }

        cookies.push(
            accountCookie
        );
    }

    const redirectUrl =
        buildEpicAuthorizeUrl(
            configuration.clientId,
            configuration.redirectUri,
            state
        );

    return {
        provider:
            "epic",

        mode:
            normalizedMode,

        redirectUrl,

        cookies
    };
}

/* =========================================================
MAIN LOGIN
========================================================= */

export async function handleEpicLogin(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    if (
        request.method !==
        "POST"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    "METHOD_NOT_ALLOWED"
            },
            405
        );
    }

    let body;

    try {
        body =
            await readRequestBody(
                request
            );
    }
    catch (
        error
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    error?.message
                    || "INVALID_REQUEST"
            },
            400
        );
    }

    /* =====================================================
    TURNSTILE

    Public Epic login is CAPTCHA protected.

    Authenticated provider linking will call
    startEpicAuthorization() server-side instead.
    ===================================================== */

    const captchaToken =
        normalizeString(
            body.captchaToken
        );

    const verification =
        await verifyTurnstile(
            request,
            env,
            captchaToken
        );

    if (
        verification.configurationError ===
        true
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    verification.error,

                debugId
            },
            500
        );
    }

    if (
        verification.unavailable ===
        true
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    verification.error,

                debugId
            },
            503
        );
    }

    if (
        verification.success !==
        true
    ) {
        console.warn(
            "EPIC LOGIN: Turnstile verification rejected.",
            {
                debugId,

                errorCodes:
                    verification.errorCodes
            }
        );

        return jsonResponse(
            {
                success:
                    false,

                error:
                    verification.error,

                debugId
            },
            verification.error ===
                "CAPTCHA_REQUIRED"
                ? 400
                : 403
        );
    }

    const returnTo =
        normalizeReturnTo(
            body.returnTo
        );

    try {
        const authorization =
            startEpicAuthorization(
                request,
                env,
                {
                    mode:
                        OAUTH_MODE_LOGIN,

                    returnTo
                }
            );

        console.info(
            "EPIC LOGIN: Authorization initialized.",
            {
                debugId,

                mode:
                    OAUTH_MODE_LOGIN
            }
        );

        return jsonResponse(
            {
                success:
                    true,

                provider:
                    "epic",

                redirectUrl:
                    authorization
                        .redirectUrl
            },
            200,
            authorization.cookies
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
                    || "Unknown error"
            }
        );

        if (
            error?.message ===
            "EPIC_OAUTH_NOT_CONFIGURED"
        ) {
            console.error(
                "EPIC LOGIN: OAuth configuration missing or invalid.",
                {
                    debugId,

                    hasClientId:
                        error
                            ?.configuration
                            ?.hasClientId ===
                        true,

                    hasRedirectUri:
                        error
                            ?.configuration
                            ?.hasRedirectUri ===
                        true
                }
            );

            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "EPIC_OAUTH_NOT_CONFIGURED",

                    debugId
                },
                503
            );
        }

        return jsonResponse(
            {
                success:
                    false,

                error:
                    "EPIC_LOGIN_START_FAILED",

                debugId
            },
            500
        );
    }
}