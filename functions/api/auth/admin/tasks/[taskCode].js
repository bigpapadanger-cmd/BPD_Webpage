"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN SINGLE TASK API

File:
    functions/api/auth/admin/tasks/[taskCode].js

Routes:
    GET   /api/auth/admin/tasks/:taskCode
    PATCH /api/auth/admin/tasks/:taskCode

Purpose:
    HTTP boundary for retrieving and updating one Admin
    task-board record.

Description:
    GET:
        - Retrieves one task by human-readable task code.
        - Deleted tasks are hidden by default.
        - Explicit deleted-task access requires elevated
          delete permission.

    PATCH:
        - Updates supported mutable task fields.
        - Requires optimistic concurrency through
          expectedVersion.
        - Assignment changes automatically require
          TASKS_ASSIGN in addition to TASKS_UPDATE.

Security:
    - Authentication and Discord-backed authorization occur
      in the Admin permission/service layers.
    - actor_account_id is never accepted from the browser.
    - Client role/permission claims are never trusted.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTask
} from "../../../../services/supabase/admin/tasks/get.js";

import {
    updateAdminTask
} from "../../../../services/supabase/admin/tasks/update.js";

import {
    authorizeTaskDelete
} from "../../../../services/admin/permissions.js";

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
TASK CODE
========================================================= */

function getTaskCode(
    context
) {
    const taskCode =
        normalizeString(
            context?.params?.taskCode
        )
            .toUpperCase();

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
ERROR RESPONSE
========================================================= */

function getErrorStatus(
    error
) {
    const status =
        Number(
            error?.status
        );

    return (
        Number.isInteger(
            status
        )
        && status >= 400
        && status <= 599
    )
        ? status
        : 500;
}

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
            "[ADMIN SINGLE TASK API]",
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
GET /api/auth/admin/tasks/:taskCode

Optional Query:
    includeDeleted=true

Security:
    Normal task access:
        TASKS_READ

    includeDeleted=true:
        TASKS_DELETE
        + TASKS_READ through getAdminTask()

This intentionally prevents normal Moderator/League Staff
accounts from retrieving deleted records.
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

        let includeDeleted =
            false;

        if (
            url.searchParams.has(
                "includeDeleted"
            )
        ) {
            includeDeleted =
                parseBooleanQuery(
                    url.searchParams.get(
                        "includeDeleted"
                    )
                );
        }

        if (
            includeDeleted ===
            true
        ) {
            /*
             * Deleted-task visibility is intentionally more
             * privileged than ordinary task reads.
             */
            await authorizeTaskDelete(
                request,
                env
            );
        }

        const result =
            await getAdminTask(
                request,
                env,
                {
                    taskCode,
                    includeDeleted
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
PATCH /api/auth/admin/tasks/:taskCode

Expected Body:
{
    "expectedVersion": 4,
    "changes": {
        "title": "...",
        "description": "...",
        "priority": "...",
        "timeline": "...",
        "assigned_role": "...",
        "assigned_account_id": "..."
    }
}

Important:
    - taskCode comes from the route.
    - actor_account_id is never accepted.
    - lifecycle timestamps cannot be changed here.
========================================================= */

export async function onRequestPatch(
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

        const body =
            await readJsonBody(
                request
            );

        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                "expectedVersion"
            )
        ) {
            throw createRequestError(
                "TASK_VERSION_REQUIRED",
                "expectedVersion is required.",
                400
            );
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                "changes"
            )
        ) {
            throw createRequestError(
                "TASK_CHANGES_REQUIRED",
                "A changes object is required.",
                400
            );
        }

        /*
         * Explicitly reject authoritative/server-owned actor
         * fields if somebody attempts to submit them at the
         * HTTP boundary.
         */
        if (
            Object.prototype.hasOwnProperty.call(
                body,
                "actor_account_id"
            )
            || Object.prototype.hasOwnProperty.call(
                body,
                "actorAccountId"
            )
        ) {
            throw createRequestError(
                "TASK_ACTOR_NOT_ALLOWED",
                "Task actor information is determined by the server.",
                400
            );
        }

        const result =
            await updateAdminTask(
                request,
                env,
                {
                    taskCode,

                    expectedVersion:
                        body.expectedVersion,

                    changes:
                        body.changes
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
        )
            .toUpperCase();

    switch (
        method
    ) {
        case "GET":
            return onRequestGet(
                context
            );

        case "PATCH":
            return onRequestPatch(
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
                        "GET, PATCH"
                }
            );
    }
}