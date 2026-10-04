"use strict";

import { verifyAccountProviderIdentity } from "../provider_identity.js";
import { isValidProviderRuntimeCallerSecret, PROVIDER_RUNTIME_TIMEOUT_MS, withAbortTimeout } from "./runtime_contract.js";

const FRESHNESS_MS = 60 * 60 * 1000;
const LOCK_TTL_SECONDS = 45;
const MEMBERSHIP_BATCH_SIZE = 400;
const INVENTORY_KEY = "discord:bot-guild-inventory:v1";
const INVENTORY_BACKOFF_KEY = "discord:bot-guild-inventory:retry-after:v1";
const ACCOUNT_CACHE_PREFIX = "discord:eligibility:v1:";
const SNOWFLAKE = /^\d{16,22}$/u;
const inFlight = new Map();

function fail(code) { return Object.assign(new Error(code), { code }); }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function cache(env) { return env?.RL_STATS_CACHE || env?.SERVICE_STATUS || null; }
function timestamp(value) {
    const normalized = text(value);
    if (!normalized || !Number.isFinite(Date.parse(normalized))) throw fail("DISCORD_TIMESTAMP_INVALID");
    return normalized;
}

function supabaseConfig(env) {
    const root = text(env?.SUPABASE_URL).replace(/\/+$/, "");
    const key = text(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH);
    if (!root || !key) throw fail("SUPABASE_CONFIGURATION_MISSING");
    return { root: /\/rest\/v1$/iu.test(root) ? `${root}/` : `${root}/rest/v1/`, key };
}

async function rpc(env, name, payload) {
    const allowed = new Set([
        "get_rl_discord_notification_state",
        "sync_discord_bot_guilds",
        "sync_account_discord_guilds"
    ]);
    if (!allowed.has(name)) throw fail("DISCORD_RPC_NOT_ALLOWED");
    const { root, key } = supabaseConfig(env);
    let response;
    try {
        response = await fetch(new URL(`rpc/${name}`, root), {
            method: "POST",
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: JSON.stringify(payload)
        });
    } catch { throw fail("DISCORD_PERSISTENCE_UNAVAILABLE"); }
    if (!response.ok) throw fail("DISCORD_PERSISTENCE_UNAVAILABLE");
    try { return await response.json(); }
    catch { throw fail("DISCORD_PERSISTENCE_RESPONSE_INVALID"); }
}

function one(value) { return Array.isArray(value) ? value[0] ?? null : value; }

function normalizeState(value) {
    const state = one(value);
    if (!state || typeof state !== "object" || Array.isArray(state)
        || typeof state.profileExists !== "boolean"
        || typeof state.eligible !== "boolean"
        || !Number.isSafeInteger(state.sharedGuildCount) || state.sharedGuildCount < 0) {
        throw fail("DISCORD_STATE_RESPONSE_INVALID");
    }
    const checkedAt = text(state.checkedAt || state.checked_at) || null;
    if (checkedAt && !Number.isFinite(Date.parse(checkedAt))) throw fail("DISCORD_STATE_RESPONSE_INVALID");
    return {
        profileExists: state.profileExists,
        discordNotificationsEnabled: state.discordNotificationsEnabled === true || state.discord_notifications_enabled === true,
        eligible: state.eligible,
        mutualGuildCount: state.sharedGuildCount,
        countComplete: Boolean(checkedAt) || state.profileExists === false,
        checkedAt,
        warningRequired: state.warningRequired === true || state.warning_required === true,
        warningConditionStartedAt: text(state.warningConditionStartedAt || state.warning_condition_started_at) || null,
        snoozedUntil: text(state.snoozedUntil || state.snoozed_until) || null,
        acknowledgedAt: text(state.acknowledgedAt || state.acknowledged_at) || null,
        eligibilityGeneration: state.eligibilityGeneration ?? state.eligibility_generation ?? null,
        acknowledgedGeneration: state.acknowledgedGeneration ?? state.acknowledged_generation ?? null
    };
}

