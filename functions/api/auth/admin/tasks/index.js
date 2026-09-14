"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASKS API

File:
    functions/api/auth/admin/tasks/index.js

Routes:
    GET  /api/auth/admin/tasks
    POST /api/auth/admin/tasks

Purpose:
    HTTP boundary for Admin task-board listing and task
    creation.

Description:
    GET:
        - Reads supported task filters from query parameters.
        - Retrieves authorized task-board records.

    POST:
        - Accepts a new task payload.
        - Creates the task through the secured task service.

Security:
    - Authentication and Discord-backed permissions are
      handled by the Admin service layer.
    - Browser-submitted permissions are never trusted.
    - Browser-submitted actor IDs are never accepted.
    - Supabase service-role credentials remain server-side.
    - Assignment permission is enforced automatically by
      the task creation service.
========================================================= */

import {
    listAdminTasks
} from "../../../../services/supabase/admin/tasks/list.js";

import {
    createAdminTask
} from "../../../../services/supabase/admin/tasks/create.js";

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
    return typeof value ===
        "string"
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
        JSON.stringify(
            body
        ),
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
        new Error(
            message
        );

    error.name =
        "AdminTaskApiRequestError";

    error.code =
        code;

    error.status =
        status;

    error.details =
        details;

    return error;
}

/* =========================================================
BOOLEAN QUERY
========================================================= */

function parseBooleanQuery(
    value
) {
    const normalized =
        normalizeString(
            value
        )
            .toLowerCase();

    if (
        normalized === "true"
        || normalized === "1"
    ) {
        return true;
    }

    if (
        normalized === "false"
        || normalized === "0"
        || normalized === ""
    ) {
        return false;
    }

    throw createRequestError(
        "QUERY_BOOLEAN_INVALID",
        "A boolean query parameter is invalid.",
        400
    );
}

/* =========================================================
QUERY FILTER
========================================================= */

function copyQueryParameter(
    target,
    searchParams,
    key
) {
    if (
        !searchParams.has(
            key
        )
    ) {
        return;
    }

    target[key] =
        searchParams.get(
            key
        );
}

/* =========================================================
LIST INPUT
========================================================= */

function getListInput(
    request
) {
    const url =
        new URL(
            request.url
        );

    const searchParams =
        url.searchParams;

    const filters = {};

    copyQueryParameter(
        filters,
        searchParams,
        "search"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "priority"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "timeline"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "assignedRole"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "assignedAccountId"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "lifecycle"
    );

    if (
        searchParams.has(
            "includeDeleted"
        )
    ) {
        filters.includeDeleted =
            parseBooleanQuery(
                searchParams.get(
                    "includeDeleted"
                )
            );
    }

    return {
        filters,

        limit:
            searchParams.get(
                "limit"
            ),

        offset:
            searchParams.get(
                "offset"
            )
    };
}

/* =========================================================
JSON BODY
========================================================= */

async function readJsonBody(
    request
) {
    const contentType =
        normalizeString(
            request.headers.get(
                "content-type"
            )
        )
            .toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        throw createRequestError(
            "CONTENT_TYPE_INVALID",
            "Request body must use application/json.",
            415
        );
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        throw createRequestError(
            "REQUEST_JSON_INVALID",
            "Request body contains invalid JSON.",
            400
        );
    }

    if (
        !body
        || typeof body !==
            "object"
        || Array.isArray(
            body
        )
    ) {
        throw createRequestError(
            "REQUEST_BODY_INVALID",
            "Request body must be a JSON object.",
            400
        );
    }

    return body;
}

/* =========================================================
ERROR STATUS
========================================================= */

function getErrorStatus(
    error
) {
    const status =
        Number(
            error?.status
        );

    if (
        Number.isInteger(
            status
        )
        && status >= 400
        && status <= 599
    ) {
        return status;
    }

    return 500;
}

/* =========================================================
ERROR CODE
========================================================= */

function getErrorCode(
    error
) {
    return (
        normalizeString(
            error?.code
        )
        || "ADMIN_TASK_REQUEST_FAILED"
    );
}

/* =========================================================
ERROR MESSAGE
========================================================= */

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return "The task request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task request could not be completed."
    );
}

/* =========================================================
SAFE ERROR RESPONSE
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
            "[ADMIN TASKS API]",
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
        && error?.details !==
            undefined
        && error?.details !==
            null
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
GET /api/auth/admin/tasks
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

        const input =
            getListInput(
                request
            );

        const result =
            await listAdminTasks(
                request,
                env,
                input
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
POST /api/auth/admin/tasks

Expected Body:
{
    "task": {
        "title": "...",
        "description": "...",
        "priority": "...",
        "timeline": "...",
        "assigned_role": "...",
        "assigned_account_id": "...",
        "due_at": "..."
    }
}

actor_account_id is intentionally not accepted.
========================================================= */

export async function onRequestPost(
    context
) {
    try {
        const {
            request,
            env
        } =
            context;

        const body =
            await readJsonBody(
                request
            );

        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                "task"
            )
        ) {
            throw createRequestError(
                "TASK_PAYLOAD_REQUIRED",
                "A task object is required.",
                400
            );
        }

        const result =
            await createAdminTask(
                request,
                env,
                body.task
            );

        return jsonResponse(
            result,
            201
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
        )
            .toUpperCase();

    switch (
        method
    ) {
        case "GET":
            return onRequestGet(
                context
            );

        case "POST":
            return onRequestPost(
                context
            );

        default:
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
                        "GET, POST"
                }
            );
    }
}