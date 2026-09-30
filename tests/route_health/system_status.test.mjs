import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getSystemStatus, performSystemStatusAction } from "../../functions/services/admin/system_status.js";
import { onRequestGet, onRequestPost } from "../../functions/api/admin/system-status.js";

const INTERNAL_HOSTNAME_FOR_TEST = "ocr-google-transport.internal";

function createEnv() {
    const values = new Map();
    const calls = { presence: 0, transport: 0, mmr: 0 };
    return {
        calls,
        expire() { for (const item of values.values()) item.expiresAt = 0; },
        env: {
            RL_PRESENCE_MONITOR_URL: "https://status.example.test",
            PRESENCE_TRIGGER_KEY: "p".repeat(48),
            SUPABASE_URL: "https://supabase.example.test/rest/v1/",
            SUPABASE_AUTH: "supabase-test-key",
            MMR_API_URL: "https://mmr.example.test",
            MMR_API_KEY: "lookup-key",
            MMR_ADMIN_API_KEY: "admin-key",
            OCR_GOOGLE_TRANSPORT_SECRET: "s".repeat(48),
            RL_STATS_CACHE: {
                async get(key) { const value = values.get(key); return value && value.expiresAt > Date.now() ? JSON.parse(value.body) : null; },
                async put(key, body, options) { assert.equal(options.expirationTtl, 45); values.set(key, { body, expiresAt: Date.now() + options.expirationTtl * 1000 }); },
                async delete(key) { values.delete(key); }
            },
            OCR_GOOGLE_TRANSPORT: {
                async fetch(request) {
                    calls.transport += 1;
                    assert.equal(new URL(request.url).pathname, "/health");
                    return Response.json({ success: true, configuration: { mtlsBindingPresent: true, x509CertificateChainPresent: true, apiUrlPresent: true, apiKeyPresent: true } });
                }
            }
        },
        values
    };
}

function installHealthFetch(calls) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input);
        if (url.hostname === "mmr.example.test") {
            calls.mmr += 1;
            assert.equal(url.pathname, "/health/ready");
            assert.equal(init.headers.Authorization, "Bearer lookup-key");
            return Response.json({ status: "degraded", config: { requiredConfigPresent: true, missingConfig: [] }, psynet: { state: "backoff", lastAuthAttemptAt: "2026-09-28T00:00:00.000Z", lastAuthFailureAt: "2026-09-28T00:00:01.000Z", lastSuccessfulAt: null, lastFailureAt: "2026-09-28T00:00:01.000Z", lastFailureCode: "PSYNET_AUTH_FAILED", lastFailureStage: "psynet_auth", lastProviderCode: "BuildError", backoffUntil: "2026-09-28T00:00:13.000Z", retryAfterSeconds: 12 }, recovery: { lastAttemptAt: "2026-09-28T00:00:00.000Z", lastResult: "failed", attempts: 2, successes: 1, failures: 1 }, traffic: { totalRequests: 4, successfulRequests: 2, failedRequests: 2, emptyRequests: 1, rateLimitedRequests: 1, lastRequestAt: "2026-09-28T00:00:01.000Z", lastSuccessAt: "2026-09-27T23:00:00.000Z", lastFailureAt: "2026-09-28T00:00:01.000Z", lastFailureCode: "PSYNET_AUTH_FAILED", normalLimitPerMinute: 30, emptyLimitPerMinute: 5 } });
        }
        calls.presence += 1;
        assert.equal(url.pathname, "/admin/health");
        assert.equal(init.headers.Authorization, `Bearer ${"p".repeat(48)}`);
        return Response.json({ success: true, status: "unknown", configuration: { supabaseUrlPresent: true, supabaseCredentialPresent: true, mmrApiUrlPresent: true } });
    };
    return () => { globalThis.fetch = originalFetch; };
}

test("system health cache includes protected MMR readiness without starting MMR work", async () => {
    const { env, calls } = createEnv();
    const restore = installHealthFetch(calls);
    try {
        const [first, concurrent] = await Promise.all([getSystemStatus(env), getSystemStatus(env)]);
        assert.equal(first.services.find(item => item.id === "ocr-transport").status, "healthy");
        assert.equal(first.services.find(item => item.id === "rl-presence").status, "unknown");
        const mmr = first.services.find(item => item.id === "mmr-api");
        assert.equal(mmr.status, "degraded");
        assert.deepEqual(mmr.actions, ["recheck", "reconnect", "check-version"]);
        assert.equal(mmr.lastFailureCode, "PSYNET_AUTH_FAILED");
        assert.equal(mmr.lastFailureStage, "psynet_auth");
        assert.equal(mmr.lastProviderCode, "BuildError");
        assert.equal(mmr.configReady, true);
        assert.equal(mmr.mmrRequests, 4);
        assert.equal(mmr.reconnectFailures, 1);
        assert.ok(["miss", "hit"].includes(concurrent.cache));
        await getSystemStatus(env);
        assert.equal(calls.transport, 1);
        assert.equal(calls.presence, 1);
        assert.equal(calls.mmr, 1);
        assert.equal(JSON.stringify(first).includes("lookup-key"), false);
        for (const item of first.services) {
            assert.ok(["healthy", "degraded", "down", "unknown"].includes(item.status));
            assert.ok(item.checkedAt);
            assert.ok(Array.isArray(item.actions));
        }
    } finally { restore(); }
});

