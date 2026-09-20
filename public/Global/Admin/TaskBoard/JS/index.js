"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASKBOARD CLIENT

File:
    public/Global/Admin/TaskBoard/JS/index.js

Purpose:
    Initializes and controls the Admin Taskboard interface.

Responsibilities:
    - Require centralized Admin authorization.
    - Require an active Admin responsibility role.
    - Load verified Taskboard role context.
    - Load task summary.
    - Load task list.
    - Load task assignees.
    - Render Taskboard summary information.
    - Render verified responsibility roles.
    - Render and filter the user's accessible tasks.
    - Control dashboard, create, review, and detail views.
    - Handle manual refresh and retry.
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
    - Client-side role claims are never authoritative.
    - Task APIs independently enforce permissions,
      membership, and task responsibility.
    - Supabase credentials never reach the browser.

Important:
    - This module does not call /api/auth/admin/access
      directly.
    - Centralized Admin authorization comes from auth.js.
    - This module does not initialize the sidebar.
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
CLIENT STATE
========================================================= */

const taskboardState = {
    access:
        null,

    summary:
        null,

    tasks:
        [],

    assignees:
        null,

    selectedTask:
        null,

    view:
        "dashboard",

    filters: {
        search:
            "",

        status:
            "active",

        priority:
            ""
    }
};

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

        taskboardRetry:
            document.getElementById(
                "taskboardRetry"
            ),

        taskboardStatus:
            document.getElementById(
                "taskboardStatus"
            ),

        taskboardRoleList:
            document.getElementById(
                "taskboardRoleList"
            ),

        taskboardRefresh:
            document.getElementById(
                "taskboardRefresh"
            ),

        taskboardActiveCount:
            document.getElementById(
                "taskboardActiveCount"
            ),

        taskboardCompletedCount:
            document.getElementById(
                "taskboardCompletedCount"
            ),

        taskboardShelvedCount:
            document.getElementById(
                "taskboardShelvedCount"
            ),

        taskboardLateCount:
            document.getElementById(
                "taskboardLateCount"
            ),

        taskboardMyTaskCount:
            document.getElementById(
                "taskboardMyTaskCount"
            ),

        taskboardCreateAction:
            document.getElementById(
                "taskboardCreateAction"
            ),

        taskboardReviewAction:
            document.getElementById(
                "taskboardReviewAction"
            ),

        taskboardCreateView:
            document.getElementById(
                "taskboardCreateView"
            ),

        taskboardReviewView:
            document.getElementById(
                "taskboardReviewView"
            ),

        taskboardTaskDetail:
            document.getElementById(
                "taskboardTaskDetail"
            ),

        taskboardCreateClose:
            document.getElementById(
                "taskboardCreateClose"
            ),

        taskboardCreateCancel:
            document.getElementById(
                "taskboardCreateCancel"
            ),

        taskboardCreateForm:
            document.getElementById(
                "taskboardCreateForm"
            ),

        taskboardReviewClose:
            document.getElementById(
                "taskboardReviewClose"
            ),

        taskboardTaskDetailClose:
            document.getElementById(
                "taskboardTaskDetailClose"
            ),

        taskboardTaskSearch:
            document.getElementById(
                "taskboardTaskSearch"
            ),

        taskboardStatusFilter:
            document.getElementById(
                "taskboardStatusFilter"
            ),

        taskboardPriorityFilter:
            document.getElementById(
                "taskboardPriorityFilter"
            ),

        taskboardTaskList:
            document.getElementById(
                "taskboardTaskList"
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

function normalizeArray(
    value
) {
    return Array.isArray(
        value
    )
        ? value
        : [];
}

/* =========================================================
TOP-LEVEL PAGE STATE
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
WORKSPACE VIEW STATE
========================================================= */

function hideTaskboardWorkspaces() {
    const {
        taskboardCreateView,
        taskboardReviewView,
        taskboardTaskDetail
    } =
        getTaskboardElements();

    if (
        taskboardCreateView
    ) {
        taskboardCreateView.hidden =
            true;
    }

    if (
        taskboardReviewView
    ) {
        taskboardReviewView.hidden =
            true;
    }

    if (
        taskboardTaskDetail
    ) {
        taskboardTaskDetail.hidden =
            true;
    }
}

function showDashboard() {
    hideTaskboardWorkspaces();

    taskboardState.view =
        "dashboard";

    taskboardState.selectedTask =
        null;
}

function showCreateView() {
    const {
        taskboardCreateView
    } =
        getTaskboardElements();

    hideTaskboardWorkspaces();

    taskboardState.view =
        "create";

    taskboardState.selectedTask =
        null;

    if (
        taskboardCreateView
    ) {
        taskboardCreateView.hidden =
            false;

        taskboardCreateView.scrollIntoView({
            behavior:
                "smooth",

            block:
                "start"
        });
    }
}

function showReviewView() {
    const {
        taskboardReviewView
    } =
        getTaskboardElements();

    hideTaskboardWorkspaces();

    taskboardState.view =
        "review";

    taskboardState.selectedTask =
        null;

    renderTaskList();

    if (
        taskboardReviewView
    ) {
        taskboardReviewView.hidden =
            false;

        taskboardReviewView.scrollIntoView({
            behavior:
                "smooth",

            block:
                "start"
        });
    }
}

function showTaskDetailView(
    task
) {
    const {
        taskboardReviewView,
        taskboardTaskDetail
    } =
        getTaskboardElements();

    hideTaskboardWorkspaces();

    taskboardState.view =
        "detail";

    taskboardState.selectedTask =
        task
        || null;

    if (
        taskboardReviewView
    ) {
        taskboardReviewView.hidden =
            true;
    }

    if (
        taskboardTaskDetail
    ) {
        taskboardTaskDetail.hidden =
            false;

        taskboardTaskDetail.scrollIntoView({
            behavior:
                "smooth",

            block:
                "start"
        });
    }
}

/* =========================================================
STATUS
========================================================= */

function setTaskboardStatus(
    message,
    state =
        ""
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

    const normalizedMessage =
        normalizeString(
            message
        );

    if (
        !normalizedMessage
    ) {
        taskboardStatus.textContent =
            "";

        taskboardStatus.hidden =
            true;

        taskboardStatus.removeAttribute(
            "data-state"
        );

        return;
    }

    taskboardStatus.textContent =
        normalizedMessage;

    taskboardStatus.hidden =
        false;

    if (
        state
    ) {
        taskboardStatus.dataset.state =
            state;
    }
    else {
        taskboardStatus.removeAttribute(
            "data-state"
        );
    }
}

/* =========================================================
CENTRALIZED TASKBOARD ACCESS
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
GET API REQUEST
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
TASK SUMMARY API
========================================================= */

async function loadTaskSummary() {
    return requestAdminApi(
        TASK_SUMMARY_URL
    );
}

/* =========================================================
TASK LIST API
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
TASK ASSIGNEES API
========================================================= */

async function loadTaskAssignees() {
    return requestAdminApi(
        TASK_ASSIGNEES_URL
    );
}

/* =========================================================
API RESULT EXTRACTION
========================================================= */

function extractTasks(
    result
) {
    if (
        Array.isArray(
            result?.tasks
        )
    ) {
        return result.tasks;
    }

    if (
        Array.isArray(
            result?.data
        )
    ) {
        return result.data;
    }

    if (
        Array.isArray(
            result?.items
        )
    ) {
        return result.items;
    }

    return [];
}

function getSummaryNumber(
    summary,
    keys
) {
    for (
        const key of keys
    ) {
        const value =
            summary?.[key];

        if (
            Number.isFinite(
                Number(
                    value
                )
            )
        ) {
            return Number(
                value
            );
        }
    }

    return 0;
}

/* =========================================================
ROLE RENDERING
========================================================= */

function formatRoleName(
    role
) {
    switch (
        role
    ) {
        case "owner":
            return "Owner";

        case "database":
            return "Database";

        case "security":
            return "Security";

        case "ui":
            return "UI";

        default:
            return role;
    }
}

function renderTaskboardRoles() {
    const {
        taskboardRoleList
    } =
        getTaskboardElements();

    if (
        !taskboardRoleList
    ) {
        return;
    }

    const roles =
        normalizeTaskboardRoles(
            taskboardState
                ?.access
                ?.taskboardRoles
        );

    taskboardRoleList.replaceChildren();

    for (
        const role of roles
    ) {
        const element =
            document.createElement(
                "span"
            );

        element.className =
            "taskboard-role";

        element.textContent =
            formatRoleName(
                role
            );

        taskboardRoleList.appendChild(
            element
        );
    }
}

/* =========================================================
SUMMARY RENDERING
========================================================= */

function renderTaskSummary() {
    const {
        taskboardActiveCount,
        taskboardCompletedCount,
        taskboardShelvedCount,
        taskboardLateCount,
        taskboardMyTaskCount
    } =
        getTaskboardElements();

    const summary =
        taskboardState.summary
        || {};

    const active =
        getSummaryNumber(
            summary,
            [
                "active",
                "activeCount",
                "active_count"
            ]
        );

    const completed =
        getSummaryNumber(
            summary,
            [
                "completed",
                "completedCount",
                "completed_count"
            ]
        );

    const shelved =
        getSummaryNumber(
            summary,
            [
                "shelved",
                "shelvedCount",
                "shelved_count"
            ]
        );

    const late =
        getSummaryNumber(
            summary,
            [
                "late",
                "lateCount",
                "late_count",
                "overdue",
                "overdueCount",
                "overdue_count"
            ]
        );

    if (
        taskboardActiveCount
    ) {
        taskboardActiveCount.textContent =
            String(
                active
            );
    }

    if (
        taskboardCompletedCount
    ) {
        taskboardCompletedCount.textContent =
            String(
                completed
            );
    }

    if (
        taskboardShelvedCount
    ) {
        taskboardShelvedCount.textContent =
            String(
                shelved
            );
    }

    if (
        taskboardLateCount
    ) {
        taskboardLateCount.textContent =
            String(
                late
            );
    }

    if (
        taskboardMyTaskCount
    ) {
        taskboardMyTaskCount.textContent =
            String(
                active
            );
    }
}

/* =========================================================
TASK NORMALIZATION
========================================================= */

function getTaskCode(
    task
) {
    return normalizeString(
        task?.task_code
        || task?.taskCode
        || task?.code
    );
}

function getTaskTitle(
    task
) {
    return normalizeString(
        task?.title
    )
    || "Untitled Task";
}

function getTaskBody(
    task
) {
    return normalizeString(
        task?.body
        || task?.description
    );
}

function getTaskStatus(
    task
) {
    return normalizeString(
        task?.status
    );
}

function getTaskPriority(
    task
) {
    return normalizeString(
        task?.priority
    );
}

function getTaskRoles(
    task
) {
    return normalizeTaskboardRoles(
        task?.responsible_roles
        || task?.responsibleRoles
    );
}

/* =========================================================
FILTER STATE
========================================================= */

function updateFilterState() {
    const {
        taskboardTaskSearch,
        taskboardStatusFilter,
        taskboardPriorityFilter
    } =
        getTaskboardElements();

    taskboardState.filters.search =
        normalizeString(
            taskboardTaskSearch
                ?.value
        )
            .toLowerCase();

    taskboardState.filters.status =
        normalizeString(
            taskboardStatusFilter
                ?.value
        )
            .toLowerCase();

    taskboardState.filters.priority =
        normalizeString(
            taskboardPriorityFilter
                ?.value
        )
            .toLowerCase();
}

function taskMatchesStatusFilter(
    task,
    filter
) {
    if (
        !filter
        || filter ===
            "all"
    ) {
        return true;
    }

    const status =
        getTaskStatus(
            task
        )
            .toLowerCase();

    if (
        filter ===
        "active"
    ) {
        return (
            status ===
                "to do"
            || status ===
                "in progress"
        );
    }

    return status ===
        filter;
}

function getFilteredTasks() {
    const {
        search,
        status,
        priority
    } =
        taskboardState.filters;

    return normalizeArray(
        taskboardState.tasks
    )
        .filter(
            task => {
                if (
                    !taskMatchesStatusFilter(
                        task,
                        status
                    )
                ) {
                    return false;
                }

                if (
                    priority
                    && getTaskPriority(
                        task
                    )
                        .toLowerCase() !==
                        priority
                ) {
                    return false;
                }

                if (
                    !search
                ) {
                    return true;
                }

                const searchable =
                    [
                        getTaskCode(
                            task
                        ),
                        getTaskTitle(
                            task
                        ),
                        getTaskBody(
                            task
                        ),
                        getTaskStatus(
                            task
                        ),
                        getTaskPriority(
                            task
                        ),
                        ...getTaskRoles(
                            task
                        )
                    ]
                        .join(
                            " "
                        )
                        .toLowerCase();

                return searchable.includes(
                    search
                );
            }
        );
}

/* =========================================================
TASK CARD
========================================================= */

function createTaskBadge(
    value
) {
    const badge =
        document.createElement(
            "span"
        );

    badge.className =
        "taskboard-task-badge";

    badge.textContent =
        value;

    return badge;
}

function createTaskCard(
    task
) {
    const card =
        document.createElement(
            "article"
        );

    card.className =
        "taskboard-task-card";

    const main =
        document.createElement(
            "div"
        );

    main.className =
        "taskboard-task-card-main";

    const header =
        document.createElement(
            "div"
        );

    header.className =
        "taskboard-task-card-header";

    const code =
        document.createElement(
            "span"
        );

    code.className =
        "taskboard-task-code";

    code.textContent =
        getTaskCode(
            task
        )
        || "TASK";

    header.appendChild(
        code
    );

    const title =
        document.createElement(
            "h3"
        );

    title.textContent =
        getTaskTitle(
            task
        );

    const description =
        document.createElement(
            "p"
        );

    description.textContent =
        getTaskBody(
            task
        )
        || "No description provided.";

    const metadata =
        document.createElement(
            "div"
        );

    metadata.className =
        "taskboard-task-card-meta";

    const status =
        getTaskStatus(
            task
        );

    const priority =
        getTaskPriority(
            task
        );

    if (
        status
    ) {
        metadata.appendChild(
            createTaskBadge(
                status
            )
        );
    }

    if (
        priority
    ) {
        metadata.appendChild(
            createTaskBadge(
                priority
            )
        );
    }

    for (
        const role of getTaskRoles(
            task
        )
    ) {
        metadata.appendChild(
            createTaskBadge(
                formatRoleName(
                    role
                )
            )
        );
    }

    main.append(
        header,
        title,
        description,
        metadata
    );

    const actions =
        document.createElement(
            "div"
        );

    actions.className =
        "taskboard-task-card-actions";

    const viewButton =
        document.createElement(
            "button"
        );

    viewButton.type =
        "button";

    viewButton.textContent =
        "View Task";

    viewButton.addEventListener(
        "click",
        function() {
            showTaskDetailView(
                task
            );
        }
    );

    actions.appendChild(
        viewButton
    );

    card.append(
        main,
        actions
    );

    return card;
}

/* =========================================================
TASK LIST RENDERING
========================================================= */

function renderTaskList() {
    const {
        taskboardTaskList
    } =
        getTaskboardElements();

    if (
        !taskboardTaskList
    ) {
        return;
    }

    const tasks =
        getFilteredTasks();

    taskboardTaskList.replaceChildren();

    if (
        tasks.length ===
        0
    ) {
        const empty =
            document.createElement(
                "p"
            );

        empty.className =
            "taskboard-empty-state";

        empty.textContent =
            "No tasks match the current filters.";

        taskboardTaskList.appendChild(
            empty
        );

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const task of tasks
    ) {
        fragment.appendChild(
            createTaskCard(
                task
            )
        );
    }

    taskboardTaskList.appendChild(
        fragment
    );
}

/* =========================================================
LOAD TASKBOARD DATA
========================================================= */

async function loadTaskboardData() {
    const {
        taskboardRefresh
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
            taskResult,
            assignees
        ] =
            await Promise.all([
                loadTaskSummary(),
                loadTaskList(),
                loadTaskAssignees()
            ]);

        taskboardState.summary =
            summary;

        taskboardState.tasks =
            extractTasks(
                taskResult
            );

        taskboardState.assignees =
            assignees;

        renderTaskSummary();

        renderTaskList();

        setTaskboardStatus(
            ""
        );

        console.log(
            "[TASKBOARD SUMMARY]",
            summary
        );

        console.log(
            "[TASKBOARD TASKS]",
            taskResult
        );

        console.log(
            "[TASKBOARD ASSIGNEES]",
            assignees
        );

        return {
            summary,
            tasks:
                taskResult,
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
            error?.message
            || "Taskboard data could not be loaded.",
            "error"
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
PRIMARY ACTIONS
========================================================= */

function setupPrimaryActions() {
    const {
        taskboardCreateAction,
        taskboardReviewAction
    } =
        getTaskboardElements();

    if (
        taskboardCreateAction
        && taskboardCreateAction
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardCreateAction.addEventListener(
            "click",
            showCreateView
        );

        taskboardCreateAction.dataset.initialized =
            "true";
    }

    if (
        taskboardReviewAction
        && taskboardReviewAction
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardReviewAction.addEventListener(
            "click",
            showReviewView
        );

        taskboardReviewAction.dataset.initialized =
            "true";
    }
}

/* =========================================================
CREATE WORKSPACE NAVIGATION
========================================================= */

function setupCreateNavigation() {
    const {
        taskboardCreateClose,
        taskboardCreateCancel,
        taskboardCreateForm
    } =
        getTaskboardElements();

    if (
        taskboardCreateClose
        && taskboardCreateClose
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardCreateClose.addEventListener(
            "click",
            showDashboard
        );

        taskboardCreateClose.dataset.initialized =
            "true";
    }

    if (
        taskboardCreateCancel
        && taskboardCreateCancel
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardCreateCancel.addEventListener(
            "click",
            function() {
                if (
                    taskboardCreateForm
                ) {
                    taskboardCreateForm.reset();
                }

                showDashboard();
            }
        );

        taskboardCreateCancel.dataset.initialized =
            "true";
    }
}

/* =========================================================
REVIEW WORKSPACE NAVIGATION
========================================================= */

function setupReviewNavigation() {
    const {
        taskboardReviewClose,
        taskboardTaskDetailClose
    } =
        getTaskboardElements();

    if (
        taskboardReviewClose
        && taskboardReviewClose
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardReviewClose.addEventListener(
            "click",
            showDashboard
        );

        taskboardReviewClose.dataset.initialized =
            "true";
    }

    if (
        taskboardTaskDetailClose
        && taskboardTaskDetailClose
            .dataset
            .initialized !==
            "true"
    ) {
        taskboardTaskDetailClose.addEventListener(
            "click",
            showReviewView
        );

        taskboardTaskDetailClose.dataset.initialized =
            "true";
    }
}

/* =========================================================
FILTER EVENTS
========================================================= */

function handleFilterChange() {
    updateFilterState();

    renderTaskList();
}

function setupTaskFilters() {
    const {
        taskboardTaskSearch,
        taskboardStatusFilter,
        taskboardPriorityFilter
    } =
        getTaskboardElements();

    const elements =
        [
            taskboardTaskSearch,
            taskboardStatusFilter,
            taskboardPriorityFilter
        ];

    for (
        const element of elements
    ) {
        if (
            !element
            || element
                .dataset
                .initialized ===
                "true"
        ) {
            continue;
        }

        const eventName =
            element ===
                taskboardTaskSearch
                ? "input"
                : "change";

        element.addEventListener(
            eventName,
            handleFilterChange
        );

        element.dataset.initialized =
            "true";
    }

    updateFilterState();
}

/* =========================================================
REFRESH
========================================================= */

async function refreshTaskboard() {
    const {
        taskboardRefresh
    } =
        getTaskboardElements();

    if (
        taskboardRefresh
        && taskboardRefresh.disabled
    ) {
        return;
    }

    if (
        taskboardRefresh
    ) {
        taskboardRefresh.disabled =
            true;
    }

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

        taskboardState.access =
            access;

        showTaskboardAuthorized();

        renderTaskboardRoles();

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
        if (
            taskboardRefresh
        ) {
            taskboardRefresh.disabled =
                false;
        }
    }
}

function setupTaskboardRefresh() {
    const {
        taskboardRefresh
    } =
        getTaskboardElements();

    if (
        !taskboardRefresh
        || taskboardRefresh
            .dataset
            .initialized ===
            "true"
    ) {
        return;
    }

    taskboardRefresh.addEventListener(
        "click",
        refreshTaskboard
    );

    taskboardRefresh.dataset.initialized =
        "true";
}

/* =========================================================
RETRY
========================================================= */

function setupTaskboardRetry() {
    const {
        taskboardRetry
    } =
        getTaskboardElements();

    if (
        !taskboardRetry
        || taskboardRetry
            .dataset
            .initialized ===
            "true"
    ) {
        return;
    }

    taskboardRetry.addEventListener(
        "click",
        function() {
            initializePage();
        }
    );

    taskboardRetry.dataset.initialized =
        "true";
}

/* =========================================================
INTERACTION SETUP
========================================================= */

function setupTaskboardInteractions() {
    setupPrimaryActions();

    setupCreateNavigation();

    setupReviewNavigation();

    setupTaskFilters();

    setupTaskboardRefresh();

    setupTaskboardRetry();
}

/* =========================================================
INITIALIZE TASKBOARD
========================================================= */

async function initializeTaskboard() {
    setupTaskboardInteractions();

    showDashboard();

    renderTaskboardRoles();

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
        AUTHORIZATION UNAVAILABLE
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

            setupTaskboardRetry();

            return;
        }

        /* -------------------------------------------------
        ACCESS DENIED
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

        taskboardState.access =
            access;

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
            if (
                error?.status ===
                    401
                || error?.status ===
                    403
            ) {
                showTaskboardDenied();

                return;
            }

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

        setupTaskboardRetry();
    }
}