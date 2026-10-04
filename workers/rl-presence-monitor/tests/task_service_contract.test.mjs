import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createAdminTask } from "../../../functions/services/supabase/admin/tasks/create.js";
import { updateAdminTask } from "../../../functions/services/supabase/admin/tasks/update.js";
import { performAdminTaskLifecycleAction } from "../../../functions/services/supabase/admin/tasks/lifecycle.js";
import { listAdminTasks } from "../../../functions/services/supabase/admin/tasks/list.js";
import { getAdminTask } from "../../../functions/services/supabase/admin/tasks/get.js";
import { getAdminTaskSummary } from "../../../functions/services/supabase/admin/tasks/summary.js";
import { getAdminTaskAssignees } from "../../../functions/services/supabase/admin/tasks/assignees.js";
import { getAdminTaskEvents, getAdminTaskActivity, listAdminTaskActivity } from "../../../functions/services/supabase/admin/tasks/activity.js";
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
        Providers: providers.includes("epic") ? { epic: { AccountId: "old-cached-subject", Linked: true } } : {} });
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
        if (url.endsWith("get_rocketleague_profile_v2")) return Response.json({ account_id: "account-1", rl_player_id: "player-1",
            active, registration_status: "complete", profile_complete: true, rocket_league_access: true,
            age_consent: ageConsent, policy_consent: true });
        if (url.endsWith("touch_account_last_seen")) return Response.json({ updated: true });
        if (url.endsWith("get_stats_refresh_state")) return Response.json([]);
        throw new Error(`Unexpected request ${url}`);
    };
    const request = new Request("https://bpd.invalid/api/test", { headers: { cookie: "bpd_session=test-session" } });
    return { env, records, request, calls, iso };
}


