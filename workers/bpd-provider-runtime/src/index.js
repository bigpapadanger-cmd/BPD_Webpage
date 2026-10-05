export { UserRocketLeagueSession } from "./rl_user_session.js";
export { RlProbeSecurityAuthority } from "./rl_probe_authority.js";
export { DiscordLinkedRoleNonceAuthority } from "./discord_linked_role_nonce.js";
import { fetchBoundedResponse } from "../../../functions/services/http/upstream.js";

const API = "https://discord.com/api/v10";
const PAGE_SIZE = 200;
const MAX_PAGES_PER_SHARD = 1000;
const MAX_GUILDS = 200000;
const MAX_BODY_BYTES = 32768;
const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_CLEANUP_TIMEOUT_MS = 1000;
const CALLER_SECRET_MIN_LENGTH = 64;
const CALLER_SECRET_MAX_LENGTH = 256;
const MEMBERSHIP_CONCURRENCY = 3;
const SNOWFLAKE = /^\d{16,22}$/u;

function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFailure(code, status = 503, retryAfterSeconds = null) {
    return json({ success: false, status: "unavailable", code, retryAfterSeconds }, status);
}

function equalSecret(expected, actual) {
    if (!expected || !actual || expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
        difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
    }
    return difference === 0;
}

function validCallerSecret(secret) {
    return typeof secret === "string"
        && secret.length >= CALLER_SECRET_MIN_LENGTH
        && secret.length <= CALLER_SECRET_MAX_LENGTH
        && secret.trim() === secret
        && !/\s/u.test(secret);
}

function authorizationFailure(request, env) {
    const expected = typeof env?.PROVIDER_RUNTIME_CALLER_SECRET === "string"
        ? env.PROVIDER_RUNTIME_CALLER_SECRET
        : "";
    if (!validCallerSecret(expected)) return "configuration";
    const actual = request.headers.get("Authorization") || "";
    return equalSecret(`Bearer ${expected}`, actual) ? null : "caller";
}

function authorizationResponse(request, env) {
    const failure = authorizationFailure(request, env);
    if (!failure) return null;
    if (env?.DISCORD_ELIGIBILITY_DIAGNOSTICS === "true") console.info("DISCORD PROVIDER DIAGNOSTIC", {
        stage: "internal_authorization", providerResultCode: failure === "configuration"
            ? "PROVIDER_RUNTIME_CALLER_SECRET_INVALID" : "INTERNAL_AUTH_REQUIRED"
    });
    return failure === "configuration"
        ? safeFailure("PROVIDER_RUNTIME_CALLER_SECRET_INVALID")
        : json({ success: false, code: "INTERNAL_AUTH_REQUIRED" }, 401);
}

function retryAfterSeconds(response, body) {
    const raw = response.headers.get("Retry-After") ?? body?.retry_after;
    if (raw === null || raw === undefined || raw === "") return null;
    const numeric = Number(raw);
    const value = Number.isFinite(numeric) ? numeric : (Date.parse(raw) - Date.now()) / 1000;
    return Number.isFinite(value) && value >= 0 ? Math.min(86400, Math.ceil(value)) : null;
}

function errorCode(body) {
    const value = body?.code;
    return Number.isInteger(value) ? value : null;
}

