import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRlProbeAssertion, deriveRlProbeAccountKey, invalidateRlProbeSession } from "../../functions/services/rl/probe_security.js";
import { handleLogout } from "../../functions/services/auth/account/logout.js";
import { handleRocketLeagueProfileDelete } from "../../functions/services/rl/delete_profile.js";
import { onRequestPost } from "../../functions/api/admin/rocketleague/compatibility-probe.js";

const secret = "s".repeat(64);
function config() {
    const session = { UserId: "account-1", Role: "admin", Active: true,
        AbsoluteExpiresAt: Date.now() + 60000, LastSeenAt: Date.now() };
    const calls = [];
    let deleted = false;
    return { calls, get deleted() { return deleted; }, env: {
        RL_PROBE_SECURITY_ENABLED: "true", RL_PROBE_ACCOUNT_KEY_SECRET: "k".repeat(64), PROVIDER_RUNTIME_CALLER_SECRET: secret,
        SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "test-only",
        AUTH_SESSIONS: { async get(key) { return key === "session:session-1" ? session : null; }, async delete() { deleted = true; } },
        PROVIDER_RUNTIME: { async fetch(url, init) { calls.push(JSON.parse(init.body)); return Response.json({ success: true, code: "RL_PROBE_INVALIDATED" }); } }
    } };
}

test("opaque object key is server-derived, stable and account-specific", async () => {
    const env = { RL_PROBE_ACCOUNT_KEY_SECRET: secret };
    const one = await deriveRlProbeAccountKey(env, "account-1");
    assert.match(one, /^[a-f0-9]{64}$/u);
    assert.equal(one, await deriveRlProbeAccountKey(env, "account-1"));
    assert.notEqual(one, await deriveRlProbeAccountKey(env, "account-2"));
    assert.equal(one.includes("account-1"), false);
});

