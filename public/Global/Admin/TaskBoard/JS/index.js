"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASKBOARD CLIENT

File:
    public/Global/Admin/TaskBoard/JS/index.js

Purpose:
    Initializes the Admin Taskboard page and performs the
    preliminary Taskboard API integration.

Preliminary Test:
    - Verify Admin access.
    - Load Admin sidebar.
    - Load task summary.
    - Load task list.
    - Load task assignees.
    - Display returned API data for verification.
    - Allow manual refresh.

Security:
    - Discord authorization is performed server-side.
    - Client-side role claims are never trusted.
    - Task APIs independently enforce permissions.
    - Supabase credentials never reach the browser.
========================================================= */

import {
    initializeAdminSidebar,
    loadAdminSidebarHover
} from "/Framework/Shell/JS/Admin/sidebar.js";

/* =========================================================
ENDPOINTS
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

const ADMIN_SIDEBAR_URL =
    "/Framework/Shell/HTML/Admin/sidebar.html";

const TASKS_URL =
    "/api/auth/admin/tasks";

const TASK_SUMMARY_URL =
    "/api/auth/admin/tasks/task-summary";

const TASK_ASSIGNEES_URL =
    "/api/auth/admin/tasks/task-assignees";

/* =========================================================
ELEMENTS
========================================================= */

const taskboardContent =
    document.getElementById(
        "taskboardContent"
    );

const taskboardLoading =
    document.getElementById(
        "taskboardLoading"
    );

const taskboardDenied =
    document.getElementById(
        "taskboardDenied"
    );

const taskboardError =
    document.getElementById(
        "taskboardError"
    );

const taskboardErrorMessage =
    document.getElementById(
        "taskboardErrorMessage"
    );

const sidebar =
    document.getElementById(
        "sidebar"
    );

const taskboardRefresh =
    document.getElementById(
        "taskboardRefresh"
    );

const taskSummaryOutput =
    document.getElementById(
        "taskSummaryOutput"
    );

const taskListOutput =
    document.getElementById(
        "taskListOutput"
    );

const taskAssigneesOutput =
    document.getElementById(
        "taskAssigneesOutput"
    );

const taskboardStatus =
    document.getElementById(
        "taskboardStatus"
    );

/* =========================================================
PAGE STATE
========================================================= */

function hideAllTaskboardStates() {
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
    hideAllTaskboardStates();

    if (
        taskboardLoading
    ) {
        taskboardLoading.hidden =
            false;
    }
}

function showTaskboardAuthorized() {
    hideAllTaskboardStates();

    if (
        taskboardContent
    ) {
        taskboardContent.hidden =
            false;
    }
}

function showTaskboardDenied() {
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
    if (
        !taskboardStatus
    ) {
        return;
    }

    taskboardStatus.textContent =
        message;
}

/* =========================================================
VERIFY ADMIN ACCESS
========================================================= */

async function verifyAdminAccess() {
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
        return {
            authorized:
                false,

            status:
                response.status
        };
    }

    return {
        authorized:
            response.ok
            && result?.authorized === true,

        status:
            response.status
    };
}

/* =========================================================
LOAD ADMIN SIDEBAR
========================================================= */

async function loadAdminSidebar() {
    if (
        !sidebar
    ) {
        throw new Error(
            "Admin sidebar container was not found."
        );
    }

    const response =
        await fetch(
            ADMIN_SIDEBAR_URL,
            {
                cache:
                    "no-store"
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            `Admin sidebar failed: ${response.status}`
        );
    }

    sidebar.innerHTML =
        await response.text();
}

/* =========================================================
INITIALIZE ADMIN SHELL
========================================================= */

async function initializeAdminShell() {
    await loadAdminSidebar();

    await loadAdminSidebarHover();

    initializeAdminSidebar();
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
        throw new Error(
            `${url} returned a non-JSON response (${response.status}).`
        );
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

These requests are intentionally executed together so the
preliminary test verifies all three primary read endpoints.
========================================================= */

async function loadTaskboardData() {
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
    }
    catch (
        error
    ) {
        console.error(
            "[TASKBOARD DATA LOAD FAILED]",
            error
        );

        setTaskboardStatus(
            `Taskboard API test failed: ${error.message}`
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
========================================================= */

function setupTaskboardRefresh() {
    if (
        !taskboardRefresh
    ) {
        return;
    }

    taskboardRefresh.addEventListener(
        "click",
        async function() {
            try {
                await loadTaskboardData();
            }
            catch {
                /*
                 * Error is already displayed in the status
                 * area and logged by loadTaskboardData().
                 */
            }
        }
    );
}

/* =========================================================
INITIALIZE TASKBOARD
========================================================= */

async function initializeTaskboard() {
    setupTaskboardRefresh();

    await loadTaskboardData();
}

/* =========================================================
INITIALIZE TASKBOARD PAGE
========================================================= */

async function initializeTaskboardPage() {
    showTaskboardLoading();

    try {
        const access =
            await verifyAdminAccess();

        if (
            !access.authorized
        ) {
            if (
                access.status === 401
                || access.status === 403
            ) {
                showTaskboardDenied();
                return;
            }

            showTaskboardError(
                `Admin access verification failed (${access.status}).`
            );

            return;
        }

        await initializeAdminShell();

        showTaskboardAuthorized();

        try {
            await initializeTaskboard();
        }
        catch (
            error
        ) {
            /*
             * Keep the Taskboard visible during preliminary
             * testing so individual API failures can be read
             * directly from the status panel and console.
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

/* =========================================================
START
========================================================= */

initializeTaskboardPage();