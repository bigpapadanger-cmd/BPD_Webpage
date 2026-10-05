"use strict";
import { withUpstreamDeadline, fetchBoundedResponse } from "../../http/upstream.js";

const RPC_NAMES = Object.freeze({
    SEARCH: "search_rocketleague_players",
    PUBLIC_PROFILE: "get_public_rocketleague_profile",
    FEATURED: "get_rl_featured_player",
    NETWORK: "get_rocketleague_network_statistics"
});

const ALLOWED_RPCS = new Set(Object.values(RPC_NAMES));
const PUBLIC_PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8000;
const PRESENCE_STALE_AFTER_MS = 30 * 60 * 1000;

export class RocketLeagueDiscoveryError extends Error {
    constructor(code, status = 503) {
        super(code);
        this.name = "RocketLeagueDiscoveryError";
        this.code = code;
        this.status = status;
    }
}

function normalizeString(value, maxLength = 120) {
    return typeof value === "string"
        ? value.trim().slice(0, maxLength)
        : "";
}

function normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeTimestamp(value) {
    const timestamp = normalizeString(value, 40);
    return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function normalizeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizePublicProfile(value) {
    const row = normalizeObject(value);
    // Only the fixed service-role public RPCs call this sanitizer. Their live
    // SQL excludes private/inactive profiles before projection and intentionally
    // omits private preferences. Reject contradictory legacy flags if supplied.
    if (Object.hasOwn(row, "find_profile_enabled") && row.find_profile_enabled !== true) return null;
    const publicProfileId = normalizeString(row.public_profile_id, 36);
    if (!PUBLIC_PROFILE_ID_PATTERN.test(publicProfileId)) return null;

    const presenceShared = row.presence_shared === true;
    const mmr = normalizeObject(row.mmr);
    const provider = normalizeObject(row.provider);
    const stats = normalizeObject(row.stats);
    const presenceCheckedAt = normalizeTimestamp(row.presence_checked_at);
    const presenceCheckedAtMs = presenceCheckedAt ? Date.parse(presenceCheckedAt) : NaN;
    const now = Date.now();
    const presenceFresh = Number.isFinite(presenceCheckedAtMs)
        && presenceCheckedAtMs <= now
        && now - presenceCheckedAtMs <= PRESENCE_STALE_AFTER_MS;
    const normalizedPresenceState = normalizeString(row.presence_state, 20).toLowerCase();
    const presenceState = presenceFresh && ["online", "offline", "unknown"].includes(normalizedPresenceState)
        ? normalizedPresenceState
        : null;

    return {
        public_profile_id: publicProfileId,
        display_name: normalizeString(row.display_name, 80) || null,
        epic_display_name: normalizeString(row.epic_display_name, 80) || null,
        rl_platform: normalizeString(row.rl_platform, 40) || null,
        presence_shared: presenceShared,
        presence_state: presenceShared ? presenceState : null,
        presence_checked_at: presenceShared && presenceState !== null ? presenceCheckedAt : null,
        mmr: {
            captured_at: normalizeTimestamp(mmr.captured_at),
            ones_mmr: normalizeNumber(mmr.ones_mmr),
            twos_mmr: normalizeNumber(mmr.twos_mmr),
            threes_mmr: normalizeNumber(mmr.threes_mmr),
            ones_tier: normalizeString(mmr.ones_tier, 60) || null,
            twos_tier: normalizeString(mmr.twos_tier, 60) || null,
            threes_tier: normalizeString(mmr.threes_tier, 60) || null
        },
        provider: {
            display_username: normalizeString(provider.display_username, 80) || null
        },
        stats: {
            wins: normalizeNumber(stats.wins),
            goals: normalizeNumber(stats.goals),
            assists: normalizeNumber(stats.assists),
            saves: normalizeNumber(stats.saves),
            shots: normalizeNumber(stats.shots),
            mvps: normalizeNumber(stats.mvps)
        }
    };
}

function sanitizeSearchResult(value) {
    const profile = sanitizePublicProfile(value);
    if (!profile) return null;
    return {
        public_profile_id: profile.public_profile_id,
        display_name: profile.display_name,
        epic_display_name: profile.epic_display_name,
        rl_platform: profile.rl_platform,
        presence_shared: profile.presence_shared,
        presence_state: profile.presence_state,
        presence_checked_at: profile.presence_checked_at,
        mmr: profile.mmr
    };
}

async function callDiscoveryRpc(env, rpcName, parameters) {
    if (!ALLOWED_RPCS.has(rpcName)) {
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 500);
    }

    const supabaseUrl = typeof env?.SUPABASE_URL === "string"
        ? env.SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "")
        : "";
    const serviceRoleKey = typeof env?.SUPABASE_AUTH === "string"
        ? env.SUPABASE_AUTH.trim()
        : "";

    if (!supabaseUrl || !serviceRoleKey) {
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 503);
    }

    try {
        if (new URL(supabaseUrl).protocol !== "https:") {
            throw new Error("SUPABASE_URL_INVALID");
        }
    } catch {
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 503);
    }

    try {
        return await withUpstreamDeadline(async signal => {
            const response = await fetchBoundedResponse(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
                method: "POST",
                headers: {
                    apikey: serviceRoleKey,
                    Authorization: `Bearer ${serviceRoleKey}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Content-Profile": "api",
                    "Accept-Profile": "api"
                },
                body: JSON.stringify(parameters),
                signal
            });

            if (!response.ok) {
                console.error("Rocket League discovery RPC failed.", {
                    rpcName,
                    status: response.status
                });
                throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 503);
            }

            try {
                return await response.json();
            } catch {
                throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 502);
            }
        }, REQUEST_TIMEOUT_MS);
    } catch (error) {
        if (error instanceof RocketLeagueDiscoveryError) throw error;
        if (error?.name === "AbortError" || error?.code === "UPSTREAM_TIMEOUT") {
            throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 504);
        }
        console.error("Rocket League discovery RPC transport failed.", { rpcName });
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 503);
    }
}

export async function searchPublicRocketLeaguePlayers(env, query, limit = 20) {
    const result = await callDiscoveryRpc(env, RPC_NAMES.SEARCH, {
        p_query: query,
        p_limit: limit
    });
    const rows = Array.isArray(result) ? result : [];
    return rows.map(sanitizeSearchResult).filter(Boolean);
}

export async function getPublicRocketLeagueProfile(env, publicProfileId) {
    const result = await callDiscoveryRpc(env, RPC_NAMES.PUBLIC_PROFILE, {
        p_public_profile_id: publicProfileId
    });
    const row = Array.isArray(result) ? result[0] : result;
    return row ? sanitizePublicProfile(row) : null;
}

export async function getFeaturedRocketLeaguePlayer(env) {
    const result = await callDiscoveryRpc(env, RPC_NAMES.FEATURED, {});
    if (!result || typeof result !== "object" || Array.isArray(result)
        || !/^\d{4}-\d{2}-\d{2}$/.test(result.featuredDate)
        || !normalizeTimestamp(result.validUntil)
        || !(result.player === null || (typeof result.player === "object" && !Array.isArray(result.player)))) {
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 502);
    }
    return {
        featuredDate: result.featuredDate,
        validUntil: normalizeTimestamp(result.validUntil),
        player: result.player === null ? null : sanitizePublicProfile(result.player)
    };
}

export async function getRocketLeagueNetworkStatistics(env) {
    const result = await callDiscoveryRpc(env, RPC_NAMES.NETWORK, {});
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new RocketLeagueDiscoveryError("ROCKET_LEAGUE_DISCOVERY_UNAVAILABLE", 502);
    }
    const output = {};
    for (const key of ["playersOnline", "registeredPlayers", "activeSeasons", "upcomingEvents", "matchesPlayed", "scoreboardsSubmitted", "goalsRecorded"]) {
        output[key] = Number.isSafeInteger(result[key]) && result[key] >= 0 ? result[key] : null;
    }
    output.generatedAt = normalizeTimestamp(result.generatedAt);
    return output;
}

export const ROCKET_LEAGUE_DISCOVERY_RPCS = RPC_NAMES;
