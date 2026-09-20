"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK ACTIVITY SERVICE

File:
    functions/services/supabase/admin/tasks/activity.js

Purpose:
    Securely retrieves task-board event history and global
    task activity through the Supabase task audit RPCs.

Description:
    - Individual task history requires TASKS_READ.
    - Individual task history also requires Taskboard
      responsibility for the requested task.
    - owner may inspect any task history.
    - database/security/ui require responsible-role overlap.
    - Global task activity requires AUDIT_READ.
    - Supports bounded pagination.
    - Supports filtered global activity.
    - Does not mutate task state.
    - Keeps task history and global audit access separated.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Task responsibility is derived from persisted data.
    - Authorization is derived server-side.
    - Supabase service-role credentials remain server-side.
    - Global audit visibility is intentionally more
      restrictive than individual task history.
========================================================= */

import {
    authorizeTaskRead,
    authorizeTaskAuditRead
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

export class AdminTaskActivityError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_ACTIVITY_ERROR",

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
            "AdminTaskActivityError";

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

const ALLOWED_ACTIVITY_FILTERS =
    new Set([
        "taskCode",
        "actorAccountId",
        "eventType",
        "createdAfter",
        "createdBefore"
    ]);

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
        throw new AdminTaskActivityError(
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
PAGINATION
========================================================= */

function normalizeLimit(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return 50;
    }

    const limit =
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            limit
        )
    ) {
        throw new AdminTaskActivityError(
            "Task activity limit is invalid.",
            {
                code:
                    "TASK_ACTIVITY_LIMIT_INVALID",

                status:
                    400
            }
        );
    }

    return Math.min(
        Math.max(
            limit,
            1
        ),
        200
    );
}

function normalizeOffset(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return 0;
    }

    const offset =
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            offset
        )
        || offset < 0
    ) {
        throw new AdminTaskActivityError(
            "Task activity offset is invalid.",
            {
                code:
                    "TASK_ACTIVITY_OFFSET_INVALID",

                status:
                    400
            }
        );
    }

    return offset;
}

/* =========================================================
DATE
========================================================= */

