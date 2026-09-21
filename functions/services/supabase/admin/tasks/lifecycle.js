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
    - Requires lifecycle reasons for shelve, archive,
      and delete.
    - Passes p_reason only to RPCs that support reasons.
    - Sends Discord summaries after successful complete
      and shelve actions.

Discord:
    - Completed tasks are sent through:
          TASKBOARD_SUMMARY_DISCORD
    - Shelved tasks are sent through:
          TASKBOARD_SUMMARY_DISCORD
    - Discord delivery occurs only after Supabase confirms
      a successful lifecycle mutation.
    - Discord failure does not fail or roll back the
      lifecycle mutation.

Security:
    - Browser never supplies the authoritative actor account.
    - Browser never supplies authoritative Taskboard roles.
    - Browser never supplies permissions or Discord roles.
    - Browser never supplies responsible_roles for access
      authorization.
    - Responsibility is checked against persisted task data.
    - Delete privileges remain separate from update privileges.
    - Lifecycle timestamps cannot be supplied by the browser.
    - Lifecycle reasons are validated server-side.
    - Discord webhook URLs remain server-side secrets.
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
    sendTaskCompletedDiscordNotification,
    sendTaskShelvedDiscordNotification
} from "../../../admin/taskboard_discord.js";

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

const MAX_REASON_LENGTH =
    10000;

const LIFECYCLE_ACTIONS =
    Object.freeze({
        start: {
            rpc:
                ADMIN_TASK_RPCS.START,

            permission:
                "update",

            requiresReason:
                false
        },

        complete: {
            rpc:
                ADMIN_TASK_RPCS.COMPLETE,

            permission:
                "update",

            requiresReason:
                false
        },

        reopen: {
            rpc:
                ADMIN_TASK_RPCS.REOPEN,

            permission:
                "update",

            requiresReason:
                false
        },

        shelve: {
            rpc:
                ADMIN_TASK_RPCS.SHELVE,

            permission:
                "update",

            requiresReason:
                true
        },

        unshelve: {
            rpc:
                ADMIN_TASK_RPCS.UNSHELVE,

            permission:
                "update",

            requiresReason:
                false
        },

        archive: {
            rpc:
                ADMIN_TASK_RPCS.ARCHIVE,

            permission:
                "update",

            requiresReason:
                true
        },

        restoreArchived: {
            rpc:
                ADMIN_TASK_RPCS.RESTORE_ARCHIVED,

            permission:
                "update",

            requiresReason:
                false
        },

        delete: {
            rpc:
                ADMIN_TASK_RPCS.DELETE,

            permission:
                "delete",

            requiresReason:
                true
        },

        restoreDeleted: {
            rpc:
                ADMIN_TASK_RPCS.RESTORE_DELETED,

            permission:
                "delete",

            requiresReason:
                false
        }
    });

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
        )
            .toUpperCase();

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
        || version <
            1
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
REASON

Reasons are required for:
    shelve
    archive
    delete

Other lifecycle operations do not pass p_reason to their
Supabase RPCs.
========================================================= */

