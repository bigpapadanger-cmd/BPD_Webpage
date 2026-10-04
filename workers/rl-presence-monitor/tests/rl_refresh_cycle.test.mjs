import assert from "node:assert/strict";
import test from "node:test";
import { persistCapability, refreshCandidate, runRocketLeagueRefreshCycle } from "../src/rl_refresh_cycle.js";

const candidate = { account_id: "account-1", player_id: "player-1", epic_account_id: "epic-1" };
const baseEnv = { SUPABASE_URL: "https://supabase.invalid/rest/v1", SUPABASE_SERVICE_ROLE_KEY: "test-secret" };
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("skills persist through the changed-only MMR v2 RPC contract", async () => {
    let call;
    globalThis.fetch = async (url, init) => {
        call = { rpc: new URL(url).pathname.split("/").at(-1), body: JSON.parse(init.body) };
        return Response.json({ saved: false });
    };
    await persistCapability(baseEnv, candidate, "mmr", { skills: { status: "success", data: { playlists: [
        { id: 10, mmr: 900, tier: 13 }, { id: 11, mmr: 1100, tier: 16 }, { id: 13, mmr: 1050, tier: 15 }
    ] } } });
    assert.equal(call.rpc, "save_rl_player_mmr_snapshot_v2");
    assert.deepEqual(call.body, {
        p_account_id: "account-1", p_epic_account_id: "epic-1", p_captured_at: call.body.p_captured_at,
        p_ones_mmr: 900, p_twos_mmr: 1100, p_threes_mmr: 1050,
        p_ones_tier: "Diamond I", p_twos_tier: "Champion I", p_threes_tier: "Diamond III",
        p_source: "mmr-api-v2"
    });
    assert.ok(Number.isFinite(Date.parse(call.body.p_captured_at)));
});

test("provider profile only writes the supported display username and preserves unsupported nulls", async () => {
    let body;
    globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response(null, { status: 204 }); };
    await persistCapability(baseEnv, candidate, "provider", { profile: { status: "success", data: { display_username: "Pilot" } } });
    assert.deepEqual(body, {
        p_account_id: "account-1", p_display_username: "Pilot", p_level: null,
        p_xp: null, p_creator_code: null, p_provider_updated_at: null
    });
});

test("career stats require all six nonnegative aggregate values before persistence", async () => {
    let writes = 0;
    globalThis.fetch = async () => { writes++; return new Response(null, { status: 204 }); };
    await assert.rejects(persistCapability(baseEnv, candidate, "career_stats", {
        stats: { status: "incomplete", data: { wins: 1 } }
    }), error => error.code === "RL_CAREER_STATS_INCOMPLETE");
    assert.equal(writes, 0);
});

test("history remains unsupported and Discord inventory failure is independently checkpointed", async () => {
    const writes = [];
    globalThis.fetch = async (url, init) => {
        writes.push({ rpc: new URL(url).pathname.split("/").at(-1), body: JSON.parse(init.body) });
        return Response.json({ success: true });
    };
    const result = await refreshCandidate(baseEnv, { ...candidate, match_history_due: true, discord_due: true });
    assert.deepEqual(result, { attempted: 2, succeeded: 0, failed: 2, mmrChanged: 0, mmrUnchanged: 0 });
    assert.deepEqual(writes.map(item => item.rpc), ["record_rl_player_refresh_result", "record_rl_player_refresh_result"]);
    assert.deepEqual(writes.map(item => item.body.p_error_code), [
        "RL_MATCH_HISTORY_AUTHENTICATED_PLAYER_ONLY", "DISCORD_INVENTORY_UNAVAILABLE"
    ]);
});

