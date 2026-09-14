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
    - Uses dedicated Supabase RPCs for each lifecycle action.
    - Requires TASKS_UPDATE for normal lifecycle actions.
    - Requires TASKS_DELETE for delete/restore-delete actions.
    - Resolves the authoritative canonical BPD account ID
      from the server-side authorization context.
    - Injects p_actor_account_id server-side.

Security:
    - Browser never supplies the authoritative actor account.
    - Browser never supplies permissions or Discord roles.
    - Delete privileges remain separate from update privileges.
    - Lifecycle timestamps cannot be supplied by the browser.
    - Supabase remains authoritative for state-transition rules.
========================================================= */

import {
    authorizeTaskUpdate,
    authorizeTaskDelete
} from "../../../admin/permissions.js";

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
AUTHORIZATION ACCOUNT ID

The canonical account ID must originate from the trusted
authorization context.

Once the exact central authorization context shape is fixed,
this may be reduced to one authoritative property.
========================================================= */

function getAuthorizedAccountId(
    authorization
) {
    const candidates = [
        authorization?.account?.id,
        authorization?.accountId,
        authorization?.account?.accountId,
        authorization?.identity?.accountId
    ];

    for (
        const candidate
        of candidates
    ) {
        const normalized =
            normalizeString(
                candidate
            );

        if (
            normalized
        ) {
            return normalized;
        }
    }

    throw new AdminTaskLifecycleError(
        "The authenticated account ID could not be resolved.",
        {
            code:
                "ADMIN_ACCOUNT_ID_MISSING",

            status:
                500
        }
    );
}

/* =========================================================
AUTHORIZATION

Normal lifecycle actions:
    TASKS_UPDATE

Delete lifecycle:
    TASKS_DELETE
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
    const {
        definition
    } =
        requireLifecycleAction(
            action
        );

    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedVersion =
        requireExpectedVersion(
            expectedVersion
        );

    const authorization =
        await authorizeLifecycleAction(
            request,
            env,
            definition
        );

    const actorAccountId =
        getAuthorizedAccountId(
            authorization
        );

    return callAdminTaskRpc(
        env,
        definition.rpc,
        {
            p_task_code:
                normalizedTaskCode,

            p_expected_version:
                normalizedVersion,

            p_actor_account_id:
                actorAccountId
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

This is a soft delete in Supabase.

Requires:
    TASKS_DELETE
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

Restoring a deleted task also requires TASKS_DELETE because
access to the deleted-task state remains privileged.
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