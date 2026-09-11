"use strict";

/* =========================================================
BPD GAMING NETWORK
GLOBAL AUTH SESSION ROUTE

File:
    functions/api/auth/session.js

Public Route:
    GET /api/auth/session

Service:
    functions/services/auth/account/session.js

Purpose:
    Returns the current global BPD authentication state.

Responsibilities:
    - Receive the browser session request.
    - Delegate session evaluation to the global account
      session service.
    - Return the normalized authentication response.

Important:
    - This is the global BPD authentication endpoint.
    - This is NOT Rocket League-specific.
    - Rocket League authentication state is handled by:
        GET /api/auth/rocketleague/session
========================================================= */

import {
    handleAuthSession
} from "../../services/auth/account/session.js";

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
        "AUTH SESSION ROUTE: Request received.",
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
            await handleAuthSession(
                context.request,
                context.env
            );

        console.info(
            "AUTH SESSION ROUTE: Request completed.",
            {
                debugId,
                status:
                    response.status
            }
        );

        return response;
    }
    catch (
        error
    ) {
        console.error(
            "AUTH SESSION ROUTE: Unexpected failure.",
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
                authenticated:
                    false,
                message:
                    "Authentication session failed unexpectedly.",
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