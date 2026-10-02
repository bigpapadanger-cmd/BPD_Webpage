"use strict";

import { verifyBackgroundEpicAccount } from "../authorization.js";
import { getStatsRefreshState } from "../stats/refresh_state.js";
import { fetchMmrProviderData } from "../stats/fetch_mmr.js";

const SUCCESS_TTL_SECONDS = 24 * 60 * 60;
const RETRY_TTL_SECONDS = 15 * 60;
const PERSIST_TIMEOUT_MS = 10000;
const inFlight = new Map();

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isNonNegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function makeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function getSupabaseConfiguration(env) {
    const baseUrl = cleanString(env?.SUPABASE_URL).replace(/\/+$/, "");
    const apiKey = cleanString(env?.SUPABASE_AUTH);
    if (!baseUrl || !apiKey) throw makeError("SUPABASE_CONFIGURATION_MISSING");
    return {
        baseUrl: /\/rest\/v1$/i.test(baseUrl) ? `${baseUrl}/` : `${baseUrl}/rest/v1/`,
        apiKey
    };
}

function normalizeStats(data) {
    const fields = ["wins", "goals", "assists", "saves", "shots", "mvps"];
    if (!data || fields.some(field => !isNonNegativeSafeInteger(data[field]))) return null;
    return Object.fromEntries(fields.map(field => [field, data[field]]));
}

function normalizeProfile(data) {
    // The Worker currently guarantees only the display username. The live RPC
    // contract preserves stored values with COALESCE for these unsupported nulls.
    if (!data || !cleanString(data.display_username)) return null;
    return {
        display_username: cleanString(data.display_username),
        level: isNonNegativeSafeInteger(data.level) ? data.level : null,
        xp: isNonNegativeSafeInteger(data.xp) ? data.xp : null,
        creator_code: typeof data.creator_code === "string" ? cleanString(data.creator_code) || null : null,
        provider_updated_at: typeof data.provider_updated_at === "string" && data.provider_updated_at.trim()
            ? data.provider_updated_at.trim()
            : null
    };
}

