"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK LIST SERVICE

File:
    functions/services/supabase/admin/tasks/list.js

Purpose:
    Securely retrieves filtered Admin task-board records
    through the Supabase admin_list_tasks RPC.

Description:
    - Requires TASKS_READ permission.
    - Validates and normalizes supported task filters.
    - Supports bounded pagination.
    - Keeps deleted-task inclusion explicit.
    - Calls the shared Admin task RPC transport.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Authorization is derived server-side.
    - Arbitrary filter fields are rejected.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead,
    authorizeTaskDelete
} from "../../../admin/permissions.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
ERROR
========================================================= */

export class AdminTaskListError extends Error {
    constructor(
        message,
        {
            code = "ADMIN_TASK_LIST_ERROR",
            status = 400,
            details = null
        } = {}
    ) {
        super(message);

        this.name = "AdminTaskListError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

/* =========================================================
CONSTANTS
========================================================= */

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_FILTER_FIELDS =
    new Set([
        "search",
        "priority",
        "timeline_days",
        "responsibleRole",
        "lifecycle",
        "includeDeleted"
    ]);

const ALLOWED_LIFECYCLE_VALUES =
    new Set([
        "active",
        "completed",
        "shelved",
        "archived",
        "deleted",
        "all"
    ]);

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(value) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

function normalizeNullableString(value) {
    if (
        value === null
        || value === undefined
    ) {
        return null;
    }

    const normalized =
        normalizeString(value);

    return normalized || null;
}

/* =========================================================
FILTER OBJECT
========================================================= */

function normalizeFilters(value) {
    if (
        value === null
        || value === undefined
    ) {
        return {};
    }

    if (
        typeof value !== "object"
        || Array.isArray(value)
    ) {
        throw new AdminTaskListError(
            "Task filters must be an object.",
            {
                code: "TASK_FILTERS_INVALID",
                status: 400
            }
        );
    }

    const invalidFields =
        Object.keys(value)
            .filter(
                key =>
                    !ALLOWED_FILTER_FIELDS.has(key)
            );

    if (invalidFields.length > 0) {
        throw new AdminTaskListError(
            "Unsupported task filters were supplied.",
            {
                code: "TASK_FILTERS_UNSUPPORTED",
                status: 400,
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
            "search"
        )
    ) {
        const search =
            normalizeNullableString(
                value.search
            );

        if (search !== null) {
            filters.search = search;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "priority"
        )
    ) {
        const priority =
            normalizeNullableString(
                value.priority
            );

        if (priority !== null) {
            filters.priority = priority;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "timeline_days"
        )
    ) {
        const timeline_days =
            normalizeNullableString(typeof value.timeline_days === "number" ? String(value.timeline_days) : value.timeline_days);

        if (timeline_days !== null) {
            const days = Number(timeline_days);
            if (!Number.isSafeInteger(days) || days < 3 || days > 30) throw new AdminTaskListError("Invalid timeline days.", { code: "TASK_TIMELINE_INVALID" });
            filters.timeline_days = days;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "responsibleRole"
        )
    ) {
        const responsibleRole =
            normalizeNullableString(
                value.responsibleRole
            );

        if (responsibleRole !== null) {
            filters.responsibleRole =
                responsibleRole;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "lifecycle"
        )
    ) {
        const lifecycle =
            normalizeString(
                value.lifecycle
            )
                .toLowerCase();

        if (
            lifecycle
            && !ALLOWED_LIFECYCLE_VALUES.has(
                lifecycle
            )
        ) {
            throw new AdminTaskListError(
                "The task lifecycle filter is invalid.",
                {
                    code:
                        "TASK_LIFECYCLE_FILTER_INVALID",

                    status:
                        400
                }
            );
        }

        if (lifecycle) {
            filters.lifecycle =
                lifecycle;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "includeDeleted"
        )
    ) {
        filters.includeDeleted =
            normalizeBoolean(
                value.includeDeleted
            );
    }

    return filters;
}

/* =========================================================
BOOLEAN
========================================================= */

function normalizeBoolean(value) {
    if (
        value === true
        || value === "true"
        || value === 1
        || value === "1"
    ) {
        return true;
    }

    return false;
}

/* =========================================================
PAGINATION
========================================================= */

function normalizeLimit(value) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return 50;
    }

    const limit =
        Number(value);

    if (
        !Number.isSafeInteger(limit)
    ) {
        throw new AdminTaskListError(
            "Task list limit is invalid.",
            {
                code:
                    "TASK_LIST_LIMIT_INVALID",

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

function normalizeOffset(value) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return 0;
    }

    const offset =
        Number(value);

    if (
        !Number.isSafeInteger(offset)
        || offset < 0
    ) {
        throw new AdminTaskListError(
            "Task list offset is invalid.",
            {
                code:
                    "TASK_LIST_OFFSET_INVALID",

                status:
                    400
            }
        );
    }

    return offset;
}

/* =========================================================
LIST TASKS

Expected caller input:
{
    filters?: {
        search?,
        priority?,
        timeline_days?,
        responsibleRole?,

        lifecycle?,
        includeDeleted?
    },
    limit?: 50,
    offset?: 0
}

Important:
    includeDeleted remains explicit.

    If deleted-task browsing should require TASKS_DELETE or
    AUDIT_READ, enforce that rule at the API endpoint or
    extend this service before client rollout.
========================================================= */

export async function listAdminTasks(
    request,
    env,
    {
        filters = {},
        limit = 50,
        offset = 0
    } = {}
) {
    const normalizedFilters =
        normalizeFilters(
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

    await authorizeTaskRead(
        request,
        env
    );

    // Match the single-task endpoint: deleted records require delete permission.
    if (normalizedFilters.includeDeleted === true) {
        await authorizeTaskDelete(request, env);
    }

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.LIST,
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

export function isAdminTaskListError(
    error
) {
    return (
        error instanceof
            AdminTaskListError
        || error?.name ===
            "AdminTaskListError"
    );
}