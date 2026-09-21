"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK CREATE SERVICE

File:
    functions/services/supabase/admin/tasks/create.js

Purpose:
    Securely creates Admin Taskboard tasks and sends a
    server-side Discord notification after successful
    creation.

Authorization:
    - Requires Discord-backed TASKS_CREATE permission.
    - Requires at least one active Taskboard role:
          owner
          database
          security
          ui
    - Task assignment requires TASKS_ASSIGN.
    - Actor account ID is resolved server-side.

Discord:
    - Successful new tasks are reported through:
          NEW_TASKBOARD_REPORT_DISCORD
    - Discord delivery occurs only after Supabase confirms
      successful task creation.
    - Discord delivery failure does not roll back or fail
      task creation.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Browser-submitted actor account IDs are never trusted.
    - Taskboard membership is loaded from persisted account
      role data.
    - The actor account ID comes from the verified
      Taskboard authorization context.
    - Discord webhook URLs remain server-side secrets.
========================================================= */

import {
    authorizeTaskCreate
} from "../../../admin/permissions.js";

import {
    requireTaskboardMembership
} from "../../../admin/taskboard_roles.js";

import {
    sendTaskCreatedDiscordNotification
} from "../../../admin/taskboard_discord.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

import {
    normalizeTaskPayload
} from "./payload.js";

/* =========================================================
CREATED TASK EXTRACTION

The RPC response may expose the authoritative task in
slightly different wrappers.

Discord notifications must use the authoritative task
returned by Supabase rather than the browser-submitted
payload whenever possible.
========================================================= */

function extractCreatedTask(
    result
) {
    if (
        result?.task
        && typeof result.task ===
            "object"
        && !Array.isArray(
            result.task
        )
    ) {
        return result.task;
    }

    if (
        result?.data?.task
        && typeof result.data.task ===
            "object"
        && !Array.isArray(
            result.data.task
        )
    ) {
        return result.data.task;
    }

    if (
        result?.data
        && typeof result.data ===
            "object"
        && !Array.isArray(
            result.data
        )
    ) {
        return result.data;
    }

    if (
        Array.isArray(
            result
        )
        && result.length >
            0
        && result[0]
        && typeof result[0] ===
            "object"
        && !Array.isArray(
            result[0]
        )
    ) {
        return result[0];
    }

    return null;
}

/* =========================================================
DISCORD NOTIFICATION

Discord is intentionally not part of the task creation
transaction.

If Discord is unavailable, rate-limited, or misconfigured,
the already-created task remains successful.
========================================================= */

async function notifyTaskCreated(
    env,
    result
) {
    const task =
        extractCreatedTask(
            result
        );

    if (
        !task
    ) {
        console.error(
            "[TASKBOARD DISCORD CREATE NOTIFICATION SKIPPED]",
            {
                code:
                    "TASKBOARD_CREATED_TASK_MISSING",

                message:
                    "The authoritative created task could not be extracted from the RPC response."
            }
        );

        return;
    }

    try {
        await sendTaskCreatedDiscordNotification(
            env,
            task
        );
    }
    catch (
        error
    ) {
        console.error(
            "[TASKBOARD DISCORD CREATE NOTIFICATION FAILED]",
            {
                name:
                    error?.name
                    || null,

                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown Discord notification error",

                details:
                    error?.details
                    || null
            }
        );
    }
}

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

    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.CREATE,
            {
                p_task:
                    task,

                p_actor_account_id:
                    taskboardContext.accountId
            }
        );

    /* -----------------------------------------------------
    DISCORD

    Supabase creation has already succeeded at this point.

    The authoritative created task is sent to:

        NEW_TASKBOARD_REPORT_DISCORD

    Notification errors are logged but never convert a
    successful task creation into an API failure.
    ----------------------------------------------------- */

    await notifyTaskCreated(
        env,
        result
    );

    /* -----------------------------------------------------
    RESPONSE
    ----------------------------------------------------- */

    return result;
}