async function discordRequest(env, path) {
    const token = typeof env?.DISCORD_MATCHBOT_TOKEN === "string" ? env.DISCORD_MATCHBOT_TOKEN.trim() : "";
    if (!token) throw Object.assign(new Error("config"), { kind: "config" });
    const controller = new AbortController();
    let response = null;
    let timer;
    let cleanupTimer;
    let timedOut = false;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const operation = async () => {
        response = await fetchBoundedResponse(`${API}${path}`, {
            method: "GET",
            headers: { Authorization: `Bot ${token}`, Accept: "application/json" },
            redirect: "manual",
            signal: controller.signal
        });
        let body = null;
        try { body = await response.json(); }
        catch {
            if (controller.signal.aborted) throw Object.assign(new Error("timeout"), { kind: "timeout" });
            if (response.ok) throw Object.assign(new Error("malformed"), { kind: "malformed" });
        }
        if (!response.ok) {
            const status = response.status;
            const code = errorCode(body);
            if (env?.DISCORD_ELIGIBILITY_DIAGNOSTICS === "true") console.info("DISCORD PROVIDER DIAGNOSTIC", {
                stage: path.startsWith("/guilds/") ? "membership" : "guild_inventory",
                responseStatus: status, providerResultCode: status === 404 && code === 10007
                    ? "DISCORD_UNKNOWN_MEMBER" : status === 404 && code === 10004
                        ? "DISCORD_GUILD_UNAVAILABLE" : "DISCORD_PROVIDER_UNAVAILABLE"
            });
            if (status === 404 && code === 10007) throw Object.assign(new Error("not_member"), { kind: "not_member" });
            if (status === 429) throw Object.assign(new Error("rate_limited"), {
                kind: "rate_limited", retryAfterSeconds: retryAfterSeconds(response, body)
            });
            if (status === 404 && code === 10004) throw Object.assign(new Error("guild_unavailable"), { kind: "guild_unavailable" });
            throw Object.assign(new Error("provider"), { kind: "provider" });
        }
        return body;
    };
    const operationPromise = operation();
    const guardedOperation = operationPromise.then(
        result => timedOut ? timeout : result,
        error => timedOut ? timeout : Promise.reject(error)
    );
    timer = setTimeout(async () => {
        timedOut = true;
        controller.abort();
        try {
            await Promise.race([
                Promise.resolve().then(() => response?.body?.cancel()).catch(() => {}),
                new Promise(resolve => { cleanupTimer = setTimeout(resolve, REQUEST_CLEANUP_TIMEOUT_MS); })
            ]);
        } catch { /* Best-effort cancellation. */ }
        finally { clearTimeout(cleanupTimer); }
        rejectTimeout(Object.assign(new Error("timeout"), { kind: "timeout" }));
    }, REQUEST_TIMEOUT_MS);
    try {
        return await Promise.race([guardedOperation, timeout]);
    } catch (error) {
        if (error?.kind) throw error;
        throw Object.assign(new Error("network"), { kind: controller.signal.aborted || error?.name === "AbortError" || error?.code === "UPSTREAM_TIMEOUT" ? "timeout" : "network" });
    } finally {
        clearTimeout(timer);
    }
}

function strictGuild(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)
        || typeof row.id !== "string" || !SNOWFLAKE.test(row.id)
        || typeof row.name !== "string" || !row.name.trim()) {
        throw Object.assign(new Error("inventory_invalid"), { kind: "inventory_invalid" });
    }
    return { id: row.id, name: row.name.trim() };
}

async function listShardGuilds(env, shard) {
    const guilds = new Map();
    let after = null;
    let previousId = null;
    for (let page = 0; page < MAX_PAGES_PER_SHARD; page += 1) {
        const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (shard !== null) query.set("shard", String(shard));
        if (after) query.set("after", after);
        const response = await discordRequest(env, `/users/@me/guilds?${query}`);
        if (!Array.isArray(response)) throw Object.assign(new Error("inventory_invalid"), { kind: "inventory_invalid" });
        const pageGuilds = response.map(strictGuild);
        if (pageGuilds.length > PAGE_SIZE) throw Object.assign(new Error("inventory_invalid"), { kind: "inventory_invalid" });
        for (const guild of pageGuilds) {
            if (previousId !== null && BigInt(guild.id) <= BigInt(previousId)) {
                throw Object.assign(new Error("inventory_incomplete"), { kind: "inventory_incomplete" });
            }
            const previous = guilds.get(guild.id);
            if (previous && previous.name !== guild.name) throw Object.assign(new Error("inventory_invalid"), { kind: "inventory_invalid" });
            guilds.set(guild.id, guild);
            previousId = guild.id;
        }
        if (guilds.size > MAX_GUILDS) throw Object.assign(new Error("inventory_incomplete"), { kind: "inventory_incomplete" });
        if (pageGuilds.length < PAGE_SIZE) return [...guilds.values()];
        const nextAfter = pageGuilds.at(-1)?.id;
        if (!nextAfter || nextAfter === after) throw Object.assign(new Error("inventory_incomplete"), { kind: "inventory_incomplete" });
        after = nextAfter;
    }
    throw Object.assign(new Error("inventory_incomplete"), { kind: "inventory_incomplete" });
}

async function completeGuildInventory(env) {
    const largeSharding = env?.DISCORD_LARGE_BOT_SHARDING;
    if (largeSharding !== "true" && largeSharding !== "false") {
        throw Object.assign(new Error("sharding_config"), { kind: "sharding_config" });
    }
    if (largeSharding === "false") return listShardGuilds(env, null);

    const gateway = await discordRequest(env, "/gateway/bot");
    const shardCount = gateway?.session_start_limit?.max_concurrency;
    if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 1000) {
        throw Object.assign(new Error("sharding_config"), { kind: "sharding_config" });
    }
    const merged = new Map();
    // Keep inventory requests sequential so a large-bot sweep does not burst
    // Discord's shared/global REST buckets.
    for (let shard = 0; shard < shardCount; shard += 1) {
        const shardGuilds = await listShardGuilds(env, shard);
        for (const guild of shardGuilds) {
            const previous = merged.get(guild.id);
            if (previous && previous.name !== guild.name) throw Object.assign(new Error("inventory_invalid"), { kind: "inventory_invalid" });
            merged.set(guild.id, guild);
        }
    }
    if (merged.size > MAX_GUILDS) throw Object.assign(new Error("inventory_incomplete"), { kind: "inventory_incomplete" });
    return [...merged.values()];
}

