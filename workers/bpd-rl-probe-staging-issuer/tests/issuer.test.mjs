import assert from "node:assert/strict";
import test from "node:test";
import issuer from "../src/index.js";

const secret = "issuer-test-caller-".padEnd(64, "i");
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
delete publicJwk.d;
const env = {
    RL_PROBE_STAGING_ISSUER_ENABLED: "true",
    RL_PROBE_STAGING_ISSUER_CALLER_SECRET: secret,
    RL_PROBE_ACCOUNT_KEY_SECRET: "isolated-test-account-key-".padEnd(64, "k"),
    RL_PROBE_SIGNING_JWK: JSON.stringify(privateJwk),
    RL_PROBE_ISSUER: "bpd-provider-runtime-staging",
    RL_PROBE_KEY_VERSION: "staging-v1"
};

function req(path, { body, authorization = `Bearer ${secret}`, method = "POST" } = {}) {
    return new Request(`https://issuer.internal${path}`, {
        method,
        headers: { Authorization: authorization, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

function decode(segment) { return Buffer.from(segment, "base64url"); }

test("private issuer is disabled by default and rejects unauthenticated calls", async () => {
    const defaultOff = await issuer.fetch(req("/internal/health", { method: "GET" }), {
        ...env, RL_PROBE_STAGING_ISSUER_ENABLED: "false"
    });
    assert.equal((await defaultOff.json()).enabled, false);
    const unauthorized = await issuer.fetch(req("/internal/health", { method: "GET", authorization: "Bearer wrong" }), env);
    assert.equal(unauthorized.status, 401);
});

test("only two fixed slots produce distinct synthetic identities and account keys", async () => {
    const invoke = slot => issuer.fetch(req("/internal/identity", { body: { slot } }), env);
    const a = await (await invoke("A")).json();
    const b = await (await invoke("B")).json();
    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.match(a.accountKey, /^[a-f0-9]{64}$/u);
    assert.match(b.accountKey, /^[a-f0-9]{64}$/u);
    assert.match(a.epicIdentityHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(a.accountKey, b.accountKey);
    assert.notEqual(a.epicIdentityHash, b.epicIdentityHash);
    assert.equal((await invoke("C")).status, 400);
    assert.equal((await issuer.fetch(req("/internal/identity", { body: { slot: "A", accountId: "real" } }), env)).status, 400);
});

test("issuer creates a 60-second ES256 assertion bound to the fixed account and staging audience", async () => {
    const identity = await (await issuer.fetch(req("/internal/identity", { body: { slot: "A" } }), env)).json();
    const response = await issuer.fetch(req("/internal/issue", { body: {
        slot: "A", generation: 3, invalidatedBefore: Date.now() - 1000, securityEpoch: "7"
    } }), env);
    const issued = await response.json();
    assert.equal(response.status, 200);
    assert.equal(issued.success, true);
    assert.equal(issued.accountKey, identity.accountKey);
    assert.match(issued.credential, /^synthetic-staging-credential:/u);
    const [headerPart, claimsPart, signaturePart] = issued.assertion.split(".");
    const header = JSON.parse(decode(headerPart));
    const claims = JSON.parse(decode(claimsPart));
    const verifyKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    assert.equal(header.alg, "ES256");
    assert.equal(header.kid, "staging-v1");
    assert.equal(claims.iss, "bpd-provider-runtime-staging");
    assert.equal(claims.aud, "bpd-provider-runtime/rl-compatibility-probe");
    assert.equal(claims.action, "rl.compatibility.probe");
    assert.equal(claims.sub, identity.accountKey);
    assert.equal(claims.generation, 3);
    assert.equal(claims.securityEpoch, "7");
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, decode(signaturePart),
        new TextEncoder().encode(`${headerPart}.${claimsPart}`)), true);
    assert.equal(JSON.stringify(issued).includes("privateJwk"), false);
});

test("issuer refuses arbitrary identity fields, malformed issuance context, queries and cookies", async () => {
    for (const body of [
        { slot: "A", accountId: "real" },
        { slot: "A", generation: -1, invalidatedBefore: 0, securityEpoch: "1" },
        { slot: "A", generation: 0, invalidatedBefore: 0, securityEpoch: "0" }
    ]) {
        const response = await issuer.fetch(req("/internal/issue", { body }), env);
        assert.equal(response.ok, false);
    }
    const query = await issuer.fetch(req("/internal/identity?slot=A", { body: { slot: "A" } }), env);
    assert.equal(query.status, 400);
    const cookie = await issuer.fetch(new Request("https://issuer.internal/internal/identity", {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, Cookie: "session=x", "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "A" })
    }), env);
    assert.equal(cookie.status, 400);
});
