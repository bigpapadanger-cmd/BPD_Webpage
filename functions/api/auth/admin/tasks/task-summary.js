"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK SUMMARY API

File:
    functions/api/auth/admin/tasks/task-summary.js

Route:
    GET /api/auth/admin/tasks/task-summary

Purpose:
    HTTP boundary for retrieving authoritative, role-scoped
    Admin Taskboard summary statistics.

Description:
    - Requires TASKS_READ through the task summary service.
    - Requires active Taskboard membership through the
      task summary service.
    - Returns only statistics visible to the authenticated
      user's verified Taskboard roles.
    - owner receives statistics across all tasks.
    - database/security/ui receive statistics for tasks
      assigned to at least one of their verified roles.
    - Does not calculate task totals in the browser.
    - Does not mutate task state.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the Admin service layer.
    - Taskboard roles are resolved server-side.
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never accepted.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTaskSummary
} from "../../../../services/supabase/admin/tasks/summary.js";

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
        || "ADMIN_TASK_SUMMARY_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return "The task summary request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task summary request could not be completed."
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
            "[ADMIN TASK SUMMARY API]",
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
GET /api/auth/admin/tasks/task-summary

Authorization and role scoping are performed by
getAdminTaskSummary().

The browser supplies no account ID, permissions, or
Taskboard roles.
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
            await getAdminTaskSummary(
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