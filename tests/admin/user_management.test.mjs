import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { onRequestGet as listRoute } from "../../functions/api/admin/user-management/index.js";
import { onRequestPost as actionRoute } from "../../functions/api/admin/user-management/[targetAccountId]/actions.js";
import { parseListInput, parseMutationInput } from "../../functions/services/admin/user_management.js";
import { ROUTES } from "../../public/routes.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-10-05T12:00:00Z";
const permissions = role => ({ role, view: true, addNote: role !== "staff", suspend: role === "owner" || role === "admin" || role === "moderator",
    disableRocketLeague: role === "owner" || role === "admin" || role === "moderator", ban: role === "owner" || role === "admin",
    remove: role === "owner" || role === "admin", manageRoles: role === "owner" || role === "admin" });
const state = { exists: true, state: "active", accountActive: true, suspended: false, suspendedUntil: null, banned: false, removed: false,
    rocketLeague: { exists: false, active: false } };
function envFor(role, onRpc) {
    return { SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "auth-secret", SUPABASE_SERVICE_ROLE_KEY: "service-secret",
        AUTH_SESSIONS: { async get(key) {
            assert.equal(key, "session:test-session");
            return { UserId: actorId, Active: true, Role: "user", LastSeenAt: Date.now(), AbsoluteExpiresAt: Date.now() + 60_000 };
        } }, onRpc };
}
function fetcherFor(env) {
    return async (url, init) => {
        env.lastUrl = String(url);
        const name = String(url).split("/").at(-1);
        if (name === "get_account_access_state") return Response.json(state);
        if (name === "can_account_perform") return Response.json(JSON.parse(init.body).p_action === "view_account");
        if (name.startsWith("admin_")) return env.onRpc(name, JSON.parse(init.body), init);
        throw new Error(`Unexpected request ${name}`);
    };
}
function request(path, init = {}) {
    const url = `https://bpd.example${path}`;
    return new Request(url, { ...init, headers: { cookie: "bpd_session=test-session", ...(init.headers || {}) } });
}

test("list input preserves server-side filters and fixes page size at 30", async () => {
    const input = await parseListInput("https://bpd.example/api/admin/user-management?status=suspended&provider=discord&hasRocketLeague=true&rlActive=false&sort=name_asc&page=3");
    assert.deepEqual(input, { query: "", status: "suspended", role: null, provider: "discord", hasRocketLeague: true,
        rlActive: false, sort: "name_asc", page: 3, offset: 60 });
    await assert.rejects(parseListInput("https://bpd.example/api/admin/user-management?actorAccountId=forged"), { code: "USER_MANAGEMENT_QUERY_INVALID" });
});

test("User List derives actor from the authenticated BPD session and returns sanitized 30-row contract", async () => {
    const env = envFor("staff", (name, args, init) => {
        assert.equal(name, "admin_list_users");
        assert.equal(args.p_actor_account_id, actorId);
        assert.equal(args.p_limit, 30);
        assert.equal(args.p_offset, 0);
        assert.equal(args.actorAccountId, undefined);
        assert.equal(env.lastUrl, "https://database.example/rest/v1/rpc/admin_list_users");
        assert.equal(init.method, "POST");
        assert.equal(init.headers.apikey, "service-secret");
        assert.equal(init.headers.Authorization, "Bearer service-secret");
        assert.deepEqual(Object.keys(init.headers).sort(), ["Accept", "Accept-Profile", "Authorization", "Content-Profile", "Content-Type", "apikey"].sort());
        return Response.json({ success: true, permissions: permissions("staff"), pagination: { total: 1, limit: 30, offset: 0, hasMore: false },
            users: [{ accountId: targetId, displayName: "Player", role: null, status: "active", accountActive: true, createdAt: timestamp,
                lastSeenAt: null, providers: ["discord"], rocketLeague: { exists: true, active: true, playerId: targetId, platform: "Epic",
                    registrationStatus: "complete", registrationCompletedAt: timestamp, publicProfileEnabled: false, showOnlineStatus: true,
                    presenceState: "online", presenceCheckedAt: timestamp }, moderation: { suspended: false, suspendedUntil: null, banned: false, removed: false, historyCount: 2 }, canManage: true }], capturedAt: timestamp });
    });
    const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
    try {
        const response = await listRoute({ request: request("/api/admin/user-management"), env });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.permissions.role, "staff");
        assert.equal(body.users[0].rocketLeague.exists, true);
        assert.equal("playerId" in body.users[0].rocketLeague, false);
        assert.equal(JSON.stringify(body).includes("service-secret"), false);
    } finally { globalThis.fetch = original; }
});

