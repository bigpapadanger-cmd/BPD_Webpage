"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK SUPABASE RPC SERVICE

File:
    functions/services/supabase/admin/tasks/rpc.js

Purpose:
    Provides the shared server-side transport for all Admin
    Taskboard Supabase RPC calls.

Description:
    - Calls only explicitly approved Admin task RPCs.
    - Uses the Supabase service-role key server-side.
    - Sends requests to the api PostgreSQL schema.
    - Normalizes Supabase/PostgREST errors.
    - Converts known task-domain errors into consistent
      server errors for API handlers.
    - Preserves database diagnostics server-side.
    - Keeps Supabase credentials out of browser code.

Security:
    - This file is server-side only.
    - Authorization must occur before calling these helpers.
    - Browser-submitted actor IDs are never trusted.
    - SUPABASE_SERVICE_ROLE_KEY is never returned.
    - Arbitrary RPC names cannot be called through this file.
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const TASK_RPC_NAMES =
    Object.freeze({
        CREATE:
            "admin_create_task",

        UPDATE:
            "admin_update_task",

        START:
            "admin_start_task",

        COMPLETE:
            "admin_complete_task",

        REOPEN:
            "admin_reopen_task",

        SHELVE:
            "admin_shelve_task",

        UNSHELVE:
            "admin_unshelve_task",

        ARCHIVE:
            "admin_archive_task",

        RESTORE_ARCHIVED:
            "admin_restore_archived_task",

        DELETE:
            "admin_delete_task",

        RESTORE_DELETED:
            "admin_restore_deleted_task",

        GET:
            "admin_get_task",

        LIST:
            "admin_list_tasks",

        SUMMARY:
            "admin_get_task_summary",

        ASSIGNEES:
            "admin_get_task_assignees",

        TASKBOARD_ROLES:
            "admin_get_taskboard_roles",

        EVENTS:
            "admin_get_task_events",

        COMMENT:
            "admin_add_task_comment",

        ACTIVITY:
            "admin_get_task_activity",

        ACTIVITY_LIST:
            "admin_list_task_activity"
    });

const ALLOWED_TASK_RPCS =
    new Set(
        Object.values(
            TASK_RPC_NAMES
        )
    );

const TASK_RPC_TIMEOUT_MS =
    10000;

const TASK_DOMAIN_ERROR_CODES =
    Object.freeze([
        "TASK_NOT_FOUND",

        "TASK_VERSION_CONFLICT",

        "TASK_DELETED",

        "TASK_ARCHIVED",

        "TASK_SHELVED",

        "TASK_COMPLETED",

        "TASK_ALREADY_IN_PROGRESS",

        "TASK_ALREADY_COMPLETED",

        "TASK_ALREADY_SHELVED",

        "TASK_ALREADY_ARCHIVED",

        "TASK_ALREADY_DELETED",

        "TASK_NOT_COMPLETED",

        "TASK_NOT_SHELVED",

        "TASK_NOT_ARCHIVED",

        "TASK_NOT_DELETED",

        "TASK_INPUT_INVALID",

        "TASK_FIELDS_UNSUPPORTED",

        "TASK_PRIORITY_INVALID",

        "TASK_TIMELINE_INVALID",

        "TASK_ROLES_INVALID",

        "TASK_STATE_CONFLICT",

        "TASK_CODE_INVALID",

        "TASK_CHANGES_INVALID",

        "TASK_CHANGES_UNSUPPORTED",

        "TASK_COMMENT_REQUIRED",

        "TASK_COMMENT_TOO_LONG",

        "ACTOR_ACCOUNT_ID_REQUIRED",

        "TASK_ACTIVITY_FILTERS_INVALID",

        "TASK_ACTIVITY_FILTERS_UNSUPPORTED",

        "TASK_ACTIVITY_DATE_RANGE_INVALID",

        "TASK_EVENT_TYPE_INVALID",

        "ACTOR_ACCOUNT_ID_INVALID",

        "CREATED_AFTER_INVALID",

        "CREATED_BEFORE_INVALID"
    ]);

/* =========================================================
EXPORT RPC NAMES
========================================================= */

export const ADMIN_TASK_RPCS =
    TASK_RPC_NAMES;

/* =========================================================
ERROR
========================================================= */

export class AdminTaskRpcError extends Error {
    constructor(
        message,
        {
            code =
                "ADMIN_TASK_RPC_ERROR",

            status =
                500,

            databaseCode =
                null,

            details =
                null,

            hint =
                null,

            unavailable =
                false
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "AdminTaskRpcError";

        this.code =
            code;

        this.status =
            status;

        this.databaseCode =
            databaseCode;

        this.details =
            details;

        this.hint =
            hint;

        this.unavailable =
            unavailable;
    }
}

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

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized || null;
}