async function callRpc(env, rpcName, payload) {
    const configuration = getSupabaseConfiguration(env);
    const url = new URL(`rpc/${rpcName}`, configuration.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PERSIST_TIMEOUT_MS);
    try {
        const response = await fetch(url.href, {
            method: "POST",
            headers: {
                apikey: configuration.apiKey,
                Authorization: `Bearer ${configuration.apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok) throw makeError(`PROVIDER_PERSIST_${rpcName.toUpperCase()}_FAILED`);
        return true;
    } catch {
        throw makeError(`PROVIDER_PERSIST_${rpcName.toUpperCase()}_FAILED`);
    } finally {
        clearTimeout(timeout);
    }
}

export async function fetchProviderCapabilities(env, epicAccountId) {
    return fetchMmrProviderData(env, epicAccountId, ["profile", "stats"]);
}

export async function persistProviderCapabilities(env, accountId, capabilities) {
    const results = {
        skills: { status: "persisted" },
        history: { status: "unsupported" }
    };
    const profile = capabilities?.profile;
    if (profile?.status === "success") {
        const data = normalizeProfile(profile.data);
        if (!data) {
            results.profile = { status: "partial_not_persisted" };
        } else {
            try {
                await callRpc(env, "save_rl_player_provider_profile", {
                    p_account_id: accountId,
                    p_display_username: data.display_username,
                    p_level: data.level,
                    p_xp: data.xp,
                    p_creator_code: data.creator_code,
                    p_provider_updated_at: data.provider_updated_at
                });
                results.profile = {
                    status: "persisted",
                    capturedAt: typeof profile.captured_at === "string" ? profile.captured_at : null,
                    providerUpdatedAt: data.provider_updated_at
                };
            } catch {
                results.profile = { status: "persistence_failed" };
            }
        }
    } else {
        results.profile = { status: profile?.status || "unavailable" };
    }

    const stats = capabilities?.stats;
    if (stats?.status === "success") {
        const data = normalizeStats(stats.data);
        if (!data) {
            results.stats = { status: "invalid_not_persisted" };
        } else {
            try {
                await callRpc(env, "save_rl_player_stats", {
                    p_account_id: accountId,
                    p_wins: data.wins,
                    p_goals: data.goals,
                    p_assists: data.assists,
                    p_saves: data.saves,
                    p_shots: data.shots,
                    p_mvps: data.mvps,
                    p_captured_at: typeof stats.captured_at === "string" ? stats.captured_at : null
                });
                results.stats = { status: "persisted", capturedAt: typeof stats.captured_at === "string" ? stats.captured_at : null };
            } catch {
                results.stats = { status: "persistence_failed" };
            }
        }
    } else {
        results.stats = { status: stats?.status || "unavailable" };
    }

    return results;
}

async function refreshProviderData(env, accountId) {
    const state = await getStatsRefreshState(env, accountId);
    if (!state || state.active !== true || !state.rlPlayerId || !state.epicAccountId) {
        return { refreshed: false, reason: "ROCKET_LEAGUE_PROFILE_NOT_ELIGIBLE" };
    }
    if (!await verifyBackgroundEpicAccount(env, accountId, state.epicAccountId)) {
        return { refreshed: false, reason: "EPIC_REAUTHORIZATION_REQUIRED" };
    }
    const capabilities = await fetchProviderCapabilities(env, state.epicAccountId);
    const persisted = await persistProviderCapabilities(env, accountId, capabilities);
    return { refreshed: true, persisted };
}

// Admin-triggered refresh shares the exact authorization, Worker, and persistence
// path, but deliberately does not consult or mutate the normal freshness gate.
export async function refreshProviderDataForced(env, accountId) {
    const normalizedAccountId = cleanString(accountId);
    if (!normalizedAccountId) return { refreshed: false, reason: "ACCOUNT_ID_REQUIRED" };
    const key = `rl-provider-data-refresh:${normalizedAccountId}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = refreshProviderData(env, normalizedAccountId).finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
}

export async function refreshProviderDataWithGate(env, accountId, mmrRefresh) {
    const normalizedAccountId = cleanString(accountId);
    if (!normalizedAccountId) return { refreshed: false, reason: "ACCOUNT_ID_REQUIRED" };
    const capabilityStatuses = {
        skills: { status: mmrRefresh?.refreshed === true ? "persisted" : "not_refreshed" },
        profile: { status: "not_requested" },
        stats: { status: "not_requested" },
        history: { status: "unsupported" }
    };
    // Six provider calls are only made when the established MMR refresh gate
    // allowed and completed a refresh. Profile saves and ordinary reads do not
    // bypass that existing cadence.
    if (mmrRefresh?.refreshed !== true) {
        return { refreshed: false, reason: "MMR_REFRESH_NOT_RUN", persisted: capabilityStatuses };
    }
    const kv = env?.RL_STATS_CACHE;
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
        return { refreshed: false, reason: "PROVIDER_REFRESH_GATE_UNAVAILABLE" };
    }
    const key = `rl-provider-data-refresh:${normalizedAccountId}`;
    try {
        if (await kv.get(key)) return {
            refreshed: false,
            gated: true,
            reason: "KV_GATE_ACTIVE",
            persisted: {
                ...capabilityStatuses,
                profile: { status: "gated" },
                stats: { status: "gated" }
            }
        };
    } catch {
        return { refreshed: false, reason: "PROVIDER_REFRESH_GATE_UNAVAILABLE", persisted: capabilityStatuses };
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const task = (async () => {
        // Reserve before network work to reduce duplicate provider traffic. Failures
        // receive a short retry window; a successful response gets the normal day gate.
        try {
            await kv.put(key, "in_progress", { expirationTtl: RETRY_TTL_SECONDS });
        } catch {
            return { refreshed: false, reason: "PROVIDER_REFRESH_GATE_UNAVAILABLE", persisted: capabilityStatuses };
        }
        try {
            const result = await refreshProviderData(env, normalizedAccountId);
            const ttl = result.refreshed ? SUCCESS_TTL_SECONDS : RETRY_TTL_SECONDS;
            await kv.put(key, JSON.stringify({ refreshedAt: new Date().toISOString() }), { expirationTtl: ttl });
            const hasCapabilityFailure = Object.values(result.persisted || {}).some(item =>
                ["error", "persistence_failed", "invalid_not_persisted"].includes(item?.status)
            );
            if (hasCapabilityFailure) {
                await kv.put(key, JSON.stringify({ refreshedAt: new Date().toISOString() }), { expirationTtl: RETRY_TTL_SECONDS });
            }
            return result;
        } catch (error) {
            try {
                await kv.put(key, JSON.stringify({ failedAt: new Date().toISOString() }), { expirationTtl: RETRY_TTL_SECONDS });
            } catch { /* Best effort; provider failures remain isolated from login. */ }
            return {
                refreshed: false,
                reason: error?.code || "PROVIDER_REFRESH_FAILED",
                persisted: {
                    ...capabilityStatuses,
                    profile: { status: "error", code: error?.code || "PROVIDER_REFRESH_FAILED" },
                    stats: { status: "error", code: error?.code || "PROVIDER_REFRESH_FAILED" }
                }
            };
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, task);
    return task;
}
