"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASKBOARD CLIENT

File:
    public/Global/Admin/TaskBoard/JS/index.js

Purpose:
    Initializes the Admin Taskboard page and performs the
    preliminary Taskboard API integration.

Responsibilities:
    - Require current centralized Admin authorization.
    - Require an active Admin responsibility role.
    - Load verified Taskboard role context.
    - Load task summary.
    - Load task list.
    - Load task assignees.
    - Display returned API data for verification.
    - Allow manual refresh.
    - Export initializePage() for the BPD router.

Access Requirements:
    All Admin pages, including Taskboard, require:

    1. An authenticated active BPD account.
    2. A verified and currently authorized Discord identity.
    3. Current Discord Admin staff authorization.
    4. At least one active responsibility role:
           owner
           database
           security
           ui

Security:
    - This module is NOT a security boundary.
    - Admin authorization is established by the centralized
      client auth service through the server-side Admin
      authorization endpoint.
    - Discord authorization is performed server-side.
    - Discord guild roles are verified server-side.
    - Responsibility roles are synchronized server-side.
    - Client-side role claims are never authoritative.
    - Task APIs independently enforce permissions,
      membership, and task responsibility.
    - Supabase credentials never reach the browser.

Important:
    - This client-side gate controls presentation only.
    - Server-side Taskboard APIs remain authoritative.
    - This module must not call /api/auth/admin/access
      directly.
    - This module must not load or initialize the sidebar.
========================================================= */

/* =========================================================
IMPORTS
========================================================= */

import {
    getAuthState,
    hasAdminAccess
} from "/Framework/Auth/auth.js";

/* =========================================================
ENDPOINTS
========================================================= */

const TASKS_URL =
    "/api/auth/admin/tasks";

const TASK_SUMMARY_URL =
    "/api/auth/admin/tasks/task-summary";

const TASK_ASSIGNEES_URL =
    "/api/auth/admin/tasks/task-assignees";

/* =========================================================
TASKBOARD ROLES
========================================================= */

const TASKBOARD_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getTaskboardElements() {
    return {
        taskboardContent:
            document.getElementById(
                "taskboardContent"
            ),

        taskboardLoading:
            document.getElementById(
                "taskboardLoading"
            ),

        taskboardDenied:
            document.getElementById(
                "taskboardDenied"
            ),

        taskboardError:
            document.getElementById(
                "taskboardError"
            ),

        taskboardErrorMessage:
            document.getElementById(
                "taskboardErrorMessage"
            ),

        taskboardRefresh:
            document.getElementById(
                "taskboardRefresh"
            ),

        taskSummaryOutput:
            document.getElementById(
                "taskSummaryOutput"
            ),

        taskListOutput:
            document.getElementById(
                "taskListOutput"
            ),

        taskAssigneesOutput:
            document.getElementById(
                "taskAssigneesOutput"
            ),

        taskboardStatus:
            document.getElementById(
                "taskboardStatus"
            )
    };
}

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