function normalizeRpcParameters(
    parameters
) {
    if (
        !parameters
        || typeof parameters !== "object"
        || Array.isArray(
            parameters
        )
    ) {
        return {};
    }

    return parameters;
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const supabaseUrl =
        normalizeString(
            env?.SUPABASE_URL
        )
            .replace(
                /\/+$/,
                ""
            );

    const serviceRoleKey =
        normalizeString(
            env?.SUPABASE_SERVICE_ROLE_KEY
        );

    if (
        !supabaseUrl
    ) {
        throw new AdminTaskRpcError(
            "Supabase URL configuration is missing.",
            {
                code:
                    "SUPABASE_URL_MISSING",

                status:
                    500
            }
        );
    }

    if (
        !serviceRoleKey
    ) {
        throw new AdminTaskRpcError(
            "Supabase service role configuration is missing.",
            {
                code:
                    "SUPABASE_SERVICE_ROLE_KEY_MISSING",

                status:
                    500
            }
        );
    }

    return {
        supabaseUrl,
        serviceRoleKey
    };
}

/* =========================================================
RPC VALIDATION
========================================================= */

function requireAllowedRpc(
    rpcName
) {
    const normalized =
        normalizeString(
            rpcName
        );

    if (
        !normalized
        || !ALLOWED_TASK_RPCS.has(
            normalized
        )
    ) {
        throw new AdminTaskRpcError(
            "The requested task RPC is not allowed.",
            {
                code:
                    "ADMIN_TASK_RPC_NOT_ALLOWED",

                status:
                    500
            }
        );
    }

    return normalized;
}

/* =========================================================
RESPONSE BODY
========================================================= */

async function readResponseBody(
    response
) {
    const text =
        await response.text();

    if (
        !text
    ) {
        return null;
    }

    try {
        return JSON.parse(
            text
        );
    }
    catch {
        return {
            message:
                text
        };
    }
}

/* =========================================================
TASK DOMAIN ERROR EXTRACTION
========================================================= */

function getTaskDomainErrorCode(
    result
) {
    const message =
        normalizeString(
            result?.message
        );

    const resultCode =
        normalizeString(
            result?.code
        );

    const matched =
        TASK_DOMAIN_ERROR_CODES.find(
            code =>
                message === code
                || resultCode === code
        );

    return matched || null;
}

/* =========================================================
STATUS MAPPING
========================================================= */

function mapTaskErrorStatus(
    code,
    supabaseStatus
) {
    if (
        [
            "TASK_STATE_CONFLICT",
            "TASK_VERSION_CONFLICT",

            "TASK_DELETED",
            "TASK_ARCHIVED",
            "TASK_SHELVED",
            "TASK_COMPLETED",

            "TASK_ALREADY_IN_PROGRESS",
            "TASK_ALREADY_COMPLETED",
            "TASK_ALREADY_SHELVED",
            "TASK_ALREADY_ARCHIVED",
            "TASK_ALREADY_DELETED",

            "TASK_NOT_COMPLETED",
            "TASK_NOT_SHELVED",
            "TASK_NOT_ARCHIVED",
            "TASK_NOT_DELETED"
        ].includes(
            code
        )
    ) {
        return 409;
    }

    if (
        code ===
        "TASK_NOT_FOUND"
    ) {
        return 404;
    }

    if (
        [
            "TASK_INPUT_INVALID",
            "TASK_FIELDS_UNSUPPORTED",
            "TASK_PRIORITY_INVALID",
            "TASK_TIMELINE_INVALID",
            "TASK_ROLES_INVALID",
            "TASK_CODE_INVALID",
            "TASK_CHANGES_INVALID",
            "TASK_CHANGES_UNSUPPORTED",
            "TASK_COMMENT_REQUIRED",
            "TASK_COMMENT_TOO_LONG",
            "ACTOR_ACCOUNT_ID_REQUIRED",
            "TASK_ACTIVITY_FILTERS_INVALID",
            "TASK_ACTIVITY_FILTERS_UNSUPPORTED",
            "TASK_ACTIVITY_DATE_RANGE_INVALID",
            "TASK_EVENT_TYPE_INVALID",
            "ACTOR_ACCOUNT_ID_INVALID",
            "CREATED_AFTER_INVALID",
            "CREATED_BEFORE_INVALID"
        ].includes(
            code
        )
    ) {
        return 400;
    }

    if (
        Number.isInteger(
            supabaseStatus
        )
        && supabaseStatus >= 400
        && supabaseStatus <= 599
    ) {
        return supabaseStatus;
    }

    return 500;
}

/* =========================================================
PUBLIC DOMAIN ERROR MESSAGE
========================================================= */

