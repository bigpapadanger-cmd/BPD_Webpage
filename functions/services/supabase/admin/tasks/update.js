import { authorizeTaskUpdate } from "../../../admin/permissions.js";
import { ADMIN_TASK_RPCS, callAdminTaskRpc } from "./rpc.js";
import { normalizeTaskPayload, taskInputError } from "./payload.js";
export async function updateAdminTask(request, env, { taskCode, expectedVersion, changes } = {}) {
    const code = typeof taskCode === "string" ? taskCode.trim().toUpperCase() : "";
    if (!/^TASK-[A-HJ-NP-Z2-9]{6}$/.test(code)) throw taskInputError("TASK_CODE_INVALID", "A valid task code is required.");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw taskInputError("TASK_VERSION_INVALID", "A valid expected version is required.");
    const normalized = normalizeTaskPayload(changes, true);
    const authorization = await authorizeTaskUpdate(request, env, { assignment: "responsible_roles" in normalized });
    return callAdminTaskRpc(env, ADMIN_TASK_RPCS.UPDATE, { p_task_code: code, p_expected_version: expectedVersion,
        p_changes: normalized, p_actor_account_id: authorization.accountId });
}
