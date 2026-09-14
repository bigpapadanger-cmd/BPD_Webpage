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
    - Maps lifecycle action names to trusted server-side
      service functions.
    - Does not allow the browser to choose raw Supabase RPC
      names.
    - Does not allow lifecycle timestamps to be submitted.

Security:
    - Authentication and Discord-backed permissions are
      enforced by the task lifecycle service.
    - Normal lifecycle actions require TASKS_UPDATE.
    - Delete and restore-delete require TASKS_DELETE.
    - actor_account_id is derived server-side.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
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

const LIFECYCLE_ACTIONS =
    Object.freeze({
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
        || Array.isArray(body)
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
ACTION
========================================================= */

function getLifecycleAction(
    value
) {
    const action =
        normalizeString(value);

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
        Number(value);

    if (
        !Number.isSafeInteger(version)
        || version < 1
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
SERVER-OWNED FIELD PROTECTION
========================================================= */

function rejectServerOwnedFields(
    body
) {
    const prohibitedFields = [
        "taskCode",
        "task_code",
        "actorAccountId",
        "actor_account_id",
        "completedAt",
        "completed_at",
        "shelvedAt",
        "shelved_at",
        "archivedAt",
        "archived_at",
        "deletedAt",
        "deleted_at",
        "rpc",
        "rpcName"
    ];

    const suppliedFields =
        prohibitedFields.filter(
            field =>
                Object.prototype.hasOwnProperty.call(
                    body,
                    field
                )
        );

    if (
        suppliedFields.length > 0
    ) {
        throw createRequestError(
            "TASK_SERVER_FIELD_NOT_ALLOWED",
            "One or more server-controlled task fields were supplied.",
            400,
            {
                fields:
                    suppliedFields
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
        || "ADMIN_TASK_LIFECYCLE_FAILED"
    );
}

function getErrorMessage(
    error,
    status
) {
    if (
        status >= 500
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
        getErrorStatus(error);

    const code =
        getErrorCode(error);

    if (
        status >= 500
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
POST /api/auth/admin/tasks/:taskCode/lifecycle

Expected Body:
{
    "action": "complete",
    "expectedVersion": 4
}

The browser selects a public lifecycle action name only.
It cannot select a Supabase RPC directly.
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

        rejectServerOwnedFields(
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

        const lifecycleFunction =
            LIFECYCLE_ACTIONS[
                action
            ];

        const result =
            await lifecycleFunction(
                request,
                env,
                {
                    taskCode,
                    expectedVersion
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
        method === "POST"
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