import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getSystemStatus, performSystemStatusAction, updateMmrBuildConfiguration } from "../../functions/services/admin/system_status.js";
import { getPermissionsForDiscordRoles, ADMIN_PERMISSIONS } from "../../functions/services/admin/permissions.js";
import { onRequestGet, onRequestPost } from "../../functions/api/admin/system-status.js";
import { getMmrControlModel } from "../../public/Global/Admin/WorkerStatus/JS/mmr_controls.js";
import { ROCKET_LEAGUE_CAPABILITIES, ROCKET_LEAGUE_CAPABILITY_CATEGORIES } from "../../public/Global/Admin/WorkerStatus/JS/rocket_league_capabilities.js";

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
        return Response.json({ success: true, status: "unknown", configuration: {} });
    };
    return () => { globalThis.fetch = originalFetch; };
}

test("system health cache includes protected MMR readiness without starting MMR work", async () => {
    const { env, calls } = createEnv();
    const restore = installHealthFetch(calls);
    try {
        const [first, concurrent] = await Promise.all([getSystemStatus(env), getSystemStatus(env)]);
        const mmr = first.services.find(item => item.id === "mmr-api");
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
});

test("Rocket League capability registry keeps only MMR / Skills active and placeholders inert", async () => {
    const expectedIds = [
        "player-profile", "xp-progression", "player-stats", "match-history", "mmr-skills", "leaderboards", "playlists", "population",
        "clubs", "tournaments", "training", "rocket-pass", "inventory-products", "item-shop", "wallet", "challenges",
        "regions", "ping-game-servers", "party", "matchmaking", "reservations-join-match"
    ];
    assert.deepEqual(ROCKET_LEAGUE_CAPABILITIES.map(capability => capability.id), expectedIds);
    assert.deepEqual(ROCKET_LEAGUE_CAPABILITY_CATEGORIES.map(category => category.id), ["players", "competitive", "community", "account-items", "network-diagnostics", "advanced"]);
    const active = ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.status === "active");
    assert.deepEqual(active.map(({ id, serviceId }) => ({ id, serviceId })), [{ id: "mmr-skills", serviceId: "mmr-api" }]);
    const placeholders = ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.status !== "active");
    assert.equal(placeholders.length, 20);
    assert.ok(placeholders.every(capability => ["placeholder", "future"].includes(capability.status)));
    assert.ok(placeholders.every(capability => ["read-only", "interactive"].includes(capability.access)));
    assert.ok(placeholders.every(capability => !("serviceId" in capability) && !("action" in capability) && !("endpoint" in capability)));
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

test("MMR Recheck calls only the protected recheck endpoint", async () => {
    const { env } = createEnv();
    const paths = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input); paths.push(url.pathname);
        assert.equal(init.headers.Authorization, "Bearer admin-key");
        return Response.json({ status: "healthy", rootCause: null, availableActions: ["recheck"], components: { worker: { status: "healthy" }, configuration: { status: "healthy" }, eosAuthorization: { status: "healthy" }, psynetAuthentication: { status: "healthy" }, psynetSocket: { status: "healthy" }, buildConfiguration: { status: "healthy" }, mmrService: { status: "healthy" } }, config: { requiredConfigPresent: true }, build: {}, psynet: {}, recovery: {}, traffic: {} });
    };
    try {
        await performSystemStatusAction(env, "mmr-api", "recheck");
        assert.deepEqual(paths, ["/admin/recheck"]);
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
