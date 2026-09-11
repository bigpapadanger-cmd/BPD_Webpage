"use strict";

/* =========================================================
BPD GAMING NETWORK
GLOBAL LOGOUT ROUTE

File:
    functions/api/auth/logout.js

Public Route:
    GET /api/auth/logout

Service:
    functions/services/auth/account/logout.js

Purpose:
    Ends the current global BPD browser session.

Responsibilities:
    - Receive the browser logout request.
    - Delegate session destruction to the account service.
    - Return the logout service response.

Important:
    - This is a GLOBAL logout.
    - It destroys the centralized BPD browser session.
    - It is not an Epic-only, Google-only, or
      Rocket League-only logout.
    - Provider unlinking is a separate operation.
========================================================= */

import {
    handleLogout
} from "../../services/auth/account/logout.js";

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
        "LOGOUT ROUTE: Request received.",
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
            await handleLogout(
                context.request,
                context.env
            );

        console.info(
            "LOGOUT ROUTE: Request completed.",
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
            "LOGOUT ROUTE: Unexpected failure.",
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
                    "Logout failed unexpectedly.",
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