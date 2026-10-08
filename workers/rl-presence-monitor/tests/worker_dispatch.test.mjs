import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { handleFetch, handleScheduled } from "../src/index.js";
import { persistCapability } from "../src/rl_refresh_cycle.js";
import { WORKER_ROUTE_INVENTORY } from "../../../functions/services/admin/generatedApiRouteInventory.js";

const TRIGGER_KEY = "test-only-trigger-key-with-32-characters-minimum";
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalError = console.error;
afterEach(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
});

function env(fetchImpl) {
    return {
        PRESENCE_TRIGGER_KEY: TRIGGER_KEY,
        SUPABASE_URL: "https://supabase.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-secret",
        TASKBOARD_SUMMARY_DISCORD: "https://discord.invalid/webhook/test-secret",
        ...(fetchImpl ? { fetch: fetchImpl } : {})
    };
}

function adminRequest(body, token = TRIGGER_KEY) {
    return new Request("https://status.invalid/admin/run-scheduled", {
        method: "POST",
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
}

const rpcPayload = {
    total_tasks: 12,
    active_tasks: 10,
    deleted_tasks: 2,
    status: { to_do: 3, in_progress: 2, completed: 4, shelved: 1, archived: 0, deleted: 2 },
    responsibility: { owner: 2, database: 3, security: 4, ui: 5 }
};

test("MMR persistence reports the confirmed changed-only RPC result without adding provider calls", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
        requests.push({ url: new URL(String(url)), body: JSON.parse(init.body) });
        return Response.json({ saved: false, snapshot: { onesMmr: 900 } });
    };
    const result = await persistCapability(env(), {
        account_id: "account-1", epic_account_id: "epic-1"
    }, "mmr", { skills: { status: "success", data: { playlists: [
        { id: 10, mmr: 900, tier: 14 }, { id: 11, mmr: 1000, tier: 16 }, { id: 13, mmr: 1100, tier: 17 }
    ] } } });
    assert.equal(result.changed, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, "/rest/v1/rpc/save_rl_player_mmr_snapshot_v2");
    assert.equal(requests[0].body.p_source, "mmr-api-v2");
});

test("leaderboard schedule shares the hourly trigger and runs at noon UTC", async () => {
    const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
    const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.match(source, /LEADERBOARD_REFRESH_UTC_HOUR\s*=\s*12/);
    assert.match(config, /"0 \* \* \* \*"/);
    assert.doesNotMatch(config, /"0 12 \* \* \*"/);
    assert.doesNotMatch(config, /"0 0 \* \* \*"/);
});

test("all Worker call schedules are bounded and diagnostic Worker is manual-only", async () => {
    const rlConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const ocrConfig = JSON.parse(await readFile(new URL("../../ocr-job-consumer/wrangler.jsonc", import.meta.url), "utf8"));
    const diagnosticConfig = JSON.parse(await readFile(new URL("../../google-mtls-diagnostic/wrangler.jsonc", import.meta.url), "utf8"));

    assert.deepEqual(rlConfig.triggers.crons, ["*/15 * * * *", "0 * * * *"]);
    assert.deepEqual(rlConfig.services, [{ binding: "PROVIDER_RUNTIME", service: "bpd-provider-runtime" }]);
    assert.deepEqual(ocrConfig.triggers.crons, ["*/30 * * * *"]);
    assert.deepEqual(ocrConfig.queues.consumers.map(({ max_batch_size, max_retries, max_concurrency }) => ({ max_batch_size, max_retries, max_concurrency })), [
        { max_batch_size: 1, max_retries: 2, max_concurrency: 2 }
    ]);
    assert.equal("triggers" in diagnosticConfig, false);
    assert.equal("queues" in diagnosticConfig, false);
    assert.equal(diagnosticConfig.workers_dev, false);
    assert.equal(diagnosticConfig.preview_urls, false);
});