test("Worker Status UI is event-driven and exposes only per-service supported actions", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /setInterval\s*\(/);
    assert.match(source, /action === "run-now" \? "▶ Run"/);
    assert.match(source, /action === "reconnect" \? "↻ Reconnect"/);
    assert.match(source, /action === "check-version" \? "↻ Check Rocket League Version"/);
    assert.match(source, /worker-status-indicator/);
    assert.match(source, /makeDetails\(service\)/);
    assert.match(source, /PsyNet state:/);
    assert.match(source, /Last MMR failure:/);
    assert.match(source, /Reconnects:/);
    assert.match(source, /Build status:/);
    assert.match(source, /Last successful validation:/);
    assert.match(source, /Next scheduled version check:/);
    assert.match(source, /\/api\/admin\/page-settings\/route-health/);
    assert.match(source, /systemRouteRows/);
    assert.match(source, /statusIcon\(status\)/);
});

test("health sweep cache expires and then refreshes all bounded checks", async () => {
    const { env, expire, calls } = createEnv();
    const restore = installHealthFetch(calls);
    try {
        await getSystemStatus(env);
        expire();
        await getSystemStatus(env);
        assert.equal(calls.presence, 2);
        assert.equal(calls.transport, 2);
        assert.equal(calls.mmr, 2);
    } finally { restore(); }
});

