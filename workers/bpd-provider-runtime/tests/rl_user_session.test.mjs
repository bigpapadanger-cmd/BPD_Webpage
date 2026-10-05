import assert from "node:assert/strict";
import test from "node:test";
import { UserRocketLeagueSession, credentialDigest } from "../src/rl_user_session.js";
import runtime from "../src/index.js";
import { RlProbeSecurityAuthority } from "../src/rl_probe_authority.js";

const accountKey = "a".repeat(64);
const epicIdentityHash = "b".repeat(64);
const b64 = bytes => Buffer.from(bytes).toString("base64url");
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const env = { RL_PROBE_VERIFY_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    RL_PROBE_ISSUER: "https://bpd-gaming-network.com", RL_PROBE_KEY_VERSION: "test-key", RL_PROBE_SECURITY_EPOCH: "1" };

function storageFixture() {
    const records = new Map();
    let tail = Promise.resolve();
    const storage = { alarm: null,
        async get(key) { return structuredClone(records.get(key)); },
        async put(key, value) { records.set(key, structuredClone(value)); },
        async setAlarm(time) { this.alarm = time; },
        async deleteAlarm() { this.alarm = null; },
        transaction(callback) { const operation = tail.then(() => callback(storage)); tail = operation.catch(() => {}); return operation; }
    };
    return storage;
}

async function assertion(changes = {}) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: env.RL_PROBE_ISSUER, aud: "bpd-provider-runtime/rl-compatibility-probe", action: "rl.compatibility.probe",
        sub: accountKey, epicIdentityHash, generation: 0, iat: now, exp: now + 60,
        jti: b64(crypto.getRandomValues(new Uint8Array(32))), credentialDigest: await credentialDigest("temporary-test-credential"),
        securityEpoch: "1", ...changes };
    const input = `${b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "test-key" }))}.${b64(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(input));
    return `${input}.${b64(signature)}`;
}

async function call(object, operation, body) {
    const response = await object.fetch(new Request(`https://internal/${operation}`, { method: "POST", body: JSON.stringify({ accountKey, ...body }) }));
    return { status: response.status, ...await response.json() };
}

async function fixture() {
    const storage = storageFixture();
    const authority = new RlProbeSecurityAuthority({ storage: storageFixture() });
    const object = new UserRocketLeagueSession({ storage }, { ...env,
        RL_PROBE_SECURITY: { idFromName: name => name, get: () => authority } });
    authority.env.RL_USER_SESSION = { idFromName: name => name, get: () => object };
    assert.equal((await call(object, "bootstrap", { epicIdentityHash })).status, 200);
    return { storage, object, authority };
}

test("ES256 handoff consumes first jti and rejects concurrent replay before provider work", async () => {
    const { object, storage } = await fixture();
    const signed = await assertion();
    const results = await Promise.all(Array.from({ length: 5 }, () => call(object, "consume", { assertion: signed, credential: "temporary-test-credential" })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.code === "RL_PROBE_REPLAY_REJECTED").length, 4);
    assert.equal(results[0].probeExecutionEnabled, false);
    const saved = JSON.stringify(await storage.get("security"));
    assert.equal(saved.includes("temporary-test-credential"), false);
    assert.equal(saved.includes(signed), false);
});

test("each lifecycle invalidation advances generation and rejects pre-change handoffs after bootstrap", async () => {
    for (const reason of ["logout", "epic_unlink", "profile_delete", "identity_change", "emergency"]) {
        const { object, storage } = await fixture();
        const signed = await assertion();
        assert.equal((await call(object, "invalidate", { reason })).status, 200);
        assert.equal((await storage.get("security")).generation, 1);
        await call(object, "bootstrap", { epicIdentityHash });
        assert.equal((await call(object, "consume", { assertion: signed, credential: "temporary-test-credential" })).code, "RL_PROBE_GENERATION_REJECTED");
        await call(object, "invalidate", { reason });
        assert.equal((await storage.get("security")).generation, 2);
    }
});

test("wrong account, Epic identity, digest, action, issuer, audience, expiry and oversized TTL fail closed", async () => {
    const seconds = Math.floor(Date.now() / 1000);
    for (const change of [{ sub: "c".repeat(64) }, { epicIdentityHash: "c".repeat(64) }, { credentialDigest: "c".repeat(64) },
        { action: "history.read" }, { iss: "https://attacker.invalid" }, { aud: "other" },
        { iat: seconds - 120, exp: seconds - 60 }, { iat: seconds, exp: seconds + 61 }, { securityEpoch: "old" }]) {
        const { object } = await fixture();
        const result = await call(object, "consume", { assertion: await assertion(change), credential: "temporary-test-credential" });
        assert.notEqual(result.status, 200);
    }
    const { object } = await fixture();
    assert.equal((await call(object, "bootstrap", { accountKey: "d".repeat(64), epicIdentityHash })).code, "RL_PROBE_ACCOUNT_MISMATCH");
});