function requireLifecycleReason(
    value,
    definition
) {
    const reason =
        normalizeString(
            value
        );

    if (
        definition.requiresReason ===
            true
        && !reason
    ) {
        throw new AdminTaskLifecycleError(
            "A reason is required for this lifecycle action.",
            {
                code:
                    "TASK_LIFECYCLE_REASON_REQUIRED",

                status:
                    400
            }
        );
    }

    if (
        reason.length >
        MAX_REASON_LENGTH
    ) {
        throw new AdminTaskLifecycleError(
            `Lifecycle reasons cannot exceed ${MAX_REASON_LENGTH.toLocaleString()} characters.`,
            {
                code:
                    "TASK_LIFECYCLE_REASON_TOO_LONG",

                status:
                    400,

                details: {
                    maxLength:
                        MAX_REASON_LENGTH
                }
            }
        );
    }

    return definition.requiresReason ===
        true
        ? reason
        : "";
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
    includeDeleted =
        false
) {
    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.GET,
            {
                p_task_code:
                    taskCode,

                p_include_deleted:
                    includeDeleted ===
                    true
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
        || typeof task !==
            "object"
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

Returns:
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
RPC PAYLOAD

Only the reason-enabled Supabase RPCs receive p_reason.

Reason-enabled:
    admin_shelve_task
    admin_archive_task
    admin_delete_task
========================================================= */

function createLifecycleRpcPayload(
    definition,
    taskCode,
    expectedVersion,
    actorAccountId,
    reason
) {
    const payload = {
        p_task_code:
            taskCode,

        p_expected_version:
            expectedVersion,

        p_actor_account_id:
            actorAccountId
    };

    if (
        definition.requiresReason ===
        true
    ) {
        payload.p_reason =
            reason;
    }

    return payload;
}

/* =========================================================
UPDATED TASK EXTRACTION

Lifecycle RPCs return authoritative task data after the
mutation.

Discord notifications must use that authoritative record
rather than the pre-mutation task or browser input.
========================================================= */

function extractUpdatedTask(
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
DISCORD LIFECYCLE NOTIFICATION

Notifications are currently sent for:
    complete
    shelve

Destination:
    TASKBOARD_SUMMARY_DISCORD

Discord is intentionally outside the lifecycle mutation.

If Discord fails, the successful Supabase mutation remains
successful.
========================================================= */

async function notifyLifecycleDiscord(
    env,
    action,
    result
) {
    if (
        action !==
            "complete"
        && action !==
            "shelve"
    ) {
        return;
    }

    const task =
        extractUpdatedTask(
            result
        );

    if (
        !task
    ) {
        console.error(
            "[TASKBOARD DISCORD LIFECYCLE NOTIFICATION SKIPPED]",
            {
                action,

                code:
                    "TASKBOARD_UPDATED_TASK_MISSING",

                message:
                    "The authoritative updated task could not be extracted from the lifecycle RPC response."
            }
        );

        return;
    }

    try {
        switch (
            action
        ) {
            case "complete":
                await sendTaskCompletedDiscordNotification(
                    env,
                    task
                );

                break;

            case "shelve":
                await sendTaskShelvedDiscordNotification(
                    env,
                    task
                );

                break;

            default:
                break;
        }
    }
    catch (
        error
    ) {
        console.error(
            "[TASKBOARD DISCORD LIFECYCLE NOTIFICATION FAILED]",
            {
                action,

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
EXECUTE LIFECYCLE ACTION
========================================================= */

export async function performAdminTaskLifecycleAction(
    request,
    env,
    {
        action,
        taskCode,
        expectedVersion,
        reason =
            ""
    } = {}
) {
    /* -----------------------------------------------------
    ACTION
    ----------------------------------------------------- */

    const {
        action:
            normalizedAction,

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

    const normalizedReason =
        requireLifecycleReason(
            reason,
            definition
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

    Responsibility uses the persisted responsible_roles.

    The verified Taskboard context supplies the actor account
    ID for the mutation.
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
    RPC PAYLOAD
    ----------------------------------------------------- */

    const rpcPayload =
        createLifecycleRpcPayload(
            definition,
            normalizedTaskCode,
            normalizedVersion,
            taskboardContext.accountId,
            normalizedReason
        );

    /* -----------------------------------------------------
    MUTATION
    ----------------------------------------------------- */

    const result =
        await callAdminTaskRpc(
            env,
            definition.rpc,
            rpcPayload
        );

    /* -----------------------------------------------------
    DISCORD

    Supabase mutation has already succeeded.

    complete:
        TASKBOARD_SUMMARY_DISCORD

    shelve:
        TASKBOARD_SUMMARY_DISCORD

    Discord failures are logged but never convert a
    successful lifecycle mutation into an API failure.
    ----------------------------------------------------- */

    await notifyLifecycleDiscord(
        env,
        normalizedAction,
        result
    );

    /* -----------------------------------------------------
    RESPONSE
    ----------------------------------------------------- */

    return result;
}

/* =========================================================
START

Transition:
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

Requires:
    reason
========================================================= */

export async function shelveAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion,
        reason
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "shelve",

            taskCode,

            expectedVersion,

            reason
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

Requires:
    reason
========================================================= */

export async function archiveAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion,
        reason
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "archive",

            taskCode,

            expectedVersion,

            reason
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

Requires:
    reason
========================================================= */

export async function deleteAdminTask(
    request,
    env,
    {
        taskCode,
        expectedVersion,
        reason
    } = {}
) {
    return performAdminTaskLifecycleAction(
        request,
        env,
        {
            action:
                "delete",

            taskCode,

            expectedVersion,

            reason
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
        error instanceof
            AdminTaskLifecycleError
        || error?.name ===
            "AdminTaskLifecycleError"
    );
}