test("staff direct mutation is denied by the authoritative RPC and sanitized", async () => {
    const env = envFor("staff", (name, args) => {
        assert.equal(name, "admin_ban_user");
        assert.equal(args.p_actor_account_id, actorId);
        assert.equal(args.p_target_account_id, targetId);
        return Response.json({ message: "USER_MANAGEMENT_FORBIDDEN", details: "sensitive internal policy detail" }, { status: 400 });
    });
    const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
    try {
        const response = await actionRoute({ request: request(`/api/admin/user-management/${targetId}/actions`, {
            method: "POST", headers: { origin: "https://bpd.example", "content-type": "application/json" },
            body: JSON.stringify({ action: "ban", reason: "policy violation" })
        }), env, params: { targetAccountId: targetId } });
        assert.equal(response.status, 403);
        const body = await response.json();
        assert.equal(body.error, "USER_MANAGEMENT_FORBIDDEN");
        assert.equal(JSON.stringify(body).includes("sensitive"), false);
    } finally { globalThis.fetch = original; }
});

test("permissions are returned from the User Management contract rather than inferred from session role", async () => {
    for (const role of ["staff", "moderator", "admin", "owner"]) {
        const env = envFor("user", name => {
            assert.equal(name, "admin_list_users");
            return Response.json({ success: true, permissions: permissions(role), pagination: { total: 0, limit: 30, offset: 0, hasMore: false }, users: [], capturedAt: timestamp });
        });
        const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
        try {
            const response = await listRoute({ request: request("/api/admin/user-management"), env });
            const body = await response.json();
            assert.equal(response.status, 200);
            assert.equal(body.permissions.role, role);
            assert.equal(body.permissions.view, true);
            assert.equal(body.permissions.ban, role === "admin" || role === "owner");
        } finally { globalThis.fetch = original; }
    }
});

test("high-impact RPC errors remain safe, and malformed success data fails closed", async () => {
    const env = envFor("admin", name => name === "admin_list_users"
        ? Response.json({ success: true, permissions: permissions("admin"), pagination: { total: 0, limit: 30, offset: 0, hasMore: false }, users: [], capturedAt: timestamp })
        : Response.json({ message: "OWNER_ROLE_PROTECTED: private policy details", details: "do not send this" }, { status: 400 }));
    const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
    try {
        const response = await actionRoute({ request: request(`/api/admin/user-management/${targetId}/actions`, {
            method: "POST", headers: { origin: "https://bpd.example", "content-type": "application/json" },
            body: JSON.stringify({ action: "set-role", role: "moderator", reason: "policy update" })
        }), env, params: { targetAccountId: targetId } });
        assert.equal(response.status, 403);
        const body = await response.json();
        assert.equal(body.error, "OWNER_ROLE_PROTECTED");
        assert.equal(JSON.stringify(body).includes("private policy"), false);
    } finally { globalThis.fetch = original; }
});

test("successful suspension mutation forwards only session actor and path target, then normalizes its result", async () => {
    const env = envFor("moderator", (name, args) => {
        assert.equal(name, "admin_suspend_user");
        assert.deepEqual(args, { p_actor_account_id: actorId, p_target_account_id: targetId, p_duration_days: 30,
            p_reason: "Repeated policy violations", p_internal_note: null, p_user_message: null });
        return Response.json({ success: true, account: { accountId: targetId, displayName: "Player", status: "suspended" },
            suspension: { enforcementId: "33333333-3333-4333-8333-333333333333", durationDays: 30, startsAt: timestamp,
                expiresAt: timestamp, reason: "Repeated policy violations", userMessage: null }, capturedAt: timestamp });
    });
    const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
    try {
        const response = await actionRoute({ request: request(`/api/admin/user-management/${targetId}/actions`, {
            method: "POST", headers: { origin: "https://bpd.example", "content-type": "application/json" },
            body: JSON.stringify({ action: "suspend", durationDays: 30, reason: "Repeated policy violations" })
        }), env, params: { targetAccountId: targetId } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, action: "suspend", capturedAt: timestamp });
    } finally { globalThis.fetch = original; }
});

