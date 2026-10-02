import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { fetchPresence, runPresenceCycle, savePresence } from "../src/presence_cycle.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function providerResponse(state = "online") {
    return Response.json({
        success: true,
        capabilities: {
            presence: {
                status: "success",
                data: { state, provider_state: state, checked_at: new Date().toISOString() }
            }
        }
    });
}

test("presence client uses normalized MMR Worker capability and maps successful states", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: new URL(url), init });
        return providerResponse("online");
    };

    const result = await fetchPresence({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "server-secret" }, "epic-subject");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/get-player-data");
    assert.equal(calls[0].url.searchParams.get("playerId"), "Epic|epic-subject|0");
    assert.equal(calls[0].url.searchParams.get("capabilities"), "presence");
    assert.equal(calls[0].init.headers.Authorization, "Bearer server-secret");
    assert.equal(result.state, "online");
    assert.ok(result.checkedAt);
});

test("offline persists only as an explicit normalized state; unknown and malformed results are rejected", async () => {
    globalThis.fetch = async () => providerResponse("offline");
    assert.equal((await fetchPresence({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "key" }, "epic")).state, "offline");

    globalThis.fetch = async () => providerResponse("unknown");
    await assert.rejects(fetchPresence({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "key" }, "epic"), { code: "MMR_PRESENCE_UNKNOWN" });
    await assert.rejects(savePresence({}, { rlPlayerId: "player" }, { state: "unknown", checkedAt: new Date().toISOString() }), { code: "MMR_PRESENCE_NOT_PERSISTABLE" });

    globalThis.fetch = async () => Response.json({ success: true, capabilities: { presence: { status: "error", data: null } } });
    await assert.rejects(fetchPresence({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "key" }, "epic"), { code: "MMR_PRESENCE_RESPONSE_INVALID" });

    globalThis.fetch = async () => Response.json({
        success: true,
        capabilities: { presence: { status: "success", data: { state: "offline", checked_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() } } }
    });
    await assert.rejects(fetchPresence({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "key" }, "epic"), { code: "MMR_PRESENCE_RESPONSE_STALE" });
});

test("presence persistence uses only the confirmed state and provider checked_at", async () => {
    let rpc;
    globalThis.fetch = async (url, init) => {
        rpc = { path: new URL(url).pathname, body: JSON.parse(init.body) };
        return new Response(null, { status: 204 });
    };
    const checkedAt = new Date().toISOString();
    await savePresence({ SUPABASE_URL: "https://supabase.example.test", SUPABASE_AUTH: "key" },
        { rlPlayerId: "player-1" }, { state: "offline", checkedAt, displayName: null });
    assert.ok(rpc.path.endsWith("/save_rl_player_presence"));
    assert.deepEqual(rpc.body, {
        p_player_id: "player-1",
        p_display_name: null,
        p_presence_state: "offline",
        p_checked_at: checkedAt
    });
});

