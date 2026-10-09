"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";
import { fetchSupabase, supabaseRestBase, supabaseRestUrl } from "../rest.js";

const ALLOWED_RPCS = new Set([
    "get_rl_global_leaderboard",
    "get_rl_global_leaderboard_position",
    "get_rl_global_leaderboard_preference",
    "save_rl_global_leaderboard_preference"
]);
const PLAYLISTS = new Map([[10, "1v1"], [11, "2v2"], [13, "3v3"]]);
const PAGE_SIZES = new Set([25, 50, 100, 250]);
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["Epic", "Steam", "PS4", "PS5", "XboxOne", "Switch", "PsyNet"]);

export class RocketLeagueLeaderboardError extends Error {
    constructor(code = "RL_LEADERBOARD_UNAVAILABLE", status = 503) {
        super(code);
        this.name = "RocketLeagueLeaderboardError";
        this.code = code;
        this.status = status;
    }
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function string(value, max = 120) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function number(value) { const result = Number(value); return Number.isSafeInteger(result) && result >= 0 ? result : null; }
function timestamp(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }

function logRpcFailure(name, code, upstreamStatus = null) {
    console.warn("RL LEADERBOARD: Supabase RPC failed.", {
        rpc: name,
        code,
        upstreamStatus: Number.isInteger(upstreamStatus) ? upstreamStatus : null
    });
}

async function callRpc(env, name, parameters) {
    if (!ALLOWED_RPCS.has(name)) throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_UNAVAILABLE", 500);
    const key = typeof env?.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "";
    let restBase;
    try {
        if (!key) throw new Error("config");
        restBase = supabaseRestBase(env?.SUPABASE_URL);
    } catch {
        logRpcFailure(name, "RL_LEADERBOARD_CONFIG_UNAVAILABLE");
        throw new RocketLeagueLeaderboardError();
    }
    let upstreamStatus = null;
    let upstreamDiagnosticCode = null;
    try {
        return await withUpstreamDeadline(async signal => {
            const response = await fetchBoundedResponse(supabaseRestUrl(restBase, `rpc/${name}`), {
                method: "POST",
                headers: {
                    apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
                    Accept: "application/json", "Content-Profile": "api", "Accept-Profile": "api"
                },
                body: JSON.stringify(parameters),
                signal
            }, 1024 * 1024, (input, init) => fetchSupabase(input, init));
            upstreamStatus = response.status;
            if (!response.ok) {
                const failure = await response.clone().json().catch(() => null);
                upstreamDiagnosticCode = ["PGRST202", "PGRST301", "42501", "42883"].includes(failure?.code) ? failure.code : null;
                if (name === "save_rl_global_leaderboard_preference") {
                    let providerCode = null;
                    try {
                        const payload = await response.json();
                        const code = payload?.message || payload?.code;
                        if (code === "RL_PROFILE_REQUIRED" || code === "RL_LEADERBOARD_PREFERENCE_INVALID") providerCode = code;
                    } catch { /* Error body is optional and remains private. */ }
                    if (providerCode === "RL_PROFILE_REQUIRED") throw new RocketLeagueLeaderboardError(providerCode, 404);
                    if (providerCode === "RL_LEADERBOARD_PREFERENCE_INVALID") throw new RocketLeagueLeaderboardError(providerCode, 400);
                }
                throw new RocketLeagueLeaderboardError();
            }
            try { return await response.json(); } catch { throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_RESPONSE_INVALID", 502); }
        }, 10000);
    } catch (error) {
        const normalized = error instanceof RocketLeagueLeaderboardError
            ? error
            : new RocketLeagueLeaderboardError(error?.code === "UPSTREAM_TIMEOUT" ? "RL_LEADERBOARD_TIMEOUT" : "RL_LEADERBOARD_UNAVAILABLE", error?.code === "UPSTREAM_TIMEOUT" ? 504 : 503);
        logRpcFailure(name, upstreamDiagnosticCode || normalized.code, upstreamStatus);
        throw normalized;
    }
}

function normalizeRow(value) {
    const row = object(value);
    const globalRank = row.globalRank === null || row.globalRank === undefined ? null : number(row.globalRank);
    if (row.mmr === null || row.mmr === undefined || !PLATFORMS.has(row.platform)) return null;
    const mmr = Number(row.mmr);
    const name = string(row.playerName, 120);
    const platform = string(row.platform, 32);
    if (!globalRank || !name || !platform || !Number.isFinite(mmr) || mmr < 0 || mmr > 5000) return null;
    const tier = row.tier === null || row.tier === undefined ? null
        : typeof row.tier === "string" ? string(row.tier, 40)
            : Number.isSafeInteger(row.tier) && row.tier >= 0 ? row.tier : null;
    return {
        globalRank,
        playerName: name,
        platform,
        mmr,
        isBpdMember: row.isBpdMember === true,
        tier,
        division: number(row.division),
        matchesPlayed: number(row.matchesPlayed),
        wins: number(row.wins)
    };
}

export async function getGlobalRocketLeagueLeaderboard(env, { playlistId, page = 1, pageSize = 50, membersOnly = false, minRank = null, maxRank = null, query = null, accountId = null }) {
    if (!PLAYLISTS.has(playlistId) || !Number.isSafeInteger(page) || page < 1 || page > 1000
        || !PAGE_SIZES.has(pageSize) || typeof membersOnly !== "boolean"
        || (minRank !== null && (!Number.isSafeInteger(minRank) || minRank < 1 || minRank > 20000))
        || (maxRank !== null && (!Number.isSafeInteger(maxRank) || maxRank < 1 || maxRank > 20000))
        || (minRank !== null && maxRank !== null && minRank > maxRank)
        || (query !== null && (typeof query !== "string" || query.trim().length > 80))) {
        throw new RocketLeagueLeaderboardError("INVALID_LEADERBOARD_QUERY", 400);
    }
    const raw = await callRpc(env, "get_rl_global_leaderboard", {
        p_playlist_id: playlistId, p_page: page, p_page_size: pageSize,
        p_members_only: membersOnly, p_query: query?.trim() || null,
        p_min_rank: minRank, p_max_rank: maxRank
    });
    const result = object(raw);
    if (result.success !== true || result.playlistId !== playlistId || !Array.isArray(result.rows)) {
        throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_RESPONSE_INVALID", 502);
    }
    const rows = result.rows.map(normalizeRow);
    if (rows.some(row => !row) || rows.length > pageSize) throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_RESPONSE_INVALID", 502);
    let yourPosition = null;
    if (accountId) {
        if (!ACCOUNT_ID.test(accountId)) throw new RocketLeagueLeaderboardError("INVALID_LEADERBOARD_QUERY", 400);
        const position = await callRpc(env, "get_rl_global_leaderboard_position", { p_account_id: accountId, p_playlist_id: playlistId });
        if (position !== null) {
            yourPosition = normalizeRow(position);
            if (!yourPosition) throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_RESPONSE_INVALID", 502);
        }
    }
    return {
        success: true,
        playlistId,
        gameMode: PLAYLISTS.get(playlistId),
        status: ["pending", "refreshing", "ready", "failed"].includes(result.status) ? result.status : "pending",
        snapshotDate: /^\d{4}-\d{2}-\d{2}$/.test(result.snapshotDate || "") ? result.snapshotDate : null,
        capturedAt: timestamp(result.capturedAt),
        stale: result.stale === true,
        availableDepth: number(result.availableDepth) || 0,
        totalEntries: number(result.totalEntries) || 0,
        page,
        pageSize,
        membersOnly,
        rows,
        yourPosition
    };
}

export async function getGlobalLeaderboardPreference(env, accountId) {
    if (!ACCOUNT_ID.test(accountId || "")) throw new RocketLeagueLeaderboardError("INVALID_LEADERBOARD_QUERY", 400);
    const result = object(await callRpc(env, "get_rl_global_leaderboard_preference", { p_account_id: accountId }));
    return { available: result.available === true, globalLeaderboardVisible: result.globalLeaderboardVisible === true };
}

export async function saveGlobalLeaderboardPreference(env, accountId, enabled) {
    if (!ACCOUNT_ID.test(accountId || "") || typeof enabled !== "boolean") throw new RocketLeagueLeaderboardError("INVALID_LEADERBOARD_QUERY", 400);
    const result = object(await callRpc(env, "save_rl_global_leaderboard_preference", { p_account_id: accountId, p_enabled: enabled }));
    if (result.available !== true || result.globalLeaderboardVisible !== enabled) throw new RocketLeagueLeaderboardError("RL_LEADERBOARD_PREFERENCE_UNAVAILABLE", 502);
    return { available: true, globalLeaderboardVisible: enabled };
}
