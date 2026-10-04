import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDiscordMatchBotEligibility, refreshDiscordBotGuildInventory } from "../../functions/services/auth/providers/discord_matchbot/eligibility.js";
import { isValidProviderRuntimeCallerSecret, PROVIDER_RUNTIME_TIMEOUT_MS, withAbortTimeout } from "../../functions/services/auth/providers/discord_matchbot/runtime_contract.js";
import { canEnableDiscordNotifications } from "../../functions/services/rl/profile.js";

const accountId = "account-private-123";
const discordId = "900000000000000001";
const guildId = "900000000000000002";
const secret = "p".repeat(64);
const now = new Date().toISOString();
const freshState = { profileExists: true, discordNotificationsEnabled: true, eligible: true, sharedGuildCount: 1, checkedAt: now, warningRequired: false, snoozedUntil: null };

function kvStore() {
    const data = new Map();
    return {
        async get(key, type) { const value = data.get(key); return type === "json" && typeof value === "string" ? JSON.parse(value) : value ?? null; },
        async put(key, value) { data.set(key, value); },
        async delete(key) { data.delete(key); }
    };
}

function runtime(fetcher) {
    return { async fetch(request) { return fetcher(new URL(request.url), request); } };
}

async function withFetch(mock, fn) {
    const old = globalThis.fetch;
    globalThis.fetch = mock;
    try { return await fn(); } finally { globalThis.fetch = old; }
}

function identity() {
    return Response.json([{ account_id: accountId, provider: "discord", provider_subject: discordId, active: true }]);
}

test("fresh persisted state is returned without Worker or identity calls", async () => {
    let calls = 0;
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME: runtime(async () => { throw new Error("fresh state must not call Worker"); }), PROVIDER_RUNTIME_CALLER_SECRET: secret };
    await withFetch(async () => { calls++; return Response.json(freshState); }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId);
        assert.equal(result.eligible, true);
        assert.equal(result.status, "available");
        assert.equal(calls, 1);
    });
});

test("provider-runtime caller secret contract accepts strong encodings and rejects malformed values", () => {
    assert.equal(isValidProviderRuntimeCallerSecret(undefined), false);
    assert.equal(isValidProviderRuntimeCallerSecret("x".repeat(63)), false);
    assert.equal(isValidProviderRuntimeCallerSecret("x".repeat(64)), true);
    assert.equal(isValidProviderRuntimeCallerSecret("x".repeat(88)), true);
    assert.equal(isValidProviderRuntimeCallerSecret("x".repeat(256)), true);
    assert.equal(isValidProviderRuntimeCallerSecret("x".repeat(257)), false);
    assert.equal(isValidProviderRuntimeCallerSecret(`${"x".repeat(64)} `), false);
    assert.equal(isValidProviderRuntimeCallerSecret(`${"x".repeat(32)} ${"y".repeat(32)}`), false);
});

test("provider-runtime timeout waits for bounded cancellation cleanup", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let started;
    const operationStarted = new Promise(resolve => { started = resolve; });
    let finishCleanup;
    const cleanupGate = new Promise(resolve => { finishCleanup = resolve; });
    let cleanupFinished = false;
    let settled = false;
    try {
        const pending = withAbortTimeout(signal => new Promise((_, reject) => {
            started();
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }), 100, async () => {
            await cleanupGate;
            cleanupFinished = true;
        }).finally(() => { settled = true; });
        await operationStarted;
        t.mock.timers.tick(100);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(cleanupFinished, false);
        assert.equal(settled, false);
        finishCleanup();
        await assert.rejects(pending, { code: "PROVIDER_RUNTIME_TIMEOUT" });
        assert.equal(cleanupFinished, true);
        assert.equal(settled, true);
    } finally { t.mock.timers.reset(); }
});