test("mutation requires same-origin JSON and rejects oversized/unsupported request data", async () => {
    const env = envFor("moderator", () => { throw new Error("RPC must not be called"); });
    const crossOrigin = await actionRoute({ request: request(`/api/admin/user-management/${targetId}/actions`, {
        method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: JSON.stringify({ action: "ban", reason: "x" })
    }), env, params: { targetAccountId: targetId } });
    assert.equal(crossOrigin.status, 403);
    const noJson = await actionRoute({ request: request(`/api/admin/user-management/${targetId}/actions`, {
        method: "POST", headers: { origin: "https://bpd.example", "content-type": "text/plain" }, body: "{}"
    }), env, params: { targetAccountId: targetId } });
    assert.equal(noJson.status, 415);
});

test("browser cannot select actor identity or unsupported role/duration", () => {
    assert.throws(() => parseMutationInput({ action: "ban", reason: "x", actorAccountId: actorId }), { code: "USER_MANAGEMENT_INPUT_INVALID" });
    assert.throws(() => parseMutationInput({ action: "suspend", durationDays: 5, reason: "x" }), { code: "USER_MANAGEMENT_INPUT_INVALID" });
    assert.throws(() => parseMutationInput({ action: "set-role", role: "owner", reason: "x" }), { code: "USER_MANAGEMENT_INPUT_INVALID" });
    assert.equal(parseMutationInput({ action: "set-role", role: "", reason: "x" }).role, null);
});

test("User Management route and page use authenticated route shell without Discord-role gate", async () => {
    const route = ROUTES["/Admin/UserManagement"];
    assert.equal(route.requiresAuth, true);
    assert.equal(route.body, "/Global/Admin/UserManagement/HTML/index.html");
    assert.equal(route.module, "/Global/Admin/UserManagement/JS/index.js");
    const source = await readFile(new URL("../../public/Global/Admin/UserManagement/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /hasAdminAccess|getAuthState/);
    assert.match(source, /aria-pressed/);
    assert.match(source, /textContent/);
    assert.match(source, /durationDays/);
    assert.match(source, /creates identity restrictions/);
    assert.match(source, /state\.busy/);
    assert.match(source, /finally \{ setBusy\(false\); \}/);
    const html = await readFile(new URL("../../public/Global/Admin/UserManagement/HTML/index.html", import.meta.url), "utf8");
    for (const tab of ["users", "suspended", "banned", "history"]) assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, /umPrevious/);
    assert.match(html, /umNext/);
});


test("list diagnostics locate failures, correlate responses, and exclude sensitive values", async () => {
    const sensitive = "private@example.test token-cookie-provider-secret " + actorId;
    const scenarios = [
        ["session_account_resolution", null, null, env => { env.AUTH_SESSIONS.get = async () => { throw new Error(sensitive); }; }],
        ["account_access_configuration", "get_account_access_state", null, env => { env.SUPABASE_AUTH = ""; }],
        ["account_access_decode", "get_account_access_state", 403, null, "get_account_access_state", () => Response.json({ code: "42501", message: sensitive }, { status: 403 })],
        ["account_access_normalization", "get_account_access_state", 200, null, "get_account_access_state", () => Response.json({ email: sensitive })],
        ["account_access_decode", "can_account_perform", 200, null, "can_account_perform", () => new Response(sensitive)],
        ["configuration", "admin_list_users", null, env => { env.SUPABASE_SERVICE_ROLE_KEY = ""; env.SUPABASE_AUTH = "auth-secret"; env.SUPABASE_URL = "http://invalid.example"; }],
        ["rpc_fetch_body", "admin_list_users", null, null, "admin_list_users", () => { throw new Error(sensitive); }],
        ["rpc_rejected", "admin_list_users", 500, null, "admin_list_users", () => Response.json({ code: sensitive, message: sensitive, details: sensitive }, { status: 500 })],
        ["rpc_rejected", "admin_list_users", 404, null, "admin_list_users", () => Response.json({ code: "PGRST202", message: sensitive }, { status: 404 })],
        ["response_decode", "admin_list_users", 200, null, "admin_list_users", () => new Response(sensitive)],
        ["response_normalization", "admin_list_users", 200, null, "admin_list_users", () => Response.json({ success: true, users: "invalid", email: sensitive })],
        ["admin_authorization", "admin_list_users", 200, null, "admin_list_users", () => Response.json({ success: true, users: [], capturedAt: timestamp, permissions: { ...permissions("staff"), view: false } })]
    ];
    const originalFetch = globalThis.fetch, originalInfo = console.info;
    const records = [];
    console.info = (label, record) => { assert.equal(label, "[USER MANAGEMENT DIAGNOSTIC]"); records.push(record); };
    try {
        for (const [stage, rpc, upstreamStatus, configure, failingRpc, result] of scenarios) {
            const env = envFor("admin", () => { throw new Error("Unexpected RPC"); });
            configure?.(env);
            const normal = fetcherFor(env);
            globalThis.fetch = (url, init) => String(url).endsWith("/" + failingRpc) ? result() : normal(url, init);
            const response = await listRoute({ request: request("/api/admin/user-management?query=private%40example.test", { headers: { authorization: sensitive, "X-Debug-ID": sensitive } }), env });
            const record = records.at(-1);
            assert.equal(record.stage, stage);
            assert.equal(record.rpc, rpc);
            assert.equal(record.upstreamStatus, upstreamStatus);
            assert.equal(response.headers.get("Cache-Control"), "no-store");
            assert.equal(response.headers.get("X-Debug-ID"), record.debugId);
            assert.match(record.debugId, /^[0-9a-f-]{36}$/);
            assert.ok(record.elapsedMs >= 0);
            assert.equal(record.timeout, false);
            const text = JSON.stringify(record) + JSON.stringify(await response.json());
            for (const forbidden of [sensitive, actorId, "service-secret", "auth-secret", "test-session", "private@example.test"]) assert.equal(text.includes(forbidden), false);
            const expectedKeys = ["debugId", "stage", "operation", "rpc", "upstreamStatus", "code", "timeout", "deadlineState", "elapsedMs"];
            if (record.transportErrorClass) {
                expectedKeys.push("transportErrorClass");
                if (record.exceptionName) expectedKeys.push("exceptionName");
            }
            assert.deepEqual(Object.keys(record).sort(), expectedKeys.sort());
        }
        assert.equal(records[8].code, "PGRST202");
        assert.equal(records[7].code, "UPSTREAM_REJECTED");
    } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
});

test("signed-out list remains 401 no-store and never calls an RPC", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("Must not call an upstream"); };
    try {
        const response = await listRoute({ request: new Request("https://bpd.example/api/admin/user-management"), env: { AUTH_SESSIONS: { get: async () => null } } });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
    } finally { globalThis.fetch = original; }
});

