import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { beginProbeReauthorization, claimProbeCallback, prepareProbeCallback, executePreparedProbe, PROBE_COOKIE } from "../../functions/services/rl/probe_reauth.js";
import { onRequestPost } from "../../functions/api/admin/rocketleague/compatibility-probe.js";
import runtime from "../../workers/bpd-provider-runtime/src/index.js";
import { RlProbeSecurityAuthority } from "../../workers/bpd-provider-runtime/src/rl_probe_authority.js";
import { UserRocketLeagueSession } from "../../workers/bpd-provider-runtime/src/rl_user_session.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function storage() {
    const records = new Map();
    let tail = Promise.resolve();
    const result = { get: async key => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value)),
        setAlarm: async () => {}, deleteAlarm: async () => {},
        transaction(callback) { const work = tail.then(() => callback(result)); tail = work.catch(() => {}); return work; } };
    return result;
}
async function fixture(admin = true) {
    const now = Date.now();
    const records = new Map([
        ["session:test-session", { UserId: "account-test", Role: "user", Active: true, LastSeenAt: now, AbsoluteExpiresAt: now + 86400000 }],
        ["account_login_status:account-test", { accountId: "account-test", lastLoginAt: new Date(now).toISOString(), providerReauthAfter: null }],
        ["provider_auth_id:account-test:discord", { accountId: "account-test", provider: "discord", connectedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() }]
    ]);
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const env = { RL_PROBE_SECURITY_ENABLED: "true", RL_PROBE_ACCOUNT_KEY_SECRET: "k".repeat(64),
        PROVIDER_RUNTIME_CALLER_SECRET: "s".repeat(64), RL_PROBE_REVOCATION_SECRET: "r".repeat(64),
        RL_PROBE_ISSUER: "https://bpd.invalid", RL_PROBE_KEY_VERSION: "test-key",
        RL_PROBE_SIGNING_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)),
        SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "test", SUPABASE_SERVICE_ROLE_KEY: "test",
        DISCORD_AUTHZ_GUILD_ID: "test-guild", DISCORD_AUTHZ_BOT_TOKEN: "test",
        DISCORD_AUTHZ_ADMIN_ROLE_ID: "100000000000000001", DISCORD_AUTHZ_MOD_ROLE_ID: "100000000000000002",
        DISCORD_AUTHZ_OWNER_ROLE_ID: "100000000000000003", DISCORD_AUTHZ_DATABASE_ROLE_ID: "100000000000000004",
        DISCORD_AUTHZ_SECURITY_ROLE_ID: "100000000000000005", DISCORD_AUTHZ_UI_ROLE_ID: "100000000000000006",
        EPIC_CLIENT_ID: "test-client", EPIC_REDIRECT_URI: "https://bpd.invalid/api/auth/epic/callback",
        AUTH_SESSIONS: { get: async key => structuredClone(records.get(key) ?? null), put: async (key, value) => records.set(key, JSON.parse(value)) } };
    const workerEnv = { ...env, RL_PROBE_VERIFY_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.publicKey)) };
    const authority = new RlProbeSecurityAuthority({ storage: storage() }, workerEnv);
    workerEnv.RL_PROBE_SECURITY = { idFromName: name => name, get: () => authority };
    const objects = new Map();
    workerEnv.RL_USER_SESSION = { idFromName: name => name, get: name => {
        if (!objects.has(name)) objects.set(name, new UserRocketLeagueSession({ storage: storage() }, workerEnv));
        return objects.get(name);
    } };
    env.PROVIDER_RUNTIME = { fetch: (url, init) => runtime.fetch(new Request(url, init), workerEnv) };
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (url.endsWith("can_account_perform")) return Response.json(true);
        if (url.startsWith("https://discord.com/")) return Response.json({ user: { id: "discord-test" }, roles: [admin === true ? env.DISCORD_AUTHZ_ADMIN_ROLE_ID : admin === false ? env.DISCORD_AUTHZ_MOD_ROLE_ID : "100000000000000007"], pending: false });
        if (url.endsWith("get_account_session_identity")) return Response.json([{ id: "account-test", role: "user", active: true }]);
        if (url.endsWith("verify_account_provider_identity")) {
            const provider = JSON.parse(init.body).p_provider;
            return Response.json([{ account_id: "account-test", provider, provider_subject: provider === "epic" ? "canonical-epic" : "discord-test", active: true }]);
        }
        throw new Error("Unexpected outbound request in offline probe test");
    };
    const request = (extra = "", body = null) => new Request("https://bpd.invalid/api/admin/rocketleague/compatibility-probe", {
        method: "POST", headers: { cookie: `bpd_session=test-session${extra}`, origin: "https://bpd.invalid", "Content-Type": "application/json" },
        body: JSON.stringify(body ?? { confirmation: "START_FRESH_EPIC_REAUTH" }) });
    return { env, request, objects };
}
async function begin(f) {
    const started = await beginProbeReauthorization(f.request(), f.env);
    const transaction = decodeURIComponent(started.cookies.find(cookie => cookie.startsWith(`${PROBE_COOKIE}=`)).split(";")[0].slice(PROBE_COOKIE.length + 1));
    return { request: f.request(`; ${PROBE_COOKIE}=${transaction}`), state: new URL(started.redirectUrl).searchParams.get("state") };
}

