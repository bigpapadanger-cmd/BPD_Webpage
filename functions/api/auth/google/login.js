"use strict";

/* =========================================================
BPD GAMING NETWORK
GOOGLE OAUTH LOGIN ROUTE

File:
    functions/api/auth/google/login.js

Public Route:
    GET /api/auth/google/login

Service:
    functions/services/auth/providers/google/login.js

Purpose:
    Thin Cloudflare Pages Functions route that starts the
    Google OAuth authentication flow through Supabase Auth.

Responsibilities:
    - Receive the browser login request.
    - Delegate OAuth initialization to the Google auth service.
    - Return the service response.

Important:
    - OAuth implementation does not belong in this route.
    - PKCE verifiers, authorization codes, tokens, and
      provider credentials must never be logged.
========================================================= */

import {
    handleGoogleLogin
} from "../../../services/auth/providers/google/login.js";

/* =========================================================
GET
========================================================= */

export async function onRequestGet(
    context
) {
    const debugId =
        crypto.randomUUID();

    const requestUrl =
        new URL(
            context.request.url
        );

    console.info(
        "GOOGLE LOGIN ROUTE: Request received.",
        {
            debugId,

            method:
                context.request.method,

            pathname:
                requestUrl.pathname
        }
    );

    try {
        const response =
            await handleGoogleLogin(
                context.request,
                context.env
            );

        console.info(
            "GOOGLE LOGIN ROUTE: Request completed.",
            {
                debugId,

                status:
                    response.status,

                hasRedirect:
                    Boolean(
                        response.headers.get(
                            "location"
                        )
                    )
            }
        );

        return response;
    }
    catch (
        error
    ) {
        console.error(
            "GOOGLE LOGIN ROUTE: Unexpected failure.",
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

        return Response.json(
            {
                success:
                    false,

                message:
                    "Google login failed unexpectedly.",

                debugId
            },
            {
                status:
                    500,

                headers: {
                    "Cache-Control":
                        "no-store"
                }
            }
        );
    }
}