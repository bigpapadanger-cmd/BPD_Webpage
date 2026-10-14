import assert from "node:assert/strict";
import test from "node:test";
import providerRuntime from "../src/index.js";

const SECRET = "p".repeat(64);

function healthRequest({ method = "GET", secret = SECRET, host = "service.internal", nonce = null } = {}) {
    return new Request(`https://${host}/internal/health`, {
        method,
        headers: {
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
            ...(nonce ? { "X-BPD-Staging-Caller-Check": "v1", "X-BPD-Staging-Caller-Nonce": nonce } : {})
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