function isFresh(checkedAt, now = Date.now()) {
    const time = Date.parse(checkedAt || "");
    return Number.isFinite(time) && now - time >= 0 && now - time < FRESHNESS_MS;
}

function safeAccountResult(state, status = "available", reason = null, eligibilityLost = false) {
    return {
        eligible: typeof state?.eligible === "boolean" ? state.eligible : null,
        status,
        reason,
        mutualGuildCount: Number.isSafeInteger(state?.mutualGuildCount) ? state.mutualGuildCount : null,
        countComplete: state?.countComplete === true,
        checkedAt: state?.checkedAt || null,
        warningRequired: state?.warningRequired === true,
        snoozedUntil: state?.snoozedUntil || null,
        eligibilityLost,
        stale: status === "unavailable" || status === "refreshing"
    };
}

function browserSafeFailureCode(code) {
    return code === "PROVIDER_RUNTIME_AUTH_UNAVAILABLE" || code === "PROVIDER_RUNTIME_CALLER_SECRET_INVALID"
        ? "DISCORD_PROVIDER_UNAVAILABLE"
        : code || "DISCORD_PROVIDER_UNAVAILABLE";
}

async function activeBackoff(env, key) {
    try {
        const until = Number(await cache(env)?.get?.(key));
        return Number.isFinite(until) && until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
    } catch { return 0; }
}

async function setBackoff(env, key, seconds) {
    const bounded = Number.isSafeInteger(seconds) ? Math.max(1, Math.min(86400, seconds)) : 0;
    if (!bounded) return;
    try { await cache(env)?.put?.(key, String(Date.now() + bounded * 1000), { expirationTtl: bounded }); }
    catch { /* The provider checkpoint still prevents falsely replacing eligibility. */ }
}

function validGuilds(response) {
    if (!response || response.success !== true || response.complete !== true || !Array.isArray(response.guilds)
        || response.count !== response.guilds.length) throw fail(text(response?.code) || "DISCORD_INVENTORY_INCOMPLETE");
    const ids = new Set();
    const guilds = response.guilds.map(guild => {
        if (!guild || typeof guild !== "object" || Array.isArray(guild)
            || typeof guild.id !== "string" || !SNOWFLAKE.test(guild.id)
            || typeof guild.name !== "string" || !guild.name.trim() || ids.has(guild.id)) {
            throw fail("DISCORD_INVENTORY_INVALID");
        }
        ids.add(guild.id);
        return { id: guild.id, name: guild.name.trim() };
    });
    return guilds;
}

function runtimeBinding(env) {
    if (!env?.PROVIDER_RUNTIME || typeof env.PROVIDER_RUNTIME.fetch !== "function") throw fail("PROVIDER_RUNTIME_UNAVAILABLE");
    const secret = env.PROVIDER_RUNTIME_CALLER_SECRET;
    if (!isValidProviderRuntimeCallerSecret(secret)) throw fail("PROVIDER_RUNTIME_AUTH_UNAVAILABLE");
    return { binding: env.PROVIDER_RUNTIME, secret };
}

