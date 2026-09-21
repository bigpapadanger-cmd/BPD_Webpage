"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK LIFECYCLE API

File:
    functions/api/auth/admin/tasks/[taskCode]/lifecycle.js

Route:
    POST /api/auth/admin/tasks/:taskCode/lifecycle

Purpose:
    HTTP boundary for controlled Admin task lifecycle
    transitions.

Supported Actions:
    start
    complete
    reopen
    shelve
    unshelve
    archive
    restoreArchived
    delete
    restoreDeleted

Description:
    - Reads the authoritative task code from the route.
    - Requires expectedVersion for optimistic concurrency.
    - Accepts action, expectedVersion, and a lifecycle reason
      where required.
    - Requires reasons for shelve, archive, and delete.
    - Maps lifecycle action names to trusted server-side
      service functions.
    - Does not allow the browser to choose raw Supabase RPC
      names.
    - Does not allow lifecycle metadata or timestamps to be
      submitted by the browser.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the task lifecycle service.
    - Normal lifecycle actions require TASKS_UPDATE.
    - Delete and restore-delete require TASKS_DELETE.
    - Taskboard responsibility is enforced by the lifecycle
      service using persisted responsible_roles.
    - actor_account_id is derived server-side.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    startAdminTask,
    completeAdminTask,
    reopenAdminTask,
    shelveAdminTask,
    unshelveAdminTask,
    archiveAdminTask,
    restoreArchivedAdminTask,
    deleteAdminTask,
    restoreDeletedAdminTask
} from "../../../../../services/supabase/admin/tasks/lifecycle.js";

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

const ALLOWED_BODY_FIELDS =
    new Set([
        "action",
        "expectedVersion",
        "reason"
    ]);

const REASON_REQUIRED_ACTIONS =
    new Set([
        "shelve",
        "archive",
        "delete"
    ]);

const LIFECYCLE_ACTIONS =
    Object.freeze({
        start:
            startAdminTask,

        complete:
            completeAdminTask,

        reopen:
            reopenAdminTask,

        shelve:
            shelveAdminTask,

        unshelve:
            unshelveAdminTask,

        archive:
            archiveAdminTask,

        restoreArchived:
            restoreArchivedAdminTask,

        delete:
            deleteAdminTask,

        restoreDeleted:
            restoreDeletedAdminTask
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
        "AdminTaskLifecycleApiRequestError";

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
BODY VALIDATION

Accepted:
{
    "action": "...",
    "expectedVersion": 1,
    "reason": "..."
}

reason is required only for:
    shelve
    archive
    delete

Actor identity, lifecycle metadata, timestamps, RPC names,
and task state remain controlled server-side.
========================================================= */

function validateBodyFields(
    body
) {
    const invalidFields =
        Object.keys(
            body
        )
            .filter(
                field =>
                    !ALLOWED_BODY_FIELDS.has(
                        field
                    )
            );

    if (
        invalidFields.length >
        0
    ) {
        throw createRequestError(
            "TASK_LIFECYCLE_FIELDS_UNSUPPORTED",
            "Unsupported lifecycle request fields were supplied.",
            400,
            {
                invalidFields
            }
        );
    }
}

/* =========================================================
ACTION
========================================================= */

function getLifecycleAction(
    value
) {
    const action =
        normalizeString(
            value
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            LIFECYCLE_ACTIONS,
            action
        )
    ) {
        throw createRequestError(
            "TASK_LIFECYCLE_ACTION_INVALID",
            "The requested task lifecycle action is invalid.",
            400
        );
    }

    return action;
}

/* =========================================================
EXPECTED VERSION
========================================================= */

function getExpectedVersion(
    value
) {
    const version =
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            version
        )
        || version <
            1
    ) {
        throw createRequestError(
            "TASK_VERSION_INVALID",
            "A valid expectedVersion is required.",
            400
        );
    }

    return version;
}

/* =========================================================
LIFECYCLE REASON

Reasons are intentionally accepted only for lifecycle
operations where an audit explanation is required.

Required:
    shelve
    archive
    delete

Unsupported for all other lifecycle actions.
========================================================= */

function getLifecycleReason(
    body,
    action
) {
    const reason =
        normalizeString(
            body?.reason
        );

    const requiresReason =
        REASON_REQUIRED_ACTIONS.has(
            action
        );

    if (
        requiresReason
        && !reason
    ) {
        throw createRequestError(
            "TASK_LIFECYCLE_REASON_REQUIRED",
            "A reason is required for this lifecycle action.",
            400,
            {
                action
            }
        );
    }

    if (
        !requiresReason
        && Object.prototype.hasOwnProperty.call(
            body,
            "reason"
        )
        && reason
    ) {
        throw createRequestError(
            "TASK_LIFECYCLE_REASON_UNSUPPORTED",
            "A reason is not supported for this lifecycle action.",
            400,
            {
                action
            }
        );
    }

    return requiresReason
        ? reason
        : "";
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
        && status >=
            400
        && status <=
            599
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
        || "ADMIN_TASK_LIFECYCLE_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >=
        500
    ) {
        return "The task lifecycle request could not be completed.";
    }

    return (
        normalizeString(
            error?.message
        )
        || "The task lifecycle request could not be completed."
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
        status >=
        500
    ) {
        console.error(
            "[ADMIN TASK LIFECYCLE API]",
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
        status <
            500
        && error?.details !==
            undefined
        && error?.details !==
            null
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
POST /api/auth/admin/tasks/:taskCode/lifecycle

Normal Example:
{
    "action": "start",
    "expectedVersion": 4
}

Reason Example:
{
    "action": "archive",
    "expectedVersion": 4,
    "reason": "Superseded by the replacement implementation."
}

The browser may provide:
    - public lifecycle action
    - expected task version
    - required audit reason where supported

It cannot provide:
    - actor identity
    - task status
    - lifecycle timestamps
    - lifecycle ownership metadata
    - Supabase RPC names
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

        validateBodyFields(
            body
        );

        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                "action"
            )
        ) {
            throw createRequestError(
                "TASK_LIFECYCLE_ACTION_REQUIRED",
                "A lifecycle action is required.",
                400
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

        const action =
            getLifecycleAction(
                body.action
            );

        const expectedVersion =
            getExpectedVersion(
                body.expectedVersion
            );

        const reason =
            getLifecycleReason(
                body,
                action
            );

        const lifecycleFunction =
            LIFECYCLE_ACTIONS[
                action
            ];

        const lifecycleInput = {
            taskCode,

            expectedVersion
        };

        if (
            reason
        ) {
            lifecycleInput.reason =
                reason;
        }

        const result =
            await lifecycleFunction(
                request,
                env,
                lifecycleInput
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

    if (
        method ===
        "POST"
    ) {
        return onRequestPost(
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
                "POST"
        }
    );
}