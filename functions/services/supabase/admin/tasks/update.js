"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK UPDATE SERVICE

File:
    functions/services/supabase/admin/tasks/update.js

Purpose:
    Securely validates and updates an existing Admin task.

Description:
    - Validates task code and expected version.
    - Normalizes supported task changes.
    - Requires TASKS_UPDATE.
    - Requires TASKS_ASSIGN when responsible_roles changes.
    - Loads the authoritative existing task before mutation.
    - Enforces Taskboard responsibility against the existing
      persisted responsible_roles.
    - owner may update any task.
    - database/security/ui require responsible-role overlap.
    - Uses optimistic concurrency through expectedVersion.
    - Derives the actor account ID from the verified
      Taskboard authorization context.

Security:
    - Browser-submitted roles are never trusted for access.
    - Authorization uses the task's current persisted roles.
    - Changing responsible_roles cannot grant authorization
      for the same request.
    - Browser-submitted actor account IDs are never trusted.
========================================================= */

import {
    authorizeTaskUpdate
} from "../../../admin/permissions.js";

import {
    requireTaskResponsibility
} from "../../../admin/taskboard_roles.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

import {
    normalizeTaskPayload,
    taskInputError
} from "./payload.js";

/* =========================================================
TASK CODE
========================================================= */

function requireTaskCode(
    value
) {
    const code =
        typeof value === "string"
            ? value.trim().toUpperCase()
            : "";

    if (
        !/^TASK-[A-HJ-NP-Z2-9]{6}$/.test(
            code
        )
    ) {
        throw taskInputError(
            "TASK_CODE_INVALID",
            "A valid task code is required."
        );
    }

    return code;
}

/* =========================================================
EXPECTED VERSION
========================================================= */

function requireExpectedVersion(
    value
) {
    if (
        !Number.isSafeInteger(
            value
        )
        || value < 1
    ) {
        throw taskInputError(
            "TASK_VERSION_INVALID",
            "A valid expected version is required."
        );
    }

    return value;
}

/* =========================================================
LOAD AUTHORITATIVE TASK

Authorization must use the task's CURRENT persisted
responsible_roles, never replacement roles supplied in the
PATCH request.
========================================================= */

async function getAuthoritativeTask(
    env,
    taskCode
) {
    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.GET,
            {
                p_task_code:
                    taskCode,

                p_include_deleted:
                    false
            }
        );

    const task =
        Array.isArray(
            result
        )
            ? result[0]
            : result;

    if (
        !task
        || typeof task !== "object"
    ) {
        throw taskInputError(
            "TASK_NOT_FOUND",
            "The requested task could not be found."
        );
    }

    return task;
}

/* =========================================================
UPDATE TASK
========================================================= */

export async function updateAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion,
        changes
    } = {}
) {
    /* -----------------------------------------------------
    INPUT
    ----------------------------------------------------- */

    const code =
        requireTaskCode(
            taskCode
        );

    const version =
        requireExpectedVersion(
            expectedVersion
        );

    /*
     * Normalize before operation authorization so we know
     * whether this request changes task assignment.
     */
    const normalized =
        normalizeTaskPayload(
            changes,
            true
        );

    const changesAssignment =
        Object.prototype.hasOwnProperty.call(
            normalized,
            "responsible_roles"
        );

    /* -----------------------------------------------------
    LAYER 1:
    DISCORD / APPLICATION PERMISSION

    Every update requires TASKS_UPDATE.

    Changing responsible_roles additionally requires
    TASKS_ASSIGN.
    ----------------------------------------------------- */

    const authorization =
        await authorizeTaskUpdate(
            request,
            env,
            {
                assignment:
                    changesAssignment
            }
        );

    /* -----------------------------------------------------
    LAYER 2:
    AUTHORITATIVE EXISTING TASK

    This MUST be loaded before evaluating any replacement
    responsible_roles submitted by the browser.
    ----------------------------------------------------- */

    const existingTask =
        await getAuthoritativeTask(
            env,
            code
        );

    /* -----------------------------------------------------
    LAYER 3:
    TASK RESPONSIBILITY

    Authorization is checked against the CURRENT persisted
    assignment.

    owner:
        may update any task.

    database/security/ui:
        must already overlap existing responsible_roles.

    requireTaskResponsibility() also returns the verified
    Taskboard context:

    {
        accountId,
        roles,
        isOwner
    }
    ----------------------------------------------------- */

    const taskboardContext =
        await requireTaskResponsibility(
            env,
            authorization,
            existingTask.responsible_roles
        );

    /* -----------------------------------------------------
    LAYER 4:
    MUTATION

    Supabase remains authoritative for:
        - optimistic concurrency
        - lifecycle restrictions
        - task validation
        - event/audit generation

    The actor account ID comes from the same verified
    Taskboard context that authorized responsibility.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.UPDATE,
        {
            p_task_code:
                code,

            p_expected_version:
                version,

            p_changes:
                normalized,

            p_actor_account_id:
                taskboardContext.accountId
        }
    );
}