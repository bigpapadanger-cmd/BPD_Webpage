import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { claimOperation, weeklyOccurrence, runWeeklySummary, validateSummary } from "../src/index.js";
import { DiscordCommunicationReceipts } from "../src/receipts.js";
import { signedCommunicationRequest, verifyCommunicationRequest, readCommunicationBody } from "../../../functions/services/admin/discord_communications.js";
import { onRequest as summaryRoute } from "../../../functions/api/internal/discord/task-summary.js";
import { onRequest as interactionRoute } from "../../../functions/api/auth/discord/matchbot/interactions.js";

const savedFetch = globalThis.fetch;
const savedTimer = globalThis.setTimeout;
afterEach(() => { globalThis.fetch = savedFetch; globalThis.setTimeout = savedTimer; });
const secret = "test-communication-secret-not-a-production-secret";

test("signed health is read-only and distinguishes disabled from missing enablement", async () => {
    const trap = () => { assert.fail("Health must not select a receipt instance or call Discord"); };
    globalThis.fetch = trap;
    const env = { DISCORD_COMMUNICATIONS_SECRET: secret, DISCORD_COMMUNICATION_RECEIPTS: { idFromName: trap, get: trap } };
    const invalid = await worker.fetch(new Request("https://communications/internal/health", { method: "POST", body: "{}" }), env);
    assert.equal(invalid.status, 401); assert.equal(invalid.headers.get("Cache-Control"), "no-store");
    for (const [flag, expected] of [[undefined, "unknown"], ["invalid", "unknown"], ["false", "disabled"], ["true", "healthy"]]) {
        env.DISCORD_COMMUNICATIONS_ENABLED = flag;
        const request = await signedCommunicationRequest(env, "https://communications/internal/health", {});
        const response = await worker.fetch(request, env), body = await response.json();
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(body.status, expected); assert.equal(body.deliveryChecked, false);
        assert.equal(JSON.stringify(body).includes(secret), false);
    }
});
function storage() {
    const values = new Map(); let alarm = null, tail = Promise.resolve();
    const store = { async get(k) { return values.get(k); }, async put(k, v) { values.set(k, v); },
        async getAlarm() { return alarm; }, async setAlarm(n) { alarm = n; }, async delete(k) { values.delete(k); },
        async list() { return new Map(values); }, transaction(fn) { const run = tail.then(() => fn(store)); tail = run.catch(() => {}); return run; } };
    return store;
}
function environment() {
    const objects = new Map();
    return { DISCORD_COMMUNICATIONS_SECRET: secret, DISCORD_COMMUNICATIONS_ENABLED: "true",
        BPD_SITE_URL: "https://bpd-gaming-network.com", DISCORD_MATCHBOT_CLIENT_ID: "1549606323249877034",
        TASKBOARD_SUMMARY_DISCORD: "https://discord.com/api/webhooks/123456789012345678/test-token",
        NEW_TASKBOARD_REPORT_DISCORD: "https://discord.com/api/webhooks/123456789012345679/test-token",
        DISCORD_COMMUNICATION_RECEIPTS: { idFromName: name => name, get(name) {
            if (!objects.has(name)) objects.set(name, new DiscordCommunicationReceipts({ storage: storage() }));
            return { fetch: (url, init) => objects.get(name).fetch(new Request(url, init)) };
        } } };
}
async function internal(env, path, value) { return worker.fetch(await signedCommunicationRequest(env, `https://internal${path}`, value), env); }
const counts = { total_tasks: 10, active_tasks: 9, deleted_tasks: 1,
    status: { to_do: 2, in_progress: 2, completed: 2, shelved: 2, archived: 1, deleted: 1 },
    responsibility: { owner: 1, database: 2, security: 3, ui: 4 } };