test("ineligible accounts are skipped before provider lookup or persistence", async () => {
    const writes = [];
    const calls = [];
    globalThis.fetch = async (url) => {
        const path = new URL(url).pathname;
        calls.push(path);
        if (path.endsWith("/get_rl_presence_candidates")) {
            return Response.json([{ account_id: "account", rl_player_id: "player", epic_account_id: "epic" }]);
        }
        if (path.endsWith("/get_account_session_identity")) return Response.json([{ id: "account", active: false }]);
        if (path.endsWith("/save_rl_player_presence")) writes.push(JSON.parse("{}"));
        return Response.json([]);
    };
    // The ineligible account is skipped before provider lookup; no prior row is mutated.
    const runtime = { SUPABASE_URL: "https://supabase.example.test", SUPABASE_AUTH: "key" };
    const result = await runPresenceCycle(runtime);
    const nextScheduledResult = await runPresenceCycle(runtime);
    assert.equal(result.checked, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(nextScheduledResult.skippedCount, 1);
    assert.equal(calls.filter(path => path.endsWith("/get_rl_presence_candidates")).length, 2);
    assert.equal(calls.some(path => path.endsWith("/get_rl_presence_monitor_state")), false);
    assert.equal(calls.some(path => path.endsWith("/get-player-data")), false);
    assert.equal(writes.length, 0);
});

test("provider request failure retains stored presence by skipping the save RPC", async () => {
    const now = Date.now();
    const authKv = new Map([
        ["provider_auth_id:account:epic", JSON.stringify({ accountId: "account", provider: "epic", connectedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() })],
        ["account_login_status:account", JSON.stringify({ accountId: "account", lastLoginAt: new Date(now - 60_000).toISOString(), providerReauthAfter: null })]
    ]);
    const calls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        calls.push(parsed.pathname);
        if (parsed.pathname.endsWith("/get_rl_presence_candidates")) {
            return Response.json([{ account_id: "account", rl_player_id: "player", epic_account_id: "epic" }]);
        }
        if (parsed.pathname.endsWith("/get_account_session_identity")) return Response.json([{ id: "account", active: true }]);
        if (parsed.pathname.endsWith("/verify_account_provider_identity")) return Response.json([{ account_id: "account", provider: "epic", provider_subject: "epic", active: true }]);
        if (parsed.hostname === "mmr.example.test") return Response.json({ message: "private upstream details" }, { status: 502 });
        return Response.json(null);
    };
    const result = await runPresenceCycle({
        SUPABASE_URL: "https://supabase.example.test",
        SUPABASE_AUTH: "key",
        MMR_API_URL: "https://mmr.example.test",
        MMR_API_KEY: "worker-key",
        AUTH_SESSIONS: { async get(key, format) { const value = authKv.get(key); return value && format === "json" ? JSON.parse(value) : value || null; }, async put() {} }
    });
    assert.equal(result.failed, 1);
    assert.equal(result.checked, 0);
    assert.equal(calls.some(path => path.endsWith("/save_rl_player_presence")), false);
    assert.equal(JSON.stringify(result).includes("private upstream details"), false);
});

test("scheduled polling checks opt-ins again after a fully offline cycle", async () => {
    const now = Date.now();
    const authKv = new Map([
        ["provider_auth_id:account:epic", { accountId: "account", provider: "epic", connectedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }],
        ["account_login_status:account", { accountId: "account", lastLoginAt: new Date(now - 60_000).toISOString(), providerReauthAfter: null }]
    ]);
    const counts = new Map();
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        const path = parsed.pathname.split("/").at(-1);
        counts.set(path, (counts.get(path) || 0) + 1);
        if (path === "get_rl_presence_candidates") return Response.json([{ account_id: "account", rl_player_id: "player", epic_account_id: "epic" }]);
        if (path === "get_account_session_identity") return Response.json([{ id: "account", active: true }]);
        if (path === "verify_account_provider_identity") return Response.json([{ account_id: "account", provider: "epic", provider_subject: "epic", active: true }]);
        if (parsed.hostname === "mmr.example.test") return providerResponse("offline");
        return Response.json(true);
    };
    const runtime = {
        SUPABASE_URL: "https://supabase.example.test",
        SUPABASE_AUTH: "key",
        MMR_API_URL: "https://mmr.example.test",
        MMR_API_KEY: "worker-key",
        AUTH_SESSIONS: { async get(key, format) { return format === "json" ? authKv.get(key) || null : null; }, async put() {} }
    };
    const first = await runPresenceCycle(runtime);
    const second = await runPresenceCycle(runtime);
    assert.equal(first.dormant, true);
    assert.equal(second.checked, 1);
    assert.equal(counts.get("get_rl_presence_candidates"), 2);
    assert.equal(counts.get("get-player-data"), 2);
    assert.equal(counts.get("save_rl_player_presence"), 2);
    assert.equal(counts.has("get_rl_presence_monitor_state"), false);
});

test("empty eligible-candidate selection does not call the provider", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
        const path = new URL(url).pathname;
        calls.push(path);
        if (path.endsWith("/get_rl_presence_candidates")) return Response.json([]);
        return Response.json(null);
    };
    const result = await runPresenceCycle({ SUPABASE_URL: "https://supabase.example.test", SUPABASE_AUTH: "key" });
    assert.equal(result.candidateCount, 0);
    assert.equal(calls.some(path => path.endsWith("/get-player-data")), false);
});

test("cron remains independent and every scheduled presence lookup is server-side", async () => {
    const config = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    assert.ok(config.triggers.crons.includes("*/15 * * * *"));
});
