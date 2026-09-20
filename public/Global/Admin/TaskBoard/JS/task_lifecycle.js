"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD TASK LIFECYCLE CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_lifecycle.js

Purpose:
    Controls lifecycle actions for an Admin Taskboard task.

Responsibilities:
    - Render lifecycle actions for the current task status.
    - Respect client-visible Admin permissions for UI display.
    - Use the shared Taskboard confirmation overlay.
    - Submit lifecycle actions to the protected Task API.
    - Display lifecycle success and failure messages.
    - Notify Task Detail after a successful state change.
    - Prevent duplicate lifecycle submissions.

Security:
    - This module is NOT a security boundary.
    - Client-visible permissions only control presentation.
    - The lifecycle API remains authoritative for:
          authorization
          task responsibility
          allowed transitions
          task state
          audit/event creation
          archive/delete permissions
========================================================= */

/* =========================================================
IMPORTS
========================================================= */

import {
    openTaskConfirm
} from "/Global/Admin/TaskBoard/JS/task_confirm.js";

/* =========================================================
PERMISSIONS
========================================================= */

const TASK_UPDATE_PERMISSION =
    "tasks.update";

const TASK_DELETE_PERMISSION =
    "tasks.delete";

/* =========================================================
SUPPORTED STATUS VALUES
========================================================= */

const TASK_STATUS = {
    TODO:
        "to do",

    IN_PROGRESS:
        "in progress",

    COMPLETED:
        "completed",

    SHELVED:
        "shelved",

    ARCHIVED:
        "archived",

    DELETED:
        "deleted"
};

/* =========================================================
LIFECYCLE ACTIONS

The server remains authoritative for transition validation.
========================================================= */

const LIFECYCLE_ACTIONS = {
    START: {
        action:
            "start",

        label:
            "Start Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Start Task",

        confirmationMessage:
            "Move this task into In Progress?",

        requireReason:
            false,

        danger:
            false
    },

    COMPLETE: {
        action:
            "complete",

        label:
            "Complete Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Complete Task",

        confirmationMessage:
            "Mark this task as completed?",

        requireReason:
            false,

        danger:
            false
    },

    REOPEN: {
        action:
            "reopen",

        label:
            "Reopen Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Reopen Task",

        confirmationMessage:
            "Reopen this completed task and return it to active work?",

        requireReason:
            false,

        danger:
            false
    },

    SHELVE: {
        action:
            "shelve",

        label:
            "Shelve Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Shelve Task",

        confirmationMessage:
            "Shelve this task and temporarily remove it from active work?",

        requireReason:
            true,

        reasonLabel:
            "Shelving Reason",

        reasonPlaceholder:
            "Explain why this task is being shelved...",

        danger:
            false
    },

    RESTORE: {
        action:
            "restore",

        label:
            "Restore Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Restore Task",

        confirmationMessage:
            "Restore this shelved task to active work?",

        requireReason:
            false,

        danger:
            false
    },

    ARCHIVE: {
        action:
            "archive",

        label:
            "Archive Task",

        permission:
            TASK_UPDATE_PERMISSION,

        confirmationTitle:
            "Archive Task",

        confirmationMessage:
            "Archive this task and remove it from active Taskboard work?",

        requireReason:
            true,

        reasonLabel:
            "Archive Reason",

        reasonPlaceholder:
            "Explain why this task is being archived...",

        danger:
            false
    },

    DELETE: {
        action:
            "delete",

        label:
            "Delete Task",

        permission:
            TASK_DELETE_PERMISSION,

        confirmationTitle:
            "Delete Task",

        confirmationMessage:
            "This task will be marked as deleted and the action will be recorded in task history.",

        requireReason:
            true,

        reasonLabel:
            "Deletion Reason",

        reasonPlaceholder:
            "Explain why this task is being deleted...",

        danger:
            true
    }
};

/* =========================================================
MODULE STATE
========================================================= */

let lifecycleState = {
    taskCode:
        "",

    task:
        null,

    permissions:
        [],

    onUpdated:
        null,

    submitting:
        false
};

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

