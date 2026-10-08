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
        const { env, records, calls } = fixture({ active: scenario !== "inactive", ageConsent: scenario !== "missing-consent" });
        if (scenario === "stale") records.delete("provider_auth_id:account-1:epic");
        const response = await handleRocketLeagueProfile(new Request("https://bpd.invalid/api/auth/rocketleague/profile", {
            method: "POST", headers: { Origin: "https://bpd.invalid", cookie: "bpd_session=test-session", "content-type": "application/json" },
            body: JSON.stringify({ accountId: "someone-else", EpicUniqueId: "forged-subject",
                ageConsent: false, policyConsent: false })
        }), env);
        assert.equal(response.status, scenario === "missing-consent" ? 400 : 403, scenario);
        assert.ok(!calls.some(url => /ensure_|save_|refresh|resolve_/.test(url)), scenario);
    }
});

function fixture({ providers = ["epic"], active = true, ageConsent = true,
    registrationStatus = "complete", rlActive = true, profileComplete = true } = {}) {
    Date.now = () => NOW;
    const records = new Map();
    const calls = [];
    const iso = time => new Date(time).toISOString();
    records.set("session:test-session", { UserId: "account-1", Role: "user", Active: active,
        CreatedAt: NOW - DAY, LastSeenAt: NOW, AbsoluteExpiresAt: NOW + DAY,
        Providers: providers.includes("epic") ? { epic: { AccountId: "old-cached-subject", Linked: true } } : {} });
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
        if (url.endsWith("get_account_access_state")) return Response.json({ exists: true,
            state: active ? "active" : "inactive", accountActive: active, suspended: false, suspendedUntil: null,
            banned: false, removed: false, rocketLeague: { exists: true, active: rlActive,
                registrationStatus, registrationComplete: registrationStatus === "complete" } });
        if (url.endsWith("can_account_perform")) {
            const rlActions = ["rocket_league", "join_series", "join_match", "create_private_match", "join_private_match", "submit_scoreboard", "submit_result", "refresh_rl_stats"];
            return Response.json(active && (!rlActions.includes(body.p_action) || (rlActive && registrationStatus === "complete")));
        }
        if (url.endsWith("get_account_session_identity")) return Response.json([{ id: "account-1", role: "user", active }]);
        if (url.endsWith("verify_account_provider_identity")) return Response.json(providers.includes(body.p_provider)
            ? [{ account_id: "account-1", provider: body.p_provider, provider_subject: `${body.p_provider}-subject`, active: true }] : []);
        if (url.endsWith("get_rocketleague_profile_v2")) return Response.json({ account_id: "account-1", rl_player_id: "player-1",
            active: rlActive && active, registration_status: registrationStatus, profile_complete: profileComplete, rocket_league_access: profileComplete,
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

test("Steam-only account can access BPD account features but cannot access Rocket League; recovery remains available", async () => {
    const { env, request } = fixture({ providers: ["steam"] });
    assert.equal((await authorizeRequest(request, env, { account: true })).accountId, "account-1");
    await assert.rejects(authorizeRocketLeagueRequest(request, env), { code: "PROVIDER_REQUIRED" });
    assert.equal((await authorizeRequest(request, env, { account: true, recovery: true })).accountId, "account-1");
});

test("database active state overrides cached session active", async () => {
    const { env, request } = fixture({ active: false });
    await assert.rejects(authorizeRocketLeagueRequest(request, env), { code: "ACCOUNT_ACCESS_RESTRICTED" });
});

test("private RL guard uses completed registration and canonical provider subject, not optional completeness", async () => {
    let f = fixture({ ageConsent: false });
    assert.equal((await authorizeRocketLeagueRequest(f.request, f.env)).accountId, "account-1");
    f = fixture();
    const result = await authorizeRocketLeagueRequest(f.request, f.env);
    assert.equal(result.provider.subject, "epic-subject");
    assert.equal(result.profile.rlPlayerId, "player-1");
});

for (const registrationStatus of ["incomplete", "suspended", "revoked"]) {
    test(`central RL action policy denies ${registrationStatus} registration`, async () => {
        const { request, env, calls } = fixture({ registrationStatus });
        await assert.rejects(authorizeRocketLeagueRequest(request, env), { status: 403, code: "ACCOUNT_ACCESS_RESTRICTED" });
        assert.equal(calls.some(url => url.endsWith("get_rocketleague_profile_v2")), false);
    });
}

test("completed registration permits stored data with incomplete optional profile and stale Epic, but live refresh requires freshness", async () => {
    const { request, env, records } = fixture({ profileComplete: false });
    records.delete("provider_auth_id:account-1:epic");
    const allowed = await authorizeRocketLeagueRequest(request, env);
    assert.equal(allowed.provider.subject, "epic-subject");
    assert.equal(allowed.provider.authorized, false);
    assert.equal(allowed.profile.profileComplete, false);
    const rlSession = await (await handleRocketLeagueSession(request, env)).json();
    assert.equal(rlSession.rocketLeagueAccess, true);
    assert.equal(rlSession.registrationAccepted, true);
    assert.equal(rlSession.profileComplete, false);
    assert.equal(rlSession.epicLinked, true);
    assert.equal(rlSession.requiresEpicReauthorization, true);
    await assert.rejects(authorizeRocketLeagueRequest(request, env, "refresh_rl_stats"), { code: "PROVIDER_REAUTHORIZATION_REQUIRED", status: 403 });
});

test("RL-disabled player cannot use protected RL actions", async () => {
    const { request, env } = fixture({ rlActive: false });
    await assert.rejects(authorizeRocketLeagueRequest(request, env), { code: "ROCKET_LEAGUE_DISABLED", status: 403 });
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
    assert.equal(rl.rocketLeagueAccess, true);
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

test("account activity defers MMR collection to the hourly scheduler and does not record successful login", async () => {
    const { env, records, request, calls } = fixture();
    const before = structuredClone(records.get("account_login_status:account-1"));
    const response = await lastLogin({ request, env });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).statsRefresh.refreshed, false);
    assert.ok(!calls.some(url => url.endsWith("get_stats_refresh_state")));
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
    const location = new URL(response.headers.get("location"), "https://bpd.invalid");
    assert.equal(location.pathname, "/Account");
    assert.equal(location.searchParams.get("error"), "PROVIDER_REAUTHORIZATION_MISMATCH");
    assert.match(location.searchParams.get("debugId") || "", /^[0-9a-f-]{36}$/iu);
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

for (const scenario of [
    { name: "all provider IDs agree", profile: { id: " epic-subject ", sub: "epic-subject" }, accountId: "epic-subject" },
    { name: "profile.id conflicts with profile.sub", profile: { id: "epic-subject", sub: "other-subject" }, code: "EPIC_IDENTITY_MISMATCH" },
    { name: "profile.id conflicts with token account_id", profile: { id: "epic-subject" }, accountId: "other-subject", code: "EPIC_IDENTITY_MISMATCH" },
    { name: "profile.sub conflicts with token account_id", profile: { sub: "epic-subject" }, accountId: "other-subject", code: "EPIC_IDENTITY_MISMATCH" },
    { name: "only profile.id present", profile: { id: "epic-subject" } },
    { name: "only profile.sub present", profile: { sub: "epic-subject" } },
    { name: "only token account_id present", profile: {}, accountId: " epic-subject " },
    { name: "all identity fields missing", profile: {}, code: "EPIC_IDENTITY_MISSING" },
    { name: "malformed supplied identity fails closed", profile: { id: 123, sub: "epic-subject" }, code: "EPIC_IDENTITY_MISMATCH" },
    { name: "malformed token identity fails closed", profile: { sub: "epic-subject" }, accountId: 123, code: "EPIC_IDENTITY_MISMATCH" },
    { name: "blank token identity fails closed", profile: { sub: "epic-subject" }, accountId: " ", code: "EPIC_IDENTITY_MISMATCH" },
    { name: "case differences are not silently normalized", profile: { id: "EPIC-SUBJECT", sub: "epic-subject" }, code: "EPIC_IDENTITY_MISMATCH" },
    { name: "agreeing provider IDs conflict with canonical link", profile: { id: "other-subject", sub: "other-subject" }, accountId: "other-subject", code: "PROVIDER_REAUTHORIZATION_MISMATCH" }
]) {
    test(`Epic identity consistency: ${scenario.name}`, async () => {
        const { env, records, calls } = fixture();
        env.EPIC_CLIENT_ID = "client"; env.EPIC_CLIENT_SECRET = "secret";
        env.EPIC_REDIRECT_URI = "https://bpd.invalid/api/auth/epic/callback";
        const fallback = globalThis.fetch;
        const logs = [];
        const originalInfo = console.info, originalError = console.error;
        console.info = (...args) => logs.push(args);
        console.error = (...args) => logs.push(args);
        const before = structuredClone([...records]);
        globalThis.fetch = async (url, init) => {
            if (String(url).endsWith("/token")) return Response.json({
                access_token: "access-token-must-not-leak", refresh_token: "refresh-token-must-not-leak",
                ...(scenario.accountId === undefined ? {} : { account_id: scenario.accountId })
            });
            if (String(url).endsWith("/userInfo")) return Response.json({ ...scenario.profile, private_payload: "provider-payload-must-not-leak" });
            return fallback(url, init);
        };
        try {
            const response = await handleEpicCallback(new Request("https://bpd.invalid/api/auth/epic/callback?code=code&state=state", {
                headers: { cookie: "bpd_session=test-session; bpd_epic_state=state; bpd_oauth_mode=reauthorize; bpd_oauth_account=account-1" }
            }), env);
            assert.equal(response.status, 302);
            const location = new URL(response.headers.get("location"), "https://bpd.invalid");
            assert.equal(location.searchParams.get("error"), scenario.code ?? null);
            if (scenario.code) {
                assert.deepEqual([...records], before, "failure must not mutate account/session state");
            } else {
                assert.equal((await getProviderAuthorizationState(env, "account-1", "epic")).authorized, true);
            }
            assert.ok(!calls.some(url => /link_epic_identity|resolve_epic_identity/.test(url)));
            assert.doesNotMatch(JSON.stringify(logs) + response.headers.get("location") + await response.text(),
                /access-token-must-not-leak|refresh-token-must-not-leak|provider-payload-must-not-leak/);
        } finally {
            console.info = originalInfo; console.error = originalError;
        }
    });
}

test("browser policy distinguishes public, recovery, stale, and unavailable", async () => {
    const source = (await readFile(new URL("../../../public/Framework/Auth/auth.js", import.meta.url), "utf8"))
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\/scripts\/apiRoutes.js";/,
            'const BPD_AUTH_SESSION_URL="/api/auth/session", ROCKET_LEAGUE_SESSION_URL="/api/auth/rocketleague/session";');
    const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const state = { available: true, authenticated: true, accountScope: "bpd-v1-" + "a".repeat(64), active: true,
        providers: { epic: { linked: true, authorized: false } }, linkedProviders: ["epic"] };
    assert.equal(client.evaluateRouteAuth({}, state).allowed, true);
    assert.equal(client.evaluateRouteAuth({ required: true, recovery: true }, state).allowed, true);
    assert.equal(client.evaluateRouteAuth({ required: true }, state).status, "profile_provider_required");
    assert.equal(client.evaluateRouteAuth({ provider: "epic" }, state).status, "provider_reauthorization_required");
    assert.equal(client.evaluateRouteAuth({ required: true, provider: "epic", rocketLeague: true }, state).allowed, true);
    assert.equal(client.evaluateRouteAuth({ required: true }, { available: false }).status, "unavailable");
});

test("OCR job API still rejects a request without a job ID when Epic is stale", async () => {
    const { env, records, request } = fixture();
    records.delete("provider_auth_id:account-1:epic");
    env.OCR_OWNER_SECRET = "test";
    env.OCR_STORAGE = { get() { throw new Error("Job storage must not be read"); } };
    env.OCR_PROGRESS = {};
    const response = await getJob({ request, env });
    assert.equal(response.status, 400);
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
    const notificationsHelper = new URL("../../../public/Tabs/RocketLeague/shared/notificationsV2.js", import.meta.url).href;
    source = `import { isNotificationsV2 } from ${JSON.stringify(notificationsHelper)};\n` + source;
    source += "\nregistrationDraftAccountScope = 'account-1';\nexport { handleRegistrationAuthFailure };";
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

test("profile read omits canonical IDs while preserving profile/access flags and server identity", async () => {
    const { env, calls } = fixture();
    const response = await handleRocketLeagueProfile(new Request("https://bpd.invalid/api/auth/rocketleague/profile", {
        headers: { cookie: "bpd_session=test-session" }
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profileExists, true);
    assert.equal(body.authenticated, true);
    for (const section of [body, body.user, body.profile]) {
        for (const key of ["accountId", "userId", "rlPlayerId", "EpicUniqueId"]) assert.equal(Object.hasOwn(section, key), false);
    }
    assert.ok(calls.some(url => url.endsWith("get_rocketleague_profile_v2")));
});

test("RL session response preserves access flags without redundant canonical identifiers", async () => {
    const { env, request } = fixture();
    const response = await handleRocketLeagueSession(request, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.profileLoaded, true);
    assert.equal(body.rocketLeagueAccess, true);
    for (const section of [body, body.user]) for (const key of ["accountId", "userId", "rlPlayerId", "EpicUniqueId"]) assert.equal(Object.hasOwn(section, key), false);
});

test("global account session preserves draft scope and provider authorization without exposing provider subjects", async () => {
    const { env, request } = fixture();
    const response = await handleAuthSession(request, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.user.userId, undefined);
    assert.match(body.user.accountScope, /^bpd-v1-[a-f0-9]{64}$/u);
    assert.equal(body.providers.epic.linked, true);
    assert.equal(body.providers.epic.authorized, true);
    assert.equal(Object.hasOwn(body.providers.epic, "accountId"), false);
    assert.equal(JSON.stringify(body.providers).includes("epic-subject"), false);
});