test("MMR readiness exposes safe runtime build diagnostics", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        const url = new URL(input);
        if (url.hostname === "mmr.example.test") {
            return Response.json({
                status: "degraded",
                config: { requiredConfigPresent: true, missingConfig: [] },
                build: {
                    status: "stale", currentBuildId: "build-safe", currentFeatureSet: "feature-safe",
                    userAgentConfigured: true, userAgentSummary: "Configured Rocket League client user agent",
                    source: "wrangler-fallback", lastVersionCheckAt: "2026-09-28T00:00:02.000Z",
                    lastVersionCheckResult: "RL_VERSION_SOURCE_UNAVAILABLE", lastBuildValidationAt: "2026-09-27T00:00:00.000Z",
                    lastBuildValidationResult: "RL_VERSION_VALIDATED", versionMismatchDetectedAt: "2026-09-28T00:00:01.000Z",
                    nextScheduledCheckAt: "2026-10-03T12:00:00.000Z"
                },
                psynet: { state: "backoff" }, recovery: {}, traffic: {}
            });
        }
        return Response.json({ success: true, status: "unknown", configuration: {} });
    };
    try {
        const status = await getSystemStatus(env);
        const mmr = status.services.find(item => item.id === "mmr-api");
        assert.equal(mmr.buildStatus, "stale");
        assert.equal(mmr.currentBuildId, "build-safe");
        assert.equal(mmr.currentFeatureSet, "feature-safe");
        assert.equal(mmr.userAgentSummary, "Configured Rocket League client user agent");
        assert.equal(mmr.lastVersionCheckResult, "RL_VERSION_SOURCE_UNAVAILABLE");
        assert.equal(mmr.nextScheduledVersionCheckAt, "2026-10-03T12:00:00.000Z");
        assert.equal(JSON.stringify(mmr).includes("PsyToken"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("ordinary MMR Recheck never calls version discovery", async () => {
    const { env } = createEnv();
    const paths = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        const url = new URL(input);
        paths.push(url.pathname);
        assert.equal(url.pathname, "/health/ready");
        return Response.json({ status: "unknown", config: { requiredConfigPresent: true }, build: { status: "unknown" }, psynet: { state: "idle" }, recovery: {}, traffic: {} });
    };
    try {
        await performSystemStatusAction(env, "mmr-api", "recheck");
        assert.deepEqual(paths, ["/health/ready"]);
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR reconnect uses only the configured protected endpoint and returns sanitized state", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(new URL(input).pathname, "/admin/reconnect");
        assert.equal(init.method, "POST");
        assert.equal(init.headers.Authorization, "Bearer admin-key");
        return Response.json({ success: true, state: "connected", completedAt: "2026-09-28T01:00:00.000Z", access_token: "must-not-pass" });
    };
    try {
        const result = await performSystemStatusAction(env, "mmr-api", "reconnect");
        assert.deepEqual(result.result, { state: "connected", completedAt: "2026-09-28T01:00:00.000Z" });
        assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR version check uses its fixed protected endpoint, refreshes readiness once, and sanitizes output", async () => {
    const { env } = createEnv();
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input);
        calls.push({ path: url.pathname, method: init.method, authorization: init.headers.Authorization });
        if (url.pathname === "/admin/check-rocket-league-version") {
            return Response.json({ success: true, resultCode: "RL_VERSION_SOURCE_UNAVAILABLE", state: "stale", currentBuildId: "build-safe", lastVersionCheckAt: "2026-09-28T02:00:00.000Z", access_token: "must-not-pass" });
        }
        assert.equal(url.pathname, "/health/ready");
        return Response.json({ status: "degraded", config: { requiredConfigPresent: true }, build: { status: "stale", currentBuildId: "build-safe", currentFeatureSet: "feature-safe", userAgentConfigured: true, userAgentSummary: "Configured Rocket League client user agent", source: "wrangler-fallback", lastVersionCheckAt: "2026-09-28T02:00:00.000Z", lastVersionCheckResult: "RL_VERSION_SOURCE_UNAVAILABLE", lastBuildValidationAt: "2026-09-27T00:00:00.000Z", lastBuildValidationResult: "RL_VERSION_VALIDATED", versionMismatchDetectedAt: "2026-09-28T00:00:00.000Z", nextScheduledCheckAt: "2026-10-03T12:00:00.000Z" }, psynet: { state: "backoff" }, recovery: {}, traffic: {} });
    };
    try {
        const result = await performSystemStatusAction(env, "mmr-api", "check-version");
        assert.deepEqual(calls.map(call => call.path), ["/admin/check-rocket-league-version", "/health/ready"]);
        assert.equal(calls[0].method, "POST");
        assert.equal(calls[0].authorization, "Bearer admin-key");
        assert.equal(calls[1].authorization, "Bearer lookup-key");
        assert.equal(result.result.resultCode, "RL_VERSION_SOURCE_UNAVAILABLE");
        assert.equal(result.result.currentBuildId, "build-safe");
        assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR version action is unavailable to unauthenticated system-status callers", async () => {
    let outboundCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { outboundCalls += 1; throw new Error("should not call MMR"); };
    try {
        const response = await onRequestPost({
            request: new Request("https://site.example.test/api/admin/system-status", {
                method: "POST",
                headers: { "Content-Type": "application/json", Origin: "https://site.example.test" },
                body: JSON.stringify({ service: "mmr-api", action: "check-version" })
            }),
            env: {}
        });
        assert.ok([401, 403, 503].includes(response.status));
        assert.equal(outboundCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("unsupported system actions fail before any outbound request", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
    try {
        await assert.rejects(performSystemStatusAction(createEnv().env, "supabase", "reconnect"), { code: "SYSTEM_ACTION_UNSUPPORTED", status: 400 });
        assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("explicit Supabase recheck uses only bounded Data API HEAD and returns no data", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls += 1;
        assert.equal(new URL(url).pathname, "/rest/v1/");
        assert.equal(init.method, "HEAD");
        assert.equal(init.headers.apikey, "supabase-test-key");
        return new Response(null, { status: 200 });
    };
    try {
        const result = await performSystemStatusAction(env, "supabase", "recheck");
        assert.equal(result.result.status, "healthy");
        assert.equal(calls, 1);
        assert.equal(JSON.stringify(result).includes("supabase-test-key"), false);
        assert.equal(JSON.stringify(result).includes("profile"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("service action allowlist rejects arbitrary service/action combinations", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
    try {
        await assert.rejects(performSystemStatusAction(createEnv().env, "cloud-run-ocr", "reconnect"), { code: "SYSTEM_ACTION_UNSUPPORTED", status: 400 });
        assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("Cloud Run recheck uses fixed transport diagnostic route and no caller URL", async () => {
    const { env } = createEnv();
    let observed;
    env.OCR_GOOGLE_TRANSPORT.fetch = async request => {
        observed = { url: new URL(request.url), method: request.method, authorization: request.headers.get("Authorization") };
        return Response.json({ success: true, status: "healthy", message: "ready" });
    };
    const result = await performSystemStatusAction(env, "cloud-run-ocr", "recheck");
    assert.equal(observed.url.hostname, INTERNAL_HOSTNAME_FOR_TEST);
    assert.equal(observed.url.pathname, "/admin/recheck/cloud-run");
    assert.equal(observed.method, "POST");
    assert.equal(observed.authorization, `Bearer ${"s".repeat(48)}`);
    assert.equal(result.result.status, "healthy");
});

test("system status route enforces admin permission before checking services", async () => {
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { externalCalls += 1; throw new Error("should not call health services"); };
    try {
        const response = await onRequestGet({ request: new Request("https://site.example.test/api/admin/system-status"), env: {} });
        assert.ok([401, 403, 503].includes(response.status));
        const payload = await response.json();
        assert.equal(payload.success, false);
        assert.equal("services" in payload, false);
        assert.equal(externalCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
});
