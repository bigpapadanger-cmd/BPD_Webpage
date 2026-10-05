import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { callAdminTaskRpc, ADMIN_TASK_RPCS } from "../../../functions/services/supabase/admin/tasks/rpc.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("Taskboard RPC accepts project and REST base URLs without duplicating the path", async () => {
    for (const base of ["https://db.invalid", "https://db.invalid/", "https://db.invalid/rest/v1", "https://db.invalid/rest/v1/"]) {
        globalThis.fetch = async (url, options) => {
            assert.equal(url, "https://db.invalid/rest/v1/rpc/admin_create_task");
            assert.equal(options.headers["Content-Profile"], "api");
            assert.deepEqual(JSON.parse(options.body), { p_task: { title: "Test" }, p_actor_account_id: "actor" });
            return Response.json({ task_code: "TASK-ABC234", version: 1 });
        };
        const result = await callAdminTaskRpc({ SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: "mock-only" },
            ADMIN_TASK_RPCS.CREATE, { p_task: { title: "Test" }, p_actor_account_id: "actor" });
        assert.equal(result.task_code, "TASK-ABC234");
    }
});

test("Taskboard version conflicts remain HTTP 409", async () => {
    globalThis.fetch = async () => Response.json({ code: "P0001", message: "TASK_VERSION_CONFLICT" }, { status: 400 });
    await assert.rejects(callAdminTaskRpc({ SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_SERVICE_ROLE_KEY: "mock-only" },
        ADMIN_TASK_RPCS.UPDATE, { p_task_code: "TASK-ABC234", p_expected_version: 1, p_changes: { title: "Updated" }, p_actor_account_id: "actor" }),
        { code: "TASK_VERSION_CONFLICT", status: 409 });
});

test("upstream credential errors and unknown database details are service failures, never user logout", async () => {
    for (const status of [400, 401, 403, 500]) {
        globalThis.fetch = async () => Response.json({ code: "private_code", message: "private SQL", details: "private details", hint: "private hint" }, { status });
        await assert.rejects(callAdminTaskRpc({ SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "mock-only" }, ADMIN_TASK_RPCS.SUMMARY), error => {
            assert.equal(error.status, status);
            assert.equal(error.code, "ADMIN_TASK_RPC_FAILED");
            assert.equal(error.unavailable, [502, 503, 504].includes(status));
            assert.doesNotMatch(error.message, /private/);
            assert.equal(error.details, null);
            assert.equal(error.hint, null);
            assert.equal(error.databaseCode, null);
            return true;
        });
    }
});
