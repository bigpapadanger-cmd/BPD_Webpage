"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK LIFECYCLE SERVICE

File:
    functions/services/supabase/admin/tasks/lifecycle.js

Purpose:
    Securely performs task lifecycle mutations through the
    dedicated Supabase task RPCs.

Supported Operations:
    - start
    - complete
    - reopen
    - shelve
    - unshelve
    - archive
    - restore archived
    - soft delete
    - restore deleted

Description:
    - Validates task code and expected version.
    - Uses optimistic concurrency for every mutation.
    - Uses dedicated Supabase RPCs for lifecycle actions.
    - Requires TASKS_UPDATE for normal lifecycle actions.
    - Requires TASKS_DELETE for delete/restore-delete actions.
    - Loads the authoritative task before mutation.
    - Enforces Taskboard responsibility server-side.
    - owner may operate on any task.
    - database/security/ui require responsible-role overlap.
    - Uses the verified Taskboard context returned by the
      responsibility check.
    - Injects p_actor_account_id server-side.

Security:
    - Browser never supplies the authoritative actor account.
    - Browser never supplies authoritative Taskboard roles.
    - Browser never supplies permissions or Discord roles.
    - Browser never supplies responsible_roles for access
      authorization.
    - Responsibility is checked against persisted task data.
    - Delete privileges remain separate from update privileges.
    - Lifecycle timestamps cannot be supplied by the browser.
    - Supabase remains authoritative for state transitions.
========================================================= */

import {
    authorizeTaskUpdate,
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

export class AdminTaskLifecycleError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_LIFECYCLE_ERROR",

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
            "AdminTaskLifecycleError";

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

const LIFECYCLE_ACTIONS =
    Object.freeze({
        start: {
            rpc:
                ADMIN_TASK_RPCS.START,

            permission:
                "update"
        },

        complete: {
            rpc:
                ADMIN_TASK_RPCS.COMPLETE,

            permission:
                "update"
        },

        reopen: {
            rpc:
                ADMIN_TASK_RPCS.REOPEN,

            permission:
                "update"
        },

        shelve: {
            rpc:
                ADMIN_TASK_RPCS.SHELVE,

            permission:
                "update"
        },

        unshelve: {
            rpc:
                ADMIN_TASK_RPCS.UNSHELVE,

            permission:
                "update"
        },

        archive: {
            rpc:
                ADMIN_TASK_RPCS.ARCHIVE,

            permission:
                "update"
        },

        restoreArchived: {
            rpc:
                ADMIN_TASK_RPCS.RESTORE_ARCHIVED,

            permission:
                "update"
        },

        delete: {
            rpc:
                ADMIN_TASK_RPCS.DELETE,

            permission:
                "delete"
        },

        restoreDeleted: {
            rpc:
                ADMIN_TASK_RPCS.RESTORE_DELETED,

            permission:
                "delete"
        }
    });

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
        throw new AdminTaskLifecycleError(
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
EXPECTED VERSION
========================================================= */

function requireExpectedVersion(
    value
) {
    const version =
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            version
        )
        || version < 1
    ) {
        throw new AdminTaskLifecycleError(
            "A valid expected task version is required.",
            {
                code:
                    "TASK_VERSION_INVALID",

                status:
                    400
            }
        );
    }

    return version;
}

/* =========================================================
ACTION
========================================================= */

function requireLifecycleAction(
    action
) {
    const normalized =
        normalizeString(
            action
        );

    const definition =
        LIFECYCLE_ACTIONS[
            normalized
        ];

    if (
        !definition
    ) {
        throw new AdminTaskLifecycleError(
            "The requested task lifecycle action is invalid.",
            {
                code:
                    "TASK_LIFECYCLE_ACTION_INVALID",

                status:
                    400
            }
        );
    }

    return {
        action:
            normalized,

        definition
    };
}

/* =========================================================
AUTHORIZATION

Normal lifecycle actions:
    TASKS_UPDATE

Delete lifecycle:
    TASKS_DELETE

Task-specific responsibility is checked separately after
the authoritative task has been loaded.
========================================================= */