test("hourly Discord refresh syncs complete guild inventory before account membership and checkpoints separately", async () => {
    const calls = [];
    const guildId = "900000000000000003";
    const discordId = "900000000000000004";
    const runtime = { async fetch(request) {
        const url = new URL(request.url);
        calls.push(`worker:${url.pathname}`);
        if (url.pathname.endsWith("guild-inventory")) return Response.json({ success: true, complete: true, guilds: [{ id: guildId, name: "BPD" }], count: 1, capturedAt: new Date().toISOString() });
        return Response.json({ success: true, status: "available", eligible: true, mutualGuildCount: 1, sharedGuildIds: [guildId], countComplete: true, checkedAt: new Date().toISOString() });
    } };
    const kvData = new Map();
    const env = {
        ...baseEnv,
        SUPABASE_AUTH: "test-secret",
        PROVIDER_RUNTIME_CALLER_SECRET: "r".repeat(64),
        PROVIDER_RUNTIME: runtime,
        SERVICE_STATUS: {
            async get(key, type) { const value = kvData.get(key); return type === "json" && typeof value === "string" ? JSON.parse(value) : value ?? null; },
            async put(key, value) { kvData.set(key, value); },
            async delete(key) { kvData.delete(key); }
        }
    };
    globalThis.fetch = async (url, init) => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        const body = init.body ? JSON.parse(init.body) : {};
        calls.push(`rpc:${rpc}`);
        if (rpc === "get_rl_refresh_candidates") return Response.json([{ ...candidate, discord_due: true, mmr_due: false, provider_due: false, club_due: false, career_stats_due: false, match_history_due: false }]);
        if (rpc === "verify_account_provider_identity") return Response.json([{ account_id: candidate.account_id, provider: "discord", provider_subject: discordId, active: true }]);
        if (rpc === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: body.p_checked_at, upserted: 1, deactivated: 0 });
        if (rpc === "sync_account_discord_guilds") return Response.json({ success: true, checkedAt: body.p_checked_at, eligible: true, sharedGuildCount: 1, playerId: null });
        if (rpc === "get_rl_discord_notification_state") return Response.json({ profileExists: false, discordNotificationsEnabled: false, eligible: true, sharedGuildCount: 1, warningRequired: false });
        if (rpc === "record_rl_player_refresh_result") return Response.json({ success: true });
        throw new Error(`unexpected RPC ${rpc}`);
    };
    const result = await runRocketLeagueRefreshCycle(env);
    assert.equal(result.attempted, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.discordInventoryAvailable, true);
    assert.ok(calls.indexOf("rpc:sync_discord_bot_guilds") < calls.indexOf("worker:/internal/discord/check-membership"));
    assert.ok(calls.indexOf("rpc:sync_account_discord_guilds") < calls.indexOf("rpc:record_rl_player_refresh_result"));
    assert.equal(calls.includes("rpc:save_rl_player_mmr_snapshot_v2"), false);
});

test("scheduled Discord timeout checkpoints one account and continues with remaining accounts", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const firstDiscordId = "900000000000000011";
    const secondDiscordId = "900000000000000012";
    const guildId = "900000000000000013";
    const rows = [
        { ...candidate, account_id: "account-1", player_id: "player-1", discord_due: true, mmr_due: false, provider_due: false, club_due: false, career_stats_due: false, match_history_due: false },
        { ...candidate, account_id: "account-2", player_id: "player-2", discord_due: true, mmr_due: false, provider_due: false, club_due: false, career_stats_due: false, match_history_due: false }
    ];
    const checkpoints = [];
    const accountWrites = [];
    const observed = [];
    const kvData = new Map();
    let started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    const env = {
        ...baseEnv,
        SUPABASE_AUTH: "test-secret",
        PROVIDER_RUNTIME_CALLER_SECRET: "r".repeat(64),
        SERVICE_STATUS: {
            async get(key, type) { const value = kvData.get(key); return type === "json" && typeof value === "string" ? JSON.parse(value) : value ?? null; },
            async put(key, value) { kvData.set(key, value); },
            async delete(key) { kvData.delete(key); }
        },
        PROVIDER_RUNTIME: { async fetch(request) {
            const url = new URL(request.url);
            observed.push(`worker:${url.pathname}`);
            if (url.pathname.endsWith("guild-inventory")) return Response.json({ success: true, complete: true, guilds: [{ id: guildId, name: "BPD" }], count: 1, capturedAt: new Date().toISOString() });
            const body = await request.json();
            observed.push(`member:${body.discordUserId}`);
            if (body.discordUserId === firstDiscordId) {
                started();
                return new Promise((_, reject) => request.signal.addEventListener("abort", () => { const error = new Error(); error.name = "AbortError"; reject(error); }, { once: true }));
            }
            return Response.json({ success: true, status: "available", eligible: true, mutualGuildCount: 1, sharedGuildIds: [guildId], countComplete: true, checkedAt: new Date().toISOString() });
        } }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        observed.push(`rpc:${rpc}`);
        const body = init.body ? JSON.parse(init.body) : {};
        if (rpc === "get_rl_refresh_candidates") return Response.json(rows);
        if (rpc === "verify_account_provider_identity") {
            const id = body.p_account_id === "account-1" ? firstDiscordId : secondDiscordId;
            return Response.json([{ account_id: body.p_account_id, provider: "discord", provider_subject: id, active: true }]);
        }
        if (rpc === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: body.p_checked_at, upserted: 1, deactivated: 0 });
        if (rpc === "sync_account_discord_guilds") {
            accountWrites.push(body.p_account_id);
            return Response.json({ success: true, checkedAt: body.p_checked_at, eligible: true, sharedGuildCount: 1 });
        }
        if (rpc === "get_rl_discord_notification_state") return Response.json({ profileExists: false, eligible: true, sharedGuildCount: 1, checkedAt: new Date().toISOString() });
        if (rpc === "record_rl_player_refresh_result") { checkpoints.push(body); return Response.json({ success: true }); }
        throw new Error(`unexpected RPC ${rpc}`);
    };
    try {
        const pending = runRocketLeagueRefreshCycle(env, { reconcileDiscordInventory: true });
        const startState = await Promise.race([requestStarted.then(() => "started"), pending.then(() => "completed", error => `error:${error?.code || error?.message}`), new Promise(resolve => setImmediate(() => resolve("idle")))]);
        assert.equal(startState, "started", `refresh did not reach the first account's provider request: ${observed.join(",")}; checkpoints=${JSON.stringify(checkpoints.map(item => [item.p_account_id, item.p_component, item.p_error_code]))}`);
        t.mock.timers.tick(30000);
        const result = await pending;
        assert.equal(result.attempted, 2);
        assert.equal(result.succeeded, 1);
        assert.equal(result.failed, 1);
        assert.deepEqual(accountWrites, ["account-2"]);
        assert.deepEqual(checkpoints.map(item => [item.p_account_id, item.p_success, item.p_error_code]), [
            ["account-1", false, "PROVIDER_RUNTIME_TIMEOUT"],
            ["account-2", true, null]
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        t.mock.timers.reset();
    }
});

