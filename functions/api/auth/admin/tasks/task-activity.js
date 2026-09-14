"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK ACTIVITY API

File:
    functions/api/auth/admin/tasks/task-activity.js

Routes:
    GET /api/auth/admin/tasks/task-activity

Purpose:
    HTTP boundary for retrieving global Admin task-board
    activity and audit history.

Description:
    - Requires AUDIT_READ through the task activity service.
    - Supports bounded pagination.
    - Supports optional activity filters.
    - Uses the authoritative Supabase task activity RPCs.
    - Does not mutate task state.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the Admin service layer.
    - Browser-submitted permissions are never trusted.
    - Global audit data is not exposed through ordinary
      TASKS_READ access.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTaskActivity,
    listAdminTaskActivity
} from "../../../../services/supabase/admin/tasks/activity.js";

/* =========================================================
CONSTANTS
========================================================= */

const JSON_HEADERS =
    Object.freeze({
        "Content-Type":
            "application/json; charset=utf-8",

        "Cache-Control":
            "no-store"
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
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200,
    additionalHeaders = {}
) {
    return new Response(
        JSON.stringify(body),
        {
            status,

            headers: {
                ...JSON_HEADERS,
                ...additionalHeaders
            }
        }
    );
}

/* =========================================================
REQUEST ERROR
========================================================= */

function createRequestError(
    code,
    message,
    status = 400,
    details = null
) {
    const error =
        new Error(message);

    error.name =
        "AdminTaskActivityApiRequestError";

    error.code =
        code;

    error.status =
        status;

    error.details =
        details;

    return error;
}

/* =========================================================
PAGINATION
========================================================= */

function parseLimit(
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
        || limit < 1
    ) {
        throw createRequestError(
            "TASK_ACTIVITY_LIMIT_INVALID",
            "Task activity limit must be a positive integer.",
            400
        );
    }

    return Math.min(
        limit,
        200
    );
}

function parseOffset(
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
        throw createRequestError(
            "TASK_ACTIVITY_OFFSET_INVALID",
            "Task activity offset must be a non-negative integer.",
            400
        );
    }

    return offset;
}

/* =========================================================
FILTER COLLECTION
========================================================= */

function getActivityFilters(
    searchParams
) {
    const filters = {};

    const supportedFilters = [
        "taskCode",
        "actorAccountId",
        "eventType",
        "createdAfter",
        "createdBefore"
    ];

    for (
        const filterName
        of supportedFilters
    ) {
        if (
            searchParams.has(
                filterName
            )
        ) {
            filters[filterName] =
                searchParams.get(
                    filterName
                );
        }
    }

    return filters;
}

/* =========================================================
ERROR HELPERS
========================================================= */

function getErrorStatus(
    error
) {
    const status =
        Number(
            error?.status
        );

    if (
        Number.isInteger(status)
        && status >= 400
        && status <= 599
    ) {
        return status;
    }

    return 500;
}

function getErrorCode(
    error
) {
    return (
        normalizeString(
            error?.code
        )
        || "ADMIN_TASK_ACTIVITY_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return "The task activity request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task activity request could not be completed."
    );
}

/* =========================================================
ERROR RESPONSE
========================================================= */

function handleApiError(
    error
) {
    const status =
        getErrorStatus(
            error
        );

    const code =
        getErrorCode(
            error
        );

    if (
        status >= 500
    ) {
        console.error(
            "[ADMIN TASK ACTIVITY API]",
            {
                name:
                    error?.name
                    ?? null,

                code,

                message:
                    error?.message
                    ?? null,

                details:
                    error?.details
                    ?? null
            }
        );
    }

    const body = {
        success:
            false,

        error:
            code,

        message:
            getErrorMessage(
                error,
                status
            )
    };

    if (
        status < 500
        && error?.details !== undefined
        && error?.details !== null
    ) {
        body.details =
            error.details;
    }

    return jsonResponse(
        body,
        status
    );
}

/* =========================================================
GET /api/auth/admin/tasks/task-activity

Query Parameters:
    taskCode
    actorAccountId
    eventType
    createdAfter
    createdBefore
    limit
    offset

Behavior:
    No activity filters:
        getAdminTaskActivity()

    One or more activity filters:
        listAdminTaskActivity()

Both require:
    AUDIT_READ
========================================================= */

export async function onRequestGet(
    context
) {
    try {
        const {
            request,
            env
        } =
            context;

        const url =
            new URL(
                request.url
            );

        const searchParams =
            url.searchParams;

        const limit =
            parseLimit(
                searchParams.get(
                    "limit"
                )
            );

        const offset =
            parseOffset(
                searchParams.get(
                    "offset"
                )
            );

        const filters =
            getActivityFilters(
                searchParams
            );

        const hasFilters =
            Object.keys(
                filters
            ).length > 0;

        const result =
            hasFilters
                ? await listAdminTaskActivity(
                    request,
                    env,
                    {
                        filters,
                        limit,
                        offset
                    }
                )
                : await getAdminTaskActivity(
                    request,
                    env,
                    {
                        limit,
                        offset
                    }
                );

        return jsonResponse(
            result,
            200
        );
    }
    catch (
        error
    ) {
        return handleApiError(
            error
        );
    }
}

/* =========================================================
METHOD FALLBACK
========================================================= */

export async function onRequest(
    context
) {
    const method =
        normalizeString(
            context?.request?.method
        ).toUpperCase();

    if (
        method === "GET"
    ) {
        return onRequestGet(
            context
        );
    }

    return jsonResponse(
        {
            success:
                false,

            error:
                "METHOD_NOT_ALLOWED",

            message:
                "Method not allowed."
        },
        405,
        {
            Allow:
                "GET"
        }
    );
}