test("cutoff rejects stale assertions even with the current generation", async () => {
    const { object, storage } = await fixture();
    await call(object, "invalidate", { reason: "logout" });
    await call(object, "bootstrap", { epicIdentityHash });
    const state = await storage.get("security");
    const iat = Math.floor(state.invalidatedBefore / 1000);
    const signed = await assertion({ generation: state.generation, iat, exp: iat + 60 });
    assert.equal((await call(object, "consume", { assertion: signed, credential: "temporary-test-credential" })).code, "RL_PROBE_GENERATION_REJECTED");
});

test("only one distinct handoff can occupy the temporary probe context", async () => {
    const { object } = await fixture();
    const first = await assertion();
    const second = await assertion();
    const results = await Promise.all([first, second].map(signed => call(object, "consume", { assertion: signed, credential: "temporary-test-credential" })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.code === "RL_PROBE_ALREADY_IN_FLIGHT").length, 1);
});

test("identity switching clears temporary state and requires a fresh bootstrap", async () => {
    const { object, storage } = await fixture();
    assert.equal((await call(object, "bootstrap", { epicIdentityHash: "c".repeat(64) })).code, "RL_PROBE_IDENTITY_MISMATCH");
    assert.equal((await storage.get("security")).temporary, null);
    assert.equal((await call(object, "bootstrap", { epicIdentityHash: "c".repeat(64) })).status, 200);
});

test("alarm clears expired state and nonces but retains the monotonic tombstone", async () => {
    const { object, storage } = await fixture();
    const state = await storage.get("security");
    state.temporary.lastActiveAt = Date.now() - 600001;
    state.nonces = { expired: Date.now() - 1 };
    await storage.put("security", state);
    await object.alarm();
    const cleaned = await storage.get("security");
    assert.equal(cleaned.generation, 1);
    assert.equal(cleaned.temporary, null);
    assert.deepEqual(cleaned.nonces, {});
    assert.equal(storage.alarm, null);
});

test("emergency security-epoch rotation rejects old assertions and clears temporary state", async () => {
    const { object, storage, authority } = await fixture();
    await authority.fetch(new Request("https://internal/bump", { method: "POST", body: "{}" }));
    await object.alarm();
    assert.equal((await storage.get("security")).temporary, null);
    const result = await call(object, "consume", { assertion: await assertion(), credential: "temporary-test-credential" });
    assert.equal(result.code, "RL_PROBE_ASSERTION_REJECTED");
    object.env.RL_PROBE_SECURITY_EPOCH = "1"; // Old config cannot roll authority back.
    assert.equal((await call(object, "bootstrap", { epicIdentityHash })).status, 200);
    assert.equal((await storage.get("security")).securityEpoch, "2");
});

test("bootstrap does not report ready without complete security configuration", async () => {
    const object = new UserRocketLeagueSession({ storage: storageFixture() }, {});
    assert.equal((await call(object, "bootstrap", { epicIdentityHash })).code, "RL_PROBE_SECURITY_CONFIGURATION_REQUIRED");
});

test("runtime probe routes require caller authorization and stay disabled by default", async () => {
    const request = () => new Request("https://internal/internal/rl-probe/bootstrap", { method: "POST", body: JSON.stringify({ accountKey, epicIdentityHash }) });
    const config = { PROVIDER_RUNTIME_CALLER_SECRET: "s".repeat(64) };
    assert.equal((await runtime.fetch(request(), config)).status, 401);
    const authorized = request();
    authorized.headers.set("Authorization", `Bearer ${config.PROVIDER_RUNTIME_CALLER_SECRET}`);
    assert.equal((await runtime.fetch(authorized, config)).status, 503);
});

const reauthInput = { epicIdentityHash, sessionHash: "c".repeat(64), transactionHash: "d".repeat(64), stateHash: "e".repeat(64) };
const executionInput = { epicIdentityHash, sessionHash: reauthInput.sessionHash, transactionHash: reauthInput.transactionHash };

test("reauthorization claim is atomic, bound to account/session/identity/state and one-time", async () => {
    const { object } = await fixture();
    assert.equal((await call(object, "begin", reauthInput)).status, 200);
    for (const field of ["accountKey", "epicIdentityHash", "sessionHash", "transactionHash", "stateHash"]) {
        assert.notEqual((await call(object, "claim", { ...reauthInput, [field]: "f".repeat(64) })).status, 200);
    }
    const results = await Promise.all([call(object, "claim", reauthInput), call(object, "claim", reauthInput)]);
    assert.equal(results.filter(row => row.status === 200).length, 1);
});

test("stale or expired reauthorization transaction cannot produce a handoff", async () => {
    const { object, storage } = await fixture();
    assert.notEqual((await call(object, "execute", executionInput)).status, 200);
    await call(object, "begin", reauthInput);
    const state = await storage.get("security");
    state.reauth.expiresAt = Date.now() - 1;
    await storage.put("security", state);
    assert.notEqual((await call(object, "claim", reauthInput)).status, 200);
});

async function preparedFixture() {
    const f = await fixture();
    await call(f.object, "begin", reauthInput);
    await call(f.object, "claim", reauthInput);
    const signed = await assertion();
    assert.equal((await call(f.object, "prepare", { transactionHash: reauthInput.transactionHash,
        assertion: signed, credential: "temporary-test-credential" })).status, 200);
    return { ...f, signed };
}