function normalizeTaskboardRoles(
    roles
) {
    if (
        !Array.isArray(
            roles
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            roles
                .map(
                    role =>
                        normalizeString(
                            role
                        )
                            .toLowerCase()
                )
                .filter(
                    role =>
                        TASKBOARD_ROLES.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
PAGE STATE
========================================================= */

function hideAllTaskboardStates() {
    const {
        taskboardContent,
        taskboardLoading,
        taskboardDenied,
        taskboardError
    } =
        getTaskboardElements();

    if (
        taskboardContent
    ) {
        taskboardContent.hidden =
            true;
    }

    if (
        taskboardLoading
    ) {
        taskboardLoading.hidden =
            true;
    }

    if (
        taskboardDenied
    ) {
        taskboardDenied.hidden =
            true;
    }

    if (
        taskboardError
    ) {
        taskboardError.hidden =
            true;
    }
}

function showTaskboardLoading() {
    const {
        taskboardLoading
    } =
        getTaskboardElements();

    hideAllTaskboardStates();

    if (
        taskboardLoading
    ) {
        taskboardLoading.hidden =
            false;
    }
}

function showTaskboardAuthorized() {
    const {
        taskboardContent
    } =
        getTaskboardElements();

    hideAllTaskboardStates();

    if (
        taskboardContent
    ) {
        taskboardContent.hidden =
            false;
    }
}

function showTaskboardDenied() {
    const {
        taskboardDenied
    } =
        getTaskboardElements();

    hideAllTaskboardStates();

    if (
        taskboardDenied
    ) {
        taskboardDenied.hidden =
            false;
    }
}

function showTaskboardError(
    message =
        "The Taskboard could not be loaded."
) {
    const {
        taskboardError,
        taskboardErrorMessage
    } =
        getTaskboardElements();

    hideAllTaskboardStates();

    if (
        taskboardErrorMessage
    ) {
        taskboardErrorMessage.textContent =
            message;
    }

    if (
        taskboardError
    ) {
        taskboardError.hidden =
            false;
    }
}

/* =========================================================
STATUS
========================================================= */

function setTaskboardStatus(
    message
) {
    const {
        taskboardStatus
    } =
        getTaskboardElements();

    if (
        !taskboardStatus
    ) {
        return;
    }

    taskboardStatus.textContent =
        normalizeString(
            message
        );
}

/* =========================================================
CENTRALIZED TASKBOARD ACCESS

The centralized auth service performs:

    GET /api/auth/session
        ↓
    active authenticated account
        ↓
    GET /api/auth/admin/access
        ↓
    live Discord authorization
        ↓
    responsibility-role synchronization
        ↓
    state.admin

Entering Taskboard forces a fresh authorization check.

The browser uses this result for presentation only.
========================================================= */

async function loadTaskboardAccess() {
    const state =
        await getAuthState({
            force:
                true
        });

    const adminAuthorized =
        hasAdminAccess(
            state
        );

    const taskboardRoles =
        adminAuthorized
            ? normalizeTaskboardRoles(
                state?.admin?.roles
            )
            : [];

    const taskboardMember =
        adminAuthorized
        && taskboardRoles.length >
            0;

    return {
        state,

        authorized:
            taskboardMember,

        adminAuthorized,

        taskboardMember,

        taskboardRoles,

        isOwner:
            taskboardRoles.includes(
                "owner"
            )
    };
}

/* =========================================================
API ERROR
========================================================= */

function createAdminApiError(
    {
        message,
        code,
        status,
        response = null
    }
) {
    const error =
        new Error(
            normalizeString(
                message
            )
            || "Admin API request failed."
        );

    error.code =
        normalizeString(
            code
        )
        || "ADMIN_API_REQUEST_FAILED";

    error.status =
        Number.isInteger(
            status
        )
            ? status
            : null;

    error.response =
        response;

    return error;
}

/* =========================================================
API REQUEST
========================================================= */

async function requestAdminApi(
    url
) {
    let response;

    try {
        response =
            await fetch(
                url,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );
    }
    catch (
        cause
    ) {
        const error =
            createAdminApiError({
                message:
                    "The Admin API is temporarily unavailable.",

                code:
                    "ADMIN_API_NETWORK_ERROR",

                status:
                    null
            });

        error.cause =
            cause;

        throw error;
    }

    let result =
        null;

    try {
        result =
            await response.json();
    }
    catch {
        throw createAdminApiError({
            message:
                "The Admin API returned an invalid response.",

            code:
                "ADMIN_API_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createAdminApiError({
            message:
                result?.message
                || result?.error
                || `Request failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "ADMIN_API_REQUEST_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    if (
        !result
        || typeof result !==
            "object"
        || Array.isArray(
            result
        )
    ) {
        throw createAdminApiError({
            message:
                "The Admin API returned an invalid result.",

            code:
                "ADMIN_API_RESULT_INVALID",

            status:
                response.status
        });
    }

    return result;
}

/* =========================================================
TASK SUMMARY
========================================================= */

async function loadTaskSummary() {
    return requestAdminApi(
        TASK_SUMMARY_URL
    );
}

/* =========================================================
TASK LIST
========================================================= */

async function loadTaskList() {
    const url =
        new URL(
            TASKS_URL,
            window.location.origin
        );

    url.searchParams.set(
        "limit",
        "50"
    );

    url.searchParams.set(
        "offset",
        "0"
    );

    return requestAdminApi(
        url.toString()
    );
}

/* =========================================================
TASK ASSIGNEES
========================================================= */

async function loadTaskAssignees() {
    return requestAdminApi(
        TASK_ASSIGNEES_URL
    );
}

/* =========================================================
JSON OUTPUT
========================================================= */

function renderJson(
    element,
    value
) {
    if (
        !element
    ) {
        return;
    }

    element.textContent =
        JSON.stringify(
            value,
            null,
            2
        );
}

/* =========================================================
LOAD TASKBOARD DATA
========================================================= */

async function loadTaskboardData() {
    const {
        taskboardRefresh,
        taskSummaryOutput,
        taskListOutput,
        taskAssigneesOutput
    } =
        getTaskboardElements();

    setTaskboardStatus(
        "Loading task data..."
    );

    if (
        taskboardRefresh
    ) {
        taskboardRefresh.disabled =
            true;
    }

    try {
        const [
            summary,
            tasks,
            assignees
        ] =
            await Promise.all([
                loadTaskSummary(),
                loadTaskList(),
                loadTaskAssignees()
            ]);

        renderJson(
            taskSummaryOutput,
            summary
        );

        renderJson(
            taskListOutput,
            tasks
        );

        renderJson(
            taskAssigneesOutput,
            assignees
        );

        setTaskboardStatus(
            "Taskboard API test completed successfully."
        );

        console.log(
            "[TASKBOARD SUMMARY]",
            summary
        );

        console.log(
            "[TASKBOARD TASKS]",
            tasks
        );

        console.log(
            "[TASKBOARD ASSIGNEES]",
            assignees
        );

        return {
            summary,
            tasks,
            assignees
        };
    }
    catch (
        error
    ) {
        console.error(
            "[TASKBOARD DATA LOAD FAILED]",
            {
                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            error?.status ===
                401
            || error?.status ===
                403
        ) {
            throw error;
        }

        setTaskboardStatus(
            `Taskboard API test failed: ${
                error?.message
                || "Unknown error."
            }`
        );

        throw error;
    }
    finally {
        if (
            taskboardRefresh
        ) {
            taskboardRefresh.disabled =
                false;
        }
    }
}

/* =========================================================
REFRESH

A manual Taskboard refresh forces the centralized auth
service to re-evaluate current Admin authorization before
loading Taskboard data.

This causes current Discord authorization and responsibility
roles to be checked again by the server.
========================================================= */

function setupTaskboardRefresh() {
    const {
        taskboardRefresh
    } =
        getTaskboardElements();

    if (
        !taskboardRefresh
    ) {
        return;
    }

    if (
        taskboardRefresh
            .dataset
            .initialized ===
        "true"
    ) {
        return;
    }

    taskboardRefresh.addEventListener(
        "click",
        async function() {
            if (
                taskboardRefresh.disabled
            ) {
                return;
            }

            taskboardRefresh.disabled =
                true;

            try {
                const access =
                    await loadTaskboardAccess();

                if (
                    !access.authorized
                ) {
                    if (
                        access
                            ?.state
                            ?.admin
                            ?.available ===
                        false
                    ) {
                        showTaskboardError(
                            "Taskboard authorization is temporarily unavailable."
                        );
                    }
                    else {
                        showTaskboardDenied();
                    }

                    return;
                }

                showTaskboardAuthorized();

                await loadTaskboardData();
            }
            catch (
                error
            ) {
                console.error(
                    "[TASKBOARD REFRESH FAILED]",
                    {
                        code:
                            error?.code
                            || null,

                        status:
                            error?.status
                            || null,

                        message:
                            error?.message
                            || "Unknown error"
                    }
                );

                if (
                    error?.status ===
                        401
                    || error?.status ===
                        403
                ) {
                    showTaskboardDenied();

                    return;
                }

                showTaskboardError(
                    error?.message
                    || "The Taskboard could not be refreshed."
                );
            }
            finally {
                /*
                 * loadTaskboardData() also controls this
                 * button. Explicit restoration here covers
                 * failures occurring before data loading.
                 */
                if (
                    taskboardRefresh
                ) {
                    taskboardRefresh.disabled =
                        false;
                }
            }
        }
    );

    taskboardRefresh.dataset.initialized =
        "true";
}

/* =========================================================
INITIALIZE TASKBOARD
========================================================= */

async function initializeTaskboard() {
    setupTaskboardRefresh();

    return loadTaskboardData();
}

/* =========================================================
ROUTER ENTRY POINT
========================================================= */

export async function initializePage() {
    showTaskboardLoading();

    try {
        const access =
            await loadTaskboardAccess();

        /* -------------------------------------------------
        ADMIN AUTHORIZATION UNAVAILABLE

        This is distinct from an authoritative denial.

        Do not claim the user lacks access when the server
        could not establish current Admin authorization.
        ------------------------------------------------- */

        if (
            access
                ?.state
                ?.admin
                ?.available ===
            false
        ) {
            showTaskboardError(
                "Taskboard authorization is temporarily unavailable."
            );

            return;
        }

        /* -------------------------------------------------
        ACCESS DENIED

        Covers:
            - signed-out BPD account
            - inactive BPD account
            - Discord provider authorization failure
            - Discord staff authorization failure
            - no active responsibility role
        ------------------------------------------------- */

        if (
            !access.authorized
        ) {
            showTaskboardDenied();

            return;
        }

        /* -------------------------------------------------
        AUTHORIZED
        ------------------------------------------------- */

        console.log(
            "[TASKBOARD ACCESS]",
            {
                roles:
                    access.taskboardRoles,

                isOwner:
                    access.isOwner
            }
        );

        showTaskboardAuthorized();

        try {
            await initializeTaskboard();
        }
        catch (
            error
        ) {
            /*
             * Task APIs remain authoritative.
             *
             * If any endpoint rejects access after the page
             * gate succeeded, immediately hide Taskboard
             * content.
             */
            if (
                error?.status ===
                    401
                || error?.status ===
                    403
            ) {
                showTaskboardDenied();

                return;
            }

            /*
             * Preliminary integration behavior:
             *
             * Keep the authorized Taskboard shell visible
             * while surfacing non-access data failures in
             * the status area.
             */
            console.error(
                "[TASKBOARD INITIALIZATION DATA ERROR]",
                {
                    code:
                        error?.code
                        || null,

                    status:
                        error?.status
                        || null,

                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }
    catch (
        error
    ) {
        console.error(
            "[ADMIN TASKBOARD INITIALIZATION FAILED]",
            {
                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showTaskboardError(
            error?.message
            || "The Taskboard could not be initialized."
        );
    }
}