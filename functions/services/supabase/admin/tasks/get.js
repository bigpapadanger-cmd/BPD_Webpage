"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK GET SERVICE

File:
    functions/services/supabase/admin/tasks/get.js

Purpose:
    Securely retrieves one Admin Taskboard record through
    the Supabase admin_get_task RPC.

Description:
    - Requires TASKS_READ permission.
    - Validates the human-readable task code.
    - Hides deleted tasks by default.
    - Requires TASKS_DELETE to include deleted tasks.
    - Loads the authoritative task from Supabase.
    - Enforces Taskboard responsibility before returning it.
    - owner may read any task.
    - database/security/ui require responsible-role overlap.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Browser-submitted responsible_roles are never trusted.
    - Authorization is derived server-side.
    - Task responsibility is checked against persisted data.
    - Deleted-task visibility requires elevated permission.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead,
    authorizeTaskDelete
} from "../../../admin/permissions.js";

import {
    requireTaskResponsibility
} from "../../../admin/taskboard_roles.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
ERROR
========================================================= */

export class AdminTaskGetError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_GET_ERROR",

            status =
                400,

            details =
                null
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "AdminTaskGetError";

        this.code =
            code;

        this.status =
            status;

        this.details =
            details;
    }
}

/* =========================================================
CONSTANTS
========================================================= */

const TASK_CODE_PATTERN =
    /^TASK-[A-HJ-NP-Z2-9]{6}$/;

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

/* =========================================================
TASK CODE
========================================================= */

function requireTaskCode(
    value
) {
    const taskCode =
        normalizeString(
            value
        ).toUpperCase();

    if (
        !TASK_CODE_PATTERN.test(
            taskCode
        )
    ) {
        throw new AdminTaskGetError(
            "A valid task code is required.",
            {
                code:
                    "TASK_CODE_INVALID",

                status:
                    400
            }
        );
    }

    return taskCode;
}

/* =========================================================
BOOLEAN

Security-relevant boolean values are parsed strictly.

Missing/empty:
    false

Accepted true:
    true
    "true"
    1
    "1"

Accepted false:
    false
    "false"
    0
    "0"

Anything else:
    rejected
========================================================= */

function requireBoolean(
    value,
    {
        defaultValue = false,
        code = "BOOLEAN_INVALID",
        message = "A boolean value is invalid."
    } = {}
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return defaultValue;
    }

    if (
        value === true
        || value === "true"
        || value === 1
        || value === "1"
    ) {
        return true;
    }

    if (
        value === false
        || value === "false"
        || value === 0
        || value === "0"
    ) {
        return false;
    }

    throw new AdminTaskGetError(
        message,
        {
            code,
            status:
                400
        }
    );
}

/* =========================================================
NORMALIZE TASK RESULT

PostgREST may return a SETOF/table RPC as an array.

Normalize that here so responsibility checks always operate
on the actual persisted task object.
========================================================= */

function normalizeTaskResult(
    result
) {
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
        throw new AdminTaskGetError(
            "The requested task could not be found.",
            {
                code:
                    "TASK_NOT_FOUND",

                status:
                    404
            }
        );
    }

    return task;
}

/* =========================================================
GET TASK

Authorization sequence:

    TASKS_READ
        ↓
    TASKS_DELETE if includeDeleted
        ↓
    load authoritative task
        ↓
    requireTaskResponsibility()
        ↓
    owner OR responsible_roles overlap
        ↓
    return task

Important:
    Responsibility is evaluated only after the authoritative
    persisted task has been loaded.

    Knowing a TASK-XXXXXX code alone does not grant access.
========================================================= */

export async function getAdminTask(
    request,
    env,
    {
        taskCode,
        includeDeleted =
            false
    } = {}
) {
    /* -----------------------------------------------------
    INPUT
    ----------------------------------------------------- */

    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedIncludeDeleted =
        requireBoolean(
            includeDeleted,
            {
                defaultValue:
                    false,

                code:
                    "INCLUDE_DELETED_INVALID",

                message:
                    "includeDeleted must be a boolean."
            }
        );

    /* -----------------------------------------------------
    READ PERMISSION
    ----------------------------------------------------- */

    let authorization =
        await authorizeTaskRead(
            request,
            env
        );

    /* -----------------------------------------------------
    DELETED-TASK VISIBILITY

    Ordinary TASKS_READ permission does not grant access to
    deleted task records.

    includeDeleted=true requires TASKS_DELETE.
    ----------------------------------------------------- */

    if (
        normalizedIncludeDeleted
    ) {
        authorization =
            await authorizeTaskDelete(
                request,
                env
            );
    }

    /* -----------------------------------------------------
    LOAD AUTHORITATIVE TASK
    ----------------------------------------------------- */

    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.GET,
            {
                p_task_code:
                    normalizedTaskCode,

                p_include_deleted:
                    normalizedIncludeDeleted
            }
        );

    const task =
        normalizeTaskResult(
            result
        );

    /* -----------------------------------------------------
    TASKBOARD RESPONSIBILITY

    requireTaskResponsibility() retrieves the authenticated
    account's active Taskboard roles and compares them with
    this task's persisted responsible_roles.

    owner:
        may read any task.

    database/security/ui:
        must overlap the task assignment.

    The returned context is not otherwise needed because
    this operation is read-only.
    ----------------------------------------------------- */

    await requireTaskResponsibility(
        env,
        authorization,
        task.responsible_roles
    );

    /* -----------------------------------------------------
    RETURN
    ----------------------------------------------------- */

    return task;
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskGetError(
    error
) {
    return (
        error instanceof AdminTaskGetError
        || error?.name ===
            "AdminTaskGetError"
    );
}