"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK CREATE SERVICE

File:
    functions/services/supabase/admin/tasks/create.js

Purpose:
    Securely creates Admin task-board records through the
    Supabase admin_create_task RPC.

Description:
    - Validates the submitted task payload shape.
    - Determines whether task assignment is being requested.
    - Requires TASKS_CREATE permission.
    - Requires TASKS_ASSIGN when assignment fields are used.
    - Resolves the authoritative canonical BPD account ID
      from the server-side authorization context.
    - Injects p_actor_account_id server-side.
    - Calls the shared Admin task RPC transport.

Security:
    - Never trusts actor_account_id from the browser.
    - Never trusts role or permission claims from the browser.
    - Uses the existing Admin/Discord authorization stack.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskCreate
} from "../../../admin/permissions.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
ERROR
========================================================= */

export class AdminTaskCreateError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_CREATE_ERROR",

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
            "AdminTaskCreateError";

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
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeNullableString(
    value
) {
    if (
        value ===
        null
        || value ===
            undefined
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
AUTHORIZATION ACCOUNT ID

The exact account UUID comes from the central authorization
context, never from submitted task data.
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

    throw new AdminTaskCreateError(
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
TASK OBJECT
========================================================= */

function requireTaskObject(
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
        throw new AdminTaskCreateError(
            "A task object is required.",
            {
                code:
                    "TASK_PAYLOAD_REQUIRED",

                status:
                    400
            }
        );
    }

    return value;
}

/* =========================================================
ALLOWED FIELDS
========================================================= */

const ALLOWED_TASK_FIELDS =
    new Set([
        "title",
        "description",
        "priority",
        "timeline",
        "assigned_role",
        "assigned_account_id",
        "due_at"
    ]);

/* =========================================================
VALIDATE FIELD ALLOWLIST
========================================================= */

function validateAllowedFields(
    task
) {
    const invalidFields =
        Object.keys(
            task
        )
            .filter(
                key =>
                    !ALLOWED_TASK_FIELDS.has(
                        key
                    )
            );

    if (
        invalidFields.length >
        0
    ) {
        throw new AdminTaskCreateError(
            "Unsupported task fields were supplied.",
            {
                code:
                    "TASK_FIELDS_UNSUPPORTED",

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
TITLE
========================================================= */

function requireTitle(
    value
) {
    const title =
        normalizeString(
            value
        );

    if (
        !title
    ) {
        throw new AdminTaskCreateError(
            "A task title is required.",
            {
                code:
                    "TASK_TITLE_REQUIRED",

                status:
                    400
            }
        );
    }

    return title;
}

/* =========================================================
DATE
========================================================= */

function normalizeDueAt(
    value
) {
    if (
        value ===
        null
        || value ===
            undefined
        || value ===
            ""
    ) {
        return null;
    }

    const normalized =
        normalizeString(
            value
        );

    const timestamp =
        Date.parse(
            normalized
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        throw new AdminTaskCreateError(
            "The task due date is invalid.",
            {
                code:
                    "TASK_DUE_AT_INVALID",

                status:
                    400
            }
        );
    }

    return new Date(
        timestamp
    ).toISOString();
}

/* =========================================================
UUID
========================================================= */

function normalizeOptionalUuid(
    value
) {
    if (
        value ===
        null
        || value ===
            undefined
        || value ===
            ""
    ) {
        return null;
    }

    const normalized =
        normalizeString(
            value
        );

    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            normalized
        )
    ) {
        throw new AdminTaskCreateError(
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
ASSIGNMENT DETECTION

Assignment permission is required whenever either supported
assignment field is present in the payload.

This remains true even when a caller explicitly clears an
assignment using null.
========================================================= */

function hasAssignmentFields(
    task
) {
    return (
        Object.prototype.hasOwnProperty.call(
            task,
            "assigned_role"
        )
        || Object.prototype.hasOwnProperty.call(
            task,
            "assigned_account_id"
        )
    );
}

/* =========================================================
NORMALIZED TASK PAYLOAD

Business-rule validation remains authoritative inside the
Supabase RPC. This layer performs transport/security shape
validation only.
========================================================= */

function normalizeTaskPayload(
    task
) {
    validateAllowedFields(
        task
    );

    const normalized = {
        title:
            requireTitle(
                task.title
            )
    };

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "description"
        )
    ) {
        normalized.description =
            normalizeNullableString(
                task.description
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "priority"
        )
    ) {
        normalized.priority =
            normalizeNullableString(
                task.priority
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "timeline"
        )
    ) {
        normalized.timeline =
            normalizeNullableString(
                task.timeline
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "assigned_role"
        )
    ) {
        normalized.assigned_role =
            normalizeNullableString(
                task.assigned_role
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "assigned_account_id"
        )
    ) {
        normalized.assigned_account_id =
            normalizeOptionalUuid(
                task.assigned_account_id
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            task,
            "due_at"
        )
    ) {
        normalized.due_at =
            normalizeDueAt(
                task.due_at
            );
    }

    return normalized;
}

/* =========================================================
CREATE TASK

Expected caller input:
{
    task: {
        title,
        description?,
        priority?,
        timeline?,
        assigned_role?,
        assigned_account_id?,
        due_at?
    }
}
========================================================= */

export async function createAdminTask(
    request,
    env,
    taskInput
) {
    const task =
        requireTaskObject(
            taskInput
        );

    const assignment =
        hasAssignmentFields(
            task
        );

    const authorization =
        await authorizeTaskCreate(
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

    const normalizedTask =
        normalizeTaskPayload(
            task
        );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.CREATE,
        {
            p_task:
                normalizedTask,

            p_actor_account_id:
                actorAccountId
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskCreateError(
    error
) {
    return (
        error instanceof
            AdminTaskCreateError
        || error?.name ===
            "AdminTaskCreateError"
    );
}