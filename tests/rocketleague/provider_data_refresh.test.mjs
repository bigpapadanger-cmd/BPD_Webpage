import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    fetchProviderCapabilities,
    persistProviderCapabilities,
    refreshProviderDataWithGate
} from "../../functions/services/rl/provider_data/refresh.js";

function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

async function withFetch(implementation, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = implementation;
    try {
        return await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

function memoryKv(initial = new Map()) {
    return {
        values: initial,
        async get(key) { return this.values.get(key) ?? null; },
        async put(key, value) { this.values.set(key, value); }
    };
}

test("provider data client requests only profile and stats through the existing protected Worker", async () => {
    const calls = [];
    await withFetch(async (url, init) => {
        calls.push({ url: new URL(url), init });
        return response({ success: true, capabilities: {} });
    }, async () => {
        await fetchProviderCapabilities({
            MMR_API_URL: "https://mmr.example.test/",
            MMR_API_KEY: "server-only-test-key"
        }, "epicuser1");
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/get-player-data");
    assert.equal(calls[0].url.searchParams.get("playerId"), "Epic|epicuser1|0");
    assert.equal(calls[0].url.searchParams.get("capabilities"), "profile,stats");
    assert.equal(calls[0].init.headers.Authorization, "Bearer server-only-test-key");
});

test("successful profile persists display name with supported nulls; complete stats persist separately", async () => {
    const writes = [];
    await withFetch(async (url, init) => {
        writes.push({ rpc: new URL(url).pathname.split("/").at(-1), payload: JSON.parse(init.body) });
        return new Response(null, { status: 204 });
    }, async () => {
        const result = await persistProviderCapabilities({
            SUPABASE_URL: "https://supabase.example.test",
            SUPABASE_AUTH: "server-only-test-key"
        }, "account-1", {
            profile: { status: "success", data: {
                display_username: "Pilot",
                level: null,
                xp: null,
                creator_code: null,
                provider_updated_at: null
            } },
            stats: { status: "success", data: { wins: 1, goals: 2, assists: 3, saves: 4, shots: 5, mvps: 6 } },
            history: { status: "unsupported", data: null }
        });
        assert.equal(result.profile.status, "persisted");
        assert.equal(result.stats.status, "persisted");
        assert.equal(result.history.status, "unsupported");
    });

    assert.deepEqual(writes.map(item => item.rpc), [
        "save_rl_player_provider_profile",
        "record_rl_player_refresh_result",
        "save_rl_player_stats",
        "record_rl_player_refresh_result"
    ]);
    assert.deepEqual(writes[0].payload, {
        p_account_id: "account-1",
        p_display_username: "Pilot",
        p_level: null,
        p_xp: null,
        p_creator_code: null,
        p_provider_updated_at: null
    });
    assert.deepEqual(writes[1].payload, {
        p_account_id: "account-1",
        p_component: "provider",
        p_success: true,
        p_error_code: null
    });
    assert.deepEqual(writes[3].payload, {
        p_account_id: "account-1",
        p_component: "career_stats",
        p_success: true,
        p_error_code: null
    });
    assert.deepEqual(writes[2].payload, {
        p_account_id: "account-1",
        p_wins: 1,
        p_goals: 2,
        p_assists: 3,
        p_saves: 4,
        p_shots: 5,
        p_mvps: 6,
        p_captured_at: null
    });
    assert.equal(writes.some(item => item.rpc === "save_rl_player_match_history"), false);
});

test("incomplete stats and unsupported history never mutate persisted rows", async () => {
    const writes = [];
    await withFetch(async (url, init) => {
        writes.push({ rpc: new URL(url).pathname.split("/").at(-1), payload: JSON.parse(init.body) });
        return new Response(null, { status: 204 });
    }, async () => {
        const result = await persistProviderCapabilities({
            SUPABASE_URL: "https://supabase.example.test",
            SUPABASE_AUTH: "server-only-test-key"
        }, "account-1", {
            profile: { status: "success", data: { display_username: "Pilot" } },
            stats: { status: "incomplete", data: { wins: 1 } },
            history: { status: "unsupported", data: [{ id: "must-not-save" }] }
        });
        assert.equal(result.profile.status, "persisted");
        assert.equal(result.stats.status, "incomplete");
        assert.equal(result.history.status, "unsupported");
    });
    assert.deepEqual(writes.map(item => item.rpc), [
        "save_rl_player_provider_profile",
        "record_rl_player_refresh_result",
        "record_rl_player_refresh_result"
    ]);
    assert.equal(writes[2].payload.p_success, false);
    assert.equal(writes[2].payload.p_component, "career_stats");
});

test("one persistence failure does not discard another successful capability", async () => {
    const writes = [];
    await withFetch(async url => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        writes.push(rpc);
        return rpc === "save_rl_player_provider_profile"
            ? response({ message: "must-not-leak" }, 500)
            : new Response(null, { status: 204 });
    }, async () => {
        const result = await persistProviderCapabilities({
            SUPABASE_URL: "https://supabase.example.test",
            SUPABASE_AUTH: "server-only-test-key"
        }, "account-1", {
            profile: { status: "success", data: { display_username: "Pilot" } },
            stats: { status: "success", data: { wins: 1, goals: 2, assists: 3, saves: 4, shots: 5, mvps: 6 } }
        });
        assert.equal(result.profile.status, "persistence_failed");
        assert.equal(result.stats.status, "persisted");
        assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
    });
    assert.deepEqual(writes, [
        "save_rl_player_provider_profile", "record_rl_player_refresh_result",
        "save_rl_player_stats", "record_rl_player_refresh_result"
    ]);
});

test("Worker error diagnostics are sanitized", async () => {
    await withFetch(async () => new Response("access_token=secret-value", { status: 502 }), async () => {
        await assert.rejects(
            fetchProviderCapabilities({ MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "secret-key" }, "epicuser1"),
            error => error.code === "PROVIDER_WORKER_REQUEST_FAILED"
                && !error.message.includes("secret")
        );
    });
});

test("ordinary reads and MMR-gated page activity do not call provider capabilities", async () => {
    let calls = 0;
    const env = { RL_STATS_CACHE: memoryKv() };
    await withFetch(async () => { calls++; return response({}); }, async () => {
        const result = await refreshProviderDataWithGate(env, "account-1", { refreshed: false, gated: true });
        assert.equal(result.reason, "MMR_REFRESH_NOT_RUN");
    });
    assert.equal(calls, 0);

    const profileSource = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    const getHandler = profileSource.slice(profileSource.indexOf("async function handleProfileGet"), profileSource.indexOf("async function handleProfilePost"));
    assert.equal(getHandler.includes("refreshProviderDataWithGate"), false);

    const mmrRefreshSource = await readFile(new URL("../../functions/services/rl/stats/refresh.js", import.meta.url), "utf8");
    assert.match(mmrRefreshSource, /await saveMmrStats\(/);
    assert.match(mmrRefreshSource, /record_rl_player_refresh_result/);
});

test("provider refresh cooldown suppresses a second Worker request", async () => {
    const kv = memoryKv(new Map([["rl-provider-data-refresh:account-1", "recent"]]));
    let calls = 0;
    await withFetch(async () => { calls++; return response({}); }, async () => {
        const result = await refreshProviderDataWithGate({ RL_STATS_CACHE: kv }, "account-1", { refreshed: true });
        assert.equal(result.gated, true);
        assert.equal(result.reason, "KV_GATE_ACTIVE");
    });
    assert.equal(calls, 0);
});
