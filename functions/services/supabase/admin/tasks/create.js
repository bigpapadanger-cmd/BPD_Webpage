"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK CREATE SERVICE

File:
    functions/services/supabase/admin/tasks/create.js

Purpose:
    Securely creates Admin Taskboard tasks.

Authorization:
    - Requires Discord-backed TASKS_CREATE permission.
    - Requires at least one active Taskboard role:
        owner
        database
        security
        ui
    - Task assignment requires TASKS_ASSIGN.
    - Actor account ID is resolved server-side.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Browser-submitted actor account IDs are never trusted.
    - Taskboard membership is loaded from persisted account
      role data.
    - The actor account ID comes from the verified
      Taskboard authorization context.
========================================================= */

import {
    authorizeTaskCreate
} from "../../../admin/permissions.js";

import {
    requireTaskboardMembership
} from "../../../admin/taskboard_roles.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

import {
    normalizeTaskPayload
} from "./payload.js";

/* =========================================================
CREATE TASK
========================================================= */

export async function createAdminTask(
    request,
    env,
    input
) {
    /* -----------------------------------------------------
    VALIDATE + NORMALIZE TASK
    ----------------------------------------------------- */

    const task =
        normalizeTaskPayload(
            input
        );

    /* -----------------------------------------------------
    DISCORD / APPLICATION PERMISSION

    New tasks contain responsible_roles, therefore
    assignment permission is required during creation.
    ----------------------------------------------------- */

    const authorization =
        await authorizeTaskCreate(
            request,
            env,
            {
                assignment:
                    true
            }
        );

    /* -----------------------------------------------------
    TASKBOARD MEMBERSHIP

    Discord staff access alone is not sufficient.

    requireTaskboardMembership() returns the verified
    Taskboard context:

    {
        accountId,
        roles,
        isOwner
    }
    ----------------------------------------------------- */

    const taskboardContext =
        await requireTaskboardMembership(
            env,
            authorization
        );

    /* -----------------------------------------------------
    CREATE

    Any active Taskboard role may create a task when the
    required Discord-backed operation permissions are held.

    The creator does not need to assign the task to one of
    their own responsibility roles.

    Example:
        database user may create a task assigned to ui.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.CREATE,
        {
            p_task:
                task,

            p_actor_account_id:
                taskboardContext.accountId
        }
    );
}