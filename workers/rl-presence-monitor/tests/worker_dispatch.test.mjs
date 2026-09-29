import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { handleFetch, handleScheduled } from "../src/index.js";
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

test("Taskboard schedule is noon UTC in code and Wrangler config", async () => {
    const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
    const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.match(source, /TASKBOARD_SUMMARY_CRON\s*=\s*"0 12 \* \* \*"/);
    assert.match(config, /"0 12 \* \* \*"/);
    assert.doesNotMatch(config, /"0 0 \* \* \*"/);
});

test("all Worker call schedules are bounded and diagnostic Worker is manual-only", async () => {
    const rlConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const ocrConfig = JSON.parse(await readFile(new URL("../../ocr-job-consumer/wrangler.jsonc", import.meta.url), "utf8"));
    const diagnosticConfig = JSON.parse(await readFile(new URL("../../google-mtls-diagnostic/wrangler.jsonc", import.meta.url), "utf8"));

    assert.deepEqual(rlConfig.triggers.crons, ["*/15 * * * *", "5 11 * * SAT", "0 12 * * *"]);
    assert.deepEqual(ocrConfig.triggers.crons, ["*/30 * * * *"]);
    assert.deepEqual(ocrConfig.queues.consumers.map(({ max_batch_size, max_retries, max_concurrency }) => ({ max_batch_size, max_retries, max_concurrency })), [
        { max_batch_size: 1, max_retries: 2, max_concurrency: 2 }
    ]);
    assert.equal("triggers" in diagnosticConfig, false);
    assert.equal("queues" in diagnosticConfig, false);
    assert.equal(diagnosticConfig.workers_dev, true);
});

test("protected manual route returns a safe Taskboard summary and makes only required calls", async () => {
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
    assert.equal(result.summary.summary.totalTasks, 12);
    assert.equal(calls.length, 2);
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

test("manual route rejects a duplicate same-isolate run instead of duplicating outbound calls", async () => {
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
    await started;
    const duplicate = await handleFetch(adminRequest({ job: "taskboard" }), env());
    assert.equal(duplicate.status, 409);
    releaseRpc();
    assert.equal((await first).status, 200);
    assert.equal(calls, 2);
});

test("unknown scheduled trigger performs no work, and Worker has no queue handler", async () => {
    const tasks = [];
    await handleScheduled({ cron: "0 0 * * *" }, {}, { waitUntil: task => tasks.push(task) });
    assert.equal(tasks.length, 0);
    assert.equal(typeof worker.fetch, "function");
    assert.equal("queue" in worker, false);
});

test("generated route inventory marks manual run protected", () => {
    const route = WORKER_ROUTE_INVENTORY.find(item => item.path.endsWith("/admin/run-scheduled"));
    assert.equal(route?.authRequired, true);
});