test("due capabilities share one authorized Worker request and persist/checkpoint independently", async () => {
    const writes = [];
    const now = Date.now();
    const authRecords = new Map([
        ["provider_auth_id:account-1:epic", {
            accountId: "account-1", provider: "epic",
            connectedAt: new Date(now - 60_000).toISOString(),
            expiresAt: new Date(now + 30 * 86400000).toISOString()
        }],
        ["account_login_status:account-1", {
            accountId: "account-1", lastLoginAt: new Date(now - 60_000).toISOString(), providerReauthAfter: null
        }]
    ]);
    let providerRequest;
    globalThis.fetch = async (url, init = {}) => {
        const parsed = new URL(url);
        const rpc = parsed.pathname.split("/").at(-1);
        if (parsed.hostname === "mmr.example.test") {
            providerRequest = parsed;
            return Response.json({ success: true, capabilities: {
                skills: { status: "success", data: { playlists: [{ id: 11, mmr: 1000, tier: 15 }] } },
                profile: { status: "error", error: { code: "RL_PROFILE_FAILED" } },
                stats: { status: "success", data: { wins: 1, goals: 2, assists: 3, saves: 4, shots: 5, mvps: 6 } }
            } });
        }
        const body = init.body ? JSON.parse(init.body) : {};
        if (rpc === "get_account_session_identity") return Response.json([{ id: "account-1", active: true }]);
        if (rpc === "verify_account_provider_identity") return Response.json([{ account_id: "account-1", provider: "epic", provider_subject: "epic-1", active: true }]);
        writes.push({ rpc, body });
        return Response.json({ saved: true, refreshSucceeded: true });
    };
    const env = {
        ...baseEnv,
        SUPABASE_URL: "https://supabase.invalid/rest/v1",
        SUPABASE_AUTH: "test-secret",
        MMR_API_URL: "https://mmr.example.test",
        MMR_API_KEY: "mmr-test-secret",
        AUTH_SESSIONS: {
            async get(key) { return authRecords.get(key) || null; },
            async put() {}
        }
    };

    const result = await refreshCandidate(env, {
        ...candidate, mmr_due: true, provider_due: true, career_stats_due: true,
        club_due: false, match_history_due: false, discord_due: false
    });

    assert.ok(providerRequest, JSON.stringify({ result, writes }));
    assert.equal(providerRequest.searchParams.get("capabilities"), "skills,profile,stats");
    assert.equal(result.attempted, 3);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 1);
    assert.deepEqual(writes.map(item => item.rpc), [
        "save_rl_player_mmr_snapshot_v2", "record_rl_player_refresh_result",
        "record_rl_player_refresh_result", "save_rl_player_stats",
        "record_rl_player_refresh_result"
    ]);
    assert.deepEqual(writes.filter(item => item.rpc === "record_rl_player_refresh_result").map(item => [item.body.p_component, item.body.p_success]), [
        ["mmr", true], ["provider", false], ["career_stats", true]
    ]);
    assert.equal(writes.some(item => item.rpc === "save_rl_player_stats" && item.body.p_wins === 1), true);
    assert.equal(writes.some(item => item.body?.p_access_token), false);
});
