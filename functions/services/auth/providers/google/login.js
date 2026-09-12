"use strict";

/* =========================================================
BPD GAMING NETWORK
GOOGLE LOGIN SERVICE

File:
    functions/services/auth/providers/google/login.js

Purpose:
    Starts Google authentication through Supabase Auth.

Description:
    - Accepts a Turnstile-protected login request.
    - Uses the centralized Turnstile verification service.
    - Validates the requested local return destination.
    - Generates PKCE verifier and challenge values.
    - Stores OAuth state in secure HttpOnly cookies.
    - Builds the Supabase Google authorization URL.
    - Returns the authorization URL to the browser.

Public Route:
    POST /api/auth/google/login

Callback:
    GET /api/auth/_oauth/callback
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
    "google";

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
SUPABASE AUTHORIZE URL
========================================================= */

function buildGoogleAuthorizeUrl(
    request,
    env,
    codeChallenge
) {
    const supabaseUrl =
        normalizeString(
            env?.SUPABASE_URL
        )
            .replace(
                /\/+$/u,
                ""
            );

    if (
        !supabaseUrl
    ) {
        throw new Error(
            "SUPABASE_URL_MISSING"
        );
    }

    const callbackUrl =
        new URL(
            "/api/auth/_oauth/callback",
            request.url
        );

    const authorizeUrl =
        new URL(
            `${supabaseUrl}/auth/v1/authorize`
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
GOOGLE LOGIN
========================================================= */

export async function handleGoogleLogin(
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
            "GOOGLE LOGIN: Turnstile verification rejected.",
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
            buildGoogleAuthorizeUrl(
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
            "GOOGLE LOGIN: Failed to create OAuth request.",
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
                    "GOOGLE_LOGIN_START_FAILED"
            },
            500
        );
    }
}