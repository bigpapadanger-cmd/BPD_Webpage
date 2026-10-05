"use strict";

import { isAuthorizationError, authorizeRequest } from "../../services/auth/authorization.js";
import { getGlobalRocketLeagueLeaderboard, RocketLeagueLeaderboardError } from "../../services/supabase/rocketleague/global_leaderboards.js";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const ALLOWED_QUERY = new Set(["playlist", "page", "pageSize", "membersOnly", "minRank", "maxRank", "q"]);
const PLAYLISTS = new Set([10, 11, 13]);
const PAGE_SIZES = new Set([25, 50, 100, 250]);

function json(body, status = 200) { return Response.json(body, { status, headers: HEADERS }); }
function single(url, key, fallback) {
    const values = url.searchParams.getAll(key);
    return values.length === 0 ? fallback : values.length === 1 ? values[0] : null;
}

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => !ALLOWED_QUERY.has(key))) return json({ success: false, error: "INVALID_LEADERBOARD_QUERY" }, 400);
    const playlistText = single(url, "playlist", "10");
    const pageText = single(url, "page", "1");
    const pageSizeText = single(url, "pageSize", "50");
    const membersText = single(url, "membersOnly", "false");
    const minRankText = single(url, "minRank", "");
    const maxRankText = single(url, "maxRank", "");
    const queryValue = single(url, "q", "");
    if (!/^(10|11|13)$/.test(playlistText || "") || !/^\d{1,4}$/.test(pageText || "")
        || !/^\d{1,3}$/.test(pageSizeText || "") || !["true", "false"].includes(membersText)
        || (minRankText !== "" && !/^\d{1,5}$/.test(minRankText))
        || (maxRankText !== "" && !/^\d{1,5}$/.test(maxRankText))
        || queryValue === null || queryValue.length > 80 || (queryValue.trim() && queryValue.trim().length < 2)) {
        return json({ success: false, error: "INVALID_LEADERBOARD_QUERY" }, 400);
    }
    const playlistId = Number(playlistText);
    const page = Number(pageText);
    const pageSize = Number(pageSizeText);
    const minRank = minRankText ? Number(minRankText) : null;
    const maxRank = maxRankText ? Number(maxRankText) : null;
    if (!PLAYLISTS.has(playlistId) || !Number.isSafeInteger(page) || page < 1 || page > 1000 || !PAGE_SIZES.has(pageSize)
        || (minRank !== null && (!Number.isSafeInteger(minRank) || minRank < 1 || minRank > 20000))
        || (maxRank !== null && (!Number.isSafeInteger(maxRank) || maxRank < 1 || maxRank > 20000))
        || (minRank !== null && maxRank !== null && minRank > maxRank)) {
        return json({ success: false, error: "INVALID_LEADERBOARD_QUERY" }, 400);
    }

    let accountId = null;
    if (request.headers.has("Cookie") || request.headers.has("Authorization")) {
        try { accountId = (await authorizeRequest(request, env, { account: true })).accountId || null; }
        catch (error) {
            if (!isAuthorizationError(error)) return json({ success: false, error: "LEADERBOARD_UNAVAILABLE" }, 503);
        }
    }
    try {
        const result = await getGlobalRocketLeagueLeaderboard(env, {
            playlistId, page, pageSize, membersOnly: membersText === "true", minRank, maxRank,
            query: queryValue.trim() || null, accountId
        });
        return json(result);
    } catch (error) {
        const status = error instanceof RocketLeagueLeaderboardError ? error.status : 503;
        return json({ success: false, error: status === 400 ? "INVALID_LEADERBOARD_QUERY" : "LEADERBOARD_UNAVAILABLE" }, status);
    }
}

