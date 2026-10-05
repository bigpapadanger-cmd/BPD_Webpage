"use strict";

import {
    RocketLeagueDiscoveryError,
    getPublicRocketLeagueProfileWithMmrHistory
} from "../../../../services/supabase/rocketleague/discovery.js";

const PUBLIC_PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: JSON_HEADERS
    });
}

export async function onRequestGet(context) {
    const publicProfileId = String(context.params?.publicProfileId || "").trim();
    if (!PUBLIC_PROFILE_ID_PATTERN.test(publicProfileId)) {
        return json({ success: false, error: "PROFILE_UNAVAILABLE" }, 404);
    }

    try {
        const profile = await getPublicRocketLeagueProfileWithMmrHistory(context.env, publicProfileId);
        if (!profile) {
            return json({ success: false, error: "PROFILE_UNAVAILABLE" }, 404);
        }
        return json({ success: true, profile });
    } catch (error) {
        const status = error instanceof RocketLeagueDiscoveryError
            ? error.status
            : 503;
        return json({ success: false, error: "PROFILE_UNAVAILABLE" }, status);
    }
}
