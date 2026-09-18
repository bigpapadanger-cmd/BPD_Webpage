"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE ROUTE

File:
    functions/api/auth/rocketleague/profile.js

Public Route:
    GET  /api/auth/rocketleague/profile
    POST /api/auth/rocketleague/profile

Service:
    functions/services/rl/profile.js

Purpose:
    Handles Rocket League profile retrieval and registration
    requests for the current authenticated BPD account.

Responsibilities:
    - Receive Rocket League profile GET and POST requests.
    - Log safe request metadata.
    - Delegate all profile logic to the Rocket League profile
      service.
    - Return the service response unchanged.

Important:
    - Authentication and authorization are handled by the
      service layer.
    - Account ownership comes from the authenticated BPD
      session.
    - Browser-submitted account IDs are not trusted.
    - Browser-submitted Epic IDs are not trusted.
    - GET may perform region detection only when explicitly
      requested with:
          ?detectLocation=true
    - POST handles registration/profile saving.
    - This route does not independently determine Rocket
      League access.
========================================================= */

import {
    handleRocketLeagueProfile
} from "../../../services/rl/profile.js";

/* =========================================================
REQUEST HANDLER
========================================================= */

async function handleRequest(
    context
) {
    const debugId =
        crypto.randomUUID();

    const requestUrl =
        new URL(
            context.request.url
        );

    const detectLocationRequested =
        requestUrl.searchParams.get(
            "detectLocation"
        ) ===
        "true";

    console.info(
        "RL PROFILE ROUTE: Request received.",
        {
            debugId,

            method:
                context.request.method,

            pathname:
                requestUrl.pathname,

            detectLocationRequested
        }
    );

    try {
        const response =
            await handleRocketLeagueProfile(
                context.request,
                context.env
            );

        console.info(
            "RL PROFILE ROUTE: Request completed.",
            {
                debugId,

                method:
                    context.request.method,

                pathname:
                    requestUrl.pathname,

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
            "RL PROFILE ROUTE: Unexpected failure.",
            {
                debugId,

                method:
                    context.request.method,

                pathname:
                    requestUrl.pathname,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || null,

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

                epicLinked:
                    false,

                requiresEpicLogin:
                    false,

                profileExists:
                    false,

                profileLoaded:
                    false,

                profileSaved:
                    false,

                registrationAccepted:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "ROCKET_LEAGUE_PROFILE_ROUTE_FAILED",

                message:
                    "Rocket League profile request failed unexpectedly.",

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
GET
========================================================= */

export async function onRequestGet(
    context
) {
    return handleRequest(
        context
    );
}

/* =========================================================
POST
========================================================= */

export async function onRequestPost(
    context
) {
    return handleRequest(
        context
    );
}