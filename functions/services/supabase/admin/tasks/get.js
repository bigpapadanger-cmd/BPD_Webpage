"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK GET SERVICE

File:
    functions/services/supabase/admin/tasks/get.js

Purpose:
    Securely retrieves one Admin task-board record through
    the Supabase admin_get_task RPC.

Description:
    - Requires TASKS_READ permission.
    - Validates the human-readable task code.
    - Hides deleted tasks by default.
    - Supports explicit deleted-task inclusion for trusted
      server-side callers.
    - Calls the shared Admin task RPC transport.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Authorization is derived server-side.
    - Supabase service-role credentials remain server-side.
    - Deleted-task visibility is opt-in.
========================================================= */

import {
    authorizeTaskRead
} from "../../../admin/permissions.js";

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
    return typeof value ===
        "string"
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
========================================================= */

function normalizeBoolean(
    value,
    fallback = false
) {
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
        || value === null
        || value === undefined
        || value === ""
    ) {
        return false;
    }

    return fallback;
}

/* =========================================================
GET TASK

Expected caller input:
{
    taskCode,
    includeDeleted?: false
}

Deleted tasks are hidden by default.

Important:
    This service only checks TASKS_READ.

    If we decide deleted-task visibility should require
    TASKS_DELETE or AUDIT_READ, enforce that at the API
    endpoint before calling this service or extend this
    service with that explicit rule.
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
    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedIncludeDeleted =
        normalizeBoolean(
            includeDeleted,
            false
        );

    await authorizeTaskRead(
        request,
        env
    );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.GET,
        {
            p_task_code:
                normalizedTaskCode,

            p_include_deleted:
                normalizedIncludeDeleted
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskGetError(
    error
) {
    return (
        error instanceof
            AdminTaskGetError
        || error?.name ===
            "AdminTaskGetError"
    );
}