test("malformed caller-secret configuration fails closed without exposing configuration details", async () => {
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME: runtime(async () => { throw new Error("invalid secret must not call the runtime"); }), PROVIDER_RUNTIME_CALLER_SECRET: "short" };
    await withFetch(async () => Response.json(freshState), async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        assert.equal(result.status, "unavailable");
        assert.equal(result.eligible, true);
        assert.equal(result.reason, "DISCORD_PROVIDER_UNAVAILABLE");
        assert.doesNotMatch(JSON.stringify(result), /SECRET_INVALID|AUTH_UNAVAILABLE|short/u);
    });
});

test("provider-runtime timeout before headers preserves prior eligibility", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret",
        PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: { fetch(request) {
            started();
            return new Promise((_, reject) => request.signal.addEventListener("abort", () => { const error = new Error(); error.name = "AbortError"; reject(error); }, { once: true }));
        } }
    };
    try {
        await withFetch(async url => {
            assert.match(new URL(url).pathname, /get_rl_discord_notification_state$/u);
            return Response.json(freshState);
        }, async () => {
            const pending = getDiscordMatchBotEligibility(env, accountId, { force: true });
            await requestStarted;
            t.mock.timers.tick(PROVIDER_RUNTIME_TIMEOUT_MS);
            const result = await pending;
            assert.equal(result.status, "unavailable");
            assert.equal(result.reason, "PROVIDER_RUNTIME_TIMEOUT");
            assert.equal(result.eligible, true);
            assert.equal(result.countComplete, true);
        });
    } finally { t.mock.timers.reset(); }
});

test("provider-runtime timeout while reading body preserves prior eligibility and skips writes", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    let persistenceWrites = 0;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: { async fetch() {
            started();
            return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }));
        } }
    };
    try {
        await withFetch(async url => {
            if (new URL(url).pathname.endsWith("get_rl_discord_notification_state")) return Response.json(freshState);
            persistenceWrites += 1;
            return Response.json({ success: true });
        }, async () => {
            const pending = getDiscordMatchBotEligibility(env, accountId, { force: true });
            await requestStarted;
            await new Promise(resolve => setImmediate(resolve));
            t.mock.timers.tick(PROVIDER_RUNTIME_TIMEOUT_MS);
            const result = await pending;
            assert.equal(result.status, "unavailable");
            assert.equal(result.reason, "PROVIDER_RUNTIME_TIMEOUT");
            assert.equal(result.eligible, true);
            assert.equal(persistenceWrites, 0);
        });
    } finally { t.mock.timers.reset(); }
});

test("stale state validates complete inventory and only confirmed membership before syncing", async () => {
    const writes = [];
    const paths = [];
    let stateReads = 0;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", SUPABASE_SERVICE_ROLE_KEY: "server-secret",
        PROVIDER_RUNTIME_CALLER_SECRET: secret, RL_STATS_CACHE: kvStore(),
        PROVIDER_RUNTIME: runtime(async (url, request) => {
            paths.push(url.pathname);
            const body = await request.json();
            if (url.pathname.endsWith("guild-inventory")) return Response.json({ success: true, complete: true, count: 1, guilds: [{ id: guildId, name: "BPD" }], capturedAt: now });
            assert.deepEqual(body, { discordUserId: discordId, guildIds: [guildId] });
            return Response.json({ success: true, status: "available", eligible: true, mutualGuildCount: 1, sharedGuildIds: [guildId], countComplete: true, checkedAt: now });
        })
    };
    await withFetch(async (url, init) => {
        const name = new URL(url).pathname.split("/").at(-1);
        const body = JSON.parse(init.body);
        if (name === "verify_account_provider_identity") return identity();
        if (name === "get_rl_discord_notification_state") {
            stateReads++;
            return Response.json(stateReads === 1 ? { ...freshState, checkedAt: "2026-09-01T00:00:00Z" } : { ...freshState, checkedAt: now });
        }
        writes.push({ name, body });
        if (name === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: now, upserted: 1, deactivated: 0 });
        if (name === "sync_account_discord_guilds") return Response.json({ success: true, checkedAt: now, eligible: true, sharedGuildCount: 1, playerId: "must-not-reach-browser" });
        throw new Error(`unexpected RPC ${name}`);
    }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId);
        assert.equal(result.eligible, true);
        assert.equal(result.stale, false, JSON.stringify(result));
        assert.deepEqual(paths, ["/internal/discord/guild-inventory", "/internal/discord/check-membership"]);
        assert.deepEqual(writes.map(item => item.name), ["sync_discord_bot_guilds", "sync_account_discord_guilds"]);
        assert.deepEqual(writes[0].body.p_guilds, [{ guild_id: guildId, guild_name: "BPD" }]);
        assert.deepEqual(writes[1].body.p_guild_ids, [guildId]);
        assert.equal(writes[1].body.p_account_id, accountId);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(`${accountId}|${discordId}|${guildId}|must-not-reach-browser|server-secret`));
    });
});