test("fresh explicit handoff executes once but never authenticates a provider without independent proof", async () => {
    const { object, storage, signed } = await preparedFixture();
    const saved = JSON.stringify(await storage.get("security"));
    assert.equal(saved.includes(signed), false);
    assert.equal(saved.includes("temporary-test-credential"), false);
    const results = await Promise.all([call(object, "execute", executionInput), call(object, "execute", executionInput)]);
    assert.equal(results.filter(row => row.code === "RL_PROBE_IDENTITY_PROOF_BLOCKED").length, 1);
    const accepted = results.find(row => row.code === "RL_PROBE_IDENTITY_PROOF_BLOCKED");
    assert.equal(accepted.identityVerified, false);
    assert.equal(accepted.probeExecutionEnabled, false);
    assert.equal(accepted.probeStarted, false);
    assert.equal(object.handoff, null);
});

test("eviction/credential expiry requires a new authorization, never restores credential from storage", async () => {
    const { object, storage } = await preparedFixture();
    const evicted = new UserRocketLeagueSession({ storage }, object.env);
    assert.equal((await call(evicted, "execute", executionInput)).code, "RL_PROBE_FRESH_REAUTH_REQUIRED");
    object.handoff.expiresAt = Date.now() - 1;
    assert.equal((await call(object, "execute", executionInput)).code, "RL_PROBE_FRESH_REAUTH_REQUIRED");
    assert.equal(object.handoff, null);
});

test("global bump invalidates prepared handoff and earlier assertions without touching per-user authority", async () => {
    const { object, authority, storage } = await preparedFixture();
    const response = await authority.fetch(new Request("https://internal/bump", { method: "POST", body: "{}" }));
    assert.equal((await response.json()).epoch, "2");
    assert.equal(object.handoff, null); // Emergency fanout clears custody before acknowledgement.
    assert.notEqual((await call(object, "execute", executionInput)).status, 200);
    await object.alarm();
    assert.equal((await storage.get("security")).temporary, null);
    assert.equal(object.handoff, null);
    assert.ok((await storage.get("security")).generation >= 1);
    const fresh = await call(object, "bootstrap", { epicIdentityHash });
    const iat = Math.max(Math.floor(Date.now() / 1000), Math.floor(fresh.invalidatedBefore / 1000) + 1);
    const newClaims = { securityEpoch: "2", generation: fresh.generation, iat, exp: iat + 60 };
    assert.equal((await call(object, "consume", { assertion: await assertion({ ...newClaims, generation: 0 }), credential: "temporary-test-credential" })).code, "RL_PROBE_GENERATION_REJECTED");
    assert.equal((await call(object, "consume", { assertion: await assertion(newClaims), credential: "temporary-test-credential" })).status, 200);
});

test("global authority serializes concurrent bumps monotonically and rejects malformed management input", async () => {
    const authority = new RlProbeSecurityAuthority({ storage: storageFixture() });
    const results = await Promise.all(Array.from({ length: 8 }, () => authority.fetch(new Request("https://internal/bump", { method: "POST", body: "{}" }))));
    const epochs = await Promise.all(results.map(async response => Number((await response.json()).epoch)));
    assert.deepEqual(epochs.sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal((await authority.fetch(new Request("https://internal/bump", { method: "POST", body: '{"epoch":1}' }))).status, 400);
});

test("routine Discord caller secret cannot invoke global emergency revocation", async () => {
    const request = new Request("https://internal/internal/rl-probe/epoch/bump", { method: "POST",
        headers: { Authorization: `Bearer ${"s".repeat(64)}` }, body: "{}" });
    const response = await runtime.fetch(request, { PROVIDER_RUNTIME_CALLER_SECRET: "s".repeat(64), RL_PROBE_REVOCATION_SECRET: "r".repeat(64) });
    assert.equal(response.status, 401);
});

test("request-controlled or echoed identity evidence is not accepted by the probe contract", async () => {
    const { object } = await preparedFixture();
    for (const evidence of [null, { PlayerID: "requested-identity" }, { localPlayerID: "constructed-identity" },
        { VerifiedPlayerName: "matching-name" }, { EpicAccountID: "canonical-but-echoed" }]) {
        assert.equal((await call(object, "execute", { ...executionInput, identityProof: evidence })).code, "REQUEST_SCHEMA_INVALID");
    }
    const result = await call(object, "execute", executionInput);
    assert.equal(result.code, "RL_PROBE_IDENTITY_PROOF_BLOCKED");
    assert.equal(result.identityVerified, false);
});

test("failed emergency cleanup never rolls global epoch back", async () => {
    const storage = storageFixture();
    const authority = new RlProbeSecurityAuthority({ storage }, {
        RL_USER_SESSION: { idFromName: key => key, get: () => ({ fetch: async () => new Response(null, { status: 503 }) }) }
    });
    await authority.fetch(new Request("https://internal/read", { method: "POST", body: JSON.stringify({ accountKey }) }));
    assert.equal((await authority.fetch(new Request("https://internal/bump", { method: "POST", body: "{}" }))).status, 503);
    assert.equal(await storage.get("epoch"), 2);
});
