"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK EVENTS API

File:
    functions/api/auth/admin/tasks/[taskCode]/events.js

Route:
    GET /api/auth/admin/tasks/:taskCode/events

Purpose:
    HTTP boundary for retrieving the event/audit history of
    one Admin task-board record.

Description:
    - Reads the task code from the dynamic route.
    - Supports bounded pagination.
    - Requires TASKS_READ through the task activity service.
    - Returns the authoritative task-event history from
      Supabase.
    - Does not mutate task state.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the Admin service layer.
    - Browser-submitted permissions are never trusted.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTaskEvents
} from "../../../../../services/supabase/admin/tasks/activity.js";

/* =========================================================
CONSTANTS
========================================================= */

const TASK_CODE_PATTERN =
    /^TASK-[A-HJ-NP-Z2-9]{6}$/;

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
        "AdminTaskEventsApiRequestError";

    error.code =
        code;

    error.status =
        status;

    error.details =
        details;

    return error;
}

/* =========================================================
TASK CODE
========================================================= */

function getTaskCode(
    context
) {
    const taskCode =
        normalizeString(
            context?.params?.taskCode
        ).toUpperCase();

    if (
        !TASK_CODE_PATTERN.test(
            taskCode
        )
    ) {
        throw createRequestError(
            "TASK_CODE_INVALID",
            "A valid task code is required.",
            400
        );
    }

    return taskCode;
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
            "TASK_EVENTS_LIMIT_INVALID",
            "Task event limit must be a positive integer.",
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
            "TASK_EVENTS_OFFSET_INVALID",
            "Task event offset must be a non-negative integer.",
            400
        );
    }

    return offset;
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
        || "ADMIN_TASK_EVENTS_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return "The task event request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task event request could not be completed."
    );
}

/* =========================================================
ERROR RESPONSE
========================================================= */

function handleApiError(
    error
) {
    const status =
        getErrorStatus(error);

    const code =
        getErrorCode(error);

    if (
        status >= 500
    ) {
        console.error(
            "[ADMIN TASK EVENTS API]",
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
GET /api/auth/admin/tasks/:taskCode/events

Query Parameters:
    limit
    offset
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

        const taskCode =
            getTaskCode(
                context
            );

        const url =
            new URL(
                request.url
            );

        const limit =
            parseLimit(
                url.searchParams.get(
                    "limit"
                )
            );

        const offset =
            parseOffset(
                url.searchParams.get(
                    "offset"
                )
            );

        const result =
            await getAdminTaskEvents(
                request,
                env,
                {
                    taskCode,
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