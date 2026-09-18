"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN ACCESS API

File:
    functions/api/auth/admin/access.js

Route:
    GET /api/auth/admin/access

Purpose:
    Verifies that the currently authenticated BPD account
    has authorized Discord-backed Admin access.

Security:
    - Discord identity is resolved server-side.
    - Discord guild roles are verified server-side.
    - Browser-submitted Discord IDs or roles are never used.
    - Supabase credentials are never exposed.
========================================================= */

import {
    authorizeAdminContext
} from "../../../services/admin/permissions.js";

/* =========================================================
CONSTANTS
========================================================= */

const JSON_HEADERS =
    Object.freeze({
        "Content-Type":
            "application/json; charset=utf-8",

        "Cache-Control":
            "no-store"
    });

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers:
                JSON_HEADERS
        }
    );
}

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
ERROR STATUS
========================================================= */

function getErrorStatus(
    error
) {
    const status =
        Number(
            error?.status
        );

    if (
        Number.isInteger(status)
        && status >= 400
        && status <= 599
    ) {
        return status;
    }

    return 500;
}

/* =========================================================
ERROR RESPONSE
========================================================= */

function handleApiError(
    error
) {
    const status =
        getErrorStatus(
            error
        );

    if (
        status >= 500
    ) {
        console.error(
            "[ADMIN ACCESS API]",
            {
                name:
                    error?.name
                    ?? null,

                code:
                    error?.code
                    ?? null,

                message:
                    error?.message
                    ?? null
            }
        );
    }

    /*
     * Keep the public response intentionally small.
     *
     * The client only needs to know whether access was
     * granted.
     */
    return jsonResponse(
        {
            success:
                false,

            authorized:
                false,

            error:
                status === 401
                    ? "AUTHENTICATION_REQUIRED"
                    : status === 403
                        ? "ADMIN_ACCESS_DENIED"
                        : "ADMIN_ACCESS_CHECK_FAILED"
        },
        status
    );
}

/* =========================================================
GET /api/auth/admin/access
========================================================= */

export async function onRequestGet(
    context
) {
    try {
        const {
            request,
            env
        } = context;

        await authorizeAdminContext(
            request,
            env
        );

        return jsonResponse(
            {
                success: true,
                authorized: true
            },
            200
        );
    }
    catch (
        error
    ) {
        return handleApiError(
            error
        );
    }
}
/* =========================================================
METHOD FALLBACK
========================================================= */

export async function onRequest(
    context
) {
    const method =
        normalizeString(
            context?.request?.method
        ).toUpperCase();

    if (
        method === "GET"
    ) {
        return onRequestGet(
            context
        );
    }

    return new Response(
        JSON.stringify({
            success:
                false,

            authorized:
                false,

            error:
                "METHOD_NOT_ALLOWED"
        }),
        {
            status:
                405,

            headers: {
                ...JSON_HEADERS,

                Allow:
                    "GET"
            }
        }
    );
}