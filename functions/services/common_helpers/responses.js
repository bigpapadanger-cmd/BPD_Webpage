"use strict";

/* =========================================================
BPD GAMING NETWORK
COMMON RESPONSE / AUTH HELPERS

File:
    functions/services/common_helpers/responses.js

Purpose:
    Provides shared response helpers and small authentication
    utilities used across server-side services.

Description:
    - Creates JSON responses with no-store caching.
    - Creates redirects with optional Set-Cookie headers.
    - Generates cryptographically strong OAuth state values.
    - Reports missing Epic OAuth configuration values.
========================================================= */

/* =========================================================
JSON RESPONSE
========================================================= */

export function json(
    data,
    status = 200,
    extraHeaders = {}
) {
    const safeStatus =
        Number.isInteger(
            status
        )
            ? status
            : 200;

    const body =
        JSON.stringify(
            data
            ?? {}
        );

    const headers = {
        "content-type":
            "application/json; charset=utf-8",

        "cache-control":
            "no-store",

        ...extraHeaders
    };

    return new Response(
        body,
        {
            status:
                safeStatus,

            headers
        }
    );
}

/* =========================================================
REDIRECT RESPONSE
========================================================= */

export function redirect(
    location,
    cookieHeaders = []
) {
    const safeLocation =
        typeof location === "string"
        && location.trim()
            ? location.trim()
            : "/";

    const headers =
        new Headers({
            "location":
                safeLocation,

            "cache-control":
                "no-store"
        });

    for (
        const cookie
        of cookieHeaders
    ) {
        if (
            typeof cookie === "string"
            && cookie.includes(
                "="
            )
        ) {
            headers.append(
                "set-cookie",
                cookie
            );
        }
    }

    return new Response(
        null,
        {
            status:
                302,

            headers
        }
    );
}

/* =========================================================
RANDOM OAUTH STATE
========================================================= */

export function createRandomState() {
    const bytes =
        new Uint8Array(
            32
        );

    crypto.getRandomValues(
        bytes
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
            /=+$/g,
            ""
        );
}

/* =========================================================
EPIC AUTH CONFIGURATION CHECK
========================================================= */

export function getMissingAuthConfiguration(
    env
) {
    const missing = [];

    if (
        !env.EPIC_CLIENT_ID
    ) {
        missing.push(
            "EPIC_CLIENT_ID"
        );
    }

    if (
        !env.EPIC_CLIENT_SECRET
    ) {
        missing.push(
            "EPIC_CLIENT_SECRET"
        );
    }

    if (
        !env.EPIC_REDIRECT_URI
    ) {
        missing.push(
            "EPIC_REDIRECT_URI"
        );
    }

    return missing;
}