import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getProviderAuthorizationState, recordProviderAuthentication, recordAccountLogin } from "../../../functions/services/auth/providers/provider_auth_state.js";
import { authorizeRequest } from "../../../functions/services/auth/authorization.js";
import { handleAuthSession } from "../../../functions/services/auth/account/get_session.js";
import { authorizeRocketLeagueRequest } from "../../../functions/services/rl/authorization.js";
import { handleRocketLeagueSession } from "../../../functions/services/rl/session.js";
import { handleRocketLeagueProfile } from "../../../functions/services/rl/profile.js";
import { handleEpicCallback } from "../../../functions/services/auth/providers/epic/callback.js";
import { onRequest as accountActivityFallback, onRequestPost as lastLogin } from "../../../functions/api/auth/account/last_login.js";
import { onRequestGet as getJob } from "../../../functions/api/ocr/jobs/get_job.js";
import worker from "../src/index.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 19, 12);
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
afterEach(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });

test("registration API refuses missing consent, stale Epic, and inactive accounts before saving", async () => {
    for (const scenario of ["missing-consent", "stale", "inactive"]) {
        const { env, records, calls } = fixture({ active: scenario !== "inactive" });
        if (scenario === "stale") records.delete("provider_auth_id:account-1:epic");
        const response = await handleRocketLeagueProfile(new Request("https://bpd.invalid/api/auth/rocketleague/profile", {
            method: "POST", headers: { cookie: "bpd_session=test-session", "content-type": "application/json" },
            body: JSON.stringify({ accountId: "someone-else", EpicUniqueId: "forged-subject",
                ageConsent: false, policyConsent: false })
        }), env);
        assert.equal(response.status, scenario === "missing-consent" ? 400 : 403, scenario);
        assert.ok(!calls.some(url => /ensure_|save_|refresh|resolve_/.test(url)), scenario);
    }
});

function fixture({ providers = ["epic"], active = true, ageConsent = true } = {}) {
    Date.now = () => NOW;
    const records = new Map();
    const calls = [];
    const iso = time => new Date(time).toISOString();
    records.set("session:test-session", { UserId: "account-1", Role: "user", Active: true,
        CreatedAt: NOW - DAY, LastSeenAt: NOW, AbsoluteExpiresAt: NOW + DAY,
        Providers: { epic: { AccountId: "old-cached-subject", Linked: true } } });
    records.set("account_login_status:account-1", { accountId: "account-1", lastLoginAt: iso(NOW - DAY), providerReauthAfter: null });
    for (const provider of providers) records.set(`provider_auth_id:account-1:${provider}`, {
        accountId: "account-1", provider, connectedAt: iso(NOW - DAY), expiresAt: iso(NOW + 30 * DAY)
    });
    const status = new Map();
    const env = { SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "test",
        AUTH_SESSIONS: { get: async key => structuredClone(records.get(key) ?? null),
            put: async (key, value) => records.set(key, JSON.parse(value)), delete: async key => records.delete(key) },
        SERVICE_STATUS: { get: async key => status.get(key) ?? null, put: async (key, value) => status.set(key, value), delete: async key => status.delete(key) } };
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

test("freshness expires exactly at day 31 and cannot be extended by expiresAt", async () => {
    const { env, records, iso } = fixture();
    const key = "provider_auth_id:account-1:epic";
    records.set(key, { ...records.get(key), connectedAt: iso(NOW - 31 * DAY + 1), expiresAt: iso(NOW + DAY) });
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, true);
    records.get(key).connectedAt = iso(NOW - 31 * DAY);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, false);
});

test("missing or malformed freshness fails closed", async () => {
    const { env, records } = fixture();
    records.delete("provider_auth_id:account-1:epic");
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).reason, "PROVIDER_AUTH_STATE_MISSING");
    records.set("provider_auth_id:account-1:epic", { accountId: "wrong", provider: "epic", connectedAt: NOW });
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, false);
});

test("10-day login gap invalidates other providers; same-event authentication is valid", async () => {
    const { env, records, iso } = fixture({ providers: ["epic", "google"] });
    records.get("account_login_status:account-1").lastLoginAt = iso(NOW - 10 * DAY);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, false);
    await recordProviderAuthentication(env, "account-1", "google", NOW);
    await recordAccountLogin(env, "account-1", NOW);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "google")).authorized, true);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, false);
});

test("reauthorization recovers missing policy state without recording login", async () => {
    const { env, records } = fixture();
    records.delete("account_login_status:account-1");
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, false);
    await recordProviderAuthentication(env, "account-1", "epic", NOW);
    assert.equal(records.get("account_login_status:account-1").lastLoginAt, null);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, true);
});

test("Google authorizes BPD profile but does not substitute for Epic", async () => {
    const { env, request } = fixture({ providers: ["google"] });
    assert.equal((await authorizeRequest(request, env, { account: true })).accountId, "account-1");
    await assert.rejects(authorizeRocketLeagueRequest(request, env), { code: "PROVIDER_REQUIRED" });
});

