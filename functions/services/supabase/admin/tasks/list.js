"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK LIST SERVICE

File:
    functions/services/supabase/admin/tasks/list.js

Purpose:
    Securely retrieves filtered Admin Taskboard records
    through the Supabase admin_list_tasks RPC.

Description:
    - Requires TASKS_READ permission.
    - Requires active Taskboard membership.
    - Loads verified Taskboard roles server-side.
    - Applies responsibility authorization in PostgreSQL
      before count, ordering, limit, and offset.
    - owner may list all matching tasks.
    - database/security/ui may list tasks whose
      responsible_roles overlap their verified roles.
    - Supports optional browser filters for narrowing results.
    - Supports bounded pagination.
    - Requires TASKS_DELETE for deleted-task visibility.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted for
      authorization.
    - responsibleRole is only a narrowing filter.
    - Authorized roles come from identity.account_roles.
    - Authorization scope is enforced before pagination.
    - Arbitrary filter fields are rejected.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead,
    authorizeTaskDelete
} from "../../../admin/permissions.js";

import {
    requireTaskboardMembership
} from "../../../admin/taskboard_roles.js";

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

const ALLOWED_TASKBOARD_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
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
        normalizeString(value);

    return normalized || null;
}

function normalizeBoolean(
    value
) {
    return (
        value === true
        || value === "true"
        || value === 1
        || value === "1"
    );
}

function normalizeAuthorizedRoles(
    roleContext
) {
    const roles =
        Array.isArray(roleContext?.roles)
            ? roleContext.roles
            : [];

    return [
        ...new Set(
            roles
                .map(
                    role =>
                        normalizeString(role)
                            .toLowerCase()
                )
                .filter(
                    role =>
                        ALLOWED_TASKBOARD_ROLES.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
FILTER OBJECT
========================================================= */

function normalizeFilters(
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

    if (
        invalidFields.length > 0
    ) {
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

    /* -----------------------------------------------------
    SEARCH
    ----------------------------------------------------- */

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

        if (
            search !== null
        ) {
            filters.search =
                search;
        }
    }

    /* -----------------------------------------------------
    PRIORITY
    ----------------------------------------------------- */

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

        if (
            priority !== null
        ) {
            filters.priority =
                priority;
        }
    }

    /* -----------------------------------------------------
    TIMELINE
    ----------------------------------------------------- */

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "timeline_days"
        )
    ) {
        const timelineDays =
            normalizeNullableString(
                typeof value.timeline_days === "number"
                    ? String(value.timeline_days)
                    : value.timeline_days
            );

        if (
            timelineDays !== null
        ) {
            const days =
                Number(timelineDays);

            if (
                !Number.isSafeInteger(days)
                || days < 3
                || days > 30
            ) {
                throw new AdminTaskListError(
                    "Invalid timeline days.",
                    {
                        code: "TASK_TIMELINE_INVALID",
                        status: 400
                    }
                );
            }

            filters.timeline_days =
                days;
        }
    }

    /* -----------------------------------------------------
    RESPONSIBLE ROLE

    This is only a narrowing filter. It never establishes
    authorization.
    ----------------------------------------------------- */

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "responsibleRole"
        )
    ) {
        const normalizedRole =
            normalizeNullableString(
                value.responsibleRole
            );

        const responsibleRole =
            normalizedRole === null
                ? null
                : normalizedRole.toLowerCase();

        if (
            responsibleRole !== null
            && !ALLOWED_TASKBOARD_ROLES.has(
                responsibleRole
            )
        ) {
            throw new AdminTaskListError(
                "The responsible role filter is invalid.",
                {
                    code: "TASK_ROLES_INVALID",
                    status: 400
                }
            );
        }

        if (
            responsibleRole !== null
        ) {
            filters.responsibleRole =
                responsibleRole;
        }
    }

    /* -----------------------------------------------------
    LIFECYCLE
    ----------------------------------------------------- */

    if (
        Object.prototype.hasOwnProperty.call(
            value,
            "lifecycle"
        )
    ) {
        const lifecycle =
            normalizeString(
                value.lifecycle
            ).toLowerCase();

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
                    status: 400
                }
            );
        }

        if (
            lifecycle
        ) {
            filters.lifecycle =
                lifecycle;
        }
    }

    /* -----------------------------------------------------
    INCLUDE DELETED
    ----------------------------------------------------- */

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
        Number(value);

    if (
        !Number.isSafeInteger(limit)
    ) {
        throw new AdminTaskListError(
            "Task list limit is invalid.",
            {
                code: "TASK_LIST_LIMIT_INVALID",
                status: 400
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
        Number(value);

    if (
        !Number.isSafeInteger(offset)
        || offset < 0
    ) {
        throw new AdminTaskListError(
            "Task list offset is invalid.",
            {
                code: "TASK_LIST_OFFSET_INVALID",
                status: 400
            }
        );
    }

    return offset;
}

/* =========================================================
LIST TASKS

Authorization sequence:

    TASKS_READ
        ↓
    TASKS_DELETE when deleted records are requested
        ↓
    active Taskboard membership
        ↓
    verified Taskboard role context
        ↓
    admin_list_tasks
        ↓
    database responsibility scope
        ↓
    filters/count/order/pagination
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

    /* -----------------------------------------------------
    OPERATION PERMISSION
    ----------------------------------------------------- */

    let authorization =
        await authorizeTaskRead(
            request,
            env
        );

    /* -----------------------------------------------------
    DELETED TASK VISIBILITY

    Deleted records require the stronger TASKS_DELETE
    permission.

    Use the authorization context returned by the stronger
    permission check for all subsequent role resolution.
    ----------------------------------------------------- */

    if (
        normalizedFilters.includeDeleted === true
    ) {
        authorization =
            await authorizeTaskDelete(
                request,
                env
            );
    }

    /* -----------------------------------------------------
    TASKBOARD MEMBERSHIP + VERIFIED ROLES

    requireTaskboardMembership() already resolves and
    returns the complete Taskboard role context.

    Do not make a second role RPC here.
    ----------------------------------------------------- */

    const roleContext =
        await requireTaskboardMembership(
            env,
            authorization
        );

    const authorizedRoles =
        normalizeAuthorizedRoles(
            roleContext
        );

    /*
     * This should already be guaranteed by
     * requireTaskboardMembership(), but keep the boundary
     * fail-closed if its contract ever changes.
     */
    if (
        authorizedRoles.length === 0
    ) {
        throw new AdminTaskListError(
            "An active Taskboard role is required.",
            {
                code: "TASKBOARD_ROLE_REQUIRED",
                status: 403
            }
        );
    }

    /* -----------------------------------------------------
    DATABASE QUERY

    p_authorized_roles comes exclusively from the
    server-verified role context above.

    responsibleRole inside p_filters is only an optional
    narrowing filter.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.LIST,
        {
            p_filters:
                normalizedFilters,

            p_limit:
                normalizedLimit,

            p_offset:
                normalizedOffset,

            p_authorized_roles:
                authorizedRoles
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
        error instanceof AdminTaskListError
        || error?.name === "AdminTaskListError"
    );
}