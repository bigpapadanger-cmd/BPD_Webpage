import { json } from "../../responses/responses.js";

import { getStoredSession } from "../reload/reload_sessions.js";

/*
=========================================================
TEMPORARILY DISABLED — TRN ROCKET LEAGUE LOOKUP
=========================================================

Cloudflare Pages Functions cannot bundle `trn-rocket-league`
because that package depends on Node.js `child_process`.

Previous import:

import {
    fetchProfile,
    fetchSessions
} from "trn-rocket-league";

Previous calls:

const profile = await fetchProfile(
    username,
    platform,
    {
        signal: controller.signal
    }
);

const sessions = await fetchSessions(
    username,
    platform,
    {
        signal: controller.signal
    }
);

This functionality can later be moved to a separate Cloud Run
service and called from this function using fetch().
=========================================================
*/

export async function handleRocketLeagueProfile(request, env) {

    const storedSession = await getStoredSession(
        request,
        env
    );

    if (!storedSession) {

        return json(
            {
                success: false,
                authenticated: false,
                message:
                    "Login is required to load Rocket League ranks."
            },
            401
        );

    }

    const sessionData = storedSession.sessionData;

    const username = String(
        sessionData.rocketLeagueLookup?.username
        || sessionData.displayName
        || ""
    ).trim();

    if (
        !username
        || username.length < 2
    ) {

        return json(
            {
                success: false,
                authenticated: true,
                message:
                    "Invalid Rocket League username in session."
            },
            400
        );

    }

    const platform = String(
        sessionData.rocketLeagueLookup?.platform
        || "epic"
    )
        .trim()
        .toLowerCase();

    const allowedPlatforms = [
        "psn",
        "xbl",
        "steam",
        "epic",
        "switch"
    ];

    if (!allowedPlatforms.includes(platform)) {

        return json(
            {
                success: false,
                authenticated: true,
                message:
                    "Invalid Rocket League platform in session."
            },
            400
        );

    }

    return json(
        {
            success: false,
            authenticated: true,
            temporarilyUnavailable: true,
            username,
            platform,
            message:
                "Rocket League profile lookup is temporarily unavailable."
        },
        503
    );

}