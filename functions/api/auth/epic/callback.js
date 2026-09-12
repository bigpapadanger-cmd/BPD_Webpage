"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH CALLBACK ROUTE

File:
    functions/api/auth/epic/callback.js

Purpose:
    Thin Cloudflare Pages Functions route for the Epic OAuth
    callback.

Description:
    - Receives the browser callback from Epic Games.
    - Logs only safe callback metadata.
    - Delegates OAuth processing to the Epic callback service.
    - Rejects unsupported request methods.

Public Route:
    GET /api/auth/epic/callback

Service:
    functions/services/auth/providers/epic/callback.js

Important:
    - Turnstile verification does not occur on this route.
    - OAuth secrets, tokens, authorization codes, and state
      values must never be logged.
========================================================= */

import {
    handleEpicCallback
} from "../../../services/auth/providers/epic/callback.js";

import {
    methodNotAllowedResponse
} from "../../../services/http/responses.js";

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
        "EPIC CALLBACK ROUTE: Request received.",
        {
            debugId,

            method:
                context.request.method,

            pathname:
                requestUrl.pathname,

            hasCode:
                requestUrl.searchParams.has(
                    "code"
                ),

            hasState:
                requestUrl.searchParams.has(
                    "state"
                ),

            hasError:
                requestUrl.searchParams.has(
                    "error"
                )
        }
    );

    try {
        const response =
            await handleEpicCallback(
                context.request,
                context.env
            );

        console.info(
            "EPIC CALLBACK ROUTE: Request completed.",
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
            "EPIC CALLBACK ROUTE: Unexpected failure.",
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

        return Response.json(
            {
                success:
                    false,

                error:
                    "EPIC_CALLBACK_FAILED",

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

/* =========================================================
UNSUPPORTED METHODS
========================================================= */

export async function onRequestPost() {
    return methodNotAllowedResponse(
        [
            "GET"
        ]
    );
}

export async function onRequestPut() {
    return methodNotAllowedResponse(
        [
            "GET"
        ]
    );
}

export async function onRequestPatch() {
    return methodNotAllowedResponse(
        [
            "GET"
        ]
    );
}

export async function onRequestDelete() {
    return methodNotAllowedResponse(
        [
            "GET"
        ]
    );
}