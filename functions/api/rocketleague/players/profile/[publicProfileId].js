"use strict";

import {
    RocketLeagueDiscoveryError,
    getPublicRocketLeaguePlayerSummary
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
    if (new URL(context.request.url).search) {
        return json({ success: false, error: "INVALID_PROFILE_REQUEST" }, 400);
    }
    const publicProfileId = String(context.params?.publicProfileId || "").trim();
    if (!PUBLIC_PROFILE_ID_PATTERN.test(publicProfileId)) {
        return json({ success: false, error: "PROFILE_UNAVAILABLE" }, 404);
    }

    try {
        const result = await getPublicRocketLeaguePlayerSummary(context.env, publicProfileId);
        return json(result);
    } catch (error) {
        const status = error instanceof RocketLeagueDiscoveryError
            ? error.status
            : 503;
        return json({ success: false, error: "PROFILE_UNAVAILABLE" }, status);
    }
}

export function onRequest(context) {
    if (context.request.method === "GET") return onRequestGet(context);
    return new Response(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED" }), {
        status: 405, headers: { ...JSON_HEADERS, Allow: "GET" }
    });
}
