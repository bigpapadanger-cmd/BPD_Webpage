"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD TASK DETAIL CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_detail.js

Purpose:
    Loads and controls the modular Task Detail overlay.

Responsibilities:
    - Load task_detail.html on demand.
    - Open and close the Task Detail overlay.
    - Load the authoritative task record by task code.
    - Render task metadata and description.
    - Dynamically load Task Lifecycle.
    - Dynamically load Task Comments.
    - Dynamically load Task History.
    - Dynamically load the Edit Task overlay.
    - Refresh dependent Taskboard systems after changes.
    - Notify the parent Taskboard after task updates.

Integrated Modules:
    task_lifecycle.js
    task_comments.js
    task_history.js
    task_edit.js

Security:
    - This module is NOT a security boundary.
    - Task access and task responsibility are enforced
      server-side by protected Admin Task APIs.
========================================================= */

/* =========================================================
ENDPOINTS
========================================================= */

const TASKS_API_URL =
    "/api/auth/admin/tasks";

/* =========================================================
SUPPORTED ROLES
========================================================= */

const TASKBOARD_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
MODULE STATE
========================================================= */

let taskDetailLoaded =
    false;

let taskDetailInitialized =
    false;

let taskDetailState = {
    taskCode:
        "",

    task:
        null,

    permissions:
        [],

    onUpdated:
        null,

    loading:
        false
};

/*
 * Dynamically loaded child modules are cached here after
 * their first successful import.
 *
 * Native ES module caching still applies as well. This local
 * cache simply avoids repeatedly resolving the same module.
 */
const taskDetailModules = {
    lifecycle:
        null,

    comments:
        null,

    history:
        null,

    edit:
        null
};

/* =========================================================
RESOURCE RESOLUTION

All Task Detail resources are resolved relative to this
module instead of using hardcoded site-root paths.

If this module is loaded as:
    task_detail.js?v=123

child JS modules and HTML assets receive:
    ?v=123

This keeps the Taskboard resource tree on the same deployed
asset version.
========================================================= */

function getRelativeResourceUrl(
    path
) {
    const currentModuleUrl =
        new URL(
            import.meta.url
        );

    const resourceUrl =
        new URL(
            path,
            currentModuleUrl
        );

    resourceUrl.search =
        currentModuleUrl.search;

    return resourceUrl.href;
}

function importSiblingModule(
    fileName
) {
    return import(
        getRelativeResourceUrl(
            fileName
        )
    );
}

function getTaskDetailTemplateUrl() {
    return getRelativeResourceUrl(
        "../HTML/task_detail.html"
    );
}

/* =========================================================
CHILD MODULE LOADING
========================================================= */

async function loadLifecycleModule() {
    if (
        taskDetailModules.lifecycle
    ) {
        return taskDetailModules.lifecycle;
    }

    const module =
        await importSiblingModule(
            "task_lifecycle.js"
        );

    if (
        typeof module.mountTaskLifecycle !==
            "function"
        || typeof module.clearTaskLifecycle !==
            "function"
    ) {
        throw new Error(
            "Task Lifecycle module is invalid."
        );
    }

    taskDetailModules.lifecycle =
        module;

    return module;
}

async function loadCommentsModule() {
    if (
        taskDetailModules.comments
    ) {
        return taskDetailModules.comments;
    }

    const module =
        await importSiblingModule(
            "task_comments.js"
        );

    if (
        typeof module.mountTaskComments !==
            "function"
        || typeof module.clearTaskComments !==
            "function"
        || typeof module.refreshTaskComments !==
            "function"
    ) {
        throw new Error(
            "Task Comments module is invalid."
        );
    }

    taskDetailModules.comments =
        module;

    return module;
}

async function loadHistoryModule() {
    if (
        taskDetailModules.history
    ) {
        return taskDetailModules.history;
    }

    const module =
        await importSiblingModule(
            "task_history.js"
        );

    if (
        typeof module.mountTaskHistory !==
            "function"
        || typeof module.clearTaskHistory !==
            "function"
        || typeof module.refreshTaskHistory !==
            "function"
    ) {
        throw new Error(
            "Task History module is invalid."
        );
    }

    taskDetailModules.history =
        module;

    return module;
}