function getTaskErrorMessage(
    code
) {
    switch (
        code
    ) {
        case "TASK_VERSION_CONFLICT":
            return "This task changed. Refresh it before trying again.";

        case "TASK_NOT_FOUND":
            return "The requested task could not be found.";

        case "TASK_ALREADY_IN_PROGRESS":
            return "This task is already in progress.";

        case "TASK_ALREADY_COMPLETED":
            return "This task is already completed.";

        case "TASK_ALREADY_SHELVED":
            return "This task is already shelved.";

        case "TASK_ALREADY_ARCHIVED":
            return "This task is already archived.";

        case "TASK_ALREADY_DELETED":
            return "This task is already deleted.";

        default:
            return `The task operation could not be completed (${code}).`;
    }
}

/* =========================================================
SUPABASE ERROR CONVERSION
========================================================= */

function createSupabaseRpcError(
    response,
    result
) {
    const taskCode =
        getTaskDomainErrorCode(
            result
        );

    const databaseCode =
        normalizeNullableString(
            result?.code
        );

    const details =
        result?.details ??
        null;

    const hint =
        result?.hint ??
        null;

    /* -----------------------------------------------------
    KNOWN TASK-DOMAIN ERROR

    These are expected business-rule failures generated by
    the Taskboard RPC layer.
    ----------------------------------------------------- */

    if (
        taskCode
    ) {
        return new AdminTaskRpcError(
            getTaskErrorMessage(
                taskCode
            ),
            {
                code:
                    taskCode,

                status:
                    mapTaskErrorStatus(
                        taskCode,
                        response.status
                    ),

                databaseCode,

                details,

                hint,

                unavailable:
                    false
            }
        );
    }

    /* -----------------------------------------------------
    UNKNOWN DATABASE / POSTGREST ERROR

    Preserve the actual HTTP status when possible instead
    of automatically converting every unknown failure to
    503.

    This makes schema/RPC/configuration errors distinguishable
    from genuine service outages.
    ----------------------------------------------------- */

    const status =
        Number.isInteger(
            response?.status
        )
        && response.status >= 400
        && response.status <= 599
            ? response.status
            : 500;

    return new AdminTaskRpcError(
        "The task database request failed.",
        {
            code:
                "ADMIN_TASK_RPC_FAILED",

            status,

            databaseCode,

            details,

            hint,

            unavailable:
                status === 502
                || status === 503
                || status === 504
        }
    );
}

/* =========================================================
CALL ADMIN TASK RPC

Authorization must already have completed before this
function is called.
========================================================= */

export async function callAdminTaskRpc(
    env,
    rpcName,
    parameters = {}
) {
    const rpc =
        requireAllowedRpc(
            rpcName
        );

    const normalizedParameters =
        normalizeRpcParameters(
            parameters
        );

    const {
        supabaseUrl,
        serviceRoleKey
    } =
        getSupabaseConfiguration(
            env
        );

    const controller =
        new AbortController();

    const timeoutId =
        setTimeout(
            () => {
                controller.abort();
            },
            TASK_RPC_TIMEOUT_MS
        );

    let response;

    try {
        response =
            await fetch(
                `${supabaseUrl.replace(
                    /\/rest\/v1$/,
                    ""
                )}/rest/v1/rpc/${encodeURIComponent(
                    rpc
                )}`,
                {
                    method:
                        "POST",

                    headers: {
                        apikey:
                            serviceRoleKey,

                        Authorization:
                            `Bearer ${serviceRoleKey}`,

                        "Content-Type":
                            "application/json",

                        Accept:
                            "application/json",

                        "Content-Profile":
                            "api",

                        "Accept-Profile":
                            "api"
                    },

                    body:
                        JSON.stringify(
                            normalizedParameters
                        ),

                    signal:
                        controller.signal
                }
            );
    }
    catch (
        error
    ) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new AdminTaskRpcError(
                "The task database request timed out.",
                {
                    code:
                        "ADMIN_TASK_RPC_TIMEOUT",

                    status:
                        503,

                    unavailable:
                        true
                }
            );
        }

        throw new AdminTaskRpcError(
            "The task database is currently unavailable.",
            {
                code:
                    "ADMIN_TASK_DATABASE_UNAVAILABLE",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }
    finally {
        clearTimeout(
            timeoutId
        );
    }

    const result =
        await readResponseBody(
            response
        );

    if (
        !response.ok
    ) {
        throw createSupabaseRpcError(
            response,
            result
        );
    }

    return result;
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAdminTaskRpcError(
    error
) {
    return (
        error instanceof AdminTaskRpcError
        || error?.name ===
            "AdminTaskRpcError"
    );
}