test("stalled RPC body reports deadline expiry with observed upstream status", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const env = envFor("admin", () => new Response(new ReadableStream({ start() {} })));
    const original = globalThis.fetch, originalInfo = console.info;
    let record;
    globalThis.fetch = fetcherFor(env);
    console.info = (_, value) => { record = value; };
    try {
        const pending = listRoute({ request: request("/api/admin/user-management"), env });
        await new Promise(resolve => setImmediate(resolve));
        t.mock.timers.tick(10_000);
        const response = await pending;
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error, "USER_MANAGEMENT_TIMEOUT");
        assert.equal(record.stage, "rpc_fetch_body");
        assert.equal(record.upstreamStatus, 200);
        assert.equal(record.timeout, true);
        assert.equal(record.deadlineState, "expired");
    } finally { globalThis.fetch = original; console.info = originalInfo; t.mock.timers.reset(); }
});

test("RPC URL accepts the configured REST base without duplicating the REST path", async () => {
    const env = envFor("admin", (name, args, init) => {
        assert.equal(name, "admin_list_users");
            assert.equal(env.lastUrl, "https://database.example/rest/v1/rpc/admin_list_users");
        return Response.json({ success: true, permissions: permissions("admin"), pagination: { total: 0, limit: 30, offset: 0, hasMore: false }, users: [], capturedAt: timestamp });
    });
    env.SUPABASE_URL = "https://database.example/rest/v1/";
    const original = globalThis.fetch;
    const normalFetch = fetcherFor(env);
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/admin_list_users")) assert.equal(String(url), "https://database.example/rest/v1/rpc/admin_list_users");
        return normalFetch(url, init);
    };
    try {
        const response = await listRoute({ request: request("/api/admin/user-management"), env });
        assert.equal(response.status, 200);
    } finally { globalThis.fetch = original; }
});