test("retired manual Taskboard runner makes no external calls", async () => {
    const calls = [];
    const log = [];
    console.info = (...args) => log.push(args);
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).includes("admin_taskboard_summary")) return Response.json(rpcPayload);
        if (String(url).startsWith("https://discord.invalid/")) return new Response(null, { status: 204 });
        throw new Error("Unexpected external request");
    };

    const response = await handleFetch(adminRequest({ job: "taskboard" }), env());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.job, "taskboard");
    assert.equal(result.summary.success, false);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(result).includes("test-service-role-secret"), false);
    assert.equal(JSON.stringify(log).includes("test-service-role-secret"), false);
});

test("manual route rejects unauthorized and unknown jobs before external calls", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error("should not be called"); };

    const unauthorized = await handleFetch(adminRequest({ job: "taskboard" }, "wrong"), env());
    assert.equal(unauthorized.status, 401);
    const invalid = await handleFetch(adminRequest({ job: "arbitrary-url" }), env());
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);
});

test("detailed health is protected, reports unknown before first run, and never starts presence work", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error("health must not call dependencies"); };
    const unauthorized = await handleFetch(new Request("https://status.invalid/admin/health"), env());
    assert.equal(unauthorized.status, 401);
    const authorized = await handleFetch(new Request("https://status.invalid/admin/health", { headers: { Authorization: `Bearer ${TRIGGER_KEY}` } }), env());
    const payload = await authorized.json();
    assert.equal(authorized.status, 200);
    assert.equal(payload.status, "unknown");
    assert.equal(payload.configuration.supabaseCredentialPresent, true);
    assert.equal(JSON.stringify(payload).includes("test-service-role-secret"), false);
    assert.equal(calls, 0);
});

test("retired Taskboard runner never duplicates Discord delivery", async () => {
    let releaseRpc;
    let rpcStarted;
    const started = new Promise(resolve => { rpcStarted = resolve; });
    const gate = new Promise(resolve => { releaseRpc = resolve; });
    let calls = 0;
    globalThis.fetch = async (url) => {
        calls += 1;
        if (String(url).includes("admin_taskboard_summary")) {
            rpcStarted();
            await gate;
            return Response.json(rpcPayload);
        }
        return new Response(null, { status: 204 });
    };

    const first = handleFetch(adminRequest({ job: "taskboard" }), env());
    const duplicate = await handleFetch(adminRequest({ job: "taskboard" }), env());
    assert.ok([200, 409].includes(duplicate.status));
    releaseRpc();
    assert.equal((await first).status, 200);
    assert.equal(calls, 0);
});

test("unknown scheduled trigger performs no work, and Worker has no queue handler", async () => {
    const tasks = [];
    await handleScheduled({ cron: "0 0 * * *" }, {}, { waitUntil: task => tasks.push(task) });
    assert.equal(tasks.length, 0);
    assert.equal(typeof worker.fetch, "function");
    assert.equal("queue" in worker, false);
});