async function parseBody(request) {
    const declared = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    try { return JSON.parse(text); } catch { return null; }
}

function hasExactKeys(body, keys) {
    return body && typeof body === "object" && !Array.isArray(body)
        && Object.keys(body).length === keys.length
        && keys.every(key => Object.hasOwn(body, key));
}

function mapFailure(error) {
    const map = {
        config: "PROVIDER_CONFIGURATION_UNAVAILABLE",
        network: "DISCORD_NETWORK_UNAVAILABLE",
        timeout: "DISCORD_REQUEST_TIMEOUT",
        malformed: "DISCORD_RESPONSE_INVALID",
        provider: "DISCORD_PROVIDER_UNAVAILABLE",
        rate_limited: "DISCORD_RATE_LIMITED",
        guild_unavailable: "DISCORD_GUILD_UNAVAILABLE",
        inventory_invalid: "DISCORD_GUILD_INVENTORY_INVALID",
        inventory_incomplete: "DISCORD_GUILD_INVENTORY_INCOMPLETE",
        sharding_config: "DISCORD_SHARDING_CONFIGURATION_REQUIRED"
    };
    return { code: map[error?.kind] || "DISCORD_PROVIDER_UNAVAILABLE", retryAfterSeconds: error?.retryAfterSeconds ?? null };
}

async function inventoryRoute(request, env) {
    const body = await parseBody(request);
    if (!hasExactKeys(body, [])) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
    try {
        const guilds = await completeGuildInventory(env);
        if (env?.DISCORD_ELIGIBILITY_DIAGNOSTICS === "true") console.info("DISCORD PROVIDER DIAGNOSTIC", {
            stage: "guild_inventory", botGuildInventoryCount: guilds.length,
            inventoryComplete: true, providerResultCode: "OK", checkedAt: new Date().toISOString()
        });
        return json({ success: true, complete: true, guilds, count: guilds.length, capturedAt: new Date().toISOString() });
    } catch (error) {
        const failure = mapFailure(error);
        if (env?.DISCORD_ELIGIBILITY_DIAGNOSTICS === "true") console.info("DISCORD PROVIDER DIAGNOSTIC", {
            stage: "guild_inventory", inventoryComplete: false, providerResultCode: failure.code
        });
        return safeFailure(failure.code, 503, failure.retryAfterSeconds);
    }
}