async function authorizeLifecycleAction(
    request,
    env,
    definition
) {
    switch (
        definition.permission
    ) {
        case "update":
            return authorizeTaskUpdate(
                request,
                env
            );

        case "delete":
            return authorizeTaskDelete(
                request,
                env
            );

        default:
            throw new AdminTaskLifecycleError(
                "Task lifecycle permission configuration is invalid.",
                {
                    code:
                        "TASK_LIFECYCLE_PERMISSION_INVALID",

                    status:
                        500
                }
            );
    }
}

/* =========================================================
LOAD AUTHORITATIVE TASK
========================================================= */

async function getAuthoritativeTask(
    env,
    taskCode,
    includeDeleted = false
) {
    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.GET,
            {
                p_task_code:
                    taskCode,

                p_include_deleted:
                    includeDeleted === true
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
        throw new AdminTaskLifecycleError(
            "The requested task could not be loaded.",
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
AUTHORIZE TASK RESPONSIBILITY

Loads the authoritative task first, then verifies the
current account against that task's persisted assignment.

Returns both:
    - authoritative task
    - verified Taskboard context
========================================================= */

async function authorizeTaskLifecycleResponsibility(
    env,
    authorization,
    taskCode,
    definition
) {
    const includeDeleted =
        definition.rpc ===
        ADMIN_TASK_RPCS.RESTORE_DELETED;

    const task =
        await getAuthoritativeTask(
            env,
            taskCode,
            includeDeleted
        );

    const taskboardContext =
        await requireTaskResponsibility(
            env,
            authorization,
            task.responsible_roles
        );

    return {
        task,
        taskboardContext
    };
}

/* =========================================================
EXECUTE LIFECYCLE ACTION
========================================================= */

export async function performAdminTaskLifecycleAction(
    request,
    env,
    {
        action,
        taskCode,
        expectedVersion
    } = {}
) {
    /* -----------------------------------------------------
    ACTION
    ----------------------------------------------------- */

    const {
        definition
    } =
        requireLifecycleAction(
            action
        );

    /* -----------------------------------------------------
    INPUT
    ----------------------------------------------------- */

    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedVersion =
        requireExpectedVersion(
            expectedVersion
        );

    /* -----------------------------------------------------
    OPERATION PERMISSION
    ----------------------------------------------------- */

    const authorization =
        await authorizeLifecycleAction(
            request,
            env,
            definition
        );

    /* -----------------------------------------------------
    AUTHORITATIVE TASK + RESPONSIBILITY

    The responsibility check uses the task's persisted
    responsible_roles and returns the verified Taskboard
    context.

    No second account or role lookup is required.
    ----------------------------------------------------- */

    const {
        taskboardContext
    } =
        await authorizeTaskLifecycleResponsibility(
            env,
            authorization,
            normalizedTaskCode,
            definition
        );

    /* -----------------------------------------------------
    MUTATION

    The same verified Taskboard context that passed the
    responsibility check supplies the actor account ID.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        definition.rpc,
        {
            p_task_code:
                normalizedTaskCode,

            p_expected_version:
                normalizedVersion,

            p_actor_account_id:
                taskboardContext.accountId
        }
    );
}

/* =========================================================
START

Transitions:
    To Do -> In Progress
========================================================= */

export async function startAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "start",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
COMPLETE
========================================================= */

export async function completeAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "complete",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
REOPEN
========================================================= */

export async function reopenAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "reopen",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
SHELVE
========================================================= */

export async function shelveAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "shelve",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
UNSHELVE
========================================================= */

export async function unshelveAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "unshelve",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
ARCHIVE
========================================================= */

export async function archiveAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "archive",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
RESTORE ARCHIVED
========================================================= */

export async function restoreArchivedAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "restoreArchived",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
DELETE
========================================================= */

export async function deleteAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "delete",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
RESTORE DELETED
========================================================= */

export async function restoreDeletedAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "restoreDeleted",

            taskCode,

            expectedVersion
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskLifecycleError(
    error
) {
    return (
        error instanceof AdminTaskLifecycleError
        || error?.name ===
            "AdminTaskLifecycleError"
    );
}