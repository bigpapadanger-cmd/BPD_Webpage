"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE ROUTE

File:
    functions/api/auth/rocketleague/profile.js

Public Route:
    /api/auth/rocketleague/profile

Service:
    functions/services/rl/profile.js

Purpose:
    Thin Cloudflare Pages Functions route for Rocket League
    profile operations.

Responsibilities:
    - Receive Rocket League profile requests.
    - Log safe request metadata.
    - Delegate profile handling to the Rocket League service.
    - Return the service response.

Important:
    - Rocket League profile logic does not belong here.
    - Session, Supabase, and profile persistence logic belong
      in the service layer.
========================================================= */

import {
    handleRocketLeagueProfile
} from "../../../services/rl/profile.js";

/* =========================================================
ROUTE
========================================================= */

export async function onRequest(
    context
) {
    const debugId =
        crypto.randomUUID();

    const requestUrl =
        new URL(
            context.request.url
        );

    console.info(
        "RL PROFILE ROUTE: Request received.",
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
            await handleRocketLeagueProfile(
                context.request,
                context.env
            );

        console.info(
            "RL PROFILE ROUTE: Request completed.",
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
            "RL PROFILE ROUTE: Unexpected failure.",
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