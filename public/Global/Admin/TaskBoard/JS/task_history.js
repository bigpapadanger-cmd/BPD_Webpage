"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD TASK HISTORY CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_history.js

Purpose:
    Controls task history inside the Task Detail overlay.

Responsibilities:
    - Load recorded task events for the current task.
    - Render lifecycle, assignment, content, and comment
      history from admin.task_events.
    - Display event timestamps and actor information.
    - Display loading, empty, and error states.
    - Refresh independently after task changes.

Security:
    - This module is NOT a security boundary.
    - Task history access remains enforced server-side.
    - History is rendered only from recorded task events.
========================================================= */

/* =========================================================
MODULE STATE
========================================================= */

let historyState = {
    taskCode:
        "",

    events:
        [],

    loading:
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

function normalizeObject(
    value
) {
    return (
        value
        && typeof value ===
            "object"
        && !Array.isArray(
            value
        )
    )
        ? value
        : {};
}

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getHistoryElements() {
    const root =
        document.getElementById(
            "taskDetailHistory"
        );

    return {
        root
    };
}

/* =========================================================
API URL
========================================================= */

function getHistoryApiUrl() {
    const taskCode =
        normalizeString(
            historyState.taskCode
        );

    if (
        !taskCode
    ) {
        throw new Error(
            "A task code is required."
        );
    }

    return (
        `/api/auth/admin/tasks/${encodeURIComponent(taskCode)}/events`
    );
}

/* =========================================================
API ERROR
========================================================= */

function createHistoryError(
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
            || "Task history request failed."
        );

    error.code =
        normalizeString(
            code
        )
        || "TASK_HISTORY_FAILED";

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
REQUEST EVENTS
========================================================= */

async function requestTaskEvents() {
    const url =
        getHistoryApiUrl();

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
            createHistoryError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_HISTORY_NETWORK_ERROR",

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
        throw createHistoryError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_HISTORY_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createHistoryError({
            message:
                result?.message
                || result?.error
                || `Task history request failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_HISTORY_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    return result;
}

/* =========================================================
EVENT EXTRACTION
========================================================= */

function extractEvents(
    result
) {
    if (
        Array.isArray(
            result?.events
        )
    ) {
        return result.events;
    }

    if (
        Array.isArray(
            result?.data?.events
        )
    ) {
        return result.data.events;
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
            result
        )
    ) {
        return result;
    }

    return [];
}

/* =========================================================
EVENT VALUES
========================================================= */

function getEventType(
    event
) {
    return normalizeString(
        event?.event_type
        || event?.eventType
    )
        .toLowerCase();
}

function getEventActor(
    event
) {
    return (
        normalizeString(
            event?.actor_name
            || event?.actorName
            || event?.display_name
            || event?.displayName
            || event?.actor
        )
        || "Administrator"
    );
}

function getEventTimestamp(
    event
) {
    return normalizeString(
        event?.created_at
        || event?.createdAt
        || event?.timestamp
    );
}

function getEventNote(
    event
) {
    return normalizeString(
        event?.note
    );
}

function getPreviousData(
    event
) {
    return normalizeObject(
        event?.previous_data
        || event?.previousData
    );
}

function getNewData(
    event
) {
    return normalizeObject(
        event?.new_data
        || event?.newData
    );
}

/* =========================================================
DATE FORMAT
========================================================= */

function formatDateTime(
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
        return "";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            year:
                "numeric",

            month:
                "short",

            day:
                "numeric",

            hour:
                "numeric",

            minute:
                "2-digit"
        }
    )
        .format(
            new Date(
                timestamp
            )
        );
}

/* =========================================================
DISPLAY HELPERS
========================================================= */

function formatRoleName(
    role
) {
    switch (
        normalizeString(
            role
        )
            .toLowerCase()
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
            return normalizeString(
                role
            );
    }
}

function formatValue(
    value
) {
    if (
        value ===
        null
        || value ===
            undefined
        || value ===
            ""
    ) {
        return "—";
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return value
            .map(
                item =>
                    formatRoleName(
                        item
                    )
            )
            .join(
                ", "
            );
    }

    if (
        typeof value ===
        "object"
    ) {
        try {
            return JSON.stringify(
                value
            );
        }
        catch {
            return "[data]";
        }
    }

    return String(
        value
    );
}

/* =========================================================
EVENT LABEL
========================================================= */

function getEventLabel(
    event
) {
    switch (
        getEventType(
            event
        )
    ) {
        case "created":
            return "Task created";

        case "updated":
            return "Task updated";

        case "title_changed":
            return "Title changed";

        case "body_changed":
            return "Description changed";

        case "priority_changed":
            return "Priority changed";

        case "timeline_changed":
            return "Timeline changed";

        case "assignment_changed":
            return "Responsibility changed";

        case "status_changed":
            return "Status changed";

        case "completed":
            return "Task completed";

        case "reopened":
            return "Task reopened";

        case "shelved":
            return "Task shelved";

        case "restored":
            return "Task restored";

        case "archived":
            return "Task archived";

        case "deleted":
            return "Task deleted";

        case "comment":
            return "Comment added";

        default:
            return (
                getEventType(
                    event
                )
                || "Task activity"
            )
                .replaceAll(
                    "_",
                    " "
                );
    }
}

/* =========================================================
CHANGE DESCRIPTION
========================================================= */

function getChangedFieldDescription(
    previousData,
    newData,
    field,
    label
) {
    const before =
        previousData?.[
            field
        ];

    const after =
        newData?.[
            field
        ];

    if (
        before ===
            undefined
        && after ===
            undefined
    ) {
        return "";
    }

    return (
        `${label}: ${formatValue(before)} → ${formatValue(after)}`
    );
}

/* =========================================================
EVENT DESCRIPTION
========================================================= */

function getEventDescription(
    event
) {
    const type =
        getEventType(
            event
        );

    const note =
        getEventNote(
            event
        );

    const previousData =
        getPreviousData(
            event
        );

    const newData =
        getNewData(
            event
        );

    switch (
        type
    ) {
        case "created":
            return (
                note
                || "The task was created."
            );

        case "title_changed":
            return (
                getChangedFieldDescription(
                    previousData,
                    newData,
                    "title",
                    "Title"
                )
                || note
                || "The task title was changed."
            );

        case "body_changed":
            return (
                note
                || "The task description was changed."
            );

        case "priority_changed":
            return (
                getChangedFieldDescription(
                    previousData,
                    newData,
                    "priority",
                    "Priority"
                )
                || note
                || "The task priority was changed."
            );

        case "timeline_changed":
            return (
                getChangedFieldDescription(
                    previousData,
                    newData,
                    "timeline_days",
                    "Timeline"
                )
                || note
                || "The task timeline was changed."
            );

        case "assignment_changed":
            return (
                getChangedFieldDescription(
                    previousData,
                    newData,
                    "responsible_roles",
                    "Responsible roles"
                )
                || note
                || "Task responsibility was changed."
            );

        case "status_changed":
            return (
                getChangedFieldDescription(
                    previousData,
                    newData,
                    "status",
                    "Status"
                )
                || note
                || "The task status was changed."
            );

        case "completed":
            return (
                note
                || "The task was marked completed."
            );

        case "reopened":
            return (
                note
                || "The task was reopened."
            );

        case "shelved":
            return (
                note
                || "The task was shelved."
            );

        case "restored":
            return (
                note
                || "The task was restored."
            );

        case "archived":
            return (
                note
                || "The task was archived."
            );

        case "deleted":
            return (
                note
                || "The task was deleted."
            );

        case "comment":
            return (
                note
                || "A comment was added."
            );

        case "updated":
            return (
                note
                || "The task was updated."
            );

        default:
            return (
                note
                || "Task activity was recorded."
            );
    }
}

/* =========================================================
SORT EVENTS

Newest event first.
========================================================= */

function sortEvents(
    events
) {
    return [
        ...events
    ]
        .sort(
            (
                left,
                right
            ) => {
                const leftTime =
                    Date.parse(
                        getEventTimestamp(
                            left
                        )
                    );

                const rightTime =
                    Date.parse(
                        getEventTimestamp(
                            right
                        )
                    );

                const safeLeft =
                    Number.isFinite(
                        leftTime
                    )
                        ? leftTime
                        : 0;

                const safeRight =
                    Number.isFinite(
                        rightTime
                    )
                        ? rightTime
                        : 0;

                return (
                    safeRight
                    - safeLeft
                );
            }
        );
}

/* =========================================================
HISTORY ITEM
========================================================= */

function createHistoryItem(
    event
) {
    const item =
        document.createElement(
            "article"
        );

    item.className =
        "task-history-item";

    const title =
        document.createElement(
            "strong"
        );

    title.textContent =
        getEventLabel(
            event
        );

    const description =
        document.createElement(
            "p"
        );

    description.textContent =
        getEventDescription(
            event
        );

    const metadata =
        document.createElement(
            "p"
        );

    metadata.className =
        "task-history-meta";

    const actor =
        getEventActor(
            event
        );

    const timestamp =
        getEventTimestamp(
            event
        );

    const formattedTime =
        formatDateTime(
            timestamp
        );

    if (
        actor
        && formattedTime
    ) {
        metadata.textContent =
            `${actor} · ${formattedTime}`;
    }
    else if (
        actor
    ) {
        metadata.textContent =
            actor;
    }
    else {
        metadata.textContent =
            formattedTime;
    }

    item.append(
        title,
        description,
        metadata
    );

    return item;
}

/* =========================================================
RENDER HISTORY
========================================================= */

function renderHistory() {
    const {
        root
    } =
        getHistoryElements();

    if (
        !root
    ) {
        return;
    }

    root.replaceChildren();

    if (
        historyState.events.length ===
        0
    ) {
        const empty =
            document.createElement(
                "p"
            );

        empty.className =
            "task-dialog-empty";

        empty.textContent =
            "No task history has been recorded yet.";

        root.appendChild(
            empty
        );

        return;
    }

    const list =
        document.createElement(
            "div"
        );

    list.className =
        "task-history-list";

    const fragment =
        document.createDocumentFragment();

    for (
        const event of sortEvents(
            historyState.events
        )
    ) {
        fragment.appendChild(
            createHistoryItem(
                event
            )
        );
    }

    list.appendChild(
        fragment
    );

    root.appendChild(
        list
    );
}

/* =========================================================
LOADING STATE
========================================================= */

function renderHistoryLoading() {
    const {
        root
    } =
        getHistoryElements();

    if (
        !root
    ) {
        return;
    }

    root.replaceChildren();

    const loading =
        document.createElement(
            "p"
        );

    loading.className =
        "task-dialog-loading";

    loading.textContent =
        "Loading history...";

    root.appendChild(
        loading
    );
}

/* =========================================================
ERROR STATE
========================================================= */

function renderHistoryError(
    message
) {
    const {
        root
    } =
        getHistoryElements();

    if (
        !root
    ) {
        return;
    }

    root.replaceChildren();

    const error =
        document.createElement(
            "div"
        );

    error.className =
        "task-dialog-message";

    error.dataset.state =
        "error";

    error.textContent =
        normalizeString(
            message
        )
        || "Task history could not be loaded.";

    const actions =
        document.createElement(
            "div"
        );

    actions.className =
        "task-dialog-actions";

    const retry =
        document.createElement(
            "button"
        );

    retry.type =
        "button";

    retry.textContent =
        "Try Again";

    retry.addEventListener(
        "click",
        refreshTaskHistory
    );

    actions.appendChild(
        retry
    );

    root.append(
        error,
        actions
    );
}

/* =========================================================
LOAD HISTORY
========================================================= */

export async function refreshTaskHistory() {
    if (
        historyState.loading
    ) {
        return;
    }

    historyState.loading =
        true;

    renderHistoryLoading();

    try {
        const result =
            await requestTaskEvents();

        historyState.events =
            extractEvents(
                result
            );

        renderHistory();
    }
    catch (
        error
    ) {
        console.error(
            "[TASK HISTORY LOAD FAILED]",
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

        renderHistoryError(
            error?.message
            || "Task history could not be loaded."
        );
    }
    finally {
        historyState.loading =
            false;
    }
}

/* =========================================================
PUBLIC MOUNT
========================================================= */

export async function mountTaskHistory(
    {
        taskCode
    } = {}
) {
    const normalizedTaskCode =
        normalizeString(
            taskCode
        );

    if (
        !normalizedTaskCode
    ) {
        throw new Error(
            "Task History requires a task code."
        );
    }

    historyState = {
        taskCode:
            normalizedTaskCode,

        events:
            [],

        loading:
            false
    };

    await refreshTaskHistory();
}

/* =========================================================
PUBLIC CLEAR
========================================================= */

export function clearTaskHistory() {
    const {
        root
    } =
        getHistoryElements();

    historyState = {
        taskCode:
            "",

        events:
            [],

        loading:
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
            "Loading history...";

        root.appendChild(
            loading
        );
    }
}