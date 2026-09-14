"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK ASSIGNEES SERVICE

File:
    functions/services/supabase/admin/tasks/assignees.js

Purpose:
    Securely retrieves the authoritative list of task
    assignees and assignable roles through the Supabase
    admin_get_task_assignees RPC.

Description:
    - Requires TASKS_ASSIGN permission.
    - Returns canonical BPD accounts eligible for assignment.
    - Returns active assignable application roles.
    - Does not expose provider-specific account information.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Authorization is derived server-side.
    - Supabase service-role credentials remain server-side.
    - Assignee data is not exposed to users without task
      assignment permission.
========================================================= */

import {
    authorizeTaskAssign
} from "../../../admin/permissions.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
GET ASSIGNEES
========================================================= */

export async function getAdminTaskAssignees(
    request,
    env
) {
    await authorizeTaskAssign(
        request,
        env
    );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.ASSIGNEES,
        {}
    );
}