test("Steam alone cannot authorize BPD profile; recovery remains available", async () => {
    const { env, request } = fixture({ providers: ["steam"] });
    await assert.rejects(authorizeRequest(request, env, { account: true }), { code: "PROFILE_PROVIDER_REAUTHORIZATION_REQUIRED" });
    assert.equal((await authorizeRequest(request, env, { account: true, recovery: true })).accountId, "account-1");
});

test("database active state overrides cached session active", async () => {
    const { env, request } = fixture({ active: false });
    await assert.rejects(authorizeRocketLeagueRequest(request, env), { code: "ACCOUNT_INACTIVE" });
});

test("private RL guard requires registration consent and canonical provider subject", async () => {
    let f = fixture({ ageConsent: false });
    await assert.rejects(authorizeRocketLeagueRequest(f.request, f.env), { code: "RL_REGISTRATION_REQUIRED" });
    f = fixture();
    const result = await authorizeRocketLeagueRequest(f.request, f.env);
    assert.equal(result.provider.subject, "epic-subject");
    assert.equal(result.profile.rlPlayerId, "player-1");
});

test("stale Epic stays linked in global and RL session responses", async () => {
    const { env, records, request } = fixture();
    records.delete("provider_auth_id:account-1:epic");
    const global = await (await handleAuthSession(request, env)).json();
    assert.equal(global.providers.epic.linked, true);
    assert.equal(global.providers.epic.requiresReauthorization, true);
    const rl = await (await handleRocketLeagueSession(request, env)).json();
    assert.equal(rl.epicLinked, true);
    assert.equal(rl.requiresEpicReauthorization, true);
    assert.equal(rl.requiresEpicLogin, false);
    assert.equal(rl.rocketLeagueAccess, false);
});

test("KV/database failures are unavailable, never confirmed logout", async () => {
    const { env, request } = fixture();
    delete env.AUTH_SESSIONS;
    let response = await handleAuthSession(request, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).authenticated, null);
    response = await handleRocketLeagueSession(request, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).authenticated, null);
});

test("account activity uses the existing MMR service and does not record successful login", async () => {
    const { env, records, request, calls } = fixture();
    const before = structuredClone(records.get("account_login_status:account-1"));
    const response = await lastLogin({ request, env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).statsRefresh.refreshed, false);
    assert.ok(calls.some(url => url.endsWith("get_stats_refresh_state")));
    assert.deepEqual(records.get("account_login_status:account-1"), before);
});

test("account activity rejects GET explicitly without touching account state", async () => {
    const response = await accountActivityFallback({
        request: new Request("https://bpd.invalid/api/auth/account/last_login", { method: "GET" }),
        env: {}
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal((await response.json()).code, "METHOD_NOT_ALLOWED");
});

test("Epic reauthorization rejects another subject without relinking", async () => {
    const { env, records, calls } = fixture();
    env.EPIC_CLIENT_ID = "client"; env.EPIC_CLIENT_SECRET = "secret";
    env.EPIC_REDIRECT_URI = "https://bpd.invalid/api/auth/epic/callback";
    const fallback = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/token")) return Response.json({ access_token: "test", account_id: "wrong-epic" });
        if (String(url).endsWith("/userInfo")) return Response.json({ sub: "wrong-epic" });
        return fallback(url, init);
    };
    const before = structuredClone([...records]);
    const response = await handleEpicCallback(new Request("https://bpd.invalid/api/auth/epic/callback?code=code&state=state", {
        headers: { cookie: "bpd_session=test-session; bpd_epic_state=state; bpd_oauth_mode=reauthorize; bpd_oauth_account=account-1" }
    }), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/Account?error=PROVIDER_REAUTHORIZATION_MISMATCH");
    assert.deepEqual([...records], before);
    assert.ok(!calls.some(url => /link_epic_identity|resolve_epic_identity/.test(url)));
});

test("matching Epic reauthorization preserves the link and does not record a BPD login", async () => {
    const { env, records, calls } = fixture();
    records.delete("provider_auth_id:account-1:epic");
    env.EPIC_CLIENT_ID = "client"; env.EPIC_CLIENT_SECRET = "secret";
    env.EPIC_REDIRECT_URI = "https://bpd.invalid/api/auth/epic/callback";
    const fallback = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/token")) return Response.json({ access_token: "test", account_id: "epic-subject" });
        if (String(url).endsWith("/userInfo")) return Response.json({ sub: "epic-subject" });
        return fallback(url, init);
    };
    const before = structuredClone(records.get("account_login_status:account-1"));
    const response = await handleEpicCallback(new Request("https://bpd.invalid/api/auth/epic/callback?code=code&state=state", {
        headers: { cookie: "bpd_session=test-session; bpd_epic_state=state; bpd_oauth_mode=reauthorize; bpd_oauth_account=account-1" }
    }), env);
    assert.equal(response.status, 302);
    assert.deepEqual(records.get("account_login_status:account-1"), before);
    assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, true);
    assert.ok(!calls.some(url => /link_epic_identity|resolve_epic_identity/.test(url)));
});

