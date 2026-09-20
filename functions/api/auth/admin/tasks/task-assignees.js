"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK ASSIGNEES API

File:
    functions/api/auth/admin/tasks/task-assignees.js

Route:
    GET /api/auth/admin/tasks/task-assignees

Purpose:
    HTTP boundary for retrieving authoritative Admin
    Taskboard assignment options and the authenticated
    user's verified Taskboard role context.

Description:
    - Requires TASKS_ASSIGN through the assignee service.
    - Requires active Taskboard membership through the
      assignee service.
    - Returns authoritative assignable Taskboard roles.
    - Returns the authenticated user's verified Taskboard
      responsibility roles.
    - Returns whether the authenticated user holds owner.
    - Accepts no query parameters.
    - Does not mutate task state.

Response:
{
    success: true,

    availableRoles: [
        "owner",
        "database",
        "security",
        "ui"
    ],

    accounts: [],

    userRoles: [
        ...
    ],

    isOwner: boolean
}

Security:
    - Authentication and Discord-backed operation
      permissions are enforced by the Admin service layer.
    - Taskboard responsibility roles are loaded
      server-side from the canonical role source.
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Provider-specific identifiers are not accepted from
      the client.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTaskAssignees
} from "../../../../services/supabase/admin/tasks/assignees.js";

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
        "AdminTaskAssigneesApiRequestError";

    error.code =
        code;

    error.status =
        status;

    error.details =
        details;

    return error;
}

/* =========================================================
QUERY VALIDATION

This endpoint accepts no query parameters.

Assignment context is derived entirely from the
authenticated account and authoritative server-side data.
========================================================= */

function validateQueryParameters(
    request
) {
    const url =
        new URL(
            request.url
        );

    const parameters =
        [
            ...new Set(
                [...url.searchParams.keys()]
            )
        ];

    if (
        parameters.length >
        0
    ) {
        throw createRequestError(
            "TASK_ASSIGNEES_QUERY_UNSUPPORTED",
            "This endpoint does not accept query parameters.",
            400,
            {
                invalidParameters:
                    parameters
            }
        );
    }
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

function getErrorCode(
    error
) {
    return (
        normalizeString(
            error?.code
        )
        || "ADMIN_TASK_ASSIGNEES_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return "The task assignee request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task assignee request could not be completed."
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
            "[ADMIN TASK ASSIGNEES API]",
            {
                name:
                    error?.name
                    ?? null,

                code,

                message:
                    error?.message
                    ?? null,

                databaseCode:
                    error?.databaseCode
                    ?? null,

                details:
                    error?.details
                    ?? null,

                hint:
                    error?.hint
                    ?? null
            }
        );
    }

    const responseBody = {
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
        responseBody.details =
            error.details;
    }

    return jsonResponse(
        responseBody,
        status
    );
}

/* =========================================================
GET /api/auth/admin/tasks/task-assignees

Authorization and Taskboard membership are performed by
getAdminTaskAssignees().

No account ID, permissions, Discord roles, or Taskboard
roles are supplied by the browser.
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

        validateQueryParameters(
            request
        );

        const result =
            await getAdminTaskAssignees(
                request,
                env
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