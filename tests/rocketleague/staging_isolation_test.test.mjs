import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkStagingConnectivity, isLiveAdminHost, isSafeHealthRead, isSameOriginRequest, onRequestGet, onRequestPost, runStagingIsolationTest } from "../../functions/api/admin/rocketleague/staging-isolation-test.js";
import runtime from "../../workers/bpd-provider-runtime/src/index.js";
import { RlProbeSecurityAuthority } from "../../workers/bpd-provider-runtime/src/rl_probe_authority.js";
import { UserRocketLeagueSession } from "../../workers/bpd-provider-runtime/src/rl_user_session.js";
import issuer from "../../workers/bpd-rl-probe-staging-issuer/src/index.js";

function storageFixture() {
    const records = new Map();
    let tail = Promise.resolve();
    return {
        async get(key) { return structuredClone(records.get(key)); },
        async put(key, value) { records.set(key, structuredClone(value)); },
        async transaction(callback) { const op = tail.then(() => callback(this)); tail = op.catch(() => {}); return op; },
        async setAlarm() {}, async deleteAlarm() {}
    };
}

async function stagingFixture({ enabled = true } = {}) {
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    delete publicJwk.d;
    const runtimeSecret = "runtime-staging-test-secret-".padEnd(64, "r");
    const revokeSecret = "revocation-staging-test-secret-".padEnd(64, "v");
    const issuerSecret = "issuer-staging-test-secret-".padEnd(64, "i");
    const sessions = new Map();
    const authority = new RlProbeSecurityAuthority({ storage: storageFixture() });
    const workerEnv = {
        PROVIDER_RUNTIME_CALLER_SECRET: runtimeSecret,
        RL_PROBE_REVOCATION_SECRET: revokeSecret,
        RL_PROBE_SECURITY_ENABLED: "true",
        RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
        RL_PROBE_KEY_VERSION: "staging-v1",
        RL_PROBE_VERIFY_JWK: JSON.stringify(publicJwk),
        RL_PROBE_SECURITY: { idFromName: name => name, get: () => authority },
        RL_USER_SESSION: { idFromName: name => name, get: name => {
            if (!sessions.has(name)) sessions.set(name, new UserRocketLeagueSession({ storage: storageFixture() }, workerEnv));
            return sessions.get(name);
        } }
    };
    authority.env.RL_USER_SESSION = workerEnv.RL_USER_SESSION;
    const issuerEnv = {
        RL_PROBE_STAGING_ISSUER_ENABLED: "true",
        RL_PROBE_STAGING_ISSUER_CALLER_SECRET: issuerSecret,
        RL_PROBE_ACCOUNT_KEY_SECRET: "account-key-staging-test-secret-".padEnd(64, "a"),
        RL_PROBE_SIGNING_JWK: JSON.stringify(privateJwk),
        RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
        RL_PROBE_KEY_VERSION: "staging-v1"
    };
    const pageEnv = {
        RL_PROBE_STAGING_TEST_ENABLED: enabled ? "true" : "false",
        RL_PROBE_STAGING_RUNTIME_CALLER_SECRET: runtimeSecret,
        RL_PROBE_STAGING_REVOCATION_SECRET: revokeSecret,
        RL_PROBE_STAGING_ISSUER_CALLER_SECRET: issuerSecret,
        RL_PROBE_STAGING_RUNTIME: { fetch: request => runtime.fetch(request, workerEnv) },
        RL_PROBE_STAGING_ISSUER: { fetch: request => issuer.fetch(request, issuerEnv) },
        PROVIDER_RUNTIME: { fetch: async () => { throw new Error("production binding must not be called"); } }
    };
    return { pageEnv, workerEnv, issuerEnv, sessions };
}

test("staging isolation route exercises two synthetic accounts against the real Worker handlers", async () => {
    const { pageEnv, sessions } = await stagingFixture();
    const result = await runStagingIsolationTest(pageEnv);
    assert.deepEqual(result, {
        success: true,
        concurrentHandoff: true,
        replayDenied: true,
        crossAccountRejected: true,
        independentInvalidation: true,
        globalRevocation: true,
        probeExecutionEnabled: false,
        epicAuthenticationAttempted: false,
        psynetAuthenticationAttempted: false
    });
    assert.equal(sessions.size, 2);
    for (const session of sessions.values()) {
        const state = await session.ctx.storage.get("security");
        assert.equal(state.temporary, null);
        assert.equal(state.reauth, null);
        assert.equal(session.handoff, null);
        assert.equal(JSON.stringify(state).includes("synthetic-staging-credential:"), false);
        assert.doesNotMatch(JSON.stringify(state), /eyJ[a-zA-Z0-9_-]{20,}\./u);
    }
    assert.equal(JSON.stringify(result).includes("assertion"), false);
});

