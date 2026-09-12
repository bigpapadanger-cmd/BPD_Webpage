"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH LOGIN SERVICE

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
    Starts direct Epic Games OAuth authentication.

Description:
    - Accepts a Turnstile-protected login request.
    - Verifies CAPTCHA through the shared Turnstile service.
    - Validates the requested local return destination.
    - Generates and stores OAuth state.
    - Builds the Epic Games authorization URL.
    - Returns the authorization URL to the browser as JSON.

Flow:
    Browser
    ↓
    Turnstile verification
    ↓
    Generate OAuth state
    ↓
    Store state in short-lived HttpOnly cookie
    ↓
    Return Epic authorization URL
    ↓
    Browser redirects to Epic Games
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
    AUTH_STATE_MAX_AGE_SECONDS
} from "../../../config/api_vars.js";

import { OAUTH_RETURN_COOKIE } from "../../../config/api_vars.js";
/* =========================================================
CONSTANTS
========================================================= */

const DEFAULT_RETURN_TO =
    "/Account";


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
MAIN
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
        const configuration =
            getEpicConfiguration(
                env
            );

        if (
            configuration.valid !==
            true
        ) {
            console.error(
                "EPIC LOGIN: OAuth configuration missing or invalid.",
                {
                    debugId,

                    hasClientId:
                        Boolean(
                            configuration.clientId
                        ),

                    hasRedirectUri:
                        Boolean(
                            configuration.redirectUri
                        )
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
                returnTo,
                AUTH_STATE_MAX_AGE_SECONDS
            );

        if (
            !stateCookie
            || !returnCookie
        ) {
            throw new Error(
                "OAUTH_COOKIE_CREATION_FAILED"
            );
        }

        const redirectUrl =
            buildEpicAuthorizeUrl(
                configuration.clientId,
                configuration.redirectUri,
                state
            );

        console.info(
            "EPIC LOGIN: Authorization initialized.",
            {
                debugId
            }
        );

        return jsonResponse(
            {
                success:
                    true,

                provider:
                    "epic",

                redirectUrl
            },
            200,
            [
                stateCookie,
                returnCookie
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
                    || "Unknown error"
            }
        );

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