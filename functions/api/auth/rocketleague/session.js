"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SESSION ROUTE

File:
    functions/api/auth/rocketleague/session.js

Public Route:
    GET /api/auth/rocketleague/session

Service:
    functions/services/rl/session.js

Purpose:
    Returns the Rocket League-specific authentication and
    session state for the current BPD browser session.

Responsibilities:
    - Receive the Rocket League session request.
    - Log safe request metadata.
    - Delegate Rocket League session evaluation to the
      service layer.
    - Return the service response.

Important:
    - This is NOT the global BPD authentication endpoint.
    - Global authentication is handled by:
        GET /api/auth/session
    - Rocket League may require Epic-specific state in
      addition to a valid global BPD session.
========================================================= */

import {
    handleRocketLeagueSession
} from "../../../services/rl/session.js";

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
        "RL SESSION ROUTE: Request received.",
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
            await handleRocketLeagueSession(
                context.request,
                context.env
            );

        console.info(
            "RL SESSION ROUTE: Request completed.",
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
            "RL SESSION ROUTE: Unexpected failure.",
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
                    "Rocket League session request failed unexpectedly.",

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