async function runtimePost(env, path, body) {
    const { binding, secret } = runtimeBinding(env);
    let response = null;
    let result;
    try {
        ({ response, result } = await withAbortTimeout(async signal => {
            let workerResponse;
            try {
                workerResponse = await binding.fetch(new Request(`https://provider-runtime.internal${path}`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(body),
                    signal
                }));
            } catch (error) {
                if (signal.aborted) throw fail("PROVIDER_RUNTIME_TIMEOUT");
                throw error;
            }
            response = workerResponse;
            let payload;
            try { payload = await workerResponse.json(); }
            catch {
                if (signal.aborted) throw fail("PROVIDER_RUNTIME_TIMEOUT");
                throw fail("PROVIDER_RUNTIME_RESPONSE_INVALID");
            }
            return { response: workerResponse, result: payload };
        }, PROVIDER_RUNTIME_TIMEOUT_MS, () => response?.body?.cancel()));
    } catch (error) {
        if (error?.code === "PROVIDER_RUNTIME_TIMEOUT" || error?.code === "PROVIDER_RUNTIME_RESPONSE_INVALID") throw error;
        throw fail("PROVIDER_RUNTIME_UNAVAILABLE");
    }
    if (!response.ok || result?.success !== true || result?.status === "unavailable") {
        const code = text(result?.code);
        const error = fail(code === "PROVIDER_RUNTIME_CALLER_SECRET_INVALID"
            ? "PROVIDER_RUNTIME_AUTH_UNAVAILABLE"
            : code || "PROVIDER_RUNTIME_UNAVAILABLE");
        error.retryAfterSeconds = Number.isSafeInteger(result?.retryAfterSeconds) ? result.retryAfterSeconds : null;
        throw error;
    }
    return result;
}

async function readInventoryCache(env) {
    const kv = cache(env);
    if (!kv || typeof kv.get !== "function") return null;
    let value;
    try { value = await kv.get(INVENTORY_KEY, "json"); } catch { return null; }
    if (!value || value.complete !== true || !isFresh(value.checkedAt)) return null;
    try { return { guilds: validGuilds({ success: true, complete: true, guilds: value.guilds, count: value.guilds?.length }), checkedAt: value.checkedAt }; }
    catch { return null; }
}

async function acquireLock(env, key) {
    const kv = cache(env);
    if (inFlight.has(key)) return { acquired: false, promise: inFlight.get(key) };
    if (kv?.get && kv?.put) {
        try {
            if (await kv.get(key)) return { acquired: false, promise: null };
            await kv.put(key, "1", { expirationTtl: LOCK_TTL_SECONDS });
        } catch { /* In-isolate dedupe remains available when KV is transient. */ }
    }
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    inFlight.set(key, promise);
    return { acquired: true, release: async () => {
        inFlight.delete(key);
        release();
        try { await kv?.delete?.(key); } catch { /* TTL is the fallback. */ }
    } };
}

async function withLock(env, key, operation, fallback) {
    const lock = await acquireLock(env, key);
    if (!lock.acquired) {
        if (lock.promise) await lock.promise;
        return fallback();
    }
    try { return await operation(); }
    finally { await lock.release(); }
}

export async function refreshDiscordBotGuildInventory(env, { force = false } = {}) {
    const waitSeconds = await activeBackoff(env, INVENTORY_BACKOFF_KEY);
    if (waitSeconds) throw Object.assign(fail("DISCORD_RATE_LIMIT_BACKOFF"), { retryAfterSeconds: waitSeconds });
    if (!force) {
        const cached = await readInventoryCache(env);
        if (cached) return { ...cached, cached: true };
    }
    return withLock(env, "discord:bot-guild-inventory:refresh-lock:v1", async () => {
        if (!force) {
            const cached = await readInventoryCache(env);
            if (cached) return { ...cached, cached: true };
        }
        let response;
        try { response = await runtimePost(env, "/internal/discord/guild-inventory", {}); }
        catch (error) {
            await setBackoff(env, INVENTORY_BACKOFF_KEY, error?.retryAfterSeconds ?? 60);
            throw error;
        }
        const guilds = validGuilds(response);
        const checkedAt = timestamp(response.capturedAt || new Date().toISOString());
        const synced = one(await rpc(env, "sync_discord_bot_guilds", {
            p_guilds: guilds.map(({ id, name }) => ({ guild_id: id, guild_name: name })),
            p_checked_at: checkedAt
        }));
        if (synced?.success !== true) throw fail("DISCORD_INVENTORY_SYNC_FAILED");
        const snapshot = { complete: true, guilds, checkedAt: synced.checkedAt ? timestamp(synced.checkedAt) : checkedAt };
        try { await cache(env)?.put?.(INVENTORY_KEY, JSON.stringify(snapshot), { expirationTtl: 2 * 60 * 60 }); }
        catch { /* Complete result remains usable for the current request. */ }
        return { ...snapshot, cached: false };
    }, () => {
        throw fail("DISCORD_INVENTORY_REFRESH_IN_PROGRESS");
    });
}

