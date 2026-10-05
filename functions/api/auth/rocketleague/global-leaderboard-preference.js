"use strict";

import { authorizationErrorResponse } from "../../../services/rl/authorization.js";
import { authorizeRocketLeagueRequest } from "../../../services/rl/authorization.js";
import { RocketLeagueLeaderboardError, getGlobalLeaderboardPreference, saveGlobalLeaderboardPreference } from "../../../services/supabase/rocketleague/global_leaderboards.js";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(body, status = 200) { return Response.json(body, { status, headers: HEADERS }); }
function crossSite(request) {
    const origin = String(request.headers.get("Origin") || "").trim();
    return request.headers.get("Sec-Fetch-Site") === "cross-site" || (origin && origin !== new URL(request.url).origin);
}
async function authorize(request, env) {
    try { return await authorizeRocketLeagueRequest(request, env); }
    catch (error) { return { response: authorizationErrorResponse(error) }; }
}

export async function onRequestGet({ request, env }) {
    const authorization = await authorize(request, env);
    if (authorization.response) return authorization.response;
    try {
        const preference = await getGlobalLeaderboardPreference(env, authorization.accountId);
        if (!preference.available) return json({ success: false, error: "RL_PROFILE_REQUIRED" }, 404);
        return json({ success: true, ...preference });
    } catch {
        return json({ success: false, error: "LEADERBOARD_PREFERENCE_UNAVAILABLE" }, 503);
    }
}

export async function onRequestPatch({ request, env }) {
    if (crossSite(request)) return json({ success: false, error: "CROSS_SITE_REQUEST_REJECTED" }, 403);
    const authorization = await authorize(request, env);
    if (authorization.response) return authorization.response;
    const length = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > 256) return json({ success: false, error: "INVALID_PREFERENCE" }, 400);
    let body;
    try {
        const raw = await request.text();
        if (raw.length > 256) return json({ success: false, error: "INVALID_PREFERENCE" }, 400);
        body = JSON.parse(raw);
    } catch { return json({ success: false, error: "INVALID_PREFERENCE" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || typeof body.globalLeaderboardVisible !== "boolean") {
        return json({ success: false, error: "INVALID_PREFERENCE" }, 400);
    }
    try {
        return json({ success: true, ...await saveGlobalLeaderboardPreference(env, authorization.accountId, body.globalLeaderboardVisible) });
    } catch (error) {
        if (error instanceof RocketLeagueLeaderboardError && error.code === "RL_PROFILE_REQUIRED") return json({ success: false, error: "RL_PROFILE_REQUIRED" }, 404);
        if (error instanceof RocketLeagueLeaderboardError && error.status === 400) return json({ success: false, error: "INVALID_PREFERENCE" }, 400);
        return json({ success: false, error: "LEADERBOARD_PREFERENCE_UNAVAILABLE" }, 503);
    }
}