test("hourly Rocket League schedule pages due candidates and refreshes Shop, not leaderboards outside noon UTC", async () => {
    const calls = [];
    const kv = new Map();
    const tasks = [];
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname === "mmr.example.test") {
            if (parsed.pathname === "/get-shop-data") {
                calls.push({ rpc: "get-shop-data", body: null });
                return Response.json({ success: true, shops: [{ id: 7 }], catalogues: [{ shop_id: 7, items: [] }] });
            }
            if (parsed.pathname === "/health/ready") return Response.json({ status: "healthy", components: {} });
            throw new Error("Unexpected MMR Worker endpoint");
        }
        const rpc = parsed.pathname.split("/").at(-1);
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ rpc, body });
        if (rpc === "get_rl_featured_player") return Response.json({ featuredDate: "2026-10-05", validUntil: "2026-10-06T00:00:00Z", player: null });
        if (rpc === "get_rl_refresh_candidates") return Response.json([{
            account_id: "account-1", player_id: "player-1", epic_account_id: "epic-1",
            mmr_due: false, provider_due: false, match_history_due: true,
            club_due: false, career_stats_due: false, discord_due: false
        }]);
        if (rpc === "sync_discord_bot_guilds") return Response.json({ success: true, checkedAt: body.p_checked_at, upserted: 0, deactivated: 0 });
        if (rpc === "save_rl_shop_snapshot") return Response.json({ saved: false, snapshot_id: 1 });
        if (rpc === "record_rl_player_refresh_result" || rpc === "record_rl_global_refresh_result") return Response.json({ success: true });
        throw new Error(`Unexpected request to ${rpc}`);
    };
    const scheduledEnv = {
        ...env(),
        SUPABASE_AUTH: "test-service-role-secret",
        PROVIDER_RUNTIME_CALLER_SECRET: "r".repeat(64),
        PROVIDER_RUNTIME: { async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/internal/discord/guild-inventory") return Response.json({ success: true, complete: true, count: 0, guilds: [], capturedAt: new Date().toISOString() });
            if (path === "/internal/health") return Response.json({ success: true, service: "bpd-provider-runtime", status: "ok", timestamp: new Date().toISOString() });
            if (path === "/internal/discord/bot-health") return Response.json({ success: true, botAuthenticated: true, checkedAt: new Date().toISOString() });
            throw new Error(`Unexpected provider-runtime path: ${path}`);
        } },
        MMR_API_URL: "https://mmr.example.test",
        MMR_API_KEY: "mmr-test-secret",
        SERVICE_STATUS: {
            async get(key) { return kv.get(key) ?? null; },
            async put(key, value) { kv.set(key, value); },
            async delete(key) { kv.delete(key); }
        }
    };

    await handleScheduled({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 5, 11) }, scheduledEnv, { waitUntil: task => tasks.push(task) });
    await Promise.all(tasks);

    const callsByRpc = new Map();
    for (const call of calls) callsByRpc.set(call.rpc, [...(callsByRpc.get(call.rpc) || []), call]);
    assert.equal(callsByRpc.get("get_rl_refresh_candidates").length, 1);
    assert.equal(callsByRpc.get("sync_discord_bot_guilds").length, 1);
    assert.deepEqual(callsByRpc.get("get_rl_refresh_candidates")[0].body, { p_after_player_id: null, p_limit: 20 });
    assert.equal(callsByRpc.get("get-shop-data").length, 1);
    assert.equal(callsByRpc.has("get-global-leaderboard"), false);
    assert.equal(callsByRpc.has("begin_rl_global_leaderboard_snapshot"), false);
    assert.equal(callsByRpc.get("save_rl_shop_snapshot").length, 1);
    assert.match(callsByRpc.get("save_rl_shop_snapshot")[0].body.p_content_hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(callsByRpc.get("record_rl_player_refresh_result")[0].body, {
        p_account_id: "account-1", p_component: "match_history", p_success: false,
        p_error_code: "RL_MATCH_HISTORY_AUTHENTICATED_PLAYER_ONLY"
    });
    assert.deepEqual(callsByRpc.get("record_rl_global_refresh_result")[0].body, {
        p_refresh_key: "shop", p_success: true, p_changed: false, p_error_code: null
    });
    assert.equal(kv.get("rl:scheduled-refresh:cursor"), "player-1");
    assert.ok(JSON.parse(kv.get("admin:service-status:rl-mmr")).lastInvocationAt);
    assert.equal(JSON.parse(kv.get("admin:service-status:rl-shop")).lastSummary.changed, false);
    assert.equal(JSON.parse(kv.get("admin:service-status:rl-health")).lastSummary.checked, 4);
    for (const id of ["supabase", "mmr-api", "provider-runtime", "discord-matchbot"]) {
        assert.ok(JSON.parse(kv.get(`admin:service-status:${id}`)).checkedAt, `${id} health check stored`);
    }
});

