import assert from "node:assert/strict";
import test from "node:test";
import { assertAccountCanPerform, canAccountPerform } from "../../functions/services/auth/account/access.js";
import { safeUpstreamErrorCode } from "../../functions/services/http/upstream.js";
import { authorizeRequest } from "../../functions/services/auth/authorization.js";
import { readFile } from "node:fs/promises";
import { getProviderConfig } from "../../functions/services/auth/oauth/provider_helpers.js";
import { onRequestPost as createSuggestion } from "../../functions/api/suggestions/index.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const stateFor = (state, { active = true, rlExists = true, rlActive = true } = {}) => ({
    exists: true, state, accountActive: active, suspended: state === "suspended",
    suspendedUntil: state === "suspended" ? "2026-10-06T00:00:00Z" : null,
    banned: state === "banned", removed: state === "removed",
    rocketLeague: { exists: rlExists, active: rlActive }
});

function rpcFetcher(state, allowedActions = []) {
    return async (url, init) => {
        const action = JSON.parse(init.body);
        return new Response(JSON.stringify(String(url).endsWith("get_account_access_state")
            ? state : allowedActions.includes(action.p_action)), { status: 200 });
    };
}

test("active account can perform a protected action from current RPC state", async () => {
    const state = await assertAccountCanPerform({ SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server" },
        accountId, "post", rpcFetcher(stateFor("active"), ["post"]));
    assert.equal(state.state, "active");
});

test("suspended account can log in and view account but cannot post", async () => {
    const env = { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server" };
    const fetcher = rpcFetcher(stateFor("suspended"), ["login", "view_account"]);
    assert.equal(await canAccountPerform(env, accountId, "login", fetcher), true);
    assert.equal(await canAccountPerform(env, accountId, "view_account", fetcher), true);
    await assert.rejects(assertAccountCanPerform(env, accountId, "post", fetcher), { code: "ACCOUNT_SUSPENDED", status: 403 });
});

test("suspension remains an authenticated viewable session even if legacy active is false", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.now();
    const env = {
        SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server",
        AUTH_SESSIONS: { async get() { return { UserId: accountId, Active: false, Role: "user",
            LastSeenAt: now, AbsoluteExpiresAt: now + 60_000 }; } }
    };
    globalThis.fetch = async url => String(url).endsWith("get_account_access_state")
        ? Response.json(stateFor("suspended", { active: false })) : Response.json(true);
    try {
        const authorization = await authorizeRequest(new Request("https://bpd.example/account", {
            headers: { cookie: "bpd_session=suspended-session" }
        }), env, { account: true, action: "view_account" });
        assert.equal(authorization.active, true);
        assert.equal(authorization.sessionContext.active, true);
        assert.equal(authorization.accountAccess.state, "suspended");
    } finally { globalThis.fetch = originalFetch; }
});

for (const stateName of ["banned", "removed", "inactive"]) {
    test(`${stateName} account is denied protected login and mutations`, async () => {
        const env = { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server" };
        const fetcher = rpcFetcher(stateFor(stateName, { active: stateName !== "inactive" }), []);
        await assert.rejects(assertAccountCanPerform(env, accountId, "login", fetcher), { status: 403 });
        await assert.rejects(assertAccountCanPerform(env, accountId, "post", fetcher), { status: 403 });
    });
}

test("RL-disabled account can retain general account actions but cannot use RL actions", async () => {
    const env = { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server" };
    const fetcher = rpcFetcher(stateFor("active", { rlActive: false }), ["manage_profile"]);
    assert.equal(await canAccountPerform(env, accountId, "manage_profile", fetcher), true);
    await assert.rejects(assertAccountCanPerform(env, accountId, "refresh_rl_stats", fetcher), { code: "ROCKET_LEAGUE_DISABLED" });
});

test("restricted provider resolver errors have one generic browser-safe code", () => {
    assert.equal(safeUpstreamErrorCode("ACCOUNT_ACCESS_RESTRICTED"), "ACCOUNT_ACCESS_RESTRICTED");
    assert.equal(safeUpstreamErrorCode("restriction matched private email"), "UPSTREAM_REJECTED");
});

test("malformed access RPC fails closed", async () => {
    const env = { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server" };
    const fetcher = async () => new Response(JSON.stringify({ exists: true, state: "active" }), { status: 200 });
    await assert.rejects(assertAccountCanPerform(env, accountId, "post", fetcher), { code: "ACCOUNT_ACCESS_UNAVAILABLE", status: 503 });
});

test("a pre-existing session is denied after current database state changes to banned", async () => {
    const originalFetch = globalThis.fetch;
    const env = {
        SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server",
        AUTH_SESSIONS: { async get(key) {
            assert.equal(key, "session:existing-session");
            return { UserId: accountId, Active: true, Role: "user", LastSeenAt: Date.now(), AbsoluteExpiresAt: Date.now() + 60_000 };
        } }
    };
    globalThis.fetch = async url => String(url).endsWith("get_account_access_state")
        ? Response.json(stateFor("banned")) : Response.json(false);
    try {
        await assert.rejects(authorizeRequest(new Request("https://bpd.example/api/suggestions", {
            headers: { cookie: "bpd_session=existing-session" }
        }), env, { session: true, account: true, action: "post" }), { code: "ACCOUNT_ACCESS_RESTRICTED", status: 403 });
    } finally { globalThis.fetch = originalFetch; }
});

test("direct protected POST is rejected for a suspended existing session before persistence", async () => {
    const originalFetch = globalThis.fetch;
    let suggestionWrites = 0;
    const env = {
        SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server",
        AUTH_SESSIONS: { async get() { return { UserId: accountId, Active: true, Role: "user",
            LastSeenAt: Date.now(), AbsoluteExpiresAt: Date.now() + 60_000 }; } }
    };
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("get_account_access_state")) return Response.json(stateFor("suspended"));
        if (String(url).endsWith("can_account_perform")) return Response.json(JSON.parse(init.body).p_action === "view_account");
        suggestionWrites++;
        return Response.json({ success: true });
    };
    try {
        const response = await createSuggestion({ request: new Request("https://bpd.example/api/suggestions", {
            method: "POST", headers: { cookie: "bpd_session=existing", origin: "https://bpd.example", "content-type": "application/json" },
            body: JSON.stringify({ title: "Test idea", description: "A useful proposal body" })
        }), env });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error, "ACCOUNT_SUSPENDED");
        assert.equal(suggestionWrites, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("present mutation paths request the server-authoritative protected action", async () => {
    const cases = [
        ["functions/api/suggestions/index.js", /action:\s*"post"/],
        ["functions/api/suggestions/[suggestionId]/vote.js", /action:\s*"post"/],
        ["functions/api/ocr/jobs/submit_job.js", /authorizeRocketLeagueRequest\(request, env, "submit_scoreboard"\)/],
        ["functions/services/ocr/handler.js", /authorizeRocketLeagueRequest\(request, env, "submit_scoreboard"\)/],
        ["functions/services/ocr/confirm.js", /authorizeRocketLeagueRequest\(request, env, "submit_result"\)/],
        ["functions/api/auth/account/last_login.js", /canAccountPerform\(env, authorization\.accountId, "refresh_rl_stats"\)/],
        ["functions/services/rl/admin_force_refresh.js", /assertAccountCanPerform\(env, normalizedAccountId, "refresh_rl_stats"\)/]
    ];
    for (const [path, pattern] of cases) assert.match(await readFile(path, "utf8"), pattern, path);
});

test("Discord login uses its dedicated normal resolve/link RPC contract", () => {
    assert.deepEqual(getProviderConfig("discord"), {
        label: "Discord", resolveRpc: "resolve_discord_identity", linkRpc: "link_discord_identity"
    });
});

test("stale Epic authorization remains linked and requests reauthorization", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.now();
    const env = {
        SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server",
        AUTH_SESSIONS: { async get(key) {
            if (key === "session:epic-session") return { UserId: accountId, Active: true, Role: "user",
                LastSeenAt: now, AbsoluteExpiresAt: now + 60_000,
                Providers: { epic: { AccountId: "canonical-epic", Linked: true, Authenticated: true } } };
            if (key === `provider_auth_id:${accountId}:epic`) return { accountId, provider: "epic",
                connectedAt: new Date(now - 32 * 86400000).toISOString(), expiresAt: new Date(now - 86400000).toISOString() };
            if (key === `account_login_status:${accountId}`) return { accountId, lastLoginAt: new Date(now).toISOString(), providerReauthAfter: null };
            return null;
        }, async put() {} }
    };
    globalThis.fetch = async url => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        if (String(url).endsWith("verify_account_provider_identity")) return Response.json([{ account_id: accountId, provider: "epic",
            provider_subject: "canonical-epic", active: true }]);
        throw new Error("Unexpected provider request");
    };
    try {
        await assert.rejects(authorizeRequest(new Request("https://bpd.example/RocketLeague", {
            headers: { cookie: "bpd_session=epic-session" }
        }), env, { account: true, provider: "epic" }), error =>
            error.code === "PROVIDER_REAUTHORIZATION_REQUIRED"
            && error.details?.linked === true
            && error.details?.requiresReauthorization === true);
    } finally { globalThis.fetch = originalFetch; }
});
