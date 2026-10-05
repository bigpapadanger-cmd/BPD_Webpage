import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getSystemStatus, performSystemStatusAction, runScheduledAdminHealthChecks, updateMmrBuildConfiguration } from "../../functions/services/admin/system_status.js";
import { getPermissionsForDiscordRoles, ADMIN_PERMISSIONS } from "../../functions/services/admin/permissions.js";
import { onRequestGet, onRequestPost } from "../../functions/api/admin/system-status.js";
import { getMmrControlModel } from "../../public/Global/Admin/WorkerStatus/JS/mmr_controls.js";
import { ROCKET_LEAGUE_CAPABILITIES, ROCKET_LEAGUE_CAPABILITY_CATEGORIES } from "../../public/Global/Admin/WorkerStatus/JS/rocket_league_capabilities.js";

const INTERNAL_HOSTNAME_FOR_TEST = "ocr-google-transport.internal";

function createEnv() {
    const values = new Map();
    const calls = { presence: 0, transport: 0, mmr: 0, providerRuntime: 0 };
    return {
        calls,
        expire() { for (const item of values.values()) item.expiresAt = 0; },
        seedStatus(id, status, checkedAt) { values.set(`admin:service-status:${id}`, { body: JSON.stringify({ id, name: id, status, checkedAt, lastSuccessfulAt: checkedAt }), expiresAt: Date.now() + 60_000 }); },
        env: {
            RL_PRESENCE_MONITOR_URL: "https://status.example.test",
            PRESENCE_TRIGGER_KEY: "p".repeat(48),
            SUPABASE_URL: "https://supabase.example.test/rest/v1/",
            SUPABASE_AUTH: "supabase-test-key",
            MMR_API_URL: "https://mmr.example.test",
            MMR_API_KEY: "lookup-key",
            MMR_ADMIN_API_KEY: "admin-key",
            OCR_GOOGLE_TRANSPORT_SECRET: "s".repeat(48),
            PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64),
            PROVIDER_RUNTIME: {
                async fetch() {
                    calls.providerRuntime += 1;
                    return Response.json({ success: true, service: "bpd-provider-runtime", status: "ok", timestamp: new Date().toISOString() });
                }
            },
            RL_STATS_CACHE: {
                async get(key) { const value = values.get(key); return value && value.expiresAt > Date.now() ? JSON.parse(value.body) : null; },
                async put(key, body, options) { values.set(key, { body, expiresAt: Date.now() + options.expirationTtl * 1000 }); },
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
            return Response.json({
                status: "degraded", rootCause: "PSYNET_AUTH_FAILED", activeRepair: null,
                availableActions: ["recheck", "reconnect-psynet", "repair-session"],
                components: {
                    worker: { status: "healthy" }, configuration: { status: "healthy" },
                    eosAuthorization: { status: "healthy", state: "authorized" },
                    psynetAuthentication: { status: "unhealthy", state: "failed", lastSuccessAt: null },
                    psynetSocket: { status: "unhealthy", state: "disconnected" },
                    buildConfiguration: { status: "healthy", gameVersion: "260918.75141.528314", derivedBuildId: "246758282", featureSet: "PrimeUpdate60", configurationGeneration: 1, source: "runtime-validated", buildSecretConfigured: true },
                    mmrService: { status: "degraded", lastFailureAt: "2026-09-28T00:00:01.000Z", lastFailureCode: "PSYNET_AUTH_FAILED" }
                },
                config: { requiredConfigPresent: true, missingConfig: [] },
                build: { status: "valid", nextScheduledCheckAt: "2026-10-03T12:00:00.000Z", lastVersionCheckResult: "RL_VERSION_MISMATCH" },
                psynet: { state: "idle", lastAuthAttemptAt: "2026-09-28T00:00:00.000Z", lastFailureCode: "PSYNET_AUTH_FAILED", lastFailureStage: "psynet_auth", lastProviderCode: "BuildError" },
                recovery: { lastRepairAction: "reconnect-psynet", lastRepairResult: "failed" },
                traffic: { totalRequests: 4, successfulRequests: 2, failedRequests: 2, emptyRequests: 1, rateLimitedRequests: 1, lastRequestAt: "2026-09-28T00:00:01.000Z", lastSuccessAt: "2026-09-27T23:00:00.000Z", lastFailureAt: "2026-09-28T00:00:01.000Z", lastFailureCode: "PSYNET_AUTH_FAILED" }
            });
        }
        calls.presence += 1;
        assert.equal(url.pathname, "/admin/health");
        return Response.json({ success: true, status: "unknown", configuration: {}, scheduledJobs: { mmr: { lastInvocationAt: "2026-10-03T15:00:00Z", lastSummary: { attempted: 2, mmrChanged: 1, mmrUnchanged: 1 } }, shop: { lastInvocationAt: "2026-10-03T15:00:01Z", lastSummary: { changed: false } } } });
    };
    return () => { globalThis.fetch = originalFetch; };
}

