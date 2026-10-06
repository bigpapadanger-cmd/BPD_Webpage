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
        assert.equal(init.headers.apikey, "service-secret");
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
    assert.match(source, /aria-selected/);
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
