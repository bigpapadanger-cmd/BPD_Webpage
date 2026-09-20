"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK EVENTS API

File:
    functions/api/auth/admin/tasks/[taskCode]/events.js

Routes:
    GET  /api/auth/admin/tasks/:taskCode/events
    POST /api/auth/admin/tasks/:taskCode/events

Purpose:
    HTTP boundary for retrieving task event history and
    adding controlled comments/questions to an Admin task.

Description:
    GET:
        - Retrieves task event/audit history.
        - Supports bounded pagination.
        - Accepts only limit and offset query parameters.

    POST:
        - Adds a comment/question to the task.
        - Accepts only a comment field.
        - Does not modify task state or task version.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the service layer.
    - Taskboard responsibility is enforced server-side
      against the authoritative persisted task.
    - Browser-submitted permissions are never trusted.
    - Browser-submitted actor IDs are never accepted.
    - Browser-submitted event metadata is never accepted.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    getAdminTaskEvents
} from "../../../../../services/supabase/admin/tasks/activity.js";

import {
    addAdminTaskComment
} from "../../../../../services/supabase/admin/tasks/comments.js";

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

const ALLOWED_GET_QUERY_PARAMETERS =
    new Set([
        "limit",
        "offset"
    ]);

const ALLOWED_POST_FIELDS =
    new Set([
        "comment"
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
GET QUERY VALIDATION
========================================================= */

function validateGetQueryParameters(
    searchParams
) {
    const invalidParameters =
        [
            ...new Set(
                [...searchParams.keys()]
                    .filter(
                        key =>
                            !ALLOWED_GET_QUERY_PARAMETERS.has(
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
            "TASK_EVENTS_QUERY_UNSUPPORTED",
            "Unsupported task event query parameters were supplied.",
            400,
            {
                invalidParameters
            }
        );
    }
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
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            limit
        )
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
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            offset
        )
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
            "Content-Type must be application/json.",
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
            "REQUEST_BODY_INVALID",
            "A valid JSON request body is required.",
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
            "The request body must be a JSON object.",
            400
        );
    }

    return body;
}

/* =========================================================
COMMENT BODY

Only:
{
    "comment": "..."
}

is accepted.

Actor IDs, permissions, roles, event types, task IDs, and
other event metadata cannot be supplied by the browser.
========================================================= */

function getCommentFromBody(
    body
) {
    const invalidFields =
        Object.keys(
            body
        )
            .filter(
                field =>
                    !ALLOWED_POST_FIELDS.has(
                        field
                    )
            );

    if (
        invalidFields.length >
        0
    ) {
        throw createRequestError(
            "TASK_COMMENT_FIELDS_UNSUPPORTED",
            "Unsupported fields were supplied.",
            400,
            {
                invalidFields
            }
        );
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            body,
            "comment"
        )
    ) {
        throw createRequestError(
            "TASK_COMMENT_REQUIRED",
            "A comment is required.",
            400
        );
    }

    return body.comment;
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
            "[ADMIN TASK EVENTS API]",
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
GET /api/auth/admin/tasks/:taskCode/events

Query Parameters:
    limit
    offset

Authorization and responsibility checks are performed by
getAdminTaskEvents().
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

        validateGetQueryParameters(
            url.searchParams
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
POST /api/auth/admin/tasks/:taskCode/events

Body:
{
    "comment": "Question or comment text"
}

The actor account ID is derived by the service and is
intentionally never accepted from the browser.
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

        const taskCode =
            getTaskCode(
                context
            );

        const body =
            await readJsonBody(
                request
            );

        const comment =
            getCommentFromBody(
                body
            );

        const result =
            await addAdminTaskComment(
                request,
                env,
                {
                    taskCode,
                    comment
                }
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