function normalizeOptionalDate(
    value,
    code
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

    const timestamp =
        Date.parse(
            normalized
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        throw new AdminTaskActivityError(
            "The task activity date filter is invalid.",
            {
                code,
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
FILTERS
========================================================= */

function normalizeActivityFilters(
    value
) {
    if (
        value === null
        || value === undefined
    ) {
        return {};
    }

    if (
        typeof value !== "object"
        || Array.isArray(
            value
        )
    ) {
        throw new AdminTaskActivityError(
            "Task activity filters must be an object.",
            {
                code:
                    "TASK_ACTIVITY_FILTERS_INVALID",

                status:
                    400
            }
        );
    }

    const invalidFields =
        Object.keys(
            value
        )
            .filter(
                key =>
                    !ALLOWED_ACTIVITY_FILTERS.has(
                        key
                    )
            );

    if (
        invalidFields.length > 0
    ) {
        throw new AdminTaskActivityError(
            "Unsupported task activity filters were supplied.",
            {
                code:
                    "TASK_ACTIVITY_FILTERS_UNSUPPORTED",

                status:
                    400,

                details: {
                    invalidFields
                }
            }
        );
    }

    const filters = {};

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "taskCode"
        )
    ) {
        const taskCode =
            normalizeNullableString(
                value.taskCode
            );

        if (
            taskCode !== null
        ) {
            filters.taskCode =
                requireTaskCode(
                    taskCode
                );
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "actorAccountId"
        )
    ) {
        const accountId =
            normalizeNullableString(
                value.actorAccountId
            );

        if (
            accountId !== null
        ) {
            if (
                !UUID_PATTERN.test(
                    accountId
                )
            ) {
                throw new AdminTaskActivityError(
                    "The activity actor account ID is invalid.",
                    {
                        code:
                            "ACTOR_ACCOUNT_ID_INVALID",

                        status:
                            400
                    }
                );
            }

            filters.actorAccountId =
                accountId;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "eventType"
        )
    ) {
        const eventType =
            normalizeNullableString(
                value.eventType
            );

        if (
            eventType !== null
        ) {
            filters.eventType =
                eventType.toLowerCase();
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "createdAfter"
        )
    ) {
        const createdAfter =
            normalizeOptionalDate(
                value.createdAfter,
                "CREATED_AFTER_INVALID"
            );

        if (
            createdAfter !== null
        ) {
            filters.createdAfter =
                createdAfter;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "createdBefore"
        )
    ) {
        const createdBefore =
            normalizeOptionalDate(
                value.createdBefore,
                "CREATED_BEFORE_INVALID"
            );

        if (
            createdBefore !== null
        ) {
            filters.createdBefore =
                createdBefore;
        }
    }

    if (
        filters.createdAfter
        && filters.createdBefore
        && Date.parse(
            filters.createdAfter
        ) >
            Date.parse(
                filters.createdBefore
            )
    ) {
        throw new AdminTaskActivityError(
            "createdAfter cannot be later than createdBefore.",
            {
                code:
                    "TASK_ACTIVITY_DATE_RANGE_INVALID",

                status:
                    400
            }
        );
    }

    return filters;
}

/* =========================================================
LOAD AUTHORITATIVE TASK

Individual task history authorization uses the persisted
responsible_roles value.

The browser cannot supply or override the roles used for
this access decision.
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
        throw new AdminTaskActivityError(
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
INDIVIDUAL TASK EVENTS

Requires:
    TASKS_READ

Responsibility:
    owner
        -> may inspect any task

    database/security/ui
        -> must overlap task.responsible_roles

This does not grant access to the global Admin audit feed.
========================================================= */

export async function getAdminTaskEvents(
    request,
    env,
    {
        taskCode,
        limit = 50,
        offset = 0
    } = {}
) {
    /* -----------------------------------------------------
    INPUT
    ----------------------------------------------------- */

    const normalizedTaskCode =
        requireTaskCode(
            taskCode
        );

    const normalizedLimit =
        normalizeLimit(
            limit
        );

    const normalizedOffset =
        normalizeOffset(
            offset
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
    ----------------------------------------------------- */

    const task =
        await getAuthoritativeTask(
            env,
            normalizedTaskCode
        );

    /* -----------------------------------------------------
    TASKBOARD RESPONSIBILITY

    requireTaskResponsibility() loads the user's verified
    Taskboard role context and compares it against the
    persisted task assignment.

    The returned context is not otherwise needed because
    this operation is read-only.
    ----------------------------------------------------- */

    await requireTaskResponsibility(
        env,
        authorization,
        task.responsible_roles
    );

    /* -----------------------------------------------------
    TASK HISTORY
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.EVENTS,
        {
            p_task_code:
                normalizedTaskCode,

            p_limit:
                normalizedLimit,

            p_offset:
                normalizedOffset
        }
    );
}

/* =========================================================
GLOBAL ACTIVITY

Requires:
    AUDIT_READ

This is an administrative audit capability rather than an
assigned-task capability.

Taskboard responsibility filtering is intentionally NOT
applied here.
========================================================= */

export async function getAdminTaskActivity(
    request,
    env,
    {
        limit = 50,
        offset = 0
    } = {}
) {
    const normalizedLimit =
        normalizeLimit(
            limit
        );

    const normalizedOffset =
        normalizeOffset(
            offset
        );

    await authorizeTaskAuditRead(
        request,
        env
    );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.ACTIVITY,
        {
            p_limit:
                normalizedLimit,

            p_offset:
                normalizedOffset
        }
    );
}

/* =========================================================
FILTERED GLOBAL ACTIVITY

Requires:
    AUDIT_READ

Supported filters:
    taskCode
    actorAccountId
    eventType
    createdAfter
    createdBefore

Taskboard responsibility filtering is intentionally NOT
applied because AUDIT_READ represents global audit access.
========================================================= */

export async function listAdminTaskActivity(
    request,
    env,
    {
        filters = {},
        limit = 50,
        offset = 0
    } = {}
) {
    const normalizedFilters =
        normalizeActivityFilters(
            filters
        );

    const normalizedLimit =
        normalizeLimit(
            limit
        );

    const normalizedOffset =
        normalizeOffset(
            offset
        );

    await authorizeTaskAuditRead(
        request,
        env
    );

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.ACTIVITY_LIST,
        {
            p_filters:
                normalizedFilters,

            p_limit:
                normalizedLimit,

            p_offset:
                normalizedOffset
        }
    );
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskActivityError(
    error
) {
    return (
        error instanceof AdminTaskActivityError
        || error?.name ===
            "AdminTaskActivityError"
    );
}