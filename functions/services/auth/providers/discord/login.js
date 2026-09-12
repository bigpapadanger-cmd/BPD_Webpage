"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD LOGIN SERVICE

File:
    functions/services/auth/providers/discord/login.js

Purpose:
    Starts Discord authentication through Supabase Auth.

Description:
    - Accepts a Turnstile-protected login request.
    - Uses the centralized Turnstile verification service.
    - Validates the requested local return destination.
    - Generates PKCE verifier and challenge values.
    - Stores OAuth state in secure HttpOnly cookies.
    - Builds the Supabase Discord authorization URL.
    - Includes the public Supabase publishable key required
      by the Supabase Auth authorize endpoint.
    - Returns the authorization URL to the browser.

Public Route:
    POST /api/auth/discord/login

Callback:
    GET /api/auth/_oauth/callback

Supabase Public Key:
    env.SB_PUB_KEY

Important:
    - Discord authentication does not require guild membership.
    - Guild membership and role authorization are evaluated
      separately after authentication.
    - SB_PUB_KEY is the public Supabase publishable key.
    - SUPABASE_AUTH must never be exposed in this URL.
========================================================= */

import {
    OAUTH_MODE_COOKIE,
    OAUTH_PROVIDER_COOKIE,
    OAUTH_PKCE_COOKIE,
    OAUTH_RETURN_COOKIE,
    OAUTH_COOKIE_MAX_AGE_SECONDS
} from "../../../config/api_vars.js";

import {
    verifyTurnstile
} from "../../../security/turnstile.js";

/* =========================================================
CONSTANTS
========================================================= */

const PROVIDER =
    "discord";

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
COOKIE
========================================================= */

function createOAuthCookie(
    name,
    value,
    maxAge =
        OAUTH_COOKIE_MAX_AGE_SECONDS
) {
    return [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        `Max-Age=${maxAge}`,
        "HttpOnly",
        "Secure",
        "SameSite=Lax"
    ]
        .join(
            "; "
        );
}

/* =========================================================
BASE64 URL
========================================================= */

function arrayBufferToBase64Url(
    value
) {
    const bytes =
        value instanceof Uint8Array
            ? value
            : new Uint8Array(
                value
            );

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
            /=+$/u,
            ""
        );
}

/* =========================================================
RANDOM STRING
========================================================= */

function createRandomString(
    byteLength = 48
) {
    const bytes =
        new Uint8Array(
            byteLength
        );

    crypto.getRandomValues(
        bytes
    );

    return arrayBufferToBase64Url(
        bytes
    );
}

/* =========================================================
PKCE
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

    return arrayBufferToBase64Url(
        digest
    );
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
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const configuredUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    const publishableKey =
        normalizeString(
            env?.SB_PUB_KEY
        );

    if (
        !configuredUrl
    ) {
        throw new Error(
            "SUPABASE_URL_MISSING"
        );
    }

    if (
        !publishableKey
    ) {
        throw new Error(
            "SB_PUB_KEY_MISSING"
        );
    }

    let origin;

    try {
        origin =
            new URL(
                configuredUrl
            ).origin;
    }
    catch {
        throw new Error(
            "SUPABASE_URL_INVALID"
        );
    }

    return {
        origin,
        publishableKey
    };
}

/* =========================================================
SUPABASE AUTHORIZE URL
========================================================= */

function buildDiscordAuthorizeUrl(
    request,
    env,
    codeChallenge
) {
    const {
        origin,
        publishableKey
    } =
        getSupabaseConfiguration(
            env
        );
        
    const callbackUrl =
        new URL(
            "/api/auth/_oauth/callback",
            request.url
        );

    const authorizeUrl =
        new URL(
            `${origin}/auth/v1/authorize`
        );



    authorizeUrl.searchParams.set(
        "provider",
        PROVIDER
    );

    authorizeUrl.searchParams.set(
        "redirect_to",
        callbackUrl.href
    );

    authorizeUrl.searchParams.set(
        "code_challenge",
        codeChallenge
    );

    authorizeUrl.searchParams.set(
        "code_challenge_method",
        "s256"
    );

    /*
     * Supabase Auth requires an API key for this request.
     *
     * SB_PUB_KEY is intentionally public and may appear
     * in the browser-visible authorization URL.
     *
     * Never use SUPABASE_AUTH here.
     */
    authorizeUrl.searchParams.set(
        "apikey",
        publishableKey
    );

    return authorizeUrl.href;
}

/* =========================================================
TURNSTILE RESPONSE
========================================================= */

function getTurnstileFailureResponse(
    verification
) {
    if (
        verification.configurationError ===
        true
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    verification.error
                    || "CAPTCHA_NOT_CONFIGURED"
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
                    verification.error
                    || "CAPTCHA_SERVICE_UNAVAILABLE"
            },
            503
        );
    }

    if (
        verification.success !==
        true
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    verification.error
                    || "CAPTCHA_INVALID"
            },
            verification.error ===
                "CAPTCHA_REQUIRED"
                ? 400
                : 403
        );
    }

    return null;
}

/* =========================================================
DISCORD LOGIN
========================================================= */

export async function handleDiscordLogin(
    request,
    env
) {
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

    const verification =
        await verifyTurnstile(
            request,
            env,
            body.captchaToken
        );

    const verificationFailure =
        getTurnstileFailureResponse(
            verification
        );

    if (
        verificationFailure
    ) {
        console.warn(
            "DISCORD LOGIN: Turnstile verification rejected.",
            {
                error:
                    verification.error,

                errorCodes:
                    verification.errorCodes
            }
        );

        return verificationFailure;
    }

    const returnTo =
        normalizeReturnTo(
            body.returnTo
        );

    try {
        const pkceVerifier =
            createRandomString();

        const pkceChallenge =
            await createPkceChallenge(
                pkceVerifier
            );

        const redirectUrl =
            buildDiscordAuthorizeUrl(
                request,
                env,
                pkceChallenge
            );

        const cookies = [
            createOAuthCookie(
                OAUTH_MODE_COOKIE,
                "login"
            ),

            createOAuthCookie(
                OAUTH_PROVIDER_COOKIE,
                PROVIDER
            ),

            createOAuthCookie(
                OAUTH_PKCE_COOKIE,
                pkceVerifier
            ),

            createOAuthCookie(
                OAUTH_RETURN_COOKIE,
                returnTo
            )
        ];

        return jsonResponse(
            {
                success:
                    true,

                provider:
                    PROVIDER,

                redirectUrl
            },
            200,
            cookies
        );
    }
    catch (
        error
    ) {
        console.error(
            "DISCORD LOGIN: Failed to create OAuth request.",
            {
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
                    error?.message ===
                        "SB_PUB_KEY_MISSING"
                        ? "SB_PUB_KEY_MISSING"
                        : "DISCORD_LOGIN_START_FAILED"
            },
            500
        );
    }
}