async function loadEditModule() {
    if (
        taskDetailModules.edit
    ) {
        return taskDetailModules.edit;
    }

    const module =
        await importSiblingModule(
            "task_edit.js"
        );

    if (
        typeof module.openTaskEdit !==
            "function"
    ) {
        throw new Error(
            "Task Edit module is invalid."
        );
    }

    taskDetailModules.edit =
        module;

    return module;
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

function normalizeRoles(
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

function normalizePermissions(
    permissions
) {
    if (
        !Array.isArray(
            permissions
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            permissions
                .map(
                    permission =>
                        normalizeString(
                            permission
                        )
                )
                .filter(
                    Boolean
                )
        )
    ];
}

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getTaskDetailElements() {
    return {
        overlay:
            document.getElementById(
                "taskDetailOverlay"
            ),

        dialog:
            document.getElementById(
                "taskDetailDialog"
            ),

        header:
            document.querySelector(
                "#taskDetailDialog .task-dialog-header"
            ),

        close:
            document.getElementById(
                "taskDetailClose"
            ),

        edit:
            document.getElementById(
                "taskDetailEdit"
            ),

        loading:
            document.getElementById(
                "taskDetailLoading"
            ),

        content:
            document.getElementById(
                "taskDetailContent"
            ),

        error:
            document.getElementById(
                "taskDetailError"
            ),

        errorMessage:
            document.getElementById(
                "taskDetailErrorMessage"
            ),

        retry:
            document.getElementById(
                "taskDetailRetry"
            ),

        code:
            document.getElementById(
                "taskDetailCode"
            ),

        title:
            document.getElementById(
                "taskDetailTitle"
            ),

        status:
            document.getElementById(
                "taskDetailStatus"
            ),

        priority:
            document.getElementById(
                "taskDetailPriority"
            ),

        deadline:
            document.getElementById(
                "taskDetailDeadline"
            ),

        roles:
            document.getElementById(
                "taskDetailRoles"
            ),

        description:
            document.getElementById(
                "taskDetailDescriptionBody"
            ),

        lifecycleContainer:
            document.getElementById(
                "taskDetailLifecycle"
            ),

        commentsContainer:
            document.getElementById(
                "taskDetailComments"
            ),

        historyContainer:
            document.getElementById(
                "taskDetailHistory"
            )
    };
}

/* =========================================================
TEMPLATE LOADING
========================================================= */

async function loadTaskDetailTemplate() {
    const existing =
        document.getElementById(
            "taskDetailOverlay"
        );

    if (
        existing
    ) {
        taskDetailLoaded =
            true;

        return;
    }

    let response;

    try {
        response =
            await fetch(
                getTaskDetailTemplateUrl(),
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "text/html"
                    }
                }
            );
    }
    catch (
        cause
    ) {
        const error =
            new Error(
                "The Task Detail interface could not be loaded."
            );

        error.cause =
            cause;

        throw error;
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `The Task Detail interface could not be loaded (${response.status}).`
        );
    }

    const html =
        (
            await response.text()
        )
            .trim();

    if (
        !html
    ) {
        throw new Error(
            "The Task Detail template is empty."
        );
    }

    const template =
        document.createElement(
            "template"
        );

    template.innerHTML =
        html;

    const element =
        template.content.firstElementChild;

    if (
        !element
    ) {
        throw new Error(
            "The Task Detail template does not contain a root element."
        );
    }

    document.body.appendChild(
        element
    );

    taskDetailLoaded =
        true;
}

/* =========================================================
EDIT BUTTON
========================================================= */

function ensureTaskEditButton() {
    const {
        header,
        close
    } =
        getTaskDetailElements();

    if (
        !header
        || !close
    ) {
        return;
    }

    if (
        document.getElementById(
            "taskDetailEdit"
        )
    ) {
        return;
    }

    const button =
        document.createElement(
            "button"
        );

    button.id =
        "taskDetailEdit";

    button.className =
        "task-dialog-primary";

    button.type =
        "button";

    button.textContent =
        "Edit Task";

    header.insertBefore(
        button,
        close
    );
}

/* =========================================================
API ERROR
========================================================= */

function createTaskDetailError(
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
            || "Task Detail request failed."
        );

    error.code =
        normalizeString(
            code
        )
        || "TASK_DETAIL_REQUEST_FAILED";

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
TASK DETAIL API
========================================================= */