test("Check Again bypasses fresh cache and refreshes the current account", async () => {
    let runtimeCalls = 0;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: runtime(async url => { runtimeCalls++; return url.pathname.endsWith("guild-inventory")
            ? Response.json({ success: true, complete: true, count: 0, guilds: [], capturedAt: now })
            : Response.json({ success: true, status: "available", eligible: false, mutualGuildCount: 0, sharedGuildIds: [], countComplete: true, checkedAt: now }); })
    };
    let stateReads = 0;
    await withFetch(async (url, init) => {
        const name = new URL(url).pathname.split("/").at(-1);
        if (name === "get_rl_discord_notification_state") { stateReads++; return Response.json(stateReads === 1 ? freshState : { ...freshState, eligible: false, sharedGuildCount: 0, checkedAt: now }); }
        if (name === "verify_account_provider_identity") return identity();
        if (name === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: now });
        if (name === "sync_account_discord_guilds") return Response.json({ success: true, checkedAt: now, eligible: false, sharedGuildCount: 0 });
        throw new Error(`unexpected ${name} ${init?.body}`);
    }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        assert.equal(result.eligible, false, JSON.stringify(result));
        assert.equal(runtimeCalls, 2);
        assert.equal(stateReads, 2);
    });
});

test("provider failure preserves last eligibility and never replaces account membership", async () => {
    let accountSyncs = 0;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: runtime(async () => Response.json({ success: false, status: "unavailable", code: "DISCORD_RATE_LIMITED", retryAfterSeconds: 20 }, { status: 503 }))
    };
    await withFetch(async url => {
        const name = new URL(url).pathname.split("/").at(-1);
        if (name === "get_rl_discord_notification_state") return Response.json(freshState);
        if (name === "verify_account_provider_identity") return identity();
        if (name === "sync_account_discord_guilds") accountSyncs++;
        return Response.json({ success: true });
    }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        assert.equal(result.eligible, true);
        assert.equal(result.status, "unavailable");
        assert.equal(result.stale, true);
        assert.equal(accountSyncs, 0);
    });
});

test("a complete empty membership result writes authoritative ineligible state", async () => {
    let syncedGuildIds = null;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: runtime(async url => url.pathname.endsWith("guild-inventory")
            ? Response.json({ success: true, complete: true, count: 0, guilds: [], capturedAt: now })
            : Response.json({ success: true, status: "available", eligible: false, mutualGuildCount: 0, sharedGuildIds: [], countComplete: true, checkedAt: now }))
    };
    await withFetch(async (url, init) => {
        const name = new URL(url).pathname.split("/").at(-1);
        if (name === "get_rl_discord_notification_state") return Response.json({ profileExists: false, discordNotificationsEnabled: false, eligible: false, sharedGuildCount: 0, warningRequired: false });
        if (name === "verify_account_provider_identity") return identity();
        if (name === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: now });
        if (name === "sync_account_discord_guilds") {
            syncedGuildIds = JSON.parse(init.body).p_guild_ids;
            return Response.json({ success: true, checkedAt: now, eligible: false, sharedGuildCount: 0 });
        }
        throw new Error(`unexpected ${name}`);
    }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        assert.equal(result.status, "available");
        assert.equal(result.eligible, false);
        assert.equal(result.mutualGuildCount, 0);
        assert.deepEqual(syncedGuildIds, []);
    });
});

