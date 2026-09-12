"use strict";

/* =========================================================
BPD GAMING NETWORK
TURNSTILE VERIFICATION SERVICE

File:
    functions/services/security/turnstile.js

Purpose:
    Provides centralized server-side Cloudflare Turnstile
    verification for protected BPD Gaming Network endpoints.

Description:
    - Validates Cloudflare Turnstile response tokens.
    - Uses the server-side TURNSTILE_SECRET_KEY.
    - Includes the visitor IP when available.
    - Normalizes Turnstile verification results.
    - Handles provider and network failures consistently.
    - Does not expose the Turnstile secret to the browser.
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const TURNSTILE_VERIFY_URL =
    "https://challenges.cloudflare.com/turnstile/v0/siteverify";

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
RESULT HELPERS
========================================================= */

function createFailureResult(
    error,
    options = {}
) {
    return {
        success:
            false,

        configurationError:
            options.configurationError === true,

        unavailable:
            options.unavailable === true,

        error,

        errorCodes:
            Array.isArray(
                options.errorCodes
            )
                ? options.errorCodes
                : []
    };
}

function createSuccessResult() {
    return {
        success:
            true,

        configurationError:
            false,

        unavailable:
            false,

        error:
            null,

        errorCodes:
            []
    };
}

/* =========================================================
CLIENT IP
========================================================= */

function getClientIp(
    request
) {
    if (
        !request
        || !request.headers
        || typeof request.headers.get !==
            "function"
    ) {
        return "";
    }

    return normalizeString(
        request.headers.get(
            "CF-Connecting-IP"
        )
    );
}

/* =========================================================
TURNSTILE ERROR CODES
========================================================= */

function getTurnstileErrorCodes(
    result
) {
    if (
        !Array.isArray(
            result?.["error-codes"]
        )
    ) {
        return [];
    }

    return result[
        "error-codes"
    ]
        .map(
            normalizeString
        )
        .filter(
            Boolean
        );
}

/* =========================================================
VERIFY TURNSTILE
========================================================= */

export async function verifyTurnstile(
    request,
    env,
    captchaToken
) {
    const secret =
        normalizeString(
            env?.TURNSTILE_SECRET_KEY
        );

    if (
        !secret
    ) {
        console.error(
            "TURNSTILE: TURNSTILE_SECRET_KEY is missing."
        );

        return createFailureResult(
            "CAPTCHA_NOT_CONFIGURED",
            {
                configurationError:
                    true
            }
        );
    }

    const token =
        normalizeString(
            captchaToken
        );

    if (
        !token
    ) {
        return createFailureResult(
            "CAPTCHA_REQUIRED"
        );
    }

    const formData =
        new FormData();

    formData.set(
        "secret",
        secret
    );

    formData.set(
        "response",
        token
    );

    const clientIp =
        getClientIp(
            request
        );

    if (
        clientIp
    ) {
        formData.set(
            "remoteip",
            clientIp
        );
    }

    let response;

    try {
        response =
            await fetch(
                TURNSTILE_VERIFY_URL,
                {
                    method:
                        "POST",

                    body:
                        formData
                }
            );
    }
    catch (
        error
    ) {
        console.error(
            "TURNSTILE: Verification request failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return createFailureResult(
            "CAPTCHA_SERVICE_UNAVAILABLE",
            {
                unavailable:
                    true
            }
        );
    }

    if (
        !response.ok
    ) {
        console.error(
            "TURNSTILE: Verification returned HTTP error.",
            {
                status:
                    response.status
            }
        );

        return createFailureResult(
            "CAPTCHA_SERVICE_UNAVAILABLE",
            {
                unavailable:
                    true
            }
        );
    }

    let result;

    try {
        result =
            await response.json();
    }
    catch (
        error
    ) {
        console.error(
            "TURNSTILE: Could not parse verification response.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return createFailureResult(
            "CAPTCHA_SERVICE_UNAVAILABLE",
            {
                unavailable:
                    true
            }
        );
    }

    const errorCodes =
        getTurnstileErrorCodes(
            result
        );

    if (
        result?.success !==
        true
    ) {
        console.warn(
            "TURNSTILE: Verification rejected.",
            {
                errorCodes
            }
        );

        return createFailureResult(
            "CAPTCHA_INVALID",
            {
                errorCodes
            }
        );
    }

    return createSuccessResult();
}