async function resolveDiscordIdentity(env, accountId) {
    let identity;
    try { identity = await verifyAccountProviderIdentity(env, accountId, "discord"); }
    catch { throw fail("DISCORD_IDENTITY_UNAVAILABLE"); }
    if (!identity?.active || !SNOWFLAKE.test(text(identity.providerSubject))) throw fail("DISCORD_NOT_LINKED");
    return identity.providerSubject;
}

async function persistMembership(env, accountId, discordUserId, inventory) {
    if (!inventory?.guilds || !isFresh(inventory.checkedAt)) throw fail("DISCORD_INVENTORY_STALE");
    const activeGuildIds = new Set(inventory.guilds.map(guild => guild.id));
    const shared = new Set();
    const guildIds = [...activeGuildIds];
    const batches = guildIds.length
        ? Array.from({ length: Math.ceil(guildIds.length / MEMBERSHIP_BATCH_SIZE) }, (_, index) => guildIds.slice(index * MEMBERSHIP_BATCH_SIZE, (index + 1) * MEMBERSHIP_BATCH_SIZE))
        : [[]];
    let checkedAt = null;
    for (const batch of batches) {
        const result = await runtimePost(env, "/internal/discord/check-membership", { discordUserId, guildIds: batch });
        if (result.countComplete !== true || typeof result.eligible !== "boolean"
            || !Array.isArray(result.sharedGuildIds)
            || !Number.isSafeInteger(result.mutualGuildCount)
            || result.mutualGuildCount !== result.sharedGuildIds.length) throw fail("DISCORD_MEMBERSHIP_RESPONSE_INVALID");
        const batchGuildIds = new Set(batch);
        const batchShared = new Set();
        for (const id of result.sharedGuildIds) {
            if (typeof id !== "string" || !SNOWFLAKE.test(id) || !batchGuildIds.has(id) || !activeGuildIds.has(id) || shared.has(id) || batchShared.has(id)) throw fail("DISCORD_MEMBERSHIP_RESPONSE_INVALID");
            shared.add(id);
            batchShared.add(id);
        }
        if (result.eligible !== (batchShared.size > 0)) throw fail("DISCORD_MEMBERSHIP_RESPONSE_INVALID");
        checkedAt = timestamp(result.checkedAt || new Date().toISOString());
    }
    const eligible = shared.size > 0;
    const synced = one(await rpc(env, "sync_account_discord_guilds", {
        p_account_id: accountId,
        p_guild_ids: [...shared],
        p_checked_at: checkedAt
    }));
    if (synced?.success !== true || typeof synced.eligible !== "boolean"
        || synced.eligible !== eligible
        || synced.sharedGuildCount !== shared.size) {
        throw fail("DISCORD_ACCOUNT_SYNC_FAILED");
    }
    let state;
    try { state = normalizeState(await rpc(env, "get_rl_discord_notification_state", { p_account_id: accountId })); }
    catch (error) {
        if (error?.code !== "DISCORD_STATE_RESPONSE_INVALID") throw error;
        state = null;
    }
    const persisted = state?.profileExists ? state : {
        profileExists: false,
        eligible: synced.eligible,
        mutualGuildCount: synced.sharedGuildCount,
        countComplete: true,
        checkedAt: synced.checkedAt ? timestamp(synced.checkedAt) : checkedAt,
        warningRequired: false,
        snoozedUntil: null
    };
    const kv = cache(env);
    try {
        if (kv?.put) await kv.put(`${ACCOUNT_CACHE_PREFIX}${accountId}`, JSON.stringify(persisted), { expirationTtl: 2 * 60 * 60 });
    } catch { /* Supabase remains authoritative when profile state exists. */ }
    return persisted;
}