test("browser policy distinguishes public, recovery, stale, and unavailable", async () => {
    const source = (await readFile(new URL("../../../public/Framework/Auth/auth.js", import.meta.url), "utf8"))
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\/scripts\/apiRoutes.js";/,
            'const BPD_AUTH_SESSION_URL="/api/auth/session", ROCKET_LEAGUE_SESSION_URL="/api/auth/rocketleague/session";');
    const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const state = { available: true, authenticated: true, userId: "account-1", active: true,
        providers: { epic: { linked: true, authorized: false } }, linkedProviders: ["epic"] };
    assert.equal(client.evaluateRouteAuth({}, state).allowed, true);
    assert.equal(client.evaluateRouteAuth({ required: true, recovery: true }, state).allowed, true);
    assert.equal(client.evaluateRouteAuth({ required: true }, state).status, "profile_provider_required");
    assert.equal(client.evaluateRouteAuth({ provider: "epic" }, state).status, "provider_reauthorization_required");
    assert.equal(client.evaluateRouteAuth({ required: true }, { available: false }).status, "unavailable");
});

test("OCR job API denies stale Epic before reading another user's job", async () => {
    const { env, records, request } = fixture();
    records.delete("provider_auth_id:account-1:epic");
    env.OCR_OWNER_SECRET = "test";
    env.OCR_STORAGE = { get() { throw new Error("Job storage must not be read"); } };
    env.OCR_PROGRESS = {};
    const response = await getJob({ request, env });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).requiresEpicReauthorization, true);
});

test("configured hourly cron dispatches due-aware refresh and does not fetch non-due capabilities", async () => {
    const { env } = fixture();
    const fallback = globalThis.fetch;
    let candidatesRead = false;
    let providerCalls = 0;
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("get_rl_refresh_candidates")) {
            candidatesRead = true;
            return Response.json([{ account_id: "account-1", player_id: "player-1", epic_account_id: "epic-subject",
                mmr_due: false, provider_due: false, match_history_due: false, club_due: false, career_stats_due: false, discord_due: false }]);
        }
        if (String(url).includes("mmr.invalid") || String(url).includes("get-player-data")) providerCalls++;
        return fallback(url, init);
    };
    const configuration = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const tasks = [];
    await worker.scheduled({ cron: configuration.triggers.crons.find(cron => cron === "0 * * * *") }, env,
        { waitUntil(task) { tasks.push(task); } });
    const [result] = await Promise.all(tasks);
    assert.equal(candidatesRead, true);
    assert.equal(result.attempted, 0);
    assert.equal(result.failed, 0);
    assert.equal(providerCalls, 0);
});

test("registration saves draft before reauthorization and does not redirect on outage", async () => {
    let source = await readFile(new URL("../../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g, "");
    source += "\nregistrationDraftAccountId = 'account-1';\nexport { handleRegistrationAuthFailure };";
    const oldDocument = globalThis.document, oldWindow = globalThis.window, oldStorage = globalThis.localStorage;
    const events = [];
    globalThis.document = { addEventListener() {}, getElementById() { return null; } };
    globalThis.window = { location: { replace(url) { events.push(["redirect", url]); } } };
    globalThis.localStorage = { setItem(key, value) { events.push(["draft", JSON.parse(value)]); } };
    try {
        const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
        const payload = { email: "player@example.test", ageConsent: true, policyConsent: true, availability: [] };
        assert.equal(module.handleRegistrationAuthFailure({ status: 403 }, { requiresEpicReauthorization: true }, payload), true);
        assert.equal(events[0][0], "draft");
        assert.equal(events[0][1].email, payload.email);
        assert.equal(events[0][1].ageConsent, undefined);
        assert.equal(events[1][1], "/Account?reauthorize=epic");
        events.length = 0;
        assert.equal(module.handleRegistrationAuthFailure({ status: 503 }, { available: false }, payload), false);
        assert.equal(events.length, 0);
    } finally {
        globalThis.document = oldDocument; globalThis.window = oldWindow; globalThis.localStorage = oldStorage;
    }
});

test("RL homepage link endpoint redirects into Epic OAuth for unlinked and stale-linked accounts", async () => {
    const { handleLinkProvider } = await import("../../../functions/services/auth/account/link_provider.js");
    for (const linked of [false,true]) {
        const f=fixture({providers: linked ? ["epic"] : []});
        f.env.EPIC_CLIENT_ID="mock-client";
        f.env.EPIC_REDIRECT_URI="https://bpd.invalid/api/auth/epic/callback";
        f.records.delete("provider_auth_id:account-1:epic");
        const response=await handleLinkProvider(new Request("https://bpd.invalid/api/auth/link?provider=epic&returnTo=%2FRocketLeague",{headers:{cookie:"bpd_session=test-session"}}),f.env);
        assert.equal(response.status,302);
        const url=new URL(response.headers.get("location"));
        assert.match(url.hostname,/(^|\.)epicgames\.com$/);
        assert.equal(url.searchParams.get("client_id"),"mock-client");
        assert.ok(url.searchParams.get("state"));
        assert.match(response.headers.get("set-cookie"),new RegExp(linked?"reauthorize":"link"));
    }
});