test("system health cache includes protected MMR readiness without starting MMR work", async () => {
    const { env, calls } = createEnv();
    const restore = installHealthFetch(calls);
    try {
        const [first, concurrent] = await Promise.all([getSystemStatus(env), getSystemStatus(env)]);
        const monitor = first.services.find(item => item.id === "rl-presence");
        const mmr = first.services.find(item => item.id === "mmr-api");
        assert.equal(monitor.scheduledJobs.shop.lastSummary.changed, false);
        assert.equal(monitor.scheduledJobs.mmr.lastSummary.attempted, 2);
        assert.equal(monitor.scheduledJobs.mmr.lastSummary.mmrChanged, 1);
        assert.equal(mmr.status, "degraded");
        assert.equal(mmr.rootCause, "PSYNET_AUTH_FAILED");
        assert.deepEqual(mmr.actions, ["recheck", "reconnect-psynet", "repair-session"]);
        assert.equal(mmr.components.eosAuthorization.state, "authorized");
        assert.equal(mmr.gameVersion, "260918.75141.528314");
        assert.equal(mmr.currentBuildId, "246758282");
        assert.equal(mmr.currentFeatureSet, "PrimeUpdate60");
        assert.equal(mmr.configurationGeneration, 1);
        assert.equal(mmr.historical.lastVersionCheckResult, "RL_VERSION_MISMATCH");
        assert.equal(mmr.mmrRequests, 4);
        assert.ok(["miss", "hit"].includes(concurrent.cache));
        assert.equal(calls.mmr, 1);
        assert.equal(JSON.stringify(first).includes("lookup-key"), false);
    } finally { restore(); }
});

test("provider runtime health uses the private Service Binding and exposes only its safe contract", async () => {
    const { env, calls } = createEnv();
    let observed;
    env.PROVIDER_RUNTIME.fetch = async request => {
        calls.providerRuntime += 1;
        observed = { url: new URL(request.url), method: request.method, authorization: request.headers.get("Authorization") };
        return Response.json({ success: true, service: "bpd-provider-runtime", status: "ok", timestamp: new Date().toISOString() });
    };
    const restore = installHealthFetch(calls);
    try {
        const status = await getSystemStatus(env, { force: true });
        const runtime = status.services.find(item => item.id === "provider-runtime");
        assert.equal(runtime.name, "bpd-provider-runtime");
        assert.equal(runtime.status, "healthy");
        assert.equal(runtime.message, "Provider runtime is online.");
        assert.ok(Number.isFinite(runtime.responseTimeMs));
        assert.ok(Number.isFinite(Date.parse(runtime.checkedAt)));
        assert.deepEqual({ hostname: observed.url.hostname, pathname: observed.url.pathname, method: observed.method }, {
            hostname: "bpd-provider-runtime.internal", pathname: "/internal/health", method: "GET"
        });
        assert.equal(observed.authorization, `Bearer ${env.PROVIDER_RUNTIME_CALLER_SECRET}`);
        assert.equal(calls.providerRuntime, 1);
        assert.equal(JSON.stringify(runtime).includes(env.PROVIDER_RUNTIME_CALLER_SECRET), false);
    } finally { restore(); }
});

test("provider runtime degraded health is reported without invoking a provider", async () => {
    const { env, calls } = createEnv();
    env.PROVIDER_RUNTIME.fetch = async () => {
        calls.providerRuntime += 1;
        return Response.json({ success: true, service: "bpd-provider-runtime", status: "degraded", timestamp: new Date().toISOString() });
    };
    const restore = installHealthFetch(calls);
    try {
        const runtime = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
        assert.equal(runtime.status, "degraded");
        assert.equal(runtime.message, "Provider runtime is reachable but reports degraded health.");
        assert.equal(calls.providerRuntime, 1);
    } finally { restore(); }
});

test("provider runtime service recheck uses its fixed Service Binding health path", async () => {
    const { env, values, calls } = createEnv();
    env.RL_STATS_CACHE.put = async (key, body, options) => {
        values.set(key, { body, expiresAt: Date.now() + options.expirationTtl * 1000 });
    };
    const result = await performSystemStatusAction(env, "provider-runtime", "recheck");
    assert.equal(result.success, true);
    assert.equal(result.result.status, "healthy");
    assert.equal(calls.providerRuntime, 1);
    assert.equal(JSON.stringify(result).includes(env.PROVIDER_RUNTIME_CALLER_SECRET), false);
});

test("provider runtime health rejects weak or whitespace-modified caller configuration", async () => {
    const { env } = createEnv();
    let calls = 0;
    env.PROVIDER_RUNTIME.fetch = async () => { calls += 1; return Response.json({}); };
    for (const secret of ["x".repeat(63), "x".repeat(257), `${"x".repeat(64)} `, ` ${"x".repeat(64)}`]) {
        env.PROVIDER_RUNTIME_CALLER_SECRET = secret;
        const result = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
        assert.equal(result.status, "down");
        assert.equal(result.errorCode, "PROVIDER_RUNTIME_CALLER_SECRET_UNCONFIGURED");
    }
    assert.equal(calls, 0);
});

