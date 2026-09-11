"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH LOGIN ROUTE

File:
    functions/api/auth/epic/login.js

Public Route:
    GET /api/auth/epic/login

Service:
    functions/services/auth/providers/epic/login.js

Purpose:
    Thin Cloudflare Pages Functions route that starts the
    Epic OAuth authentication flow.

Responsibilities:
    - Receive the browser login request.
    - Log safe request metadata.
    - Delegate OAuth initialization to the Epic auth service.
    - Return the service response.

Important:
    - OAuth implementation does not belong in this route.
    - Tokens, secrets, authorization codes, and OAuth state
      values must never be logged.
========================================================= */

import {
    handleEpicLogin
} from "../../../services/auth/providers/epic/login.js";

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
        "EPIC LOGIN ROUTE: Request received.",
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
            await handleEpicLogin(
                context.request,
                context.env
            );

        console.info(
            "EPIC LOGIN ROUTE: Request completed.",
            {
                debugId,

                status:
                    response.status,

                hasLocation:
                    response.headers.has(
                        "location"
                    ),

                locationOrigin:
                    getLocationOrigin(
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
            "EPIC LOGIN ROUTE: Unexpected failure.",
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
                    "Epic login failed unexpectedly.",

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
SAFE REDIRECT ORIGIN
========================================================= */

function getLocationOrigin(
    location
) {
    if (
        !location
    ) {
        return null;
    }

    try {
        return new URL(
            location
        ).origin;
    }
    catch {
        return "invalid-location";
    }
}