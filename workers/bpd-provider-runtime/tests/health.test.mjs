import assert from "node:assert/strict";
import test from "node:test";
import providerRuntime from "../src/index.js";
import { UserRocketLeagueSession } from "../src/rl_user_session.js";

const SECRET = "p".repeat(64);

function healthRequest({ method = "GET", secret = SECRET, host = "service.internal", nonce = null, revocationCheck = false, query = "" } = {}) {
    return new Request(`https://${host}/internal/health${query}`, {
        method,
        headers: {
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
            ...(nonce ? { "X-BPD-Staging-Caller-Check": "v1", "X-BPD-Staging-Caller-Nonce": nonce } : {}),
            ...(revocationCheck ? { "X-BPD-Staging-Revocation-Check": "v1" } : {})
        }
    });
}

function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeBase64Url(value) {
    const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + "=");
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

test("internal health endpoint requires caller authorization and returns only the non-sensitive contract", async () => {
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error("health check must not call Discord"); };
    try {
        const response = await providerRuntime.fetch(healthRequest(), { PROVIDER_RUNTIME_CALLER_SECRET: SECRET });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(Object.keys(payload).sort(), ["service", "status", "success", "timestamp"]);
        assert.equal(payload.success, true);
        assert.equal(payload.service, "bpd-provider-runtime");
        assert.equal(payload.status, "ok");
        assert.ok(Number.isFinite(Date.parse(payload.timestamp)));
        assert.equal(JSON.stringify(payload).includes(SECRET), false);
        assert.equal(providerCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("internal health endpoint rejects unauthenticated callers and non-GET methods", async () => {
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET };
    const unauthorized = await providerRuntime.fetch(healthRequest({ secret: "" }), env);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { success: false, code: "INTERNAL_AUTH_REQUIRED" });

    const wrongMethod = await providerRuntime.fetch(healthRequest({ method: "POST" }), env);
    assert.equal(wrongMethod.status, 405);
    assert.deepEqual(await wrongMethod.json(), { success: false, code: "METHOD_NOT_ALLOWED" });
});

test("staging health rejection returns only a nonce-bound proof internally and never authenticates the caller", async () => {
    const expectedSecret = SECRET;
    const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const env = {
        PROVIDER_RUNTIME_CALLER_SECRET: expectedSecret,
        RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
        RL_PROBE_SECURITY_ENABLED: "false"
    };
    const response = await providerRuntime.fetch(healthRequest({
        secret: "wrong-secret".padEnd(64, "x"), host: "provider-runtime-staging.internal", nonce
    }), env);
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ["callerCheckProof", "code", "success"]);
    assert.equal(payload.success, false);
    assert.equal(payload.code, "INTERNAL_AUTH_REQUIRED");
    assert.equal(typeof payload.callerCheckProof, "string");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(expectedSecret),
        { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const validProof = await crypto.subtle.verify("HMAC", key, decodeBase64Url(payload.callerCheckProof),
        new TextEncoder().encode(`bpd-provider-runtime-staging-caller-check-v1\0${nonce}`));
    assert.equal(validProof, true);
    assert.equal(JSON.stringify(payload).includes(expectedSecret), false);
    assert.equal(JSON.stringify(payload).includes("wrong-secret"), false);
});

test("caller proof is unavailable outside the staging internal Service Binding and for malformed challenges", async () => {
    const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const request = (host, challenge = nonce) => healthRequest({
        secret: "wrong-secret".padEnd(64, "x"), host, nonce: challenge
    });
    const staging = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET, RL_PROBE_ISSUER: "bpd-provider-runtime-staging" };
    const publicHost = await providerRuntime.fetch(request("bpd-provider-runtime-staging.workers.dev"), staging);
    assert.equal(publicHost.status, 401);
    assert.deepEqual(await publicHost.json(), { success: false, code: "INTERNAL_AUTH_REQUIRED" });

    const nonStaging = await providerRuntime.fetch(request("provider-runtime-staging.internal"), {
        PROVIDER_RUNTIME_CALLER_SECRET: SECRET
    });
    assert.equal(nonStaging.status, 401);
    assert.deepEqual(await nonStaging.json(), { success: false, code: "INTERNAL_AUTH_REQUIRED" });

    const malformed = await providerRuntime.fetch(request("provider-runtime-staging.internal", "short"), staging);
    assert.equal(malformed.status, 401);
    assert.deepEqual(await malformed.json(), { success: false, code: "INTERNAL_AUTH_REQUIRED" });
});