test("missing test gate fails closed without contacting either Worker binding", async () => {
    let calls = 0;
    const { pageEnv } = await stagingFixture({ enabled: false });
    pageEnv.RL_PROBE_STAGING_RUNTIME.fetch = async () => { calls += 1; throw new Error("must not call"); };
    pageEnv.RL_PROBE_STAGING_ISSUER.fetch = async () => { calls += 1; throw new Error("must not call"); };
    await assert.rejects(runStagingIsolationTest(pageEnv), /STAGING_TEST_DISABLED/u);
    assert.equal(calls, 0);
});

test("health check authenticates both staging bindings while all execution gates remain disabled", async () => {
    const { pageEnv, workerEnv, issuerEnv, sessions } = await stagingFixture({ enabled: false });
    workerEnv.RL_PROBE_SECURITY_ENABLED = "false";
    issuerEnv.RL_PROBE_STAGING_ISSUER_ENABLED = "false";
    const requests = [];
    for (const name of ["RL_PROBE_STAGING_RUNTIME", "RL_PROBE_STAGING_ISSUER"]) {
        const service = pageEnv[name];
        const fetch = service.fetch;
        service.fetch = request => {
            requests.push({ binding: name, method: request.method, path: new URL(request.url).pathname,
                hasAuthorization: request.headers.has("Authorization"),
                callerCheck: request.headers.get("X-BPD-Staging-Caller-Check"),
                nonce: request.headers.get("X-BPD-Staging-Caller-Nonce") });
            return fetch(request);
        };
    }
    const result = await checkStagingConnectivity(pageEnv);
    assert.deepEqual(result, { success: true, runtime: "authenticated", runtimeCallerCredential: "match", issuer: "authenticated" });
    assert.deepEqual(requests.map(({ binding, method, path, hasAuthorization, callerCheck, nonce }) => ({
        binding, method, path, hasAuthorization, callerCheck, hasFreshNonce: /^[A-Za-z0-9_-]{43}$/u.test(nonce || "")
    })), [
        { binding: "RL_PROBE_STAGING_RUNTIME", method: "GET", path: "/internal/health", hasAuthorization: true,
            callerCheck: "v1", hasFreshNonce: true },
        { binding: "RL_PROBE_STAGING_ISSUER", method: "GET", path: "/internal/health", hasAuthorization: true,
            callerCheck: null, hasFreshNonce: false }
    ]);
    assert.equal(sessions.size, 0);
    assert.equal(workerEnv.RL_PROBE_SECURITY_ENABLED, "false");
    assert.equal(issuerEnv.RL_PROBE_STAGING_ISSUER_ENABLED, "false");
});

