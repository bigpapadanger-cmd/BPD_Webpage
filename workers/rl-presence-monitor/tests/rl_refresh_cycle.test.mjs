import assert from "node:assert/strict";
import test from "node:test";
import { persistCapability, refreshCandidate } from "../src/rl_refresh_cycle.js";

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

test("history and Discord do not invoke provider APIs and are checkpointed unsupported", async () => {
    const writes = [];
    globalThis.fetch = async (url, init) => {
        writes.push({ rpc: new URL(url).pathname.split("/").at(-1), body: JSON.parse(init.body) });
        return Response.json({ success: true });
    };
    const result = await refreshCandidate(baseEnv, { ...candidate, match_history_due: true, discord_due: true });
    assert.deepEqual(result, { attempted: 2, succeeded: 0, failed: 2, mmrChanged: 0, mmrUnchanged: 0 });
    assert.deepEqual(writes.map(item => item.rpc), ["record_rl_player_refresh_result", "record_rl_player_refresh_result"]);
    assert.deepEqual(writes.map(item => item.body.p_error_code), [
        "RL_MATCH_HISTORY_AUTHENTICATED_PLAYER_ONLY", "DISCORD_GATEWAY_RUNTIME_UNAVAILABLE"
    ]);
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