async function loadTaskDetail(
    taskCode
) {
    const normalizedTaskCode =
        normalizeString(
            taskCode
        );

    if (
        !normalizedTaskCode
    ) {
        throw new Error(
            "A task code is required."
        );
    }

    const url =
        `${TASKS_API_URL}/${encodeURIComponent(normalizedTaskCode)}`;

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
            createTaskDetailError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_DETAIL_NETWORK_ERROR",

                status:
                    null
            });

        error.cause =
            cause;

        throw error;
    }

    let result;

    try {
        result =
            await response.json();
    }
    catch {
        throw createTaskDetailError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_DETAIL_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createTaskDetailError({
            message:
                result?.message
                || result?.error
                || `Task Detail request failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_DETAIL_REQUEST_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    return result;
}

/* =========================================================
TASK EXTRACTION
========================================================= */

function extractTask(
    result
) {
    if (
        result?.task
        && typeof result.task ===
            "object"
    ) {
        return result.task;
    }

    if (
        result?.data?.task
        && typeof result.data.task ===
            "object"
    ) {
        return result.data.task;
    }

    if (
        result?.data
        && typeof result.data ===
            "object"
        && !Array.isArray(
            result.data
        )
    ) {
        return result.data;
    }

    if (
        result
        && typeof result ===
            "object"
        && !Array.isArray(
            result
        )
    ) {
        return result;
    }

    return null;
}

/* =========================================================
TASK VALUES
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
    return (
        normalizeString(
            task?.title
        )
        || "Untitled Task"
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

function getTaskDeadline(
    task
) {
    return normalizeString(
        task?.deadline
        || task?.deadline_at
        || task?.deadlineAt
    );
}

function getTaskRoles(
    task
) {
    return normalizeRoles(
        task?.responsible_roles
        || task?.responsibleRoles
    );
}

function getTaskDescription(
    task
) {
    return normalizeString(
        task?.body
        || task?.description
    );
}

/* =========================================================
ROLE DISPLAY
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

/* =========================================================
DATE DISPLAY
========================================================= */

function formatDate(
    value
) {
    const timestamp =
        Date.parse(
            normalizeString(
                value
            )
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            year:
                "numeric",

            month:
                "short",

            day:
                "numeric"
        }
    )
        .format(
            new Date(
                timestamp
            )
        );
}

/* =========================================================
VIEW STATE
========================================================= */

function hideTaskDetailStates() {
    const {
        loading,
        content,
        error
    } =
        getTaskDetailElements();

    if (
        loading
    ) {
        loading.hidden =
            true;
    }

    if (
        content
    ) {
        content.hidden =
            true;
    }

    if (
        error
    ) {
        error.hidden =
            true;
    }
}

function showTaskDetailLoading() {
    const {
        loading
    } =
        getTaskDetailElements();

    hideTaskDetailStates();

    if (
        loading
    ) {
        loading.hidden =
            false;
    }
}

function showTaskDetailContent() {
    const {
        content
    } =
        getTaskDetailElements();

    hideTaskDetailStates();

    if (
        content
    ) {
        content.hidden =
            false;
    }
}

function showTaskDetailError(
    message
) {
    const {
        error,
        errorMessage
    } =
        getTaskDetailElements();

    hideTaskDetailStates();

    if (
        errorMessage
    ) {
        errorMessage.textContent =
            normalizeString(
                message
            )
            || "The task could not be loaded.";
    }

    if (
        error
    ) {
        error.hidden =
            false;
    }
}

/* =========================================================
RENDER TASK
========================================================= */

function renderTaskDetail(
    task
) {
    const {
        code,
        title,
        status,
        priority,
        deadline,
        roles,
        description
    } =
        getTaskDetailElements();

    if (
        code
    ) {
        code.textContent =
            getTaskCode(
                task
            )
            || "Task";
    }

    if (
        title
    ) {
        title.textContent =
            getTaskTitle(
                task
            );
    }

    if (
        status
    ) {
        status.textContent =
            getTaskStatus(
                task
            )
            || "—";
    }

    if (
        priority
    ) {
        priority.textContent =
            getTaskPriority(
                task
            )
            || "—";
    }

    if (
        deadline
    ) {
        deadline.textContent =
            formatDate(
                getTaskDeadline(
                    task
                )
            );
    }

    if (
        roles
    ) {
        const values =
            getTaskRoles(
                task
            );

        roles.textContent =
            values.length >
                0
                ? values
                    .map(
                        formatRoleName
                    )
                    .join(
                        ", "
                    )
                : "—";
    }

    if (
        description
    ) {
        description.textContent =
            getTaskDescription(
                task
            )
            || "No description provided.";
    }
}

/* =========================================================
CLEAR SUBSYSTEMS
========================================================= */

function clearTaskSubsystems() {
    try {
        taskDetailModules
            .lifecycle
            ?.clearTaskLifecycle
            ?.();
    }
    catch (
        error
    ) {
        console.warn(
            "[TASK DETAIL LIFECYCLE CLEAR FAILED]",
            error
        );
    }

    try {
        taskDetailModules
            .comments
            ?.clearTaskComments
            ?.();
    }
    catch (
        error
    ) {
        console.warn(
            "[TASK DETAIL COMMENTS CLEAR FAILED]",
            error
        );
    }

    try {
        taskDetailModules
            .history
            ?.clearTaskHistory
            ?.();
    }
    catch (
        error
    ) {
        console.warn(
            "[TASK DETAIL HISTORY CLEAR FAILED]",
            error
        );
    }
}

/* =========================================================
MOUNT SUBSYSTEMS
========================================================= */

async function mountTaskSubsystems(
    task
) {
    const taskCode =
        getTaskCode(
            task
        );

    if (
        !taskCode
    ) {
        return;
    }

    const [
        lifecycleModule,
        commentsModule,
        historyModule
    ] =
        await Promise.all([
            loadLifecycleModule(),
            loadCommentsModule(),
            loadHistoryModule()
        ]);

    /*
     * Lifecycle renders synchronously after its module has
     * loaded.
     */
    lifecycleModule.mountTaskLifecycle({
        task,

        taskCode,

        permissions:
            taskDetailState.permissions,

        onUpdated:
            handleLifecycleUpdated
    });

    /*
     * Comments and history both request task events and may
     * load concurrently.
     */
    await Promise.allSettled([
        commentsModule.mountTaskComments({
            taskCode,

            onUpdated:
                handleCommentsUpdated
        }),

        historyModule.mountTaskHistory({
            taskCode
        })
    ]);
}

/* =========================================================
PARENT NOTIFICATION
========================================================= */

async function notifyParentUpdated(
    task,
    result =
        null
) {
    if (
        typeof taskDetailState.onUpdated !==
        "function"
    ) {
        return;
    }

    await taskDetailState.onUpdated(
        task,
        result
    );
}

/* =========================================================
REFRESH AUTHORITATIVE TASK

refreshSubsystems:
    true
        Reload lifecycle/comments/history.

    false
        Reload only the task record.
========================================================= */

async function refreshTaskDetail(
    {
        refreshSubsystems =
            true,

        notifyParent =
            false
    } = {}
) {
    const taskCode =
        normalizeString(
            taskDetailState.taskCode
        );

    if (
        !taskCode
        || taskDetailState.loading
    ) {
        return taskDetailState.task;
    }

    taskDetailState.loading =
        true;

    showTaskDetailLoading();

    if (
        refreshSubsystems
    ) {
        clearTaskSubsystems();
    }

    try {
        const result =
            await loadTaskDetail(
                taskCode
            );

        const task =
            extractTask(
                result
            );

        if (
            !task
        ) {
            throw new Error(
                "The Taskboard returned an invalid task record."
            );
        }

        taskDetailState.task =
            task;

        renderTaskDetail(
            task
        );

        showTaskDetailContent();

        if (
            refreshSubsystems
        ) {
            await mountTaskSubsystems(
                task
            );
        }

        if (
            notifyParent
        ) {
            await notifyParentUpdated(
                task,
                result
            );
        }

        return task;
    }
    catch (
        error
    ) {
        console.error(
            "[TASK DETAIL LOAD FAILED]",
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

        showTaskDetailError(
            error?.message
            || "The task could not be loaded."
        );

        return null;
    }
    finally {
        taskDetailState.loading =
            false;
    }
}

/* =========================================================
LIFECYCLE UPDATED
========================================================= */

async function handleLifecycleUpdated(
    updatedTask,
    result
) {
    if (
        updatedTask
    ) {
        taskDetailState.task =
            updatedTask;
    }

    const task =
        await refreshTaskDetail({
            refreshSubsystems:
                true,

            notifyParent:
                false
        });

    await notifyParentUpdated(
        task
        || updatedTask,
        result
    );
}

/* =========================================================
COMMENTS UPDATED
========================================================= */

async function handleCommentsUpdated() {
    try {
        const historyModule =
            await loadHistoryModule();

        await historyModule.refreshTaskHistory();
    }
    catch (
        error
    ) {
        console.error(
            "[TASK DETAIL HISTORY REFRESH FAILED]",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );
    }
}

/* =========================================================
EDIT TASK
========================================================= */

async function handleEditTask() {
    const task =
        taskDetailState.task;

    if (
        !task
    ) {
        return;
    }

    try {
        const editModule =
            await loadEditModule();

        await editModule.openTaskEdit(
            task,
            {
                onUpdated:
                    handleEditUpdated
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "[TASK DETAIL EDIT OPEN FAILED]",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );
    }
}

/* =========================================================
EDIT UPDATED
========================================================= */

async function handleEditUpdated(
    updatedTask,
    result
) {
    if (
        updatedTask
    ) {
        taskDetailState.task =
            updatedTask;
    }

    const task =
        await refreshTaskDetail({
            refreshSubsystems:
                true,

            notifyParent:
                false
        });

    await notifyParentUpdated(
        task
        || updatedTask,
        result
    );
}

/* =========================================================
OPEN
========================================================= */

export async function openTaskDetail(
    taskCode,
    context =
        {}
) {
    const normalizedTaskCode =
        normalizeString(
            taskCode
        );

    if (
        !normalizedTaskCode
    ) {
        throw new Error(
            "A task code is required to open Task Detail."
        );
    }

    await loadTaskDetailTemplate();

    ensureTaskEditButton();

    setupTaskDetail();

    taskDetailState = {
        taskCode:
            normalizedTaskCode,

        task:
            null,

        permissions:
            normalizePermissions(
                context?.permissions
            ),

        onUpdated:
            typeof context?.onUpdated ===
                "function"
                ? context.onUpdated
                : null,

        loading:
            false
    };

    const {
        overlay
    } =
        getTaskDetailElements();

    if (
        overlay
    ) {
        overlay.hidden =
            false;
    }

    document.documentElement.classList.add(
        "task-overlay-open"
    );

    await refreshTaskDetail({
        refreshSubsystems:
            true
    });
}

/* =========================================================
OVERLAY LOCK
========================================================= */

function synchronizeOverlayLock() {
    const visibleOverlay =
        Array.from(
            document.querySelectorAll(
                ".task-overlay"
            )
        )
            .some(
                overlay =>
                    overlay.hidden ===
                    false
            );

    document.documentElement.classList.toggle(
        "task-overlay-open",
        visibleOverlay
    );
}

/* =========================================================
CLOSE
========================================================= */

export function closeTaskDetail() {
    const {
        overlay
    } =
        getTaskDetailElements();

    clearTaskSubsystems();

    if (
        overlay
    ) {
        overlay.hidden =
            true;
    }

    taskDetailState = {
        taskCode:
            "",

        task:
            null,

        permissions:
            [],

        onUpdated:
            null,

        loading:
            false
    };

    synchronizeOverlayLock();
}

/* =========================================================
RETRY
========================================================= */

function handleRetry() {
    refreshTaskDetail({
        refreshSubsystems:
            true
    });
}

/* =========================================================
KEYBOARD
========================================================= */

function handleKeydown(
    event
) {
    if (
        event.key !==
        "Escape"
    ) {
        return;
    }

    const {
        overlay
    } =
        getTaskDetailElements();

    if (
        !overlay
        || overlay.hidden
    ) {
        return;
    }

    /*
     * If another Taskboard overlay is currently above
     * Task Detail, allow that overlay to handle Escape.
     */
    const visibleOverlays =
        Array.from(
            document.querySelectorAll(
                ".task-overlay"
            )
        )
            .filter(
                element =>
                    element.hidden ===
                    false
            );

    if (
        visibleOverlays.length >
        1
    ) {
        return;
    }

    closeTaskDetail();
}

/* =========================================================
BACKDROP
========================================================= */

function handleBackdropClick(
    event
) {
    const {
        overlay
    } =
        getTaskDetailElements();

    if (
        !overlay
        || event.target !==
            overlay
    ) {
        return;
    }

    closeTaskDetail();
}

/* =========================================================
SETUP
========================================================= */

function setupTaskDetail() {
    if (
        taskDetailInitialized
    ) {
        return;
    }

    const {
        overlay,
        close,
        edit,
        retry
    } =
        getTaskDetailElements();

    if (
        !overlay
    ) {
        throw new Error(
            "The Task Detail interface is incomplete."
        );
    }

    close?.addEventListener(
        "click",
        closeTaskDetail
    );

    edit?.addEventListener(
        "click",
        handleEditTask
    );

    retry?.addEventListener(
        "click",
        handleRetry
    );

    overlay.addEventListener(
        "click",
        handleBackdropClick
    );

    document.addEventListener(
        "keydown",
        handleKeydown
    );

    taskDetailInitialized =
        true;
}

/* =========================================================
PUBLIC REFRESH
========================================================= */

export async function refreshOpenTaskDetail() {
    return refreshTaskDetail({
        refreshSubsystems:
            true
    });
}

/* =========================================================
PUBLIC CURRENT TASK
========================================================= */

export function getOpenTaskDetail() {
    return taskDetailState.task;
}