test("service-role credential is preferred and SUPABASE_AUTH fallback stays raw before Bearer prefix", async () => {
    for (const [changes, expected] of [[{}, "Bearer service-secret"],
        [{ SUPABASE_SERVICE_ROLE_KEY: "  ", SUPABASE_AUTH: "auth-fallback" }, "Bearer auth-fallback"]]) {
        const env = envFor("admin", (name, _args, init) => {
            assert.equal(name, "admin_list_users");
            assert.equal(init.headers.Authorization, expected);
            assert.equal(init.headers.apikey, expected.slice("Bearer ".length));
            return Response.json({ success: true, permissions: permissions("admin"), pagination: { total: 0, limit: 30, offset: 0, hasMore: false }, users: [], capturedAt: timestamp });
        });
        Object.assign(env, changes);
        const original = globalThis.fetch; globalThis.fetch = fetcherFor(env);
        try {
            const response = await listRoute({ request: request("/api/admin/user-management"), env });
            assert.equal(response.status, 200);
        } finally { globalThis.fetch = original; }
    }
});

test("pre-response transport diagnostics classify safe URL/header/fetch failures only", async () => {
    const sensitive = "private-token-cookie " + actorId;
    const originalFetch = globalThis.fetch, originalInfo = console.info;
    const records = [];
    console.info = (_label, record) => records.push(record);
    try {
        const cases = [
            { name: "malformed URL", configure: env => { env.SUPABASE_URL = "https://database.example/unexpected/"; }, stage: "configuration", expected: "invalid_url", errorName: undefined },
            { name: "invalid header", configure: env => { env.SUPABASE_SERVICE_ROLE_KEY = `bad\n${sensitive}`; }, stage: "configuration", expected: "invalid_header", errorName: undefined },
            { name: "fetch TypeError", error: () => new TypeError(sensitive), stage: "rpc_fetch_body", expected: "fetch_type_error", errorName: "TypeError" },
            { name: "fetch AbortError", error: () => Object.assign(new Error(sensitive), { name: "AbortError" }), stage: "rpc_fetch_body", expected: "aborted", errorName: "AbortError" },
            { name: "unknown fetch error", error: () => { const error = new Error(sensitive); error.name = "CustomError"; return error; }, stage: "rpc_fetch_body", expected: "unknown_transport", errorName: undefined }
        ];
        for (const item of cases) {
            const env = envFor("admin", () => { throw new Error("Unexpected RPC"); });
            item.configure?.(env);
            const normalFetch = fetcherFor(env);
            globalThis.fetch = async (url, init) => {
                if (String(url).endsWith("/admin_list_users")) throw item.error();
                return normalFetch(url, init);
            };
            const response = await listRoute({ request: request("/api/admin/user-management"), env });
            assert.equal(response.status, 503);
            const body = await response.json();
            assert.deepEqual(body, { success: false, error: item.name === "fetch AbortError" ? "USER_MANAGEMENT_TIMEOUT" : "USER_MANAGEMENT_UNAVAILABLE",
                message: item.name === "fetch AbortError" ? "User Management took too long to respond. Try again." : "User Management is temporarily unavailable. Try again." });
            const record = records.at(-1);
            assert.equal(record.stage, item.stage === "configuration" ? "configuration" : "rpc_fetch_body");
            assert.equal(record.upstreamStatus, null);
            assert.equal(record.transportErrorClass, item.expected);
            if (item.errorName) assert.equal(record.exceptionName, item.errorName);
            else assert.equal("exceptionName" in record, false);
            assert.equal(JSON.stringify(record).includes(sensitive), false);
            assert.equal(JSON.stringify(body).includes(sensitive), false);
        }
    } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
});


test("account-access timeout survives fail-closed error mapping in diagnostics", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const env = envFor("admin", () => { throw new Error("Admin RPC must not run"); });
    const original = globalThis.fetch, originalInfo = console.info;
    let record;
    globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
    console.info = (_, value) => { record = value; };
    try {
        const pending = listRoute({ request: request("/api/admin/user-management"), env });
        await new Promise(resolve => setImmediate(resolve));
        t.mock.timers.tick(10_000);
        const response = await pending;
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.deepEqual(await response.json(), { success: false, error: "USER_MANAGEMENT_UNAVAILABLE", message: "User Management is temporarily unavailable. Try again." });
        assert.equal(record.stage, "account_access_fetch_body");
        assert.equal(record.rpc, "get_account_access_state");
        assert.equal(record.upstreamStatus, 200);
        assert.equal(record.code, "UPSTREAM_TIMEOUT");
        assert.equal(record.timeout, true);
    } finally { globalThis.fetch = original; console.info = originalInfo; t.mock.timers.reset(); }
});