export async function refreshDiscordAccountEligibility(env, accountId, { inventory = null } = {}) {
    const retryKey = `${ACCOUNT_CACHE_PREFIX}${accountId}:retry-after`;
    const waitSeconds = await activeBackoff(env, retryKey);
    if (waitSeconds) throw Object.assign(fail("DISCORD_RATE_LIMIT_BACKOFF"), { retryAfterSeconds: waitSeconds });
    const discordUserId = await resolveDiscordIdentity(env, accountId);
    const completeInventory = inventory || await refreshDiscordBotGuildInventory(env);
    try { return await persistMembership(env, accountId, discordUserId, completeInventory); }
    catch (error) {
        await setBackoff(env, retryKey, error?.retryAfterSeconds ?? 60);
        throw error;
    }
}

async function readPriorState(env, accountId) {
    let state = null;
    try { state = normalizeState(await rpc(env, "get_rl_discord_notification_state", { p_account_id: accountId })); }
    catch (error) {
        if (error?.code !== "DISCORD_STATE_RESPONSE_INVALID") throw error;
    }
    if (state?.profileExists) return state;
    try {
        const cached = await cache(env)?.get?.(`${ACCOUNT_CACHE_PREFIX}${accountId}`, "json");
        if (cached && typeof cached === "object" && isFresh(cached.checkedAt)) return cached;
    } catch { /* No-profile state may simply be unknown. */ }
    return state;
}

export async function getDiscordMatchBotEligibility(env, accountId, { force = false } = {}) {
    if (!text(accountId)) return safeAccountResult(null, "unavailable", "ACCOUNT_REQUIRED");
    let prior;
    try { prior = await readPriorState(env, accountId); }
    catch { return safeAccountResult(null, "unavailable", "DISCORD_STATE_UNAVAILABLE"); }
    if (!force && prior?.checkedAt && isFresh(prior.checkedAt)) return safeAccountResult(prior, "available");
    if (!force && prior?.profileExists === false && prior?.checkedAt && isFresh(prior.checkedAt)) return safeAccountResult(prior, "available");

    const backoff = await activeBackoff(env, `${ACCOUNT_CACHE_PREFIX}${accountId}:retry-after`)
        || await activeBackoff(env, INVENTORY_BACKOFF_KEY);
    if (backoff) return { ...safeAccountResult(prior, "unavailable", "DISCORD_RATE_LIMIT_BACKOFF"), retryAfterSeconds: backoff };

    return withLock(env, `${ACCOUNT_CACHE_PREFIX}${accountId}:refresh-lock`, async () => {
        try {
            const inventory = await refreshDiscordBotGuildInventory(env);
            const refreshed = await refreshDiscordAccountEligibility(env, accountId, { inventory });
            return safeAccountResult(refreshed, "available", null, prior?.eligible === true && refreshed?.eligible === false);
        } catch (error) {
            const retryAfterSeconds = error?.retryAfterSeconds ?? 60;
            await setBackoff(env, `${ACCOUNT_CACHE_PREFIX}${accountId}:retry-after`, retryAfterSeconds);
            return { ...safeAccountResult(prior, "unavailable", browserSafeFailureCode(error?.code)), retryAfterSeconds };
        }
    }, async () => {
        try {
            const latest = await readPriorState(env, accountId);
            if (latest?.checkedAt && isFresh(latest.checkedAt)) return safeAccountResult(latest, "available");
        } catch { /* Preserve the prior state as stale below. */ }
        return safeAccountResult(prior, "refreshing", "DISCORD_REFRESH_IN_PROGRESS");
    });
}