test("atomic operation claim accepts exactly one concurrent duplicate and rejects replay", async () => {
    const env = environment();
    const results = await Promise.all(Array.from({ length: 8 }, () => claimOperation(env, "same-operation", 60000)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await claimOperation(env, "same-operation", 60000), false);
    assert.equal(await claimOperation(env, "other-operation", 60000), true);
});
test("receipt expiry cleanup removes only expired state and storage contains no identity", async () => {
    const store = storage(), object = new DiscordCommunicationReceipts({ storage: store });
    await store.put("a".repeat(64), Date.now() - 1);
    await store.put("b".repeat(64), Date.now() + 60000);
    await object.alarm();
    assert.equal(await store.get("a".repeat(64)), undefined);
    assert.equal(typeof await store.get("b".repeat(64)), "number");
    assert.equal((await object.fetch(new Request("https://receipt", { method: "POST", body: JSON.stringify({ key: "raw-account-id", expiresAt: Date.now() + 60000 }) }))).status, 400);
});
test("signed communication binds method path body expiry and secret", async () => {
    const env = environment();
    const request = await signedCommunicationRequest(env, "https://internal/internal/claim", { key: "operation" });
    const body = await request.clone().text();
    assert.ok(await verifyCommunicationRequest(env, request, body));
    await assert.rejects(verifyCommunicationRequest(env, request, body + " "));
    await assert.rejects(verifyCommunicationRequest({ ...env, DISCORD_COMMUNICATIONS_SECRET: "wrong-secret-with-sufficient-length" }, request, body));
    await assert.rejects(verifyCommunicationRequest(env, new Request("https://internal/other", request), body));
    const headers = new Headers(request.headers); headers.set("X-BPD-Time", "1000000000");
    await assert.rejects(verifyCommunicationRequest(env, new Request(request.url, { method: "POST", headers, body }), body));
});
test("private endpoints reject unsigned callers unknown fields disabled configuration and arbitrary destinations", async () => {
    const env = environment();
    assert.equal((await worker.fetch(new Request("https://internal/internal/claim", { method: "POST", body: "{}" }), env)).status, 401);
    assert.equal((await worker.fetch(new Request("https://internal"), env)).status, 405);
    assert.equal((await internal(env, "/internal/claim", { key: "a", accountId: "forged" })).status, 400);
    assert.equal((await internal(env, "/internal/notify", { destination: "https://evil.test", payload: {} })).status, 400);
    assert.equal((await internal({ ...env, DISCORD_COMMUNICATIONS_ENABLED: "false" }, "/internal/claim", { key: "a" })).status, 503);
});
test("bounded ingress rejects oversized streaming bodies", async () => {
    const request = new Request("https://internal", { method: "POST", body: "x".repeat(2048) });
    await assert.rejects(readCommunicationBody(request, 1024), { code: "UPSTREAM_RESPONSE_TOO_LARGE" });
});
test("weekly schedule is Friday 18:00 New York in standard and daylight time", () => {
    assert.equal(weeklyOccurrence(Date.parse("2026-10-09T22:00:00Z")), "2026-10-09");
    assert.equal(weeklyOccurrence(Date.parse("2026-10-09T23:00:00Z")), null);
    assert.equal(weeklyOccurrence(Date.parse("2026-12-04T23:00:00Z")), "2026-12-04");
    assert.equal(weeklyOccurrence(Date.parse("2026-12-04T22:00:00Z")), null);
    assert.equal(weeklyOccurrence(Date.parse("2026-10-08T22:00:00Z")), null);
});
test("weekly summary uses canonical Pages data and sends once across concurrent scheduled attempts", async () => {
    const env = environment(); let calls = 0, deliveries = 0;
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls++;
        if (new URL(request.url).hostname === "bpd-gaming-network.com") {
            assert.ok(await verifyCommunicationRequest(env, request, await request.clone().text()));
            return Response.json(counts);
        }
        deliveries++;
        const payload = JSON.parse(init.body);
        assert.deepEqual(payload.allowed_mentions, { parse: [] });
        assert.match(payload.embeds[0].title, /Weekly/);
        return new Response(null, { status: 204 });
    };
    const timestamp = Date.parse("2026-10-09T22:00:00Z");
    await Promise.all([runWeeklySummary(env, timestamp), runWeeklySummary(env, timestamp)]);
    assert.equal(deliveries, 1); assert.equal(calls, 2);
});
test("malformed summaries fail closed instead of fabricating zero and failed sends do not retry", async () => {
    assert.deepEqual(validateSummary(counts), counts);
    for (const value of [{}, { ...counts, active_tasks: null }, { ...counts, status: {} }]) assert.throws(() => validateSummary(value));
    const env = environment(); let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("secret upstream payload"); };
    await assert.rejects(runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z")));
    await runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z"));
    assert.equal(calls, 1);
});
test("weekly failure diagnostics identify the boundary without webhook, token or payload leakage", async () => {
    const logs = [], original = console.info;
    console.info = (...args) => logs.push(args);
    const env = environment();
    globalThis.fetch = async () => Response.json({ private: "sensitive-account-email-token" }, { status: 503 });
    try {
        await assert.rejects(runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z")));
        const record = logs.find(([label]) => label === "[DISCORD WEEKLY DIAGNOSTIC]")[1];
        assert.equal(record.stage, "summary_fetch_body"); assert.equal(record.rpc, "admin_taskboard_summary");
        assert.equal(record.upstreamStatus, 503); assert.equal(typeof record.debugId, "string");
        assert.equal(typeof record.elapsedMs, "number");
        assert.doesNotMatch(JSON.stringify(logs), /sensitive|discord.com|webhooks|test-communication-secret|private-service/);
    } finally { console.info = original; }
});

test("signed summary endpoint is read-only, replay protected and unavailable to browsers", async () => {
    const env = { ...environment(), SUPABASE_URL: "https://database.example/rest/v1/", SUPABASE_SERVICE_ROLE_KEY: "private-service-key" };
    env.DISCORD_COMMUNICATIONS = { fetch: request => worker.fetch(request, env) };
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls++; assert.ok(String(url).endsWith("/rpc/admin_taskboard_summary"));
        assert.equal(init.headers["Content-Profile"], "api");
        return Response.json(counts);
    };
    const unsigned = await summaryRoute({ env, request: new Request("https://bpd-gaming-network.com/api/internal/discord/task-summary", { method: "POST", body: "{}" }) });
    assert.equal(unsigned.status, 503); assert.equal(calls, 0);
    const request = await signedCommunicationRequest(env, "https://bpd-gaming-network.com/api/internal/discord/task-summary", { occurrence: "2026-10-09" });
    assert.deepEqual(await (await summaryRoute({ env, request: request.clone() })).json(), counts);
    assert.equal((await summaryRoute({ env, request: request.clone() })).status, 409);
    assert.equal(calls, 1);
});
test("Discord ingress verifies signature and replay before account work and privately defers", async () => {
    const env = environment(); env.DISCORD_COMMUNICATIONS = { fetch: request => worker.fetch(request, env) };
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    env.DISCORD_MATCHBOT_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ id: "123456789012345678", application_id: env.DISCORD_MATCHBOT_CLIENT_ID, type: 2,
        token: "test-token", member: { user: { id: "223456789012345678" } }, data: { name: "complete" } });
    const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body))).toString("hex");
    const request = () => new Request("https://bpd-gaming-network.com/api/auth/discord/matchbot/interactions", { method: "POST", body,
        headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp } });
    // Lookup lacks credentials, so the deferred safe reply does not mutate.
    globalThis.fetch = async () => new Response(null, { status: 204 });
    let background;
    const response = await interactionRoute({ request: request(), env, waitUntil: p => { background = p; } });
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await background;
    assert.equal((await interactionRoute({ request: request(), env, waitUntil() {} })).status, 409);
    const invalid = new Request(request(), { headers: { "X-Signature-Ed25519": "bad", "X-Signature-Timestamp": timestamp } });
    assert.equal((await interactionRoute({ request: invalid, env })).status, 401);
});
test("Worker has no public routes Supabase bindings or provider credentials", async () => {
    const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const pagesConfig = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
    assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
    assert.equal(config.routes, undefined); assert.equal(config.services, undefined);
    assert.equal(config.vars.DISCORD_COMMUNICATIONS_ENABLED, "true");
    assert.equal(pagesConfig.vars.DISCORD_COMMUNICATIONS_ENABLED, "true");
    assert.deepEqual(config.triggers.crons, ["0 22,23 * * 5"]);
    assert.equal(JSON.stringify(config).includes("SUPABASE"), false);
});