test("hourly noon UTC schedule refreshes each leaderboard playlist once", async () => {
    const calls = [];
    const kv = new Map();
    const tasks = [];
    let snapshotNumber = 0;
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname === "mmr.example.test") {
            assert.equal(parsed.pathname, "/get-global-leaderboard");
            const playlistId = Number(parsed.searchParams.get("playlistId"));
            calls.push({ type: "provider", playlistId });
            return Response.json({ success: true, playlistId, entries: [{ platform: "Epic", providerAccountId: "Epic|player|0", displayName: "Player", mmr: 1000, providerValue: null }] });
        }
        if (parsed.hostname === "discord.invalid") return new Response(null, { status: 204 });
        const rpc = parsed.pathname.split("/").at(-1);
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ type: "rpc", rpc, body });
        if (rpc === "begin_rl_global_leaderboard_snapshot") return Response.json({ started: true, snapshotId: `00000000-0000-4000-8000-00000000000${++snapshotNumber}` });
        if (rpc === "complete_rl_global_leaderboard_snapshot") return Response.json({ success: true, entryCount: body.p_source_entry_count });
        if (rpc === "fail_rl_global_leaderboard_snapshot") return Response.json({ success: true });
        if (rpc === "admin_taskboard_summary") return Response.json(rpcPayload);
        throw new Error(`Unexpected request to ${rpc}`);
    };
    const scheduledEnv = {
        ...env(),
        SUPABASE_AUTH: "test-service-role-secret",
        MMR_API_URL: "https://mmr.example.test",
        MMR_API_KEY: "mmr-test-secret",
        SERVICE_STATUS: { async get(key) { return kv.get(key) ?? null; }, async put(key, value) { kv.set(key, value); } }
    };

    await handleScheduled({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 5, 12) }, scheduledEnv, { waitUntil: task => tasks.push(task) });
    await Promise.all(tasks);

    assert.deepEqual(calls.filter(call => call.type === "provider").map(call => call.playlistId), [10, 11, 13]);
    assert.equal(calls.filter(call => call.rpc === "complete_rl_global_leaderboard_snapshot").length, 3);
    assert.equal(calls.filter(call => call.rpc === "admin_taskboard_summary").length, 0);
    assert.equal(JSON.parse(kv.get("admin:service-status:rl-leaderboards")).lastSummary.succeeded, 3);
});

test("protected Worker health exposes last MMR and Shop schedule attempts", async () => {
    const kv = new Map([
        ["admin:service-status:rl-mmr", JSON.stringify({ lastInvocationAt: "2026-10-03T15:00:00Z", lastSummary: { success: true, attempted: 3 } })],
        ["admin:service-status:rl-shop", JSON.stringify({ lastInvocationAt: "2026-10-03T15:00:01Z", lastSummary: { success: true, changed: false } })]
    ]);
    const response = await handleFetch(new Request("https://status.invalid/admin/health", { headers: { Authorization: `Bearer ${TRIGGER_KEY}` } }), {
        ...env(), SERVICE_STATUS: { async get(key) { const value = kv.get(key); return value ? JSON.parse(value) : null; } }
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.scheduledJobs.mmr.lastSummary.attempted, 3);
    assert.equal(result.scheduledJobs.shop.lastSummary.changed, false);
});

test("protected manual Shop refresh uses the same cached snapshot pipeline", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname === "mmr.example.test") {
            calls.push("get-shop-data");
            assert.equal(init.headers.Authorization, "Bearer mmr-test-secret");
            return Response.json({ success: true, shops: [{ id: 7 }], catalogues: [{ shop_id: 7, items: [] }] });
        }
        const rpc = parsed.pathname.split("/").at(-1);
        calls.push(rpc);
        if (rpc === "save_rl_shop_snapshot") return Response.json({ saved: true, snapshot_id: 1 });
        if (rpc === "record_rl_global_refresh_result") return Response.json({ success: true });
        throw new Error(`Unexpected request to ${rpc}`);
    };
    const response = await handleFetch(adminRequest({ job: "shop" }), {
        ...env(), MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "mmr-test-secret"
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.summary, { success: true, changed: true });
    assert.deepEqual(calls, ["get-shop-data", "save_rl_shop_snapshot", "record_rl_global_refresh_result"]);
    assert.equal(JSON.stringify(result).includes("service-secret"), false);
});

test("generated route inventory marks manual run protected", () => {
    const route = WORKER_ROUTE_INVENTORY.find(item => item.path.endsWith("/admin/run-scheduled"));
    assert.equal(route?.authRequired, true);
});