test("provider runtime health timeout remains active through response body parsing", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { env } = createEnv();
    let started;
    const responseStarted = new Promise(resolve => { started = resolve; });
    env.PROVIDER_RUNTIME.fetch = async () => {
        started();
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }));
    };
    try {
        const pending = getSystemStatus(env, { force: true });
        await responseStarted;
        await new Promise(resolve => setImmediate(resolve));
        t.mock.timers.tick(2000);
        const status = (await pending).services.find(item => item.id === "provider-runtime");
        assert.equal(status.status, "down");
        assert.equal(status.errorCode, "PROVIDER_RUNTIME_TIMEOUT");
    } finally { t.mock.timers.reset(); }
});

test("provider runtime timeout and malformed health responses fail offline with sanitized codes", async () => {
    const { env, calls } = createEnv();
    const restore = installHealthFetch(calls);
    try {
        env.PROVIDER_RUNTIME.fetch = request => new Promise((resolve, reject) => {
            request.signal.addEventListener("abort", () => {
                const error = new Error("internal timeout details");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        });
        const timedOut = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
        assert.equal(timedOut.status, "down");
        assert.equal(timedOut.errorCode, "PROVIDER_RUNTIME_TIMEOUT");
        assert.equal(timedOut.message, "Provider runtime health check timed out.");
        assert.equal(JSON.stringify(timedOut).includes("internal timeout details"), false);

        env.PROVIDER_RUNTIME.fetch = async () => Response.json({
            success: true, service: "bpd-provider-runtime", status: "ok", timestamp: "not-a-time",
            discordUserId: "123456789012345678", botToken: "must-not-pass", supabaseUrl: "must-not-pass"
        });
        const malformed = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
        assert.equal(malformed.status, "down");
        assert.equal(malformed.errorCode, "PROVIDER_RUNTIME_HEALTH_INVALID");
        assert.equal(JSON.stringify(malformed).includes("123456789012345678"), false);
        assert.equal(JSON.stringify(malformed).includes("must-not-pass"), false);
    } finally { restore(); }
});

test("provider runtime Admin health classifies rejected caller auth and missing endpoint safely", async () => {
    const { env } = createEnv();
    env.PROVIDER_RUNTIME.fetch = async () => new Response("private response body", { status: 401 });
    const unauthorized = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
    assert.equal(unauthorized.errorCode, "PROVIDER_RUNTIME_CALLER_REJECTED");
    assert.equal(JSON.stringify(unauthorized).includes("private response body"), false);

    env.PROVIDER_RUNTIME.fetch = async () => new Response("private response body", { status: 404 });
    const missingRoute = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "provider-runtime");
    assert.equal(missingRoute.errorCode, "PROVIDER_RUNTIME_HEALTH_ENDPOINT_MISSING");
    assert.equal(JSON.stringify(missingRoute).includes("private response body"), false);
});

test("Worker Status UI is event-driven and exposes current MMR operations", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /setInterval\s*\(/);
    assert.match(source, /setTimeout\(poll, 7000\)/);
    assert.match(source, /"refresh-eos": "Refresh EOS"/);
    assert.match(source, /"reauthorize-account": "Reauthorize Account"/);
    assert.match(source, /"reconnect-psynet": "Reconnect PsyNet"/);
    assert.match(source, /"repair-session": "Repair Session"/);
    assert.match(source, /MMR Functional Test/);
    assert.match(source, /name = "buildSecret"/);
    assert.match(source, /secret\.type = "password"/);
    assert.match(source, /form\.elements\.buildSecret\.value = ""/);
    assert.match(source, /Historical diagnostics/);
    assert.match(source, /getMmrControlModel\(service, canDeployMmr\)/);
    assert.match(source, /Hourly MMR refresh/);
    assert.match(source, /Hourly Shop refresh/);
    assert.match(source, /snapshot unchanged/);
    assert.match(source, /MMR changed/);
});

