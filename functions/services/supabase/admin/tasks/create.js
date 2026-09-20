import { authorizeTaskCreate } from "../../../admin/permissions.js";
import { ADMIN_TASK_RPCS, callAdminTaskRpc } from "./rpc.js";
import { normalizeTaskPayload } from "./payload.js";
export async function createAdminTask(request, env, input) {
    const task = normalizeTaskPayload(input);
    const authorization = await authorizeTaskCreate(request, env, { assignment: true });
    return callAdminTaskRpc(env, ADMIN_TASK_RPCS.CREATE, { p_task: task, p_actor_account_id: authorization.accountId });
}