test("server ES256 signing binds fresh reauthorization, credential digest and opaque account", async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const env = { RL_PROBE_SECURITY_ENABLED: "true", RL_PROBE_ACCOUNT_KEY_SECRET: secret,
        RL_PROBE_SIGNING_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)),
        RL_PROBE_ISSUER: "https://bpd.invalid", RL_PROBE_KEY_VERSION: "test", PROVIDER_RUNTIME_CALLER_SECRET: secret,
        PROVIDER_RUNTIME: { fetch: async () => Response.json({ success: true, epoch: "1" }) } };
    const input = { accountId: "account-1", epicIdentityHash: "b".repeat(64), credential: "one-time-test-token",
        generation: 7, invalidatedBefore: Date.now(), reauthorizedAt: Date.now() };
    const signed = await createRlProbeAssertion(env, input);
    const [header, payload, signature] = signed.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.sub, await deriveRlProbeAccountKey(env, "account-1"));
    assert.equal(claims.generation, 7);
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(Buffer.from(claims.jti, "base64url").length, 32);
    assert.equal(claims.iat * 1000 > input.invalidatedBefore, true);
    assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey,
        Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`)), true);
    assert.equal(JSON.stringify(claims).includes(input.credential), false);
    await assert.rejects(createRlProbeAssertion(env, { ...input, reauthorizedAt: Date.now() - 60001 }), /RL_PROBE_FRESH_REAUTH_REQUIRED/);
    await assert.rejects(createRlProbeAssertion({ ...env, RL_PROBE_SECURITY_ENABLED: "false" }, input), /RL_PROBE_FRESH_REAUTH_REQUIRED/);
});

test("invalidation is disabled by default and fails closed when enabled but unavailable", async () => {
    await invalidateRlProbeSession({}, "account-1", "logout");
    await assert.rejects(invalidateRlProbeSession({ RL_PROBE_SECURITY_ENABLED: "true" }, "account-1", "epic_unlink"), /RL_PROBE_INVALIDATION_REQUIRED/);
    const f = config();
    f.env.PROVIDER_RUNTIME.fetch = async () => Response.json({ success: false }, { status: 503 });
    await assert.rejects(invalidateRlProbeSession(f.env, "account-1", "identity_change"), /RL_PROBE_INVALIDATION_REQUIRED/);
});

test("logout invalidates before destroying the authenticated session", async () => {
    const f = config();
    const request = new Request("https://bpd.invalid/api/auth/logout", { headers: { cookie: "bpd_session=session-1" } });
    const response = await handleLogout(request, f.env);
    assert.equal(response.status, 302);
    assert.equal(f.calls[0].reason, "logout");
    assert.equal(f.calls[0].accountKey, await deriveRlProbeAccountKey(f.env, "account-1"));
    assert.equal(f.deleted, true);
});

test("logout cannot claim success if required invalidation fails", async () => {
    const f = config();
    f.env.PROVIDER_RUNTIME.fetch = async () => Response.json({ success: false }, { status: 503 });
    const request = new Request("https://bpd.invalid/api/auth/logout", { headers: { cookie: "bpd_session=session-1" } });
    assert.equal((await handleLogout(request, f.env)).status, 500);
    assert.equal(f.deleted, false);
});

test("profile delete invalidates before Supabase and blocks deletion on invalidation failure", async () => {
    const originalFetch = globalThis.fetch;
    const f = config();
    let writes = 0;
    const request = () => new Request("https://bpd.invalid/api/auth/rocketleague/profile", { method: "DELETE",
        headers: { cookie: "bpd_session=session-1", origin: "https://bpd.invalid", "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE_ROCKETLEAGUE_PROFILE" }) });
    globalThis.fetch = async () => {
        writes++;
        assert.equal(f.calls[0].reason, "profile_delete");
        return Response.json({ success: true, playerId: "22222222-2222-4222-8222-222222222222", epicIdentitiesRemoved: 1 });
    };
    try {
        assert.equal((await handleRocketLeagueProfileDelete(request(), f.env)).status, 200);
        f.env.PROVIDER_RUNTIME.fetch = async () => Response.json({ success: false }, { status: 503 });
        assert.equal((await handleRocketLeagueProfileDelete(request(), f.env)).status, 503);
        assert.equal(writes, 1);
    } finally { globalThis.fetch = originalFetch; }
});

test("Epic unlink and identity-link hooks precede authoritative mutation", async () => {
    const unlink = await readFile(new URL("../../functions/services/auth/account/unlink_provider.js", import.meta.url), "utf8");
    const callback = await readFile(new URL("../../functions/services/auth/providers/epic/callback.js", import.meta.url), "utf8");
    assert.match(unlink, /provider === "epic"[\s\S]*?invalidateRlProbeSession\(env, accountId, "epic_unlink"\)[\s\S]*?await unlinkAccountIdentity/);
    assert.match(callback, /OAUTH_MODE_LINK[\s\S]*?invalidateRlProbeSession\(env, accountContext\.accountId, "identity_change"\)[\s\S]*?await linkEpicIdentity/);
    assert.match(unlink, /RL_PROBE_INVALIDATION_REQUIRED/);
    assert.match(callback, /RL_PROBE_INVALIDATION_REQUIRED/);
});

test("Admin probe route rejects unauthenticated callers and has no provider execution", async () => {
    const response = await onRequestPost({ request: new Request("https://bpd.invalid/api/admin/rocketleague/compatibility-probe", { method: "POST" }), env: {} });
    assert.notEqual(response.status, 200);
    const source = await readFile(new URL("../../functions/api/admin/rocketleague/compatibility-probe.js", import.meta.url), "utf8");
    assert.match(source, /authorizeAdminPermission/);
    assert.match(source, /ADMIN_SETTINGS_MANAGE/);
    assert.match(source, /probeExecutionEnabled: false/);
    assert.doesNotMatch(source, /\.fetch\(|AuthPlayer|GetMatchHistory|access_token|refresh_token/);
});

test("MyProfile rejects unavailable or incomplete eligibility even when prior eligible=true", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const expression = source.match(/eligible: (response\.ok[^,]+),\s*status:/u)[1];
    const eligible = new Function("response", "result", `return ${expression};`);
    const base = { success: true, status: "available", stale: false, countComplete: true, eligible: true, matchBotAvailable: true };
    assert.equal(eligible({ ok: true }, base), true);
    for (const change of [{ status: "unavailable" }, { stale: true }, { countComplete: false }]) {
        assert.equal(eligible({ ok: true }, { ...base, ...change }), false);
    }
});