function normalizeStatus(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
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

function getTaskStatus(
    task
) {
    return normalizeStatus(
        task?.status
    );
}

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getLifecycleElements() {
    const root =
        document.getElementById(
            "taskDetailLifecycle"
        );

    return {
        root,

        actions:
            root?.querySelector(
                "[data-task-lifecycle-actions]"
            )
            || null,

        message:
            root?.querySelector(
                "[data-task-lifecycle-message]"
            )
            || null
    };
}

/* =========================================================
PERMISSION CHECK
========================================================= */

function hasPermission(
    permission
) {
    if (
        !permission
    ) {
        return true;
    }

    return lifecycleState
        .permissions
        .includes(
            permission
        );
}

/* =========================================================
TRANSITIONS

These determine what the browser offers.

The API still decides whether the transition is valid.
========================================================= */

function getAvailableActions(
    task
) {
    const status =
        getTaskStatus(
            task
        );

    switch (
        status
    ) {
        case TASK_STATUS.TODO:
            return [
                LIFECYCLE_ACTIONS.START,
                LIFECYCLE_ACTIONS.SHELVE,
                LIFECYCLE_ACTIONS.ARCHIVE,
                LIFECYCLE_ACTIONS.DELETE
            ];

        case TASK_STATUS.IN_PROGRESS:
            return [
                LIFECYCLE_ACTIONS.COMPLETE,
                LIFECYCLE_ACTIONS.SHELVE,
                LIFECYCLE_ACTIONS.ARCHIVE,
                LIFECYCLE_ACTIONS.DELETE
            ];

        case TASK_STATUS.COMPLETED:
            return [
                LIFECYCLE_ACTIONS.REOPEN,
                LIFECYCLE_ACTIONS.ARCHIVE,
                LIFECYCLE_ACTIONS.DELETE
            ];

        case TASK_STATUS.SHELVED:
            return [
                LIFECYCLE_ACTIONS.RESTORE,
                LIFECYCLE_ACTIONS.ARCHIVE,
                LIFECYCLE_ACTIONS.DELETE
            ];

        case TASK_STATUS.ARCHIVED:
            return [
                LIFECYCLE_ACTIONS.DELETE
            ];

        case TASK_STATUS.DELETED:
            return [];

        default:
            return [];
    }
}

/* =========================================================
MESSAGE
========================================================= */

function clearLifecycleMessage() {
    const {
        message
    } =
        getLifecycleElements();

    if (
        !message
    ) {
        return;
    }

    message.textContent =
        "";

    message.hidden =
        true;

    message.removeAttribute(
        "data-state"
    );
}

function setLifecycleMessage(
    text,
    state =
        ""
) {
    const {
        message
    } =
        getLifecycleElements();

    if (
        !message
    ) {
        return;
    }

    message.textContent =
        normalizeString(
            text
        );

    message.hidden =
        false;

    if (
        state
    ) {
        message.dataset.state =
            state;
    }
    else {
        message.removeAttribute(
            "data-state"
        );
    }
}

/* =========================================================
ACTION BUTTON
========================================================= */

function createLifecycleButton(
    definition
) {
    const button =
        document.createElement(
            "button"
        );

    button.type =
        "button";

    button.textContent =
        definition.label;

    button.dataset.lifecycleAction =
        definition.action;

    if (
        definition.danger ===
        true
    ) {
        button.classList.add(
            "task-dialog-danger"
        );
    }

    button.addEventListener(
        "click",
        function() {
            handleLifecycleAction(
                definition
            );
        }
    );

    return button;
}

/* =========================================================
RENDER
========================================================= */

function renderLifecycleActions() {
    const {
        root
    } =
        getLifecycleElements();

    if (
        !root
    ) {
        return;
    }

    root.replaceChildren();

    const actionsContainer =
        document.createElement(
            "div"
        );

    actionsContainer.className =
        "task-dialog-lifecycle-actions";

    actionsContainer.dataset.taskLifecycleActions =
        "";

    const message =
        document.createElement(
            "div"
        );

    message.className =
        "task-dialog-message";

    message.dataset.taskLifecycleMessage =
        "";

    message.hidden =
        true;

    const availableActions =
        getAvailableActions(
            lifecycleState.task
        )
            .filter(
                definition =>
                    hasPermission(
                        definition.permission
                    )
            );

    if (
        availableActions.length ===
        0
    ) {
        const empty =
            document.createElement(
                "p"
            );

        empty.className =
            "task-dialog-empty";

        empty.textContent =
            "No lifecycle actions are currently available.";

        root.append(
            empty,
            message
        );

        return;
    }

    for (
        const definition of availableActions
    ) {
        actionsContainer.appendChild(
            createLifecycleButton(
                definition
            )
        );
    }

    root.append(
        actionsContainer,
        message
    );
}

/* =========================================================
DISABLE ACTIONS
========================================================= */

function setLifecycleSubmitting(
    submitting
) {
    lifecycleState.submitting =
        submitting;

    const {
        actions
    } =
        getLifecycleElements();

    if (
        !actions
    ) {
        return;
    }

    const buttons =
        actions.querySelectorAll(
            "button"
        );

    for (
        const button of buttons
    ) {
        button.disabled =
            submitting;
    }
}

/* =========================================================
CONFIRM ACTION
========================================================= */

async function confirmLifecycleAction(
    definition
) {
    const result =
        await openTaskConfirm({
            title:
                definition.confirmationTitle
                || definition.label,

            message:
                definition.confirmationMessage
                || `Confirm ${definition.label}.`,

            confirmLabel:
                definition.label,

            requireReason:
                definition.requireReason ===
                true,

            reasonLabel:
                definition.reasonLabel
                || "Reason",

            reasonPlaceholder:
                definition.reasonPlaceholder
                || "Provide a reason...",

            danger:
                definition.danger ===
                true
        });

    return {
        confirmed:
            result?.confirmed ===
            true,

        reason:
            normalizeString(
                result?.reason
            )
    };
}

/* =========================================================
API ERROR
========================================================= */

function createLifecycleError(
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
            || "The task could not be updated."
        );

    error.code =
        normalizeString(
            code
        )
        || "TASK_LIFECYCLE_FAILED";

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
LIFECYCLE API
========================================================= */

async function submitLifecycleAction(
    action,
    reason =
        ""
) {
    const taskCode =
        normalizeString(
            lifecycleState.taskCode
        );

    if (
        !taskCode
    ) {
        throw new Error(
            "A task code is required."
        );
    }

    const url =
        `/api/auth/admin/tasks/${encodeURIComponent(taskCode)}/lifecycle`;

    const payload = {
        action
    };

    if (
        reason
    ) {
        payload.reason =
            reason;
    }

    let response;

    try {
        response =
            await fetch(
                url,
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json",

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );
    }
    catch (
        cause
    ) {
        const error =
            createLifecycleError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_LIFECYCLE_NETWORK_ERROR",

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
        throw createLifecycleError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_LIFECYCLE_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createLifecycleError({
            message:
                result?.message
                || result?.error
                || `Task update failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_LIFECYCLE_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    return result;
}

/* =========================================================
UPDATED TASK EXTRACTION
========================================================= */

function extractUpdatedTask(
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

    return null;
}

/* =========================================================
ACTION HANDLER
========================================================= */

async function handleLifecycleAction(
    definition
) {
    if (
        lifecycleState.submitting
    ) {
        return;
    }

    clearLifecycleMessage();

    try {
        const confirmation =
            await confirmLifecycleAction(
                definition
            );

        if (
            !confirmation.confirmed
        ) {
            return;
        }

        setLifecycleSubmitting(
            true
        );

        setLifecycleMessage(
            `${definition.label}...`
        );

        const result =
            await submitLifecycleAction(
                definition.action,
                confirmation.reason
            );

        const updatedTask =
            extractUpdatedTask(
                result
            );

        if (
            updatedTask
        ) {
            lifecycleState.task =
                updatedTask;
        }

        if (
            typeof lifecycleState.onUpdated ===
            "function"
        ) {
            await lifecycleState.onUpdated(
                updatedTask,
                result
            );
        }

        /*
         * Re-render after the callback because the parent
         * may have refreshed the authoritative task record.
         */
        renderLifecycleActions();

        setLifecycleMessage(
            "Task updated successfully.",
            "success"
        );
    }
    catch (
        error
    ) {
        console.error(
            "[TASK LIFECYCLE FAILED]",
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

        setLifecycleMessage(
            error?.message
            || "The task could not be updated.",
            "error"
        );
    }
    finally {
        setLifecycleSubmitting(
            false
        );
    }
}

/* =========================================================
PUBLIC MOUNT
========================================================= */

export function mountTaskLifecycle(
    {
        task,
        taskCode =
            "",

        permissions =
            [],

        onUpdated =
            null
    } = {}
) {
    const resolvedTaskCode =
        normalizeString(
            taskCode
        )
        || getTaskCode(
            task
        );

    if (
        !resolvedTaskCode
    ) {
        throw new Error(
            "Task Lifecycle requires a task code."
        );
    }

    lifecycleState = {
        taskCode:
            resolvedTaskCode,

        task:
            task
            || null,

        permissions:
            normalizePermissions(
                permissions
            ),

        onUpdated:
            typeof onUpdated ===
                "function"
                ? onUpdated
                : null,

        submitting:
            false
    };

    renderLifecycleActions();
}

/* =========================================================
PUBLIC REFRESH
========================================================= */

export function refreshTaskLifecycle(
    task
) {
    if (
        task
    ) {
        lifecycleState.task =
            task;

        const taskCode =
            getTaskCode(
                task
            );

        if (
            taskCode
        ) {
            lifecycleState.taskCode =
                taskCode;
        }
    }

    renderLifecycleActions();
}

/* =========================================================
PUBLIC CLEAR
========================================================= */

export function clearTaskLifecycle() {
    const {
        root
    } =
        getLifecycleElements();

    lifecycleState = {
        taskCode:
            "",

        task:
            null,

        permissions:
            [],

        onUpdated:
            null,

        submitting:
            false
    };

    if (
        root
    ) {
        root.replaceChildren();

        const loading =
            document.createElement(
                "p"
            );

        loading.className =
            "task-dialog-loading";

        loading.textContent =
            "Loading task actions...";

        root.appendChild(
            loading
        );
    }
}