test("incomplete inventory does not replace Supabase inventory", async () => {
    let syncs = 0;
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret, PROVIDER_RUNTIME: runtime(async () => Response.json({ success: true, complete: false, guilds: [], count: 0 })) };
    await withFetch(async () => { syncs++; return Response.json({ success: true }); }, async () => {
        await assert.rejects(refreshDiscordBotGuildInventory(env, { force: true }), /DISCORD_INVENTORY_INCOMPLETE/);
        assert.equal(syncs, 0);
    });
});

test("large current guild sets are checked in bounded batches before the account replacement", async () => {
    const guilds = Array.from({ length: 401 }, (_, index) => ({ id: String(900000000000000100n + BigInt(index)), name: `Guild ${index}` }));
    const batches = [];
    let accountSyncGuildIds;
    const env = {
        SUPABASE_URL: "https://db.invalid/rest/v1", SUPABASE_AUTH: "server-secret", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: runtime(async (url, request) => {
            const body = await request.json();
            if (url.pathname.endsWith("guild-inventory")) return Response.json({ success: true, complete: true, count: guilds.length, guilds, capturedAt: now });
            batches.push(body.guildIds);
            const sharedGuildIds = body.guildIds.includes(guilds[400].id) ? [guilds[400].id] : [];
            return Response.json({ success: true, status: "available", eligible: sharedGuildIds.length > 0, mutualGuildCount: sharedGuildIds.length, sharedGuildIds, countComplete: true, checkedAt: now });
        })
    };
    await withFetch(async (url, init) => {
        const name = new URL(url).pathname.split("/").at(-1);
        if (name === "verify_account_provider_identity") return identity();
        if (name === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: now });
        if (name === "sync_account_discord_guilds") {
            accountSyncGuildIds = JSON.parse(init.body).p_guild_ids;
            return Response.json({ success: true, checkedAt: now, eligible: true, sharedGuildCount: 1 });
        }
        if (name === "get_rl_discord_notification_state") return Response.json({ profileExists: false, discordNotificationsEnabled: false, eligible: true, sharedGuildCount: 1, warningRequired: false });
        throw new Error(`unexpected RPC ${name}`);
    }, async () => {
        const result = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        assert.equal(result.eligible, true);
        assert.deepEqual(batches.map(batch => batch.length), [400, 1]);
        assert.deepEqual(accountSyncGuildIds, [guilds[400].id]);
    });
});

test("Discord settings authorization and browser response remain account-scoped and ID-free", async () => {
    assert.equal(canEnableDiscordNotifications(false, false, { eligible: false }), true);
    assert.equal(canEnableDiscordNotifications(true, false, { eligible: false }), false);
    assert.equal(canEnableDiscordNotifications(true, false, { eligible: true }), true);
    assert.equal(canEnableDiscordNotifications(true, true, { eligible: false }), true);
    const [route, profileService, registration, myProfile] = await Promise.all([
        readFile(new URL("../../functions/api/auth/rocketleague/discord-notifications.js", import.meta.url), "utf8"),
        readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8"),
        readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8"),
        readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8")
    ]);
    assert.match(route, /authorization\.accountId/);
    assert.match(route, /export async function onRequestPost/);
    assert.match(route, /Object\.keys\(body\)\.length !== 0/);
    assert.match(route, /CROSS_SITE_REQUEST_REJECTED/);
    assert.doesNotMatch(route, /console\.error/u);
    assert.match(profileService, /getDiscordMatchBotEligibility\([\s\S]*?accountId/u);
    assert.match(registration, /force \? "POST" : "GET"/);
    assert.match(myProfile, /loadDiscordNotificationAvailability\(true\)/);
});
