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
    task-board assignees and assignable roles.

Description:
    - Requires TASKS_ASSIGN through the assignee service.
    - Returns canonical BPD accounts eligible for task
      assignment.
    - Returns assignable application roles.
    - Does not mutate task state.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the Admin service layer.
    - Browser-submitted permissions are never trusted.
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
GET /api/auth/admin/tasks/task-assignees
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