import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleOAuthCallback } from "../../../functions/services/auth/oauth/callback.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function setup(provider, { created = false, mode = "login", mismatch = false, activityFails = false } = {}) {
    const records = new Map(), calls = [];
    const now = Date.now();
    if (mode !== "login") {
        records.set("session:existing", { UserId: "account-1", Active: true, Role: "user",
            CreatedAt: now, LastSeenAt: now, AbsoluteExpiresAt: now + 86400000,
            Providers: { [provider]: { AccountId: "subject-1", Linked: true } } });
        records.set("account_login_status:account-1", { accountId: "account-1",
            lastLoginAt: new Date(now - 86400000).toISOString(), providerReauthAfter: null });
    }
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "test-only",
        RL_STATS_CACHE: { get: async key => { calls.push({ url: `kv:${key}` }); return { reason: "REFRESH_NOT_DUE" }; } },
        AUTH_SESSIONS: { get: async key => structuredClone(records.get(key) ?? null),
            put: async (key, value) => records.set(key, JSON.parse(value)), delete: async key => records.delete(key) } };
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input), body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url, body });
        if (url.endsWith("/rpc/get_account_access_state")) return Response.json({ exists: true, state: "active",
            accountActive: true, suspended: false, suspendedUntil: null, banned: false, removed: false,
            rocketLeague: { exists: true, active: true } });
        if (url.endsWith("/rpc/can_account_perform")) return Response.json(true);
        if (url.includes("/auth/v1/token")) return Response.json({ access_token: "test-token" });
        if (url.endsWith("/auth/v1/user")) return Response.json({ id: "auth-user-1",
            app_metadata: { provider }, identities: [{ provider, identity_data: { sub: mismatch ? "other-subject" : "subject-1" } }] });
        if (url.endsWith(`/rpc/resolve_${provider}_identity`)) return Response.json({ account_id: "account-1",
            active: true, role: "user", created_account: created });
        if (url.endsWith(`/rpc/link_${provider}_identity`)) return Response.json({ account_id: "account-1",
            active: true, role: "user", linked_identity: true });
        if (url.endsWith("/rpc/verify_account_provider_identity")) return Response.json({ account_id: "account-1",
            provider, provider_subject: "subject-1", active: true });
        if (url.endsWith("/rpc/touch_account_last_seen")) return Response.json({ updated: !activityFails }, { status: activityFails ? 503 : 200 });
        // The MMR gate/authorization path may inspect profile state; no real requests.
        if (url.endsWith("/rpc/get_stats_refresh_state")) return Response.json([]);
        throw Error(`Unexpected request: ${url}`);
    };
    const cookies = [`bpd_oauth_mode=${mode}`, `bpd_oauth_provider=${provider}`, "bpd_oauth_pkce=test-verifier",
        "bpd_oauth_return=%2FRocketLeague"];
    if (mode !== "login") cookies.push("bpd_session=existing", "bpd_oauth_account=account-1");
    return { env, records, calls, request: new Request("https://bpd.invalid/api/auth/_oauth/callback?code=test-code", {
        headers: { cookie: cookies.join("; ") }
    }) };
}

for (const provider of ["google", "discord"]) {
    for (const created of [false, true]) {
        test(`${provider}: ${created ? "new" : "existing"} identity logs into the canonical account and updates activity`, async () => {
            const { env, records, calls, request } = setup(provider, { created });
            const response = await handleOAuthCallback(request, env);
            assert.equal(response.headers.get("location"), created ? "/Account?setup=1" : "/RocketLeague");
            assert.match(response.headers.get("set-cookie"), /bpd_session=/);
            const session = [...records].find(([key]) => key.startsWith("session:"))[1];
            assert.equal(session.UserId, "account-1");
            assert.ok(records.get(`provider_auth_id:account-1:${provider}`));
            assert.ok(records.get("account_login_status:account-1").lastLoginAt);
            assert.equal(calls.filter(call => call.url.endsWith("touch_account_last_seen")).length, 1);
            assert.ok(calls.some(call => call.url.endsWith("/rpc/get_account_access_state")));
            assert.ok(calls.some(call => call.url.endsWith("/rpc/can_account_perform")));
            assert.ok(!calls.some(call => /\/link_/.test(call.url)));
        });
    }
    for (const mode of ["link", "reauthorize"]) {
        test(`${provider}: ${mode} preserves the BPD login timestamp`, async () => {
            const { env, records, calls, request } = setup(provider, { mode });
            const before = records.get("account_login_status:account-1").lastLoginAt;
            const response = await handleOAuthCallback(request, env);
            assert.equal(response.headers.get("location"), "/RocketLeague");
            assert.equal(records.get("account_login_status:account-1").lastLoginAt, before);
            assert.ok(!calls.some(call => /touch_account_last_seen|\/resolve_/.test(call.url)));
            assert.ok(!calls.some(call => call.url.startsWith("kv:")));
            if (mode === "reauthorize") assert.ok(!calls.some(call => /\/link_/.test(call.url)));
        });
    }
    test(`${provider}: reauthorization with another subject preserves the existing link`, async () => {
        const { env, records, calls, request } = setup(provider, { mode: "reauthorize", mismatch: true });
        const before = structuredClone([...records]);
        const response = await handleOAuthCallback(request, env);
        const location = new URL(response.headers.get("location"), request.url);
        assert.equal(location.pathname, "/Account");
        assert.equal(location.searchParams.get("error"), "PROVIDER_REAUTHORIZATION_MISMATCH");
        assert.match(location.searchParams.get("debugId") || "", /^[0-9a-f-]{36}$/iu);
        assert.deepEqual([...records], before);
        assert.ok(!calls.some(call => /\/link_|\/resolve_/.test(call.url)));
    });
}

test("account activity failure does not undo successful Google authentication", async () => {
    const { env, records, request } = setup("google", { activityFails: true });
    const response = await handleOAuthCallback(request, env);
    assert.equal(response.headers.get("location"), "/RocketLeague");
    assert.ok([...records.keys()].some(key => key.startsWith("session:")));
});
