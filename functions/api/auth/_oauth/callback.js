"use strict";

/* =========================================================
BPD GAMING NETWORK
SUPABASE OAUTH CALLBACK ROUTE

File:
    functions/api/auth/_oauth/callback.js

Public Route:
    GET /api/auth/_oauth/callback

Service:
    functions/services/auth/oauth/callback.js

Purpose:
    Public callback endpoint used by authentication providers
    routed through the centralized OAuth callback service.

Description:
    - Receives the OAuth callback request.
    - Delegates processing to the centralized OAuth service.
    - Returns the service response.
    - Contains no provider-specific identity logic.

Important:
    - Provider-specific OAuth logic does not belong here.
    - Tokens, authorization codes, PKCE verifiers, and
      provider credentials must never be logged.
========================================================= */

import {
    handleOAuthCallback
} from "../../../services/auth/oauth/callback.js";

/* =========================================================
GET
========================================================= */

export async function onRequestGet(
    context
) {
    const debugId =
        crypto.randomUUID();

    const url =
        new URL(
            context.request.url
        );

    console.info(
        "OAUTH CALLBACK ROUTE: Request received.",
        {
            debugId,

            method:
                context.request.method,

            pathname:
                url.pathname,

            hasCode:
                url.searchParams.has(
                    "code"
                ),

            hasError:
                url.searchParams.has(
                    "error"
                )
        }
    );

    try {
        const response =
            await handleOAuthCallback(
                context.request,
                context.env
            );

        console.info(
            "OAUTH CALLBACK ROUTE: Request completed.",
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
            "OAUTH CALLBACK ROUTE: Unexpected failure.",
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
                    "OAuth callback failed unexpectedly.",

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