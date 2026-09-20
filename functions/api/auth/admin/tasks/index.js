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
    HTTP boundary for Admin Taskboard listing and task
    creation.

Description:
    GET:
        - Reads supported task filters from query parameters.
        - Rejects unsupported query parameters.
        - Retrieves only tasks visible to the authenticated
          user's verified Taskboard roles.

    POST:
        - Accepts a new task payload.
        - Rejects server-owned task fields.
        - Creates the task through the secured task service.

Security:
    - Authentication and Discord-backed permissions are
      handled by the Admin service layer.
    - Taskboard responsibility is enforced by the task
      service layer.
    - Browser-submitted permissions are never trusted.
    - Browser-submitted actor IDs are never accepted.
    - Browser-submitted lifecycle/server fields are rejected.
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

const ALLOWED_LIST_QUERY_PARAMETERS =
    new Set([
        "search",
        "priority",
        "timeline_days",
        "responsibleRole",
        "lifecycle",
        "includeDeleted",
        "limit",
        "offset"
    ]);

const SERVER_OWNED_TASK_FIELDS =
    new Set([
        "id",
        "task_code",
        "taskCode",

        "status",
        "previous_status",

        "creator_account_id",
        "creatorAccountId",

        "created_by",
        "createdBy",

        "updated_by",
        "updatedBy",

        "actor_account_id",
        "actorAccountId",

        "created_at",
        "createdAt",

        "updated_at",
        "updatedAt",

        "completed_at",
        "completedAt",

        "shelved_until",
        "shelvedUntil",

        "shelved_reason",
        "shelvedReason",

        "shelved_by",
        "shelvedBy",

        "archived_at",
        "archivedAt",

        "archived_reason",
        "archivedReason",

        "archived_by",
        "archivedBy",

        "deleted_at",
        "deletedAt",

        "deleted_reason",
        "deletedReason",

        "deleted_by",
        "deletedBy",

        "deadline",
        "version"
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
        ).toLowerCase();

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
QUERY VALIDATION
========================================================= */

function validateListQueryParameters(
    searchParams
) {
    const invalidParameters =
        [
            ...new Set(
                [...searchParams.keys()]
                    .filter(
                        key =>
                            !ALLOWED_LIST_QUERY_PARAMETERS.has(
                                key
                            )
                    )
            )
        ];

    if (
        invalidParameters.length >
        0
    ) {
        throw createRequestError(
            "TASK_FILTERS_UNSUPPORTED",
            "Unsupported task query parameters were supplied.",
            400,
            {
                invalidParameters
            }
        );
    }
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

    validateListQueryParameters(
        searchParams
    );

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
        "timeline_days"
    );

    copyQueryParameter(
        filters,
        searchParams,
        "responsibleRole"
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
        ).toLowerCase();

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
        || typeof body !== "object"
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
CREATE BODY

Only the top-level "task" field is accepted.

The task service remains authoritative for validating the
supported mutable task fields.
========================================================= */

function getCreateTaskPayload(
    body
) {
    const topLevelFields =
        Object.keys(
            body
        );

    const invalidTopLevelFields =
        topLevelFields.filter(
            field =>
                field !== "task"
        );

    if (
        invalidTopLevelFields.length >
        0
    ) {
        throw createRequestError(
            "TASK_REQUEST_FIELDS_UNSUPPORTED",
            "Unsupported request fields were supplied.",
            400,
            {
                invalidFields:
                    invalidTopLevelFields
            }
        );
    }

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

    if (
        !body.task
        || typeof body.task !== "object"
        || Array.isArray(
            body.task
        )
    ) {
        throw createRequestError(
            "TASK_PAYLOAD_INVALID",
            "The task payload must be a JSON object.",
            400
        );
    }

    const serverOwnedFields =
        Object.keys(
            body.task
        )
            .filter(
                field =>
                    SERVER_OWNED_TASK_FIELDS.has(
                        field
                    )
            );

    if (
        serverOwnedFields.length >
        0
    ) {
        throw createRequestError(
            "TASK_SERVER_FIELD_NOT_ALLOWED",
            "One or more server-controlled task fields were supplied.",
            400,
            {
                fields:
                    serverOwnedFields
            }
        );
    }

    return body.task;
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
GET /api/auth/admin/tasks

Supported Query Parameters:
    search
    priority
    timeline_days
    responsibleRole
    lifecycle
    includeDeleted
    limit
    offset

Task visibility is enforced by listAdminTasks() using the
authenticated account's verified Taskboard roles.
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
        "body": "...",
        "priority": "Low | Medium | High | Critical",
        "timeline_days": 14,
        "responsible_roles": [
            "database",
            "security"
        ]
    }
}

Notes:
    - deadline is calculated server-side.
    - status is established server-side.
    - task_code is generated server-side.
    - version is established server-side.
    - actor/creator identity is derived server-side.
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

        const task =
            getCreateTaskPayload(
                body
            );

        const result =
            await createAdminTask(
                request,
                env,
                task
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
        ).toUpperCase();

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