test("Admin starts new OAuth transaction; cached authorization alone cannot execute", async () => {
    const f = await fixture();
    const response = await onRequestPost({ request: f.request(), env: f.env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.probeExecutionEnabled, false);
    assert.equal(new URL(body.redirectUrl).searchParams.get("response_type"), "code");
    await assert.rejects(executePreparedProbe(f.request(), f.env), /RL_PROBE_REAUTH_REQUIRED/);
    assert.doesNotMatch(JSON.stringify(body), /canonical-epic|account-test|credential|assertion/);
});

test("normal user/moderator cannot begin a probe or emergency revoke", async () => {
    for (const role of [false, "user"]) {
        const f = await fixture(role);
        await assert.rejects(beginProbeReauthorization(f.request(), f.env));
        assert.equal((await onRequestPost({ request: f.request("", { confirmation: "REVOKE_ALL_RL_PROBES" }), env: f.env })).status, 403);
        assert.equal(f.objects.size, 0);
    }
});

test("fresh callback claims once, validates canonical Epic identity, and makes handoff available only for explicit action", async () => {
    const f = await fixture();
    const started = await begin(f);
    const ctx = await claimProbeCallback(started.request, f.env, "reauthorize", started.state);
    await assert.rejects(claimProbeCallback(started.request, f.env, "reauthorize", started.state));
    await assert.rejects(prepareProbeCallback(f.env, ctx, "wrong-epic", "test-credential"), /RL_PROBE_IDENTITY_MISMATCH/);
    await prepareProbeCallback(f.env, ctx, "canonical-epic", "test-credential");
    const result = await executePreparedProbe(started.request, f.env);
    assert.equal(result.code, "RL_PROBE_IDENTITY_PROOF_BLOCKED");
    assert.equal(result.probeStarted, false);
    assert.equal(result.identityVerified, false);
    await assert.rejects(executePreparedProbe(started.request, f.env));
});

test("wrong OAuth mode/state and missing authentication reject fresh callback", async () => {
    const f = await fixture();
    const started = await begin(f);
    await assert.rejects(claimProbeCallback(started.request, f.env, "login", started.state));
    await assert.rejects(claimProbeCallback(started.request, f.env, "reauthorize", "wrong-state"));
    const signedOut = new Request(started.request.url, { headers: { cookie: started.request.headers.get("cookie").replace("bpd_session=test-session; ", "") } });
    await assert.rejects(claimProbeCallback(signedOut, f.env, "reauthorize", started.state));
});

test("callback claims transaction before token exchange and stages only after canonical reauthorization validation", async () => {
    const source = await readFile(new URL("../../functions/services/auth/providers/epic/callback.js", import.meta.url), "utf8");
    assert.ok(source.indexOf("await claimProbeCallback") < source.indexOf("await exchangeEpicCode", source.indexOf("async function executeCallback")));
    assert.ok(source.indexOf("await prepareProbeCallback") > source.indexOf("await verifyEpicReauthorization", source.indexOf("async function executeCallback")));
    assert.doesNotMatch(source, /await executePreparedProbe/);
});

test("browser-supplied identity/epoch fields rejected; emergency response exposes no epoch internals", async () => {
    const f = await fixture();
    assert.equal((await onRequestPost({ request: f.request("", { confirmation: "START_FRESH_EPIC_REAUTH", accountId: "other" }), env: f.env })).status, 400);
    const response = await onRequestPost({ request: f.request("", { confirmation: "REVOKE_ALL_RL_PROBES" }), env: f.env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, code: "RL_PROBES_REVOKED", probeExecutionEnabled: false });
});