test("matching caller auth retains the normal health contract even when the staging challenge marker is present", async () => {
    const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const response = await providerRuntime.fetch(healthRequest({
        secret: SECRET, host: "provider-runtime-staging.internal", nonce
    }), { PROVIDER_RUNTIME_CALLER_SECRET: SECRET, RL_PROBE_ISSUER: "bpd-provider-runtime-staging" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ["service", "status", "success", "timestamp"]);
});

test("authenticated staging health returns a nonce-bound revocation proof without touching probe state", async () => {
    const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const revocationSecret = "r".repeat(64);
    const response = await providerRuntime.fetch(healthRequest({
        host: "provider-runtime-staging.internal", nonce, revocationCheck: true
    }), {
        PROVIDER_RUNTIME_CALLER_SECRET: SECRET,
        RL_PROBE_REVOCATION_SECRET: revocationSecret,
        RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
        RL_PROBE_SECURITY_ENABLED: "false"
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ["revocationCredentialProof", "service", "status", "success", "timestamp"]);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(revocationSecret),
        { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    assert.equal(await crypto.subtle.verify("HMAC", key, decodeBase64Url(payload.revocationCredentialProof),
        new TextEncoder().encode(`bpd-provider-runtime-staging-revocation-check-v1\0${nonce}`)), true);
    assert.equal(JSON.stringify(payload).includes(revocationSecret), false);
});

test("revocation proof requires ordinary authentication, a valid challenge, and the private staging host", async () => {
    const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const env = {
        PROVIDER_RUNTIME_CALLER_SECRET: SECRET,
        RL_PROBE_REVOCATION_SECRET: "r".repeat(64),
        RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
        RL_PROBE_SECURITY_ENABLED: "false"
    };
    const unauthorized = await providerRuntime.fetch(healthRequest({
        secret: "x".repeat(64), host: "provider-runtime-staging.internal", nonce, revocationCheck: true
    }), env);
    assert.equal(unauthorized.status, 401);
    assert.equal("revocationCredentialProof" in await unauthorized.json(), false);

    for (const request of [
        healthRequest({ host: "provider-runtime-staging.internal", nonce: "bad", revocationCheck: true }),
        healthRequest({ host: "bpd-provider-runtime-staging.workers.dev", nonce, revocationCheck: true }),
        healthRequest({ host: "provider-runtime-staging.internal", nonce, revocationCheck: true, query: "?x=1" })
    ]) {
        const response = await providerRuntime.fetch(request, env);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, code: "STAGING_CHALLENGE_INVALID" });
    }
});

test("signing-key diagnostic verifies ES256 correspondence without enabling probe execution", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    delete publicJwk.d;
    const now = Math.floor(Date.now() / 1000);
    const challenge = {
        algorithm: "ES256", issuer: "bpd-provider-runtime-staging", keyVersion: "staging-v1",
        purpose: "bpd.rl.staging.signing-key-correspondence.v1",
        nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))), issuedAt: now, expiresAt: now + 30
    };
    const message = new TextEncoder().encode(`BPD-RL-STAGING-KEY-CORRESPONDENCE\0${challenge.algorithm}\0${challenge.issuer}\0${challenge.keyVersion}\0${challenge.purpose}\0${challenge.nonce}\0${challenge.issuedAt}\0${challenge.expiresAt}`);
    const signature = base64Url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message)));
    const request = (body, host = "provider-runtime-staging.internal", authorization = `Bearer ${SECRET}`) =>
        new Request(`https://${host}/internal/rl-probe/key-correspondence/verify`, {
            method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET, RL_PROBE_ISSUER: challenge.issuer,
        RL_PROBE_KEY_VERSION: challenge.keyVersion, RL_PROBE_VERIFY_JWK: JSON.stringify(publicJwk),
        RL_PROBE_SECURITY_ENABLED: "false" };
    const matches = await providerRuntime.fetch(request({ ...challenge, signature }), env);
    const matchPayload = await matches.json();
    assert.deepEqual(matchPayload, { success: true, keyMatches: true });
    const wrongPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const wrongPublic = await crypto.subtle.exportKey("jwk", wrongPair.publicKey);
    delete wrongPublic.d;
    const mismatch = await providerRuntime.fetch(request({ ...challenge, signature }), { ...env, RL_PROBE_VERIFY_JWK: JSON.stringify(wrongPublic) });
    assert.deepEqual(await mismatch.json(), { success: true, keyMatches: false });
    assert.equal((await providerRuntime.fetch(request({ ...challenge, signature }, "provider-runtime-staging.internal", "Bearer wrong"), env)).status, 401);
    assert.equal((await providerRuntime.fetch(request({ ...challenge, signature }, "bpd-provider-runtime-staging.workers.dev"), env)).status, 404);
    assert.equal(JSON.stringify(matchPayload).includes(signature), false);
    assert.equal(signature.split(".").length, 1);
    let persistentWrites = 0;
    const session = new UserRocketLeagueSession({ storage: {
        async get() { return undefined; }, async put() { persistentWrites += 1; },
        async transaction(callback) { return callback(this); }, async setAlarm() {}, async deleteAlarm() {}
    } }, {
        ...env,
        RL_PROBE_SECURITY: { idFromName: value => value, get: () => ({
            fetch: async () => Response.json({ success: true, epoch: "1" })
        }) }
    });
    const assertionAttempt = await session.fetch(new Request("https://rl-probe.internal/consume", {
        method: "POST", body: JSON.stringify({ accountKey: "a".repeat(64), assertion: signature, credential: "diagnostic" })
    }));
    assert.equal(assertionAttempt.status, 403);
    assert.equal((await assertionAttempt.json()).code, "RL_PROBE_ASSERTION_REJECTED");
    assert.equal(persistentWrites, 0);
});

