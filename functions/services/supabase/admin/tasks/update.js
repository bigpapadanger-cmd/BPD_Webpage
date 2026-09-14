"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK UPDATE SERVICE

File:
    functions/services/supabase/admin/tasks/update.js

Purpose:
    Securely updates Admin task-board records through the
    Supabase admin_update_task RPC.

Description:
    - Validates task code and expected version.
    - Validates the submitted change object.
    - Restricts updates to supported mutable fields.
    - Requires TASKS_UPDATE.
    - Requires TASKS_ASSIGN when assignment fields change.
    - Resolves the authoritative canonical BPD account ID
      from the server-side authorization context.
    - Injects p_actor_account_id server-side.
    - Preserves optimistic concurrency using task versioning.

Security:
    - Never trusts actor_account_id from the browser.
    - Never trusts permissions or Discord role claims from
      the browser.
    - Assignment changes require explicit assignment
      permission.
    - Lifecycle state fields cannot be modified here.
    - Deletion/archive/completion operations use dedicated
      lifecycle services.
========================================================= */

import {
    authorizeTaskUpdate
} from "../../../admin/permissions.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
ERROR
========================================================= */

export class AdminTaskUpdateError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_UPDATE_ERROR",

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
            "AdminTaskUpdateError";

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

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_CHANGE_FIELDS =
    new Set([
        "title",
        "description",
        "priority",
        "timeline",
        "assigned_role",
        "assigned_account_id"
    ]);

const ASSIGNMENT_FIELDS =
    new Set([
        "assigned_role",
        "assigned_account_id"
    ]);

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

function normalizeNullableString(
    value
) {
    if (
        value === null
        || value === undefined
    ) {
        return null;
    }

    const normalized =
        normalizeString(
            value
        );

    return normalized || null;
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
        throw new AdminTaskUpdateError(
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
        throw new AdminTaskUpdateError(
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
AUTHORIZATION ACCOUNT ID
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

    throw new AdminTaskUpdateError(
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
CHANGE OBJECT
========================================================= */

function requireChangesObject(
    value
) {
    if (
        !value
        || typeof value !==
            "object"
        || Array.isArray(
            value
        )
    ) {
        throw new AdminTaskUpdateError(
            "A task changes object is required.",
            {
                code:
                    "TASK_CHANGES_INVALID",

                status:
                    400
            }
        );
    }

    const keys =
        Object.keys(
            value
        );

    if (
        keys.length ===
        0
    ) {
        throw new AdminTaskUpdateError(
            "At least one task change is required.",
            {
                code:
                    "TASK_CHANGES_EMPTY",

                status:
                    400
            }
        );
    }

    return value;
}

/* =========================================================
ALLOWLIST
========================================================= */

function validateAllowedFields(
    changes
) {
    const invalidFields =
        Object.keys(
            changes
        )
            .filter(
                key =>
                    !ALLOWED_CHANGE_FIELDS.has(
                        key
                    )
            );

    if (
        invalidFields.length > 0
    ) {
        throw new AdminTaskUpdateError(
            "Unsupported task fields were supplied.",
            {
                code:
                    "TASK_CHANGES_UNSUPPORTED",

                status:
                    400,

                details: {
                    invalidFields
                }
            }
        );
    }
}

/* =========================================================
ASSIGNMENT DETECTION
========================================================= */

function hasAssignmentChanges(
    changes
) {
    return Object.keys(
        changes
    )
        .some(
            key =>
                ASSIGNMENT_FIELDS.has(
                    key
                )
        );
}

/* =========================================================
UUID
========================================================= */

function normalizeOptionalUuid(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const normalized =
        normalizeString(
            value
        );

    if (
        !UUID_PATTERN.test(
            normalized
        )
    ) {
        throw new AdminTaskUpdateError(
            "The assigned account ID is invalid.",
            {
                code:
                    "TASK_ASSIGNED_ACCOUNT_ID_INVALID",

                status:
                    400
            }
        );
    }

    return normalized;
}

/* =========================================================
TITLE
========================================================= */

function normalizeTitle(
    value
) {
    const title =
        normalizeString(
            value
        );

    if (
        !title
    ) {
        throw new AdminTaskUpdateError(
            "Task title cannot be empty.",
            {
                code:
                    "TASK_TITLE_INVALID",

                status:
                    400
            }
        );
    }

    return title;
}

/* =========================================================
NORMALIZE CHANGES

Only fields supplied by the caller are preserved.

This matters because omitted fields mean:
    "leave unchanged"

while null may mean:
    "explicitly clear this field"
========================================================= */

function normalizeTaskChanges(
    changes
) {
    validateAllowedFields(
        changes
    );

    const normalized = {};

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "title"
        )
    ) {
        normalized.title =
            normalizeTitle(
                changes.title
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "description"
        )
    ) {
        normalized.description =
            normalizeNullableString(
                changes.description
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "priority"
        )
    ) {
        normalized.priority =
            normalizeNullableString(
                changes.priority
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "timeline"
        )
    ) {
        normalized.timeline =
            normalizeNullableString(
                changes.timeline
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "assigned_role"
        )
    ) {
        normalized.assigned_role =
            normalizeNullableString(
                changes.assigned_role
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            changes,
            "assigned_account_id"
        )
    ) {
        normalized.assigned_account_id =
            normalizeOptionalUuid(
                changes.assigned_account_id
            );
    }

    return normalized;
}

/* =========================================================
UPDATE TASK

Expected caller input:
{
    taskCode,
    expectedVersion,
    changes: {
        title?,
        description?,
        priority?,
        timeline?,
        assigned_role?,
        assigned_account_id?
    }
}

Optimistic concurrency:
    expectedVersion must match the authoritative Supabase
    task version or the RPC returns TASK_VERSION_CONFLICT.
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
    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedVersion =
        requireExpectedVersion(
            expectedVersion
        );

    const suppliedChanges =
        requireChangesObject(
            changes
        );

    const assignment =
        hasAssignmentChanges(
            suppliedChanges
        );

    const authorization =
        await authorizeTaskUpdate(
            request,
            env,
            {
                assignment
            }
        );

    const actorAccountId =
        getAuthorizedAccountId(
            authorization
        );

    const normalizedChanges =
        normalizeTaskChanges(
            suppliedChanges
        );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.UPDATE,
        {
            p_task_code:
                normalizedTaskCode,

            p_expected_version:
                normalizedVersion,

            p_changes:
                normalizedChanges,

            p_actor_account_id:
                actorAccountId
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskUpdateError(
    error
) {
    return (
        error instanceof
            AdminTaskUpdateError
        || error?.name ===
            "AdminTaskUpdateError"
    );
}