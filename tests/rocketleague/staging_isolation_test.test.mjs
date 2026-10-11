import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLiveAdminHost, isSameOriginRequest, onRequestGet, onRequestPost, runStagingIsolationTest } from "../../functions/api/admin/rocketleague/staging-isolation-test.js";
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