test("signing-key diagnostic rejects assertion confusion and malformed or expired challenges", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    delete publicJwk.d;
    const now = Math.floor(Date.now() / 1000);
    const challenge = { algorithm: "ES256", issuer: "bpd-provider-runtime-staging", keyVersion: "staging-v1",
        purpose: "bpd.rl.staging.signing-key-correspondence.v1", nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))),
        issuedAt: now, expiresAt: now + 30, signature: base64Url(crypto.getRandomValues(new Uint8Array(64))) };
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET, RL_PROBE_ISSUER: challenge.issuer,
        RL_PROBE_KEY_VERSION: challenge.keyVersion, RL_PROBE_VERIFY_JWK: JSON.stringify(publicJwk) };
    const noMatch = await providerRuntime.fetch(new Request("https://provider-runtime-staging.internal/internal/rl-probe/key-correspondence/verify", {
        method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...challenge, signature: base64Url(crypto.getRandomValues(new Uint8Array(64))) })
    }), env);
    assert.equal(noMatch.status, 200);
    assert.deepEqual(await noMatch.json(), { success: true, keyMatches: false });
    for (const body of [
        { ...challenge, purpose: "rl.compatibility.probe" },
        { ...challenge, algorithm: "none" },
        { ...challenge, keyVersion: "old-key" },
        { ...challenge, nonce: "x".repeat(42) },
        { ...challenge, nonce: "A".repeat(42) + "B" },
        { ...challenge, issuedAt: now - 60, expiresAt: now - 30 },
        { ...challenge, signature: `${challenge.signature}.${challenge.signature}` }
    ]) {
        const response = await providerRuntime.fetch(new Request("https://provider-runtime-staging.internal/internal/rl-probe/key-correspondence/verify", {
            method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body)
        }), env);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, code: "REQUEST_SCHEMA_INVALID" });
    }
});
