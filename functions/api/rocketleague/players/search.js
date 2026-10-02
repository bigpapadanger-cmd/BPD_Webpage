"use strict";

import {
    RocketLeagueDiscoveryError,
    searchPublicRocketLeaguePlayers
} from "../../../services/supabase/rocketleague/discovery.js";

const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
};
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const MAX_RESULT_COUNT = 20;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: JSON_HEADERS
    });
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const queries = url.searchParams.getAll("q");
    const query = queries.length === 1 ? queries[0].trim() : "";
    const limitValues = url.searchParams.getAll("limit");
    const limitText = limitValues.length === 0
        ? "20"
        : limitValues.length === 1
            ? limitValues[0]
            : "";
    const limit = /^\d{1,2}$/.test(limitText) ? Number(limitText) : NaN;

    if (
        query.length < MIN_QUERY_LENGTH
        || query.length > MAX_QUERY_LENGTH
        || !Number.isInteger(limit)
        || limit < 1
        || limit > MAX_RESULT_COUNT
    ) {
        return json({ success: false, error: "INVALID_SEARCH" }, 400);
    }

    try {
        const players = await searchPublicRocketLeaguePlayers(context.env, query, limit);
        return json({ success: true, players });
    } catch (error) {
        const status = error instanceof RocketLeagueDiscoveryError
            ? error.status
            : 503;
        return json({ success: false, error: "PLAYER_SEARCH_UNAVAILABLE" }, status);
    }
}