test("provider timeout covers headers and body without automatic delivery retries", async () => {
    globalThis.setTimeout = (fn, delay, ...args) => savedTimer(fn, delay === 10000 ? 10 : delay, ...args);
    for (const bodyStall of [false, true]) {
        const env = environment(); let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return bodyStall ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {});
        };
        await assert.rejects(runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z")), { code: "UPSTREAM_TIMEOUT" });
        await runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z"));
        assert.equal(calls, 1);
    }
});
test("oversized provider bodies and rate limits stay sanitized and do not trigger retries", async () => {
    const env = environment(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("x".repeat(20000)); };
    await assert.rejects(runWeeklySummary(env, Date.parse("2026-10-09T22:00:00Z")), { code: "UPSTREAM_RESPONSE_TOO_LARGE" });
    const payload = { username: "BPD Taskboard", content: "Task complete", embeds: [{ title: "Completed" }], allowed_mentions: { parse: [] } };
    globalThis.fetch = async () => { calls++; return Response.json({ private: "do-not-expose" }, { status: 429, headers: { "Retry-After": "30" } }); };
    const response = await internal(env, "/internal/notify", { destination: "summary", payload });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, code: "DISCORD_RATE_LIMITED" });
    assert.equal((await internal(env, "/internal/notify", { destination: "summary", payload })).status, 200);
    assert.equal(calls, 2);
});
