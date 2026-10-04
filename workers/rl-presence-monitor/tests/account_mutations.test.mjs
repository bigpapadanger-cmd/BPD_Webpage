import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleAccountMutation } from "../../../functions/services/auth/account/mutations.js";
const DAY = 86400000, NOW = Date.UTC(2026,8,19,12);
const originalNow = Date.now, originalFetch = globalThis.fetch;
afterEach(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
function fixture({ providers = ["epic"], active = true, ageConsent = true } = {}) {
    Date.now = () => NOW;
    const records = new Map();
    const calls = [];
    const iso = time => new Date(time).toISOString();
    records.set("session:test-session", { UserId: "account-1", Role: "user", Active: active,
        CreatedAt: NOW - DAY, LastSeenAt: NOW, AbsoluteExpiresAt: NOW + DAY,
        Providers: Object.fromEntries(providers.map(provider => [provider, { AccountId: "old-cached-subject", Linked: true }])) });
    records.set("account_login_status:account-1", { accountId: "account-1", lastLoginAt: iso(NOW - DAY), providerReauthAfter: null });
    for (const provider of providers) records.set(`provider_auth_id:account-1:${provider}`, {
        accountId: "account-1", provider, connectedAt: iso(NOW - DAY), expiresAt: iso(NOW + 30 * DAY)
    });
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "test",
        AUTH_SESSIONS: { get: async key => structuredClone(records.get(key) ?? null),
            put: async (key, value) => records.set(key, JSON.parse(value)), delete: async key => records.delete(key) } };
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input); calls.push(url);
        const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
        if (url.endsWith("get_account_session_identity")) return Response.json([{ id: "account-1", role: "user", active }]);
        if (url.endsWith("verify_account_provider_identity")) return Response.json(providers.includes(body.p_provider)
            ? [{ account_id: "account-1", provider: body.p_provider, provider_subject: `${body.p_provider}-subject`, active: true }] : []);
        if (url.endsWith("get_rocketleague_profile")) return Response.json({ account_id: "account-1", rl_player_id: "player-1",
            active, registration_status: "complete", profile_complete: true, rocket_league_access: true,
            age_consent: ageConsent, policy_consent: true });
        if (url.endsWith("touch_account_last_seen")) return Response.json({ updated: true });
        if (url.endsWith("get_stats_refresh_state")) return Response.json([]);
        throw new Error(`Unexpected request ${url}`);
    };
    const request = new Request("https://bpd.invalid/api/test", { headers: { cookie: "bpd_session=test-session" } });
    return { env, records, request, calls, iso };
}


function setup(options = {}, response = { accountId: "account-1", displayName: "New Player",
    displayNameChangedAt: "2026-09-19T12:00:00.000Z", displayNameChangeAvailableAt: "2026-10-19T12:00:00.000Z" }) {
    const f = fixture(options), authFetch = globalThis.fetch, mutations = [];
    globalThis.fetch = async (url, init) => {
        if (/\/(update_account_display_name|deactivate_account|delete_account)$/.test(String(url))) {
            mutations.push({ url, ...init, body: JSON.parse(init.body) });
            if (response instanceof Error) throw response;
            return Response.json(response, { status: response?.status || 200 });
        }
        return authFetch(url, init);
    };
    return { ...f, mutations };
}
function request(operation = "profile", body = { displayName: "New Player" }, headers = {}) {
    return new Request("https://bpd.invalid/api/auth/account", { method: operation === "delete" ? "DELETE" : "POST",
        headers: { origin: "https://bpd.invalid", cookie: "bpd_session=test-session", "content-type": "application/json", ...headers },
        body: JSON.stringify(body) });
}
test("profile mutation uses canonical ownership, API schema, and excludes raw account records", async () => {
    const f = setup({}, { accountId: "account-1", displayName: "New Player",
        displayNameChangedAt: "2026-09-19T12:00:00.000Z", displayNameChangeAvailableAt: "2026-10-19T12:00:00.000Z",
        account: { private: true } });
    const response = await handleAccountMutation(request(), f.env, "profile");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, displayName: "New Player",
        displayNameChangedAt: "2026-09-19T12:00:00.000Z", displayNameChangeAvailableAt: "2026-10-19T12:00:00.000Z" });
    assert.deepEqual(f.mutations[0].body, { p_account_id: "account-1", p_display_name: "New Player" });
    assert.equal(f.mutations[0].url, "https://db.invalid/rest/v1/rpc/update_account_display_name");
    assert.equal(f.mutations[0].headers["Content-Profile"], "api");
    assert.equal(response.headers.get("set-cookie"), null);
});
test("invalid input, browser ownership, cross-site requests, and missing confirmation never mutate", async () => {
    const f = setup();
    for (const [op, body, headers] of [
        ["profile", { displayName: "New Player", accountId: "other" }],
        ["profile", { displayName: "x" }],
        ["profile", { displayName: "New Player" }, { origin: "https://attacker.invalid" }],
        ["profile", { displayName: "New Player" }, { origin: "" }],
        ["deactivate", {}], ["delete", { confirmation: "delete" }]
    ]) assert.ok((await handleAccountMutation(request(op, body, headers), f.env, op)).status >= 400);
    assert.equal(f.mutations.length, 0);
});
test("signed-out, inactive, and stale accounts cannot mutate; any current supported provider can", async () => {
    for (const scenario of ["signed-out", "inactive", "stale", "google", "discord", "steam"]) {
        const f = setup({ active: scenario !== "inactive", providers: [scenario === "google" || scenario === "discord" || scenario === "steam" ? scenario : "epic"] });
        if (scenario === "signed-out") f.records.delete("session:test-session");
        if (scenario === "stale") f.records.delete("provider_auth_id:account-1:epic");
        const response = await handleAccountMutation(request(), f.env, "profile");
        assert.equal(response.status, scenario === "signed-out" ? 401 : ["inactive", "stale"].includes(scenario) ? 403 : 200, scenario);
        assert.equal(f.mutations.length, ["google", "discord", "steam"].includes(scenario) ? 1 : 0);
        if (scenario === "stale") assert.equal((await response.json()).code, "PROVIDER_REAUTHORIZATION_REQUIRED");
    }
});
test("confirmed removal clears the session only after RPC success without touching provider links", async () => {
    for (const op of ["deactivate", "delete"]) {
        const f = setup({}, { accountId: "account-1", ...(op === "delete" ? { deleted: true } : { active: false, changed: true }) });
        const response = await handleAccountMutation(request(op, { confirmation: op.toUpperCase() }), f.env, op);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
        assert.equal(f.records.has("session:test-session"), false);
        assert.deepEqual(f.mutations[0].body, { p_account_id: "account-1" });
        assert.equal(f.mutations.length, 1);
        assert.equal(f.records.has("provider_auth_id:account-1:epic"), true);
    }
});
test("outages, invalid RPC results, and database errors never clear a session or expose internals", async () => {
    for (const result of [new Error("private host"), { accountId: "other", deleted: true },
        { status: 409, message: "ACCOUNT_DELETE_CONFLICT" }, { status: 500, message: "private SQL", details: "private" }]) {
        const f = setup({}, result);
        const response = await handleAccountMutation(request("delete", { confirmation: "DELETE" }), f.env, "delete");
        assert.equal(response.status, result.message === "ACCOUNT_DELETE_CONFLICT" ? 409 : 503);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal(f.records.has("session:test-session"), true);
        const body = await response.json();
        assert.doesNotMatch(JSON.stringify(body), /private/);
        if (response.status === 503) assert.equal(body.authenticated, null);
    }
});
