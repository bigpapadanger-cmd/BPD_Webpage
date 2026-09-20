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
    - Verify Discord-backed Admin access.
    - Verify active Taskboard membership.
    - Load verified Taskboard role context.
    - Load task summary.
    - Load task list.
    - Load task assignees.
    - Display returned API data for verification.
    - Allow manual refresh.
    - Export initializePage() for the BPD router.

Access Requirements:
    A user may access the Taskboard only when:

    1. The user has an authenticated BPD account.
    2. The BPD account has an associated Discord identity.
    3. That Discord account currently satisfies the
       server-side Admin staff authorization policy.
    4. The BPD account has at least one active Taskboard
       responsibility role:
           owner
           database
           security
           ui

    General Admin authorization alone is not sufficient
    for Taskboard access.

Security:
    - Discord authorization is performed server-side.
    - Discord guild roles are verified server-side.
    - Taskboard roles are resolved server-side.
    - Client-side role claims are never trusted.
    - Task APIs independently enforce permissions.
    - Task APIs independently enforce Taskboard membership
      and task responsibility where applicable.
    - Supabase credentials never reach the browser.

Important:
    - This client-side gate controls page presentation only.
    - It is not the authoritative security boundary.
    - Server-side Taskboard APIs remain authoritative.
    - Sidebar HTML and sidebar behavior are handled by the
      global router/shell.
    - This module must not load or initialize the sidebar.
========================================================= */

/* =========================================================
ENDPOINTS
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

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
    return typeof value === "string"
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
                        ).toLowerCase()
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
        message;
}

/* =========================================================
ACCESS RESULT
========================================================= */

function createDeniedAccessResult(
    status,
    reason
) {
    return {
        authorized:
            false,

        adminAuthorized:
            false,

        taskboardMember:
            false,

        taskboardRoles:
            [],

        isOwner:
            false,

        status,

        reason
    };
}

/* =========================================================
VERIFY TASKBOARD ACCESS

The general Admin access endpoint intentionally permits
Discord-authorized Admin staff who do not hold Taskboard
responsibility roles.

This Taskboard client therefore requires BOTH:

    result.authorized === true
    result.taskboard.member === true

The Taskboard APIs independently enforce this requirement
server-side. This function is only the page-level gate.
========================================================= */

async function verifyTaskboardAccess() {
    const response =
        await fetch(
            ADMIN_ACCESS_URL,
            {
                method:
                    "GET",

                credentials:
                    "same-origin",

                headers: {
                    "Accept":
                        "application/json"
                },

                cache:
                    "no-store"
            }
        );

    let result =
        null;

    try {
        result =
            await response.json();
    }
    catch {
        return createDeniedAccessResult(
            response.status,
            "INVALID_RESPONSE"
        );
    }

    const adminAuthorized =
        response.ok
        && result?.success ===
            true
        && result?.authorized ===
            true;

    if (
        !adminAuthorized
    ) {
        return {
            authorized:
                false,

            adminAuthorized:
                false,

            taskboardMember:
                false,

            taskboardRoles:
                [],

            isOwner:
                false,

            status:
                response.status,

            reason:
                response.status === 401
                    ? "AUTHENTICATION_REQUIRED"
                    : response.status === 403
                        ? "ADMIN_ACCESS_DENIED"
                        : result?.error
                            || "ADMIN_ACCESS_CHECK_FAILED"
        };
    }

    const taskboardRoles =
        normalizeTaskboardRoles(
            result?.taskboard?.roles
        );

    const taskboardMember =
        result?.taskboard?.member ===
            true
        && taskboardRoles.length >
            0;

    const isOwner =
        taskboardRoles.includes(
            "owner"
        );

    if (
        !taskboardMember
    ) {
        return {
            authorized:
                false,

            adminAuthorized:
                true,

            taskboardMember:
                false,

            taskboardRoles:
                [],

            isOwner:
                false,

            status:
                response.status,

            reason:
                "TASKBOARD_ROLE_REQUIRED"
        };
    }

    return {
        authorized:
            true,

        adminAuthorized:
            true,

        taskboardMember:
            true,

        taskboardRoles,

        isOwner,

        status:
            response.status,

        reason:
            null
    };
}

/* =========================================================
API REQUEST
========================================================= */

async function requestAdminApi(
    url
) {
    const response =
        await fetch(
            url,
            {
                method:
                    "GET",

                credentials:
                    "same-origin",

                headers: {
                    "Accept":
                        "application/json"
                },

                cache:
                    "no-store"
            }
        );

    let result =
        null;

    try {
        result =
            await response.json();
    }
    catch {
        const error =
            new Error(
                `${url} returned a non-JSON response (${response.status}).`
            );

        error.status =
            response.status;

        error.code =
            "ADMIN_API_INVALID_RESPONSE";

        throw error;
    }

    if (
        !response.ok
    ) {
        const message =
            result?.message
            || result?.error
            || `Request failed with status ${response.status}.`;

        const error =
            new Error(
                message
            );

        error.status =
            response.status;

        error.code =
            result?.error
            || "ADMIN_API_REQUEST_FAILED";

        error.response =
            result;

        throw error;
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
            error
        );

        if (
            error?.status === 401
            || error?.status === 403
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

Access is checked again before refreshing Taskboard data.

This matters because Discord guild roles or Taskboard roles
may have changed since the page was initially loaded.
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
        taskboardRefresh.dataset.initialized ===
        "true"
    ) {
        return;
    }

    taskboardRefresh.addEventListener(
        "click",
        async function() {
            try {
                const access =
                    await verifyTaskboardAccess();

                if (
                    !access.authorized
                ) {
                    showTaskboardDenied();

                    return;
                }

                await loadTaskboardData();
            }
            catch (
                error
            ) {
                console.error(
                    "[TASKBOARD REFRESH FAILED]",
                    error
                );

                if (
                    error?.status === 401
                    || error?.status === 403
                ) {
                    showTaskboardDenied();
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
            await verifyTaskboardAccess();

        /* -------------------------------------------------
        ACCESS DENIED

        This covers:
            - no authenticated BPD session
            - no authorized Discord identity
            - Discord account missing required staff role
            - no active Taskboard responsibility role
        ------------------------------------------------- */

        if (
            !access.authorized
        ) {
            if (
                access.status === 401
                || access.status === 403
                || access.reason ===
                    "TASKBOARD_ROLE_REQUIRED"
            ) {
                showTaskboardDenied();

                return;
            }

            showTaskboardError(
                `Taskboard access verification failed (${access.status}).`
            );

            return;
        }

        /* -------------------------------------------------
        AUTHORIZED

        At this point the server has confirmed Admin access
        and at least one active Taskboard responsibility
        role.
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
             * A 401/403 from any Taskboard endpoint means
             * the server no longer authorizes this user.
             *
             * Do not leave Taskboard content visible.
             */

            if (
                error?.status === 401
                || error?.status === 403
            ) {
                showTaskboardDenied();

                return;
            }

            /*
             * During preliminary integration, non-access
             * API errors remain visible through the status
             * area and console while the Taskboard itself
             * stays available.
             */

            console.error(
                "[TASKBOARD INITIALIZATION DATA ERROR]",
                error
            );
        }
    }
    catch (
        error
    ) {
        console.error(
            "[ADMIN TASKBOARD INITIALIZATION FAILED]",
            error
        );

        showTaskboardError(
            error?.message
            || "The Taskboard could not be initialized."
        );
    }
}