async function memberRoute(request, env) {
    const body = await parseBody(request);
    if (!hasExactKeys(body, ["guildIds", "discordUserId"]) || !SNOWFLAKE.test(body.discordUserId)
        || !Array.isArray(body.guildIds) || body.guildIds.length > MAX_GUILDS
        || body.guildIds.some(id => typeof id !== "string" || !SNOWFLAKE.test(id))) {
        return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
    }
    const guildIds = [...new Set(body.guildIds)];
    const counts = { next: 0, attempted: 0, mutualGuildCount: 0 };
    const sharedGuildIds = [];
    let failure = null;
    async function checkLoop() {
        while (!failure) {
            const index = counts.next++;
            if (index >= guildIds.length) return;
            counts.attempted += 1;
            try {
                const member = await discordRequest(env, `/guilds/${guildIds[index]}/members/${body.discordUserId}`);
                if (!member || typeof member !== "object" || Array.isArray(member)
                    || member.user?.id !== body.discordUserId || !Array.isArray(member.roles)) {
                    throw Object.assign(new Error("malformed"), { kind: "malformed" });
                }
                counts.mutualGuildCount += 1;
                sharedGuildIds.push(guildIds[index]);
            } catch (error) {
                if (error?.kind === "not_member") continue;
                failure ||= error;
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(MEMBERSHIP_CONCURRENCY, guildIds.length) }, checkLoop));
    if (env?.DISCORD_ELIGIBILITY_DIAGNOSTICS === "true") console.info("DISCORD PROVIDER DIAGNOSTIC", {
        stage: "membership", membershipChecksAttempted: counts.attempted,
        sharedGuildCount: counts.mutualGuildCount,
        ...(failure ? {} : { eligible: counts.mutualGuildCount > 0 }),
        providerResultCode: failure ? mapFailure(failure).code : "OK", checkedAt: new Date().toISOString()
    });
    if (failure) {
        const result = mapFailure(failure);
        return safeFailure(result.code, 503, result.retryAfterSeconds);
    }
    return json({ success: true, status: "available", eligible: counts.mutualGuildCount > 0,
        mutualGuildCount: counts.mutualGuildCount, membershipChecksAttempted: counts.attempted,
        sharedGuildIds, countComplete: true, checkedAt: new Date().toISOString() });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (["create", "begin", "consume"].some(action => url.pathname === `/internal/discord/linked-roles/nonce/${action}`)) {
            const auth = authorizationResponse(request, env);
            if (auth) return auth;
            if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
            const body = await parseBody(request);
            const nonceAction = url.pathname.split("/").at(-1);
            const nonceKeys = ["nonce", "accountBinding", "discordBinding", "action"];
            if (nonceAction === "create") nonceKeys.push("expiresAt");
            if (!hasExactKeys(body, nonceKeys)
                || typeof body.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(body.nonce)
                || typeof body.accountBinding !== "string" || !/^[a-f0-9]{64}$/u.test(body.accountBinding)
                || typeof body.discordBinding !== "string" || !/^[a-f0-9]{64}$/u.test(body.discordBinding)
                || body.action !== "discord_linked_roles_verify" || (nonceAction === "create" && !Number.isSafeInteger(body.expiresAt))) {
                return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            }
            if (!env.DISCORD_LINKED_ROLE_NONCE?.idFromName) return safeFailure("DISCORD_NONCE_UNAVAILABLE");
            const id = env.DISCORD_LINKED_ROLE_NONCE.idFromName(body.nonce);
            try {
                return await env.DISCORD_LINKED_ROLE_NONCE.get(id).fetch(new Request(`https://discord-nonce.internal/${url.pathname.split("/").at(-1)}`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
                }));
            } catch { return safeFailure("DISCORD_NONCE_UNAVAILABLE"); }
        }
        if (["/internal/rl-probe/epoch/read", "/internal/rl-probe/epoch/bump"].includes(url.pathname)) {
            const bump = url.pathname.endsWith("/bump");
            const auth = authorizationResponse(request, bump
                ? { PROVIDER_RUNTIME_CALLER_SECRET: env.RL_PROBE_REVOCATION_SECRET } : env);
            if (auth) return auth;
            if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
            if (env.RL_PROBE_SECURITY_ENABLED !== "true" || !env.RL_PROBE_SECURITY) return safeFailure("RL_PROBE_DISABLED");
            const body = await parseBody(request);
            if (!hasExactKeys(body, [])) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            const id = env.RL_PROBE_SECURITY.idFromName("global-revocation-authority-v1");
            return env.RL_PROBE_SECURITY.get(id).fetch(new Request(`https://rl-security.internal/${bump ? "bump" : "read"}`, { method: "POST", body: "{}" }));
        }
        if (["bootstrap", "invalidate", "consume", "begin", "claim", "prepare", "execute"].some(operation => url.pathname === `/internal/rl-probe/${operation}`)) {
            const auth = authorizationResponse(request, env);
            if (auth) return auth;
            if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
            if (env.RL_PROBE_SECURITY_ENABLED !== "true" || !env.RL_USER_SESSION) return safeFailure("RL_PROBE_DISABLED");
            const body = await parseBody(request);
            if (!body || typeof body.accountKey !== "string" || !/^[a-f0-9]{64}$/u.test(body.accountKey)) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            const id = env.RL_USER_SESSION.idFromName(body.accountKey);
            return env.RL_USER_SESSION.get(id).fetch(new Request(`https://rl-probe.internal${url.pathname}`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
            }));
        }
        if (url.pathname === "/internal/health") {
            if (request.method !== "GET") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
            const auth = authorizationResponse(request, env);
            if (auth) return auth;
            return json({ success: true, service: "bpd-provider-runtime", status: "ok", timestamp: new Date().toISOString() });
        }
        if (url.pathname === "/internal/discord/bot-health") {
            if (request.method !== "GET") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
            const auth = authorizationResponse(request, env);
            if (auth) return auth;
            if (url.search) return json({ success: false, code: "INVALID_INPUT" }, 400);
            try {
                const user = await discordRequest(env, "/users/@me");
                if (!user || typeof user.id !== "string" || !SNOWFLAKE.test(user.id) || user.bot !== true) {
                    return safeFailure("DISCORD_BOT_RESPONSE_INVALID");
                }
                return json({ success: true, botAuthenticated: true, checkedAt: new Date().toISOString() });
            } catch (error) {
                return safeFailure(error?.kind === "rate_limited" ? "DISCORD_BOT_RATE_LIMITED"
                    : error?.kind === "timeout" ? "DISCORD_BOT_TIMEOUT" : "DISCORD_BOT_UNAVAILABLE", 503, error?.retryAfterSeconds);
            }
        }
        if (request.method !== "POST" || !["/internal/discord/guild-inventory", "/internal/discord/check-membership"].includes(url.pathname)) {
            return json({ success: false, code: "NOT_FOUND" }, 404);
        }
        const auth = authorizationResponse(request, env);
        if (auth) return auth;
        if (url.pathname === "/internal/discord/guild-inventory") return inventoryRoute(request, env);
        return memberRoute(request, env);
    }
};
