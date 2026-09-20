"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK COMMENT SERVICE

File:
    functions/services/supabase/admin/tasks/comments.js

Purpose:
    Securely adds comments/questions to Admin tasks.

Description:
    - Validates task code and comment text.
    - Requires TASKS_READ.
    - Loads the authoritative task from Supabase.
    - Enforces Taskboard responsibility.
    - owner may comment on any task.
    - database/security/ui require responsible-role overlap.
    - Uses the actor account ID from the verified Taskboard
      responsibility context.
    - Creates a controlled comment event through Supabase.
    - Does not modify task state or task version.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Browser-submitted actor account IDs are never trusted.
    - Browser-submitted responsible_roles are never used
      for authorization.
    - Task assignment is loaded from persisted task data.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead
} from "../../../admin/permissions.js";

import {
    requireTaskResponsibility
} from "../../../admin/taskboard_roles.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
CONSTANTS
========================================================= */

const TASK_CODE_PATTERN =
    /^TASK-[A-HJ-NP-Z2-9]{6}$/;

const MAX_COMMENT_LENGTH =
    5000;

/* =========================================================
ERROR
========================================================= */

export class AdminTaskCommentError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_COMMENT_ERROR",

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
            "AdminTaskCommentError";

        this.code =
            code;

        this.status =
            status;

        this.details =
            details;
    }
}

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
        throw new AdminTaskCommentError(
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
COMMENT
========================================================= */

function requireComment(
    value
) {
    const comment =
        normalizeString(
            value
        );

    if (
        !comment
    ) {
        throw new AdminTaskCommentError(
            "A comment is required.",
            {
                code:
                    "TASK_COMMENT_REQUIRED",

                status:
                    400
            }
        );
    }

    if (
        comment.length >
        MAX_COMMENT_LENGTH
    ) {
        throw new AdminTaskCommentError(
            `Comments cannot exceed ${MAX_COMMENT_LENGTH} characters.`,
            {
                code:
                    "TASK_COMMENT_TOO_LONG",

                status:
                    400
            }
        );
    }

    return comment;
}

/* =========================================================
LOAD AUTHORITATIVE TASK

The task is loaded before the comment is created so access
can be checked against the CURRENT persisted assignment.

The browser cannot supply the responsible_roles used here.
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
        throw new AdminTaskCommentError(
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
ADD COMMENT

Authorization sequence:

    TASKS_READ
        ↓
    load persisted task
        ↓
    requireTaskResponsibility()
        ↓
    owner OR responsible_roles overlap
        ↓
    verified Taskboard context
        ↓
    admin_add_task_comment RPC
========================================================= */

export async function addAdminTaskComment(
    request,
    env,
    {
        taskCode,
        comment
    } = {}
) {
    /* -----------------------------------------------------
    INPUT
    ----------------------------------------------------- */

    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedComment =
        requireComment(
            comment
        );

    /* -----------------------------------------------------
    OPERATION PERMISSION
    ----------------------------------------------------- */

    const authorization =
        await authorizeTaskRead(
            request,
            env
        );

    /* -----------------------------------------------------
    AUTHORITATIVE TASK

    Load persisted assignment before performing the
    Taskboard responsibility check.
    ----------------------------------------------------- */

    const task =
        await getAuthoritativeTask(
            env,
            normalizedTaskCode
        );

    /* -----------------------------------------------------
    TASKBOARD RESPONSIBILITY

    requireTaskResponsibility() returns:

    {
        accountId,
        roles,
        isOwner
    }

    The returned accountId is therefore the same verified
    identity that passed the task responsibility check.
    ----------------------------------------------------- */

    const taskboardContext =
        await requireTaskResponsibility(
            env,
            authorization,
            task.responsible_roles
        );

    /* -----------------------------------------------------
    CREATE COMMENT EVENT

    Comments are event records only. They do not mutate the
    task lifecycle state or increment the task version.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.COMMENT,
        {
            p_task_code:
                normalizedTaskCode,

            p_comment:
                normalizedComment,

            p_actor_account_id:
                taskboardContext.accountId
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskCommentError(
    error
) {
    return (
        error instanceof AdminTaskCommentError
        || error?.name ===
            "AdminTaskCommentError"
    );
}