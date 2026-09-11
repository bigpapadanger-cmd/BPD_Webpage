"use strict";

/* =========================================================
BPD GAMING NETWORK
SUPABASE OAUTH CALLBACK ROUTE

Purpose:
    Public callback endpoint used by Supabase Auth.

Responsibilities:
    - Receive the OAuth callback request.
    - Delegate processing to the centralized OAuth service.
    - Return the service response.

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