function staffFixture(role = "admin", result = { task_code: "TASK-ABC234", version: 2 }) {
    const f = fixture({ providers: ["discord"] }), authFetch = globalThis.fetch, rpcCalls = [];
    Object.assign(f.env, { SUPABASE_SERVICE_ROLE_KEY: "mock-only", DISCORD_AUTHZ_GUILD_ID: "mock-guild",
        DISCORD_AUTHZ_BOT_TOKEN: "mock-only", DISCORD_AUTHZ_ADMIN_ROLE_ID: "100000000000000001",
        DISCORD_AUTHZ_MOD_ROLE_ID: "100000000000000002", DISCORD_AUTHZ_OWNER_ROLE_ID: "100000000000000003",
        DISCORD_AUTHZ_DATABASE_ROLE_ID: "100000000000000004", DISCORD_AUTHZ_SECURITY_ROLE_ID: "100000000000000005",
        DISCORD_AUTHZ_UI_ROLE_ID: "100000000000000006" });
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith("https://discord.com/")) {
            const roleIds = { admin: "100000000000000001", moderator: "100000000000000002" };
            return Response.json({ user: { id: "discord-subject" }, roles: [roleIds[role] || "100000000000000007"], pending: false });
        }
        if (String(url).endsWith("/rpc/admin_get_taskboard_roles")) return Response.json([{ role: "owner" }]);
        if (String(url).includes("/rpc/admin_")) {
            const rpc = String(url).split("/").pop();
            rpcCalls.push({ rpc, parameters: JSON.parse(init.body) });
            if (rpc === "admin_get_task") return Response.json({ ...(Array.isArray(result) ? result[0] : result),
                task_code: "TASK-ABC234", responsible_roles: ["owner"] });
            if (rpc === "admin_get_task_summary") return Response.json({ taskCount: 1 });
            if (rpc === "admin_get_task_assignees") return Response.json({ roles: ["owner"], accounts: [] });
            return Response.json(result);
        }
        return authFetch(url, init);
    };
    return { ...f, rpcCalls };
}
test("Taskboard create uses only the JSON overload and canonical actor; assignment fields are preserved", async () => {
    const f = staffFixture(), task = { title: "Task", body: "Description", priority: "High", timeline_days: 7,
        responsible_roles: ["database", "ui"] };
    await createAdminTask(f.request, f.env, task);
    assert.deepEqual(f.rpcCalls, [{ rpc: "admin_create_task", parameters: { p_task: task, p_actor_account_id: "account-1" } }]);
    for (const field of ["actor_account_id", "group", "creator_account_id"]) {
        await assert.rejects(createAdminTask(f.request, f.env, { title: "Task", [field]: "forged" }), { code: "TASK_FIELDS_UNSUPPORTED" });
    }
    assert.equal(f.rpcCalls.length, 1);
});
test("updates preserve role assignment, enforce version, and reject obsolete fields", async () => {
    const f = staffFixture(), changes = { title: "Changed", responsible_roles: ["security"] };
    await updateAdminTask(f.request, f.env, { taskCode: "TASK-ABC234", expectedVersion: 7, changes });
    assert.deepEqual(f.rpcCalls.find(call => call.rpc === "admin_update_task"), { rpc: "admin_update_task", parameters: {
        p_task_code: "TASK-ABC234", p_expected_version: 7, p_changes: changes, p_actor_account_id: "account-1" } });
    await assert.rejects(updateAdminTask(f.request, f.env, { taskCode: "TASK-ABC234", expectedVersion: 7, changes: { due_at: null } }), { code: "TASK_FIELDS_UNSUPPORTED" });
    await assert.rejects(updateAdminTask(f.request, f.env, { taskCode: "TASK-ABC234", expectedVersion: 0, changes }), { code: "TASK_VERSION_INVALID" });
    assert.equal(f.rpcCalls.filter(call => call.rpc === "admin_update_task").length, 1);
});
test("every lifecycle action sends the confirmed three-argument contract", async () => {
    const f = staffFixture();
    const names = { complete: "complete", reopen: "reopen", shelve: "shelve", unshelve: "unshelve", archive: "archive",
        restoreArchived: "restore_archived", delete: "delete", restoreDeleted: "restore_deleted" };
    for (const [action, suffix] of Object.entries(names)) {
        await performAdminTaskLifecycleAction(f.request, f.env, { action, taskCode: "TASK-ABC234", expectedVersion: 9,
            reason: "Regression fixture", actorAccountId: "forged" });
        const parameters = { p_task_code: "TASK-ABC234", p_expected_version: 9, p_actor_account_id: "account-1" };
        if (["shelve", "archive", "delete"].includes(action)) parameters.p_reason = "Regression fixture";
        assert.deepEqual(f.rpcCalls.at(-1), { rpc: "admin_" + suffix + "_task", parameters });
    }
});
test("read and history RPC names and parameter names match the supplied contracts; null historical actors survive", async () => {
    const history = [{ actor_account_id: null, creator_account_id: null, display_name: null }];
    const f = staffFixture("admin", history);
    const task = { ...history[0], task_code: "TASK-ABC234", responsible_roles: ["owner"] };
    const assignees = { success: true, availableRoles: ["owner"], accounts: [], userRoles: ["owner"], isOwner: true };
    const cases = [
        [listAdminTasks, { filters: {}, limit: 10, offset: 2 }, "admin_list_tasks", { p_filters: {}, p_limit: 10, p_offset: 2,
            p_authorized_roles: ["owner"] }, history],
        [getAdminTask, { taskCode: "TASK-ABC234" }, "admin_get_task", { p_task_code: "TASK-ABC234", p_include_deleted: false }, task],
        [getAdminTaskSummary, undefined, "admin_get_task_summary", { p_authorized_roles: ["owner"] }, { taskCount: 1 }],
        [getAdminTaskAssignees, undefined, "admin_get_task_assignees", {}, assignees],
        [getAdminTaskEvents, { taskCode: "TASK-ABC234", limit: 10, offset: 2 }, "admin_get_task_events", { p_task_code: "TASK-ABC234", p_limit: 10, p_offset: 2 }],
        [getAdminTaskActivity, { limit: 10, offset: 2 }, "admin_get_task_activity", { p_limit: 10, p_offset: 2 }],
        [listAdminTaskActivity, { filters: {}, limit: 10, offset: 2 }, "admin_list_task_activity", { p_filters: {}, p_limit: 10, p_offset: 2 }]
    ];
    for (const [fn, input, rpc, parameters, expected = history] of cases) {
        assert.deepEqual(await fn(f.request, f.env, input), expected);
        assert.deepEqual(f.rpcCalls.at(-1), { rpc, parameters });
    }
});
test("moderators cannot list deleted records through any filter; ordinary task reads remain available", async () => {
    const f = staffFixture("moderator");
    await listAdminTasks(f.request, f.env);
    await listAdminTasks(f.request, f.env, { filters: { lifecycle: "all" } });
    await listAdminTasks(f.request, f.env, { filters: { lifecycle: "deleted" } });
    for (const filters of [{ includeDeleted: true }, { lifecycle: "deleted", includeDeleted: true }, { lifecycle: "all", includeDeleted: true }]) {
        await assert.rejects(listAdminTasks(f.request, f.env, { filters }), { code: "ADMIN_PERMISSION_REQUIRED" });
    }
    assert.equal(f.rpcCalls.length, 3);
    const admin = staffFixture();
    await listAdminTasks(admin.request, admin.env, { filters: { includeDeleted: true } });
    assert.equal(admin.rpcCalls.length, 1);
});
test("stale Discord and nonstaff accounts cannot reach Taskboard RPCs", async () => {
    for (const stale of [true, false]) {
        const f = staffFixture(stale ? "admin" : "nonstaff");
        if (stale) f.records.delete("provider_auth_id:account-1:discord");
        await assert.rejects(createAdminTask(f.request, f.env, { title: "Task", body: "Body", priority: "Low", timeline_days: 30, responsible_roles: ["owner"] }), { status: 403 });
        assert.equal(f.rpcCalls.length, 0);
    }
});

test("canonical task input rejects unsupported roles, missing required fields, and priority/timeline mismatches", async () => {
    const f = staffFixture();
    const valid = { title: "Task", body: "Body", priority: "High", timeline_days: 7, responsible_roles: ["ui"] };
    for (const changes of [{ responsible_roles: [] }, { responsible_roles: ["moderator"] }, { responsible_roles: null },
        { body: "" }, { timeline_days: 14 }, { timeline_days: "7" }, { priority: "high" },
        { description: "obsolete" }, { assigned_role: "ui" }, { assigned_account_id: null }, { timeline: "current" }, { due_at: null }]) {
        await assert.rejects(createAdminTask(f.request, f.env, { ...valid, ...changes }), { status: 400 });
    }
    await assert.rejects(createAdminTask(f.request, f.env, { title: "Task" }), { status: 400 });
    assert.equal(f.rpcCalls.length, 0);
    await listAdminTasks(f.request, f.env, { filters: { responsibleRole: "ui", timeline_days: 7 } });
    assert.deepEqual(f.rpcCalls[0].parameters.p_filters, { responsibleRole: "ui", timeline_days: 7 });
});
