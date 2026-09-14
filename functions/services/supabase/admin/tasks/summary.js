"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK SUMMARY SERVICE

File:
    functions/services/supabase/admin/tasks/summary.js

Purpose:
    Securely retrieves task-board summary statistics through
    the Supabase admin_get_task_summary RPC.

Description:
    - Requires TASKS_READ permission.
    - Returns authoritative task summary metrics from
      Supabase.
    - Performs no client-side or server-side recalculation.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Authorization is derived server-side.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead
} from "../../../admin/permissions.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
GET SUMMARY
========================================================= */

export async function getAdminTaskSummary(
    request,
    env
) {
    await authorizeTaskRead(
        request,
        env
    );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.SUMMARY,
        {}
    );
}