test("health check verifies a mismatched caller credential without returning its proof or nonce", async () => {
    const { pageEnv, workerEnv, issuerEnv, sessions } = await stagingFixture({ enabled: false });
    workerEnv.RL_PROBE_SECURITY_ENABLED = "false";
    issuerEnv.RL_PROBE_STAGING_ISSUER_ENABLED = "false";
    pageEnv.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET = "wrong-secret".padEnd(64, "x");
    const requests = [];
    const runtimeFetch = pageEnv.RL_PROBE_STAGING_RUNTIME.fetch;
    pageEnv.RL_PROBE_STAGING_RUNTIME.fetch = request => { requests.push(request); return runtimeFetch(request); };
    const result = await checkStagingConnectivity(pageEnv);
    assert.deepEqual(result, {
        success: true, runtime: "unavailable", runtimeCallerCredential: "mismatch",
        runtimeFailureCode: "RUNTIME_HTTP_401", issuer: "authenticated"
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.get("Authorization"), `Bearer ${pageEnv.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET}`);
    assert.match(requests[0].headers.get("X-BPD-Staging-Caller-Nonce"), /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(requests[0].headers.get("X-BPD-Staging-Caller-Check"), "v1");
    assert.equal(JSON.stringify(result).includes("wrong-secret"), false);
    assert.doesNotMatch(JSON.stringify(result), /callerCheckProof|nonce|signature|proof/u);
    assert.equal(pageEnv.RL_PROBE_STAGING_TEST_ENABLED, "false");
    assert.equal(workerEnv.RL_PROBE_SECURITY_ENABLED, "false");
    assert.equal(issuerEnv.RL_PROBE_STAGING_ISSUER_ENABLED, "false");
    assert.equal(sessions.size, 0);
});

test("malformed or missing Runtime proof stays unavailable and is never copied into the Admin response", async () => {
    for (const proof of [undefined, "not-a-proof"]) {
        const { pageEnv, workerEnv, issuerEnv, sessions } = await stagingFixture({ enabled: false });
        workerEnv.RL_PROBE_SECURITY_ENABLED = "false";
        issuerEnv.RL_PROBE_STAGING_ISSUER_ENABLED = "false";
        pageEnv.RL_PROBE_STAGING_RUNTIME.fetch = async () => Response.json({
            success: false, code: "INTERNAL_AUTH_REQUIRED", ...(proof ? { callerCheckProof: proof } : {})
        }, { status: 401 });
        const result = await checkStagingConnectivity(pageEnv);
        assert.equal(result.runtimeCallerCredential, "unavailable");
        assert.equal(result.runtimeFailureCode, "RUNTIME_HTTP_401");
        assert.doesNotMatch(JSON.stringify(result), /callerCheckProof|proof|nonce|signature/u);
        assert.equal(sessions.size, 0);
    }
});

test("Runtime health reports only confirmed authentication rejection and sanitized failure categories", async () => {
    const cases = [
        { name: "missing binding", configure: env => { env.RL_PROBE_STAGING_RUNTIME = undefined; }, expected: "BINDING_UNAVAILABLE" },
        { name: "HTTP 401", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 401 }); }, expected: "RUNTIME_HTTP_401" },
        { name: "HTTP 403", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 403 }); }, expected: "RUNTIME_HTTP_403" },
        { name: "missing health route", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 404 }); }, expected: "INVALID_RESPONSE" },
        { name: "malformed health payload", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 200 }); }, expected: "INVALID_RESPONSE" },
        { name: "upstream HTTP failure", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 503 }); }, expected: "RUNTIME_ERROR" },
        { name: "transport timeout", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = request => new Promise((resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        }); }, expected: "TIMEOUT" },
        { name: "transport failure", configure: env => { env.RL_PROBE_STAGING_RUNTIME.fetch = async () => { throw new Error("private detail"); }; }, expected: "RUNTIME_ERROR" }
    ];

    for (const scenario of cases) {
        const { pageEnv } = await stagingFixture({ enabled: false });
        scenario.configure(pageEnv);
        const result = await checkStagingConnectivity(pageEnv);
        assert.deepEqual(result, {
            success: true,
            runtime: "unavailable",
            runtimeCallerCredential: "unavailable",
            runtimeFailureCode: scenario.expected,
            issuer: "authenticated"
        }, scenario.name);
        assert.equal(JSON.stringify(result).includes("private"), false, scenario.name);
    }
});

test("non-auth HTTP failures are never classified as authentication rejection", async () => {
    const { pageEnv } = await stagingFixture({ enabled: false });
    pageEnv.RL_PROBE_STAGING_RUNTIME.fetch = async () => new Response("private body", { status: 500 });
    const result = await checkStagingConnectivity(pageEnv);
    assert.equal(result.runtimeFailureCode, "RUNTIME_ERROR");
    assert.notEqual(result.runtimeFailureCode, "RUNTIME_HTTP_401");
    assert.notEqual(result.runtimeFailureCode, "RUNTIME_HTTP_403");
});

test("health read rejects cross-site requests and mismatched Origins", () => {
    assert.equal(isSafeHealthRead(new Request("https://bpd-gaming-network.com/health", {
        headers: { Origin: "https://bpd-gaming-network.com", "Sec-Fetch-Site": "same-origin" }
    })), true);
    assert.equal(isSafeHealthRead(new Request("https://bpd-gaming-network.com/health", {
        headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }
    })), false);
    assert.equal(isSafeHealthRead(new Request("https://bpd-gaming-network.com/health", {
        headers: { "Sec-Fetch-Site": "cross-site" }
    })), false);
});

test("Cloudflare config isolates the staging binding and keeps every new gate off", async () => {
    const pages = JSON.parse(await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
    const runtime = JSON.parse(await readFile(new URL("../../workers/bpd-provider-runtime/wrangler.staging.jsonc", import.meta.url), "utf8"));
    const issuerConfig = JSON.parse(await readFile(new URL("../../workers/bpd-rl-probe-staging-issuer/wrangler.jsonc", import.meta.url), "utf8"));
    const services = new Map(pages.services.map(binding => [binding.binding, binding.service]));
    assert.equal(services.get("PROVIDER_RUNTIME"), "bpd-provider-runtime");
    assert.equal(services.get("RL_PROBE_STAGING_RUNTIME"), "bpd-provider-runtime-staging");
    assert.equal(services.get("RL_PROBE_STAGING_ISSUER"), "bpd-rl-probe-staging-issuer");
    assert.equal(pages.vars.RL_PROBE_STAGING_TEST_ENABLED, "false");
    assert.equal(runtime.vars.RL_PROBE_SECURITY_ENABLED, "false");
    assert.equal(issuerConfig.vars.RL_PROBE_STAGING_ISSUER_ENABLED, "false");
    assert.equal(issuerConfig.workers_dev, false);
    assert.equal("durable_objects" in issuerConfig, false);
    assert.doesNotMatch(JSON.stringify(pages), /SIGNING_JWK|ACCOUNT_KEY_SECRET/u);
});

test("Admin endpoints fail closed without existing Admin authorization and disclose no configuration", async () => {
    const env = {};
    const get = await onRequestGet({ request: new Request("https://site.example.test/api/admin/rocketleague/staging-isolation-test"), env });
    assert.equal(get.status, 503);
    assert.deepEqual(await get.json(), { success: false, code: "AUTHORIZATION_UNAVAILABLE" });
    const post = await onRequestPost({ request: new Request("https://site.example.test/api/admin/rocketleague/staging-isolation-test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "RUN_STAGING_ISOLATION_TEST" })
    }), env });
    assert.equal(post.status, 503);
    assert.equal((await post.text()).includes("SECRET"), false);
});

test("temporary Admin POST requires a same-origin, non-cross-site request", () => {
    assert.equal(isSameOriginRequest(new Request("https://site.example.test/test", {
        method: "POST", headers: { Origin: "https://site.example.test", "Sec-Fetch-Site": "same-origin" }
    })), true);
    assert.equal(isSameOriginRequest(new Request("https://site.example.test/test", {
        method: "POST", headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }
    })), false);
    assert.equal(isSameOriginRequest(new Request("https://site.example.test/test", { method: "POST" })), false);
});

test("temporary test endpoint is restricted to the live HTTPS Admin hostname, not Pages Preview", () => {
    assert.equal(isLiveAdminHost(new Request("https://bpd-gaming-network.com/api/admin/rocketleague/staging-isolation-test")), true);
    assert.equal(isLiveAdminHost(new Request("https://preview.bpd-webpage.pages.dev/api/admin/rocketleague/staging-isolation-test")), false);
    assert.equal(isLiveAdminHost(new Request("http://bpd-gaming-network.com/api/admin/rocketleague/staging-isolation-test")), false);
});

test("issuer accepts only the two fixed synthetic slots and never returns a provider-enabled assertion", async () => {
    const { pageEnv, issuerEnv } = await stagingFixture();
    const secret = issuerEnv.RL_PROBE_STAGING_ISSUER_CALLER_SECRET;
    const send = (body, path = "/internal/identity") => issuer.fetch(new Request(`https://issuer.internal${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body)
    }), issuerEnv);
    const a = await (await send({ slot: "A" })).json();
    const b = await (await send({ slot: "B" })).json();
    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.notEqual(a.accountKey, b.accountKey);
    assert.notEqual(a.epicIdentityHash, b.epicIdentityHash);
    assert.equal((await send({ slot: "real-account-id" })).status, 400);
    assert.equal((await send({ slot: "A", accountId: "attacker" })).status, 400);
    const disabledEnv = { ...issuerEnv, RL_PROBE_STAGING_ISSUER_ENABLED: "false" };
    const disabled = await issuer.fetch(new Request("https://issuer.internal/internal/issue", {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "A", generation: 0, invalidatedBefore: 0, securityEpoch: "1" })
    }), disabledEnv);
    assert.equal(disabled.status, 503);
    assert.equal(pageEnv.PROVIDER_RUNTIME !== pageEnv.RL_PROBE_STAGING_RUNTIME, true);
});