test("Rocket League capability registry reflects supported Worker capabilities and keeps inactive entries inert", async () => {
    const expectedIds = [
        "player-profile", "presence", "xp-progression", "player-stats", "match-history", "mmr-skills", "leaderboards", "playlists", "population",
        "clubs", "tournaments", "training", "rocket-pass", "inventory-products", "item-shop", "wallet", "challenges",
        "regions", "ping-game-servers", "party", "matchmaking", "reservations-join-match"
    ];
    assert.deepEqual(ROCKET_LEAGUE_CAPABILITIES.map(capability => capability.id), expectedIds);
    assert.deepEqual(ROCKET_LEAGUE_CAPABILITY_CATEGORIES.map(category => category.id), ["players", "competitive", "community", "account-items", "network-diagnostics", "advanced"]);
    const active = ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.status === "active");
    assert.deepEqual(active.map(({ id, serviceId }) => ({ id, serviceId })), [
        { id: "player-profile", serviceId: "mmr-api" },
        { id: "presence", serviceId: "rl-presence" },
        { id: "player-stats", serviceId: "mmr-api" },
        { id: "mmr-skills", serviceId: "mmr-api" },
        { id: "clubs", serviceId: "mmr-api" }
    ]);
    const placeholders = ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.status !== "active");
    assert.equal(placeholders.length, 17);
    assert.ok(placeholders.every(capability => ["placeholder", "future", "unsupported"].includes(capability.status)));
    assert.ok(placeholders.every(capability => ["read-only", "interactive"].includes(capability.access)));
    assert.ok(placeholders.every(capability => !("serviceId" in capability) && !("action" in capability) && !("endpoint" in capability)));
    assert.equal(ROCKET_LEAGUE_CAPABILITIES.find(capability => capability.id === "match-history").status, "unsupported");
    assert.equal(ROCKET_LEAGUE_CAPABILITIES.find(capability => capability.id === "presence").status, "active");
    assert.equal(ROCKET_LEAGUE_CAPABILITIES.find(capability => capability.id === "clubs").status, "active");
    assert.match(ROCKET_LEAGUE_CAPABILITIES.find(capability => capability.id === "presence").purpose, /15-minute monitor/);
    assert.match(ROCKET_LEAGUE_CAPABILITIES.find(capability => capability.id === "player-profile").purpose, /display username only/);
    assert.deepEqual(ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.priority).sort((a, b) => a.priority - b.priority).slice(0, 6).map(capability => capability.id), ["player-profile", "player-stats", "match-history", "playlists", "population", "leaderboards"]);
    assert.ok(ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.category === "advanced").every(capability => capability.status === "future" && capability.access === "interactive"));

    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    const renderer = source.slice(source.indexOf("function renderRocketLeagueCapabilities"), source.indexOf("function makeDetails"));
    assert.match(source, /renderRocketLeagueCapabilities\(payload\.services\)/);
    assert.match(renderer, /document\.createElement\("details"\)/);
    assert.match(renderer, /document\.createElement\("summary"\)/);
    assert.match(renderer, /if \(!isActive\) item\.setAttribute\("aria-disabled", "true"\)/);
    assert.doesNotMatch(renderer, /\bfetch\s*\(/);
    assert.doesNotMatch(renderer, /addEventListener\s*\(/);
    const css = await readFile(new URL("../../public/Global/Admin/WorkerStatus/CSS/index.css", import.meta.url), "utf8");
    assert.match(renderer, /group\.className = "rocket-capability-category worker-status-row"/);
    assert.match(renderer, /summary\.className = "rocket-capability-category-summary worker-status-primary"/);
    assert.match(css, /\.rocket-capability-categories\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /\.rocket-capability-category\s*>\s*summary\s*\{/);
    assert.match(css, /\.rocket-capability-list\s*\{[^}]*display:\s*grid/s);
    assert.match(css, /\.rocket-capability-unsupported\s*\{/);
});

test("MMR controls keep operational, functional, build, and deployment gates separate", () => {
    const service = { id: "mmr-api", actions: ["recheck", "repair-session"], supportsBuildUpdate: false };
    assert.deepEqual(getMmrControlModel(service, true), { actions: ["recheck", "repair-session"], showBuildUpdate: false, showFunctionalTest: true, showDeploy: true, showOperations: true });
    assert.deepEqual(getMmrControlModel({ ...service, actions: [...service.actions, "validate-build"], supportsBuildUpdate: true }, false), { actions: ["recheck", "repair-session"], showBuildUpdate: true, showFunctionalTest: true, showDeploy: false, showOperations: true });
    assert.equal(getMmrControlModel({ ...service, id: "supabase" }, true).showFunctionalTest, false);
});

test("Admin role receives system-status and MMR deploy permissions", () => {
    const permissions = getPermissionsForDiscordRoles({ isAdmin: true });
    assert.ok(permissions.includes(ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE));
    assert.ok(permissions.includes(ADMIN_PERMISSIONS.MMR_DEPLOY));
    const canDeployMmr = permissions.includes(ADMIN_PERMISSIONS.MMR_DEPLOY);
    assert.equal(getMmrControlModel({ id: "mmr-api", supportsBuildUpdate: false }, canDeployMmr).showDeploy, true);
});

test("provider runtime is called only server-side and has no browser/public route", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    const config = JSON.parse(await readFile(new URL("../../workers/bpd-provider-runtime/wrangler.jsonc", import.meta.url), "utf8"));
    assert.match(source, /fetch\("\/api\/admin\/system-status"/);
    assert.doesNotMatch(source, /bpd-provider-runtime\.internal|PROVIDER_RUNTIME_CALLER_SECRET|PROVIDER_RUNTIME/);
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.placement, { mode: "smart" });
    assert.equal("routes" in config, false);
    assert.match(source, /healthy: "Online", degraded: "Degraded", down: "Down", unknown: "Unknown"/);
    assert.match(source, /Health check: \$\{service\.errorCode\}/);
    assert.match(source, /service\.checkedAt \? `Checked/);
    assert.match(source, /Number\.isFinite\(service\.responseTimeMs\)/);
});

test("missing MMR server authorization omits reconnect/version/build capabilities", async () => {
    const { env } = createEnv();
    delete env.MMR_ADMIN_API_KEY;
    const restore = installHealthFetch({ presence: 0, transport: 0, mmr: 0 });
    try {
        const status = await getSystemStatus(env, { force: true });
        const mmr = status.services.find(item => item.id === "mmr-api");
        assert.deepEqual(mmr.actions, ["recheck"]);
        assert.equal(mmr.supportsBuildUpdate, false);
        const adminControls = getMmrControlModel(mmr, true);
        assert.equal(adminControls.showBuildUpdate, false);
        assert.equal(adminControls.showDeploy, true);
    } finally { restore(); }
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

test("current healthy MMR state is not degraded by historical VersionMismatch", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        if (new URL(input).hostname !== "mmr.example.test") return Response.json({ success: true, status: "unknown", configuration: {} });
        return Response.json({
            status: "healthy", rootCause: null, activeRepair: null, availableActions: ["recheck"],
            components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy", state: "authorized" }, psynetAuthentication: { status: "healthy", state: "valid" }, psynetSocket: { status: "healthy", state: "connected" }, buildConfiguration: { status: "healthy", gameVersion: "260918.75141.528314", derivedBuildId: "246758282", featureSet: "PrimeUpdate60", configurationGeneration: 1, source: "runtime-validated", buildSecretConfigured: true }, mmrService: { status: "healthy" } },
            config: { requiredConfigPresent: true }, build: { status: "valid", lastVersionCheckResult: "RL_VERSION_MISMATCH" }, psynet: { state: "connected" }, recovery: {}, traffic: {}
        });
    };
    try {
        const mmr = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "mmr-api");
        assert.equal(mmr.status, "healthy");
        assert.equal(mmr.rootCause, null);
        assert.deepEqual(mmr.actions, ["recheck"]);
        assert.equal(mmr.historical.lastVersionCheckResult, "RL_VERSION_MISMATCH");
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR Recheck uses the same cheap readiness checker as the hourly health runner", async () => {
    const { env } = createEnv();
    const paths = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input); paths.push(url.pathname);
        assert.equal(init.headers.Authorization, "Bearer lookup-key");
        return Response.json({ status: "healthy", rootCause: null, availableActions: ["recheck"], components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy" }, psynetAuthentication: { status: "healthy" }, psynetSocket: { status: "healthy" }, buildConfiguration: { status: "healthy" }, mmrService: { status: "healthy" } }, config: { requiredConfigPresent: true }, build: {}, psynet: {}, recovery: {}, traffic: {} });
    };
    try {
        const result = await performSystemStatusAction(env, "mmr-api", "recheck");
        assert.deepEqual(paths, ["/health/ready"]);
        assert.equal(result.result.status, "healthy");
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR reconnect uses the protected endpoint and refreshes safe readiness", async () => {
    const { env } = createEnv();
    const paths = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const path = new URL(input).pathname; paths.push(path);
        if (path === "/admin/reconnect") { assert.equal(init.headers.Authorization, "Bearer admin-key"); return Response.json({ success: true, state: "connected", PsyToken: "must-not-pass" }); }
        return Response.json({ status: "healthy", rootCause: null, availableActions: ["recheck"], components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy" }, psynetAuthentication: { status: "healthy" }, psynetSocket: { status: "healthy", state: "connected" }, buildConfiguration: { status: "healthy" }, mmrService: { status: "healthy" } }, config: { requiredConfigPresent: true }, build: {}, psynet: {}, recovery: {}, traffic: {} });
    };
    try {
        const result = await performSystemStatusAction(env, "mmr-api", "reconnect-psynet");
        assert.deepEqual(paths, ["/admin/reconnect", "/health/ready"]);
        assert.equal(result.result.state, "connected");
        assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR refresh, repair, and authorization use fixed protected endpoints", async () => {
    const cases = [["refresh-eos", "/admin/refresh"], ["repair-session", "/admin/repair-session"], ["reauthorize-account", "/admin/bootstrap"], ["poll-authorization", "/admin/poll"]];
    for (const [action, expected] of cases) {
        const { env } = createEnv();
        const paths = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
            const path = new URL(input).pathname; paths.push(path); assert.equal(init.headers.Authorization, "Bearer admin-key");
            if (path === "/admin/bootstrap") return Response.json({ url: "https://www.epicgames.com/activate?userCode=SAFE", interval: 10, device_code: "must-not-pass" });
            if (path === "/admin/poll") return Response.json({ status: "authorized", access_token: "must-not-pass" });
            if (path.startsWith("/admin/")) return Response.json({ success: true, resultCode: "OK", refresh_token: "must-not-pass" });
            return Response.json({ status: "healthy", rootCause: null, availableActions: ["recheck"], components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy" }, psynetAuthentication: { status: "healthy" }, psynetSocket: { status: "healthy" }, buildConfiguration: { status: "healthy" }, mmrService: { status: "healthy" } }, config: { requiredConfigPresent: true }, build: {}, psynet: {}, recovery: {}, traffic: {} });
        };
        try {
            const result = await performSystemStatusAction(env, "mmr-api", action);
            assert.equal(paths[0], expected);
            assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
        } finally { globalThis.fetch = originalFetch; }
    }
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

test("admin action logs use request correlation without account IDs", async () => {
    const source = await readFile(new URL("../../functions/api/admin/system-status.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /accountId:\s*authorization\.accountId/u);
    assert.match(source, /requestId, requestedAt/u);
    assert.doesNotMatch(source, /actorRef|createAdminActorReference/u);
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

test("explicit Supabase recheck calls the bounded read-only featured RPC and returns no data", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls += 1;
        assert.equal(new URL(url).pathname, "/rest/v1/rpc/get_rl_featured_player");
        assert.equal(init.method, "POST");
        assert.equal(init.headers.apikey, "supabase-test-key");
        assert.equal(init.headers["Accept-Profile"], "api");
        assert.deepEqual(JSON.parse(init.body), {});
        return Response.json({ featuredDate: "2026-10-05", validUntil: "2026-10-06T00:00:00Z", player: null });
    };
    try {
        const result = await performSystemStatusAction(env, "supabase", "recheck");
        assert.equal(result.result.status, "healthy");
        assert.equal(calls, 1);
        assert.equal(JSON.stringify(result).includes("supabase-test-key"), false);
        assert.equal(JSON.stringify(result).includes("profile"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("stale persisted health becomes Unknown while preserving the last operational status", async () => {
    const { env, calls, seedStatus } = createEnv();
    const staleAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    seedStatus("supabase", "healthy", staleAt);
    seedStatus("discord-matchbot", "healthy", staleAt);
    const restore = installHealthFetch(calls);
    try {
        const status = await getSystemStatus(env, { force: true });
        for (const id of ["supabase", "discord-matchbot"]) {
            const service = status.services.find(item => item.id === id);
            assert.equal(service.status, "unknown");
            assert.equal(service.canonicalStatus, "unknown");
            assert.equal(service.stale, true);
            assert.equal(service.lastKnownStatus, "healthy");
            assert.equal(service.checkedAt, staleAt);
        }
    } finally { restore(); }
});

test("hourly health runner stores the same bounded service checks in shared status KV", async () => {
    const { env, values } = createEnv();
    env.PROVIDER_RUNTIME.fetch = async request => {
        const path = new URL(request.url).pathname;
        if (path === "/internal/health") return Response.json({ success: true, service: "bpd-provider-runtime", status: "ok", timestamp: new Date().toISOString() });
        if (path === "/internal/discord/bot-health") return Response.json({ success: true, botAuthenticated: true, checkedAt: new Date().toISOString() });
        throw new Error("Unexpected provider-runtime health path");
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        const url = new URL(input);
        if (url.hostname === "supabase.example.test") return Response.json({ featuredDate: "2026-10-05", validUntil: "2026-10-06T00:00:00Z", player: null });
        if (url.hostname === "mmr.example.test") return Response.json({ status: "healthy", components: {} });
        throw new Error("Unexpected health request");
    };
    try {
        const result = await runScheduledAdminHealthChecks(env);
        assert.deepEqual([result.checked, result.healthy, result.degraded, result.down, result.unknown], [4, 4, 0, 0, 0]);
        for (const id of ["supabase", "mmr-api", "provider-runtime", "discord-matchbot"]) {
            const stored = JSON.parse(values.get(`admin:service-status:${id}`).body);
            assert.equal(stored.status, "healthy");
            assert.equal(stored.canonicalStatus, "healthy");
            assert.ok(stored.checkedAt);
        }
    } finally { globalThis.fetch = originalFetch; }
});

test("Admin service rows group exclusively by backend canonical health", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Global/Admin/WorkerStatus/HTML/index.html", import.meta.url), "utf8");
    assert.match(html, /id="workerStatusGroups"/);
    assert.match(source, /service\.canonicalStatus/);
    assert.match(source, /statusNames = \{ healthy: "Online", degraded: "Degraded", down: "Down", unknown: "Unknown" \}/);
    assert.match(source, /\["degraded", "down"\]\.includes\(status\) && services\.length > 0/);
    assert.match(source, /previous\.count === 0 \? true : previous\.open/);
    assert.match(source, /`\(\$\{services\.length\}\)`/);
    assert.doesNotMatch(source, /String\(service\.status \|\| "unknown"\)\.toLowerCase\(\)/);
});

test("all Worker compatibility dates match the current local date", async () => {
    const configs = [
        "../../workers/rl-presence-monitor/wrangler.jsonc",
        "../../workers/ocr-job-consumer/wrangler.jsonc",
        "../../workers/ocr-cloud-run-proxy/wrangler.jsonc",
        "../../workers/google-mtls-diagnostic/wrangler.jsonc",
        "../../workers/bpd-provider-runtime/wrangler.jsonc"
    ];
    for (const path of configs) {
        const config = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
        assert.equal(config.compatibility_date, "2026-10-05", path);
    }
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
    let providerBindingCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { externalCalls += 1; throw new Error("should not call health services"); };
    try {
        const response = await onRequestGet({ request: new Request("https://site.example.test/api/admin/system-status"), env: {
            PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64),
            PROVIDER_RUNTIME: { async fetch() { providerBindingCalls += 1; throw new Error("must not be called before admin authorization"); } }
        } });
        assert.ok([401, 403, 503].includes(response.status));
        const payload = await response.json();
        assert.equal(payload.success, false);
        assert.equal("services" in payload, false);
        assert.equal(externalCalls, 0);
        assert.equal(providerBindingCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
});


test("build validation sends current contract and never returns or caches the secret", async () => {
    const { env, values } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(new URL(input).pathname, "/admin/build-configuration");
        assert.deepEqual(JSON.parse(init.body), { gameVersion: "260918.75141.528314", featureSet: "PrimeUpdate60", buildSecret: "secret-value" });
        return Response.json({ success: true, resultCode: "RL_BUILD_UPDATE_PROMOTED", buildId: "246758282", featureSet: "PrimeUpdate60", gameVersion: "260918.75141.528314", configurationGeneration: 2, validatedAt: "2026-10-01T00:00:00Z", reconnectSucceeded: true, buildSecret: "must-not-pass" });
    };
    try {
        const result = await updateMmrBuildConfiguration(env, { gameVersion: "260918.75141.528314", featureSet: "PrimeUpdate60", buildSecret: "secret-value" });
        assert.equal(result.configurationGeneration, 2);
        assert.equal(JSON.stringify(result).includes("secret"), false);
        assert.equal(JSON.stringify([...values.values()]).includes("secret-value"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("rejected build validation preserves a sanitized failure", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ code: "RL_BUILD_UPDATE_REJECTED", providerCode: "VersionMismatch", access_token: "must-not-pass" }, { status: 422 });
    try {
        await assert.rejects(updateMmrBuildConfiguration(env, { gameVersion: "260918.75141.528314", featureSet: "PrimeUpdate60", buildSecret: "secret-value" }), { code: "RL_BUILD_UPDATE_REJECTED", status: 422, providerCode: "VersionMismatch" });
    } finally { globalThis.fetch = originalFetch; }
});

test("MMR functional test validates Epic player IDs and sanitizes skill records", async () => {
    const { env } = createEnv();
    await assert.rejects(performSystemStatusAction(env, "mmr-api", "functional-test", { playerId: "bad" }), { code: "MMR_PLAYER_ID_INVALID", status: 400 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(new URL(input).pathname, "/get-skills");
        assert.equal(new URL(input).searchParams.get("playerId"), "Epic|12345678|0");
        assert.equal(init.headers.Authorization, "Bearer lookup-key");
        return Response.json({ playlists: [{ id: 11, mmr: 1000, tier: 12, division: 2 }], access_token: "must-not-pass" });
    };
    try {
        const result = await performSystemStatusAction(env, "mmr-api", "functional-test", { playerId: "Epic|12345678|0" });
        assert.equal(result.result.playlistCount, 1);
        assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
        assert.equal(JSON.stringify(result).includes("lookup-key"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("force shop uses only the protected scheduled Shop job, sanitizes output and enforces cooldown", async () => {
    const originalFetch = globalThis.fetch;
    const values = new Map();
    const env = { RL_PRESENCE_MONITOR_URL: "https://presence.test", PRESENCE_TRIGGER_KEY: "k".repeat(48),
        RL_STATS_CACHE: { get: async key => values.get(key), put: async (key, value) => values.set(key, value) } };
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        if (new URL(url).pathname === "/admin/health") return Response.json({ success: true });
        calls++;
        assert.equal(new URL(url).hostname, "presence.test");
        assert.equal(new URL(url).pathname, "/admin/run-scheduled");
        assert.deepEqual(JSON.parse(init.body), { job: "shop" });
        assert.equal(init.headers.Authorization, `Bearer ${env.PRESENCE_TRIGGER_KEY}`);
        assert.equal(init.redirect, "manual");
        return Response.json({ success: true, job: "shop", summary: { success: true }, token: "must-not-leak" });
    };
    try {
        const result = await performSystemStatusAction(env, "rl-presence", "refresh-shop");
        assert.equal(result.success, true);
        assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
        await assert.rejects(performSystemStatusAction(env, "rl-presence", "refresh-shop"), { code: "SERVICE_ACTION_COOLDOWN", status: 429 });
        assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; }
});

test("force shop fails closed on unauthenticated/cross-origin requests and malformed Worker success", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ success: true, token: "private" }); };
    try {
        for (const origin of ["https://evil.test", "https://site.example.test"]) {
            const response = await onRequestPost({ env: {}, request: new Request("https://site.example.test/api/admin/system-status", {
                method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
                body: JSON.stringify({ service: "rl-presence", action: "refresh-shop" })
            }) });
            assert.ok([401, 403, 503].includes(response.status));
        }
        assert.equal(calls, 0);
        await assert.rejects(performSystemStatusAction({ RL_PRESENCE_MONITOR_URL: "https://presence.test", PRESENCE_TRIGGER_KEY: "k".repeat(48) }, "rl-presence", "refresh-shop"), { code: "SHOP_REFRESH_FAILED", status: 502 });
        const source = await readFile(new URL("../../functions/api/admin/system-status.js", import.meta.url), "utf8");
        assert.match(source, /await authorize\(request, env, ADMIN_PERMISSIONS.RL_FORCE_REFRESH\)/);
        assert.match(source, /action === "refresh-shop"\)[\s\S]*?Object.keys\(parsed.data\)/);
    } finally { globalThis.fetch = originalFetch; }
});

test("system-status POST requires JSON and authorization before outbound calls", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
    try {
        const response = await onRequestPost({ request: new Request("https://site.example.test/api/admin/system-status", { method: "POST", headers: { Origin: "https://site.example.test" }, body: "{}" }), env: {} });
        assert.ok([401, 403, 503].includes(response.status));
        assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
});


test("MMR normalization preserves unknown and repairing current states", async () => {
    for (const current of [
        { status: "unknown", rootCause: null, activeRepair: null, availableActions: ["recheck"] },
        { status: "repairing", rootCause: "PSYNET_SOCKET_DISCONNECTED", activeRepair: "reconnect-psynet", availableActions: ["recheck"] }
    ]) {
        const { env } = createEnv();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async input => {
            if (new URL(input).hostname !== "mmr.example.test") return Response.json({ success: true, status: "unknown", configuration: {} });
            return Response.json({ ...current, components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy" }, psynetAuthentication: { status: "unknown" }, psynetSocket: { status: "unknown" }, buildConfiguration: { status: "healthy" }, mmrService: { status: "unknown" } }, config: { requiredConfigPresent: true }, build: {}, psynet: {}, recovery: {}, traffic: {} });
        };
        try {
            const mmr = (await getSystemStatus(env, { force: true })).services.find(item => item.id === "mmr-api");
            assert.equal(mmr.status, current.status);
            assert.equal(mmr.activeRepair, current.activeRepair);
        } finally { globalThis.fetch = originalFetch; }
    }
});

test("MMR backend 409 and 429 responses remain sanitized", async () => {
    for (const fixture of [
        { status: 409, body: { code: "MMR_REPAIR_IN_PROGRESS", action: "repair-session", access_token: "must-not-pass" } },
        { status: 429, body: { code: "MMR_RECONNECT_COOLDOWN", retryAfterSeconds: 12, refresh_token: "must-not-pass" } }
    ]) {
        const { env } = createEnv();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => Response.json(fixture.body, { status: fixture.status });
        try {
            await assert.rejects(performSystemStatusAction(env, "mmr-api", "reconnect-psynet"), error => {
                assert.equal(error.status, fixture.status);
                assert.equal(JSON.stringify(error).includes("must-not-pass"), false);
                if (fixture.status === 429) assert.equal(error.retryAfterSeconds, 12);
                return true;
            });
        } finally { globalThis.fetch = originalFetch; }
    }
});

test("MMR provider and unavailable failures return stable safe codes", async () => {
    const { env } = createEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ code: "PSYNET_AUTH_FAILED", providerCode: "VersionMismatch", raw: "must-not-pass" }, { status: 502 });
    try {
        await assert.rejects(performSystemStatusAction(env, "mmr-api", "refresh-eos"), { code: "PSYNET_AUTH_FAILED", status: 502, providerCode: "VersionMismatch" });
    } finally { globalThis.fetch = async () => { throw new Error("offline"); }; }
    try {
        await assert.rejects(performSystemStatusAction(env, "mmr-api", "repair-session"), { code: "MMR_ACTION_UNAVAILABLE", status: 502 });
    } finally { globalThis.fetch = originalFetch; }
});
