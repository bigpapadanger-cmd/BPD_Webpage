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
    Taskboard record.

Description:
    GET:
        - Retrieves one task by human-readable task code.
        - Deleted tasks are hidden by default.
        - Explicit deleted-task access is delegated to the
          secured task service.

    PATCH:
        - Updates supported mutable task fields.
        - Requires optimistic concurrency through
          expectedVersion.
        - Assignment changes automatically require
          TASKS_ASSIGN in addition to TASKS_UPDATE.
        - Task responsibility is checked against the
          authoritative persisted assignment before update.

Security:
    - Authentication and Discord-backed authorization occur
      in the Admin permission/service layers.
    - Taskboard responsibility is enforced by the task
      service layer.
    - actor_account_id is never accepted from the browser.
    - Client role/permission claims are never trusted.
    - Server-owned task fields are not accepted.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTask
} from "../../../../services/supabase/admin/tasks/get.js";

import {
    updateAdminTask
} from "../../../../services/supabase/admin/tasks/update.js";

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

const ALLOWED_PATCH_TOP_LEVEL_FIELDS =
    new Set([
        "expectedVersion",
        "changes"
    ]);

const SERVER_OWNED_CHANGE_FIELDS =
    new Set([
        "id",

        "task_code",
        "taskCode",

        "status",
        "previous_status",
        "previousStatus",

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
GET QUERY

Only:
    includeDeleted

is supported for this endpoint.
========================================================= */

function getIncludeDeleted(
    request
) {
    const url =
        new URL(
            request.url
        );

    const searchParams =
        url.searchParams;

    const invalidParameters =
        [
            ...new Set(
                [...searchParams.keys()]
                    .filter(
                        key =>
                            key !==
                            "includeDeleted"
                    )
            )
        ];

    if (
        invalidParameters.length >
        0
    ) {
        throw createRequestError(
            "TASK_QUERY_UNSUPPORTED",
            "Unsupported task query parameters were supplied.",
            400,
            {
                invalidParameters
            }
        );
    }

    if (
        !searchParams.has(
            "includeDeleted"
        )
    ) {
        return false;
    }

    return parseBooleanQuery(
        searchParams.get(
            "includeDeleted"
        )
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
PATCH BODY

Only:
{
    expectedVersion,
    changes
}

is accepted at the top level.

The update service remains authoritative for validating
supported mutable task fields.
========================================================= */

function getPatchInput(
    body
) {
    const invalidTopLevelFields =
        Object.keys(
            body
        )
            .filter(
                field =>
                    !ALLOWED_PATCH_TOP_LEVEL_FIELDS.has(
                        field
                    )
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

    if (
        !body.changes
        || typeof body.changes !== "object"
        || Array.isArray(
            body.changes
        )
    ) {
        throw createRequestError(
            "TASK_CHANGES_INVALID",
            "changes must be a JSON object.",
            400
        );
    }

    const serverOwnedFields =
        Object.keys(
            body.changes
        )
            .filter(
                field =>
                    SERVER_OWNED_CHANGE_FIELDS.has(
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

    return {
        expectedVersion:
            body.expectedVersion,

        changes:
            body.changes
    };
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
GET /api/auth/admin/tasks/:taskCode

Optional Query:
    includeDeleted=true

Authorization is performed by getAdminTask():

Normal task:
    TASKS_READ
    + Taskboard responsibility

Deleted task:
    TASKS_DELETE
    + Taskboard responsibility

The route deliberately does not perform a duplicate
authorizeTaskDelete() call.
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

        const includeDeleted =
            getIncludeDeleted(
                request
            );

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
        "body": "...",
        "priority": "High",
        "timeline_days": 7,
        "responsible_roles": [
            "database",
            "security"
        ]
    }
}

Important:
    - taskCode comes from the route.
    - actor identity is derived server-side.
    - status changes use the lifecycle endpoint.
    - lifecycle timestamps cannot be changed here.
    - deadline is controlled server-side.
    - version is controlled server-side.
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

        const {
            expectedVersion,
            changes
        } =
            getPatchInput(
                body
            );

        const result =
            await updateAdminTask(
                request,
                env,
                {
                    taskCode,
                    expectedVersion,
                    changes
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