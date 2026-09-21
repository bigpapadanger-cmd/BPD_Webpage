"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD CREATE TASK CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/create_task.js

Purpose:
    Loads and controls the modular Create Task overlay.

Responsibilities:
    - Load create_task.html on demand.
    - Render the Create Task interface over the Taskboard.
    - Populate priority-dependent timeline choices.
    - Validate task creation input.
    - Submit new tasks to the protected Admin Task API.
    - Display success and failure messages.
    - Notify the parent Taskboard controller after creation.
    - Cleanly close and reset the overlay.

Security:
    - This module is NOT a security boundary.
    - Client validation exists for UX only.
    - The server remains authoritative for:
          permissions
          responsibility membership
          field validation
          timeline rules
          task creation
    - Actor/account identity is derived server-side.
========================================================= */

/* =========================================================
ENDPOINTS
========================================================= */

const CREATE_TASK_API_URL =
    "/api/auth/admin/tasks";

/* =========================================================
RESOURCE RESOLUTION

The Create Task template is resolved relative to this module
instead of using a hardcoded site-root path.

If this module is loaded as:
    create_task.js?v=123

the template will be requested as:
    ../HTML/create_task.html?v=123
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

function getCreateTaskTemplateUrl() {
    return getRelativeResourceUrl(
        "../HTML/create_task.html"
    );
}

/* =========================================================
SUPPORTED RESPONSIBILITY ROLES
========================================================= */

const TASKBOARD_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
TIMELINE RULES

These mirror server-side validation.

The server remains authoritative.
========================================================= */

const TASK_TIMELINE_RULES = {
    Low:
        [30],

    Medium:
        [14],

    High:
        createNumberRange(
            5,
            13
        ),

    Critical:
        createNumberRange(
            3,
            10
        )
};

/* =========================================================
MODULE STATE
========================================================= */

let createTaskLoaded =
    false;

let createTaskInitialized =
    false;

let createTaskContext = {
    access:
        null,

    roles:
        [],

    onCreated:
        null
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

function createNumberRange(
    minimum,
    maximum
) {
    const values =
        [];

    for (
        let value =
            minimum;
        value <=
            maximum;
        value +=
            1
    ) {
        values.push(
            value
        );
    }

    return values;
}

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getCreateTaskElements() {
    return {
        overlay:
            document.getElementById(
                "taskCreateOverlay"
            ),

        dialog:
            document.getElementById(
                "taskCreateDialog"
            ),

        form:
            document.getElementById(
                "taskCreateForm"
            ),

        close:
            document.getElementById(
                "taskCreateClose"
            ),

        cancel:
            document.getElementById(
                "taskCreateCancel"
            ),

        submit:
            document.getElementById(
                "taskCreateSubmit"
            ),

        title:
            document.getElementById(
                "taskCreateName"
            ),

        body:
            document.getElementById(
                "taskCreateBody"
            ),

        priority:
            document.getElementById(
                "taskCreatePriority"
            ),

        timeline:
            document.getElementById(
                "taskCreateTimeline"
            ),

        timelineHelp:
            document.getElementById(
                "taskCreateTimelineHelp"
            ),

        message:
            document.getElementById(
                "taskCreateMessage"
            )
    };
}

/* =========================================================
TEMPLATE LOADING
========================================================= */

async function loadCreateTaskTemplate() {
    const existing =
        document.getElementById(
            "taskCreateOverlay"
        );

    if (
        existing
    ) {
        createTaskLoaded =
            true;

        return;
    }

    let response;

    try {
        response =
            await fetch(
                getCreateTaskTemplateUrl(),
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
                "The Create Task interface could not be loaded."
            );

        error.cause =
            cause;

        throw error;
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `The Create Task interface could not be loaded (${response.status}).`
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
            "The Create Task template is empty."
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
            "The Create Task template does not contain a root element."
        );
    }

    document.body.appendChild(
        element
    );

    createTaskLoaded =
        true;
}

/* =========================================================
MESSAGE
========================================================= */

function clearCreateTaskMessage() {
    const {
        message
    } =
        getCreateTaskElements();

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

function setCreateTaskMessage(
    text,
    state =
        ""
) {
    const {
        message
    } =
        getCreateTaskElements();

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
TIMELINE OPTIONS
========================================================= */

function resetTimelineOptions() {
    const {
        timeline,
        timelineHelp
    } =
        getCreateTaskElements();

    if (
        !timeline
    ) {
        return;
    }

    timeline.replaceChildren();

    const option =
        document.createElement(
            "option"
        );

    option.value =
        "";

    option.textContent =
        "Select priority first";

    option.selected =
        true;

    timeline.appendChild(
        option
    );

    timeline.disabled =
        true;

    if (
        timelineHelp
    ) {
        timelineHelp.textContent =
            "Timeline options depend on task priority.";
    }
}

function populateTimelineOptions() {
    const {
        priority,
        timeline,
        timelineHelp
    } =
        getCreateTaskElements();

    if (
        !priority
        || !timeline
    ) {
        return;
    }

    const priorityValue =
        normalizeString(
            priority.value
        );

    const values =
        TASK_TIMELINE_RULES[
            priorityValue
        ]
        || [];

    timeline.replaceChildren();

    if (
        values.length ===
        0
    ) {
        resetTimelineOptions();

        return;
    }

    const placeholder =
        document.createElement(
            "option"
        );

    placeholder.value =
        "";

    placeholder.textContent =
        "Select timeline";

    placeholder.disabled =
        true;

    placeholder.selected =
        true;

    timeline.appendChild(
        placeholder
    );

    for (
        const days of values
    ) {
        const option =
            document.createElement(
                "option"
            );

        option.value =
            String(
                days
            );

        option.textContent =
            days ===
                1
                ? "1 day"
                : `${days} days`;

        timeline.appendChild(
            option
        );
    }

    timeline.disabled =
        false;

    if (
        timelineHelp
    ) {
        if (
            values.length ===
            1
        ) {
            timelineHelp.textContent =
                `${priorityValue} tasks use a ${values[0]}-day timeline.`;
        }
        else {
            timelineHelp.textContent =
                `${priorityValue} tasks allow ${values[0]}–${values.at(-1)} days.`;
        }
    }
}

/* =========================================================
AVAILABLE RESPONSIBILITY ROLES
========================================================= */

function applyAvailableRoles() {
    const roles =
        normalizeRoles(
            createTaskContext.roles
        );

    const inputs =
        document.querySelectorAll(
            '#taskCreateForm input[name="responsible_roles"]'
        );

    for (
        const input of inputs
    ) {
        const role =
            normalizeString(
                input.value
            )
                .toLowerCase();

        const label =
            input.closest(
                "label"
            );

        const supported =
            TASKBOARD_ROLES.has(
                role
            );

        input.disabled =
            !supported;

        if (
            label
        ) {
            label.hidden =
                !supported;
        }
    }

    return roles;
}

/* =========================================================
PAYLOAD
========================================================= */

function getCreateTaskPayload() {
    const {
        form
    } =
        getCreateTaskElements();

    if (
        !form
    ) {
        throw new Error(
            "The Create Task form is unavailable."
        );
    }

    const formData =
        new FormData(
            form
        );

    const title =
        normalizeString(
            formData.get(
                "title"
            )
        );

    const body =
        normalizeString(
            formData.get(
                "body"
            )
        );

    const priority =
        normalizeString(
            formData.get(
                "priority"
            )
        );

    const timelineDays =
        Number(
            formData.get(
                "timeline_days"
            )
        );

    const responsibleRoles =
        normalizeRoles(
            formData.getAll(
                "responsible_roles"
            )
        );

    if (
        title.length <
            1
        || title.length >
            160
    ) {
        throw new Error(
            "Task title must be between 1 and 160 characters."
        );
    }

    if (
        body.length <
            1
        || body.length >
            10000
    ) {
        throw new Error(
            "Task description must be between 1 and 10,000 characters."
        );
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            TASK_TIMELINE_RULES,
            priority
        )
    ) {
        throw new Error(
            "Select a valid task priority."
        );
    }

    if (
        !Number.isInteger(
            timelineDays
        )
        || !TASK_TIMELINE_RULES[
            priority
        ]
            .includes(
                timelineDays
            )
    ) {
        throw new Error(
            "Select a valid timeline for this priority."
        );
    }

    if (
        responsibleRoles.length ===
        0
    ) {
        throw new Error(
            "Select at least one responsible role."
        );
    }

    return {
        title,

        body,

        priority,

        timeline_days:
            timelineDays,

        responsible_roles:
            responsibleRoles
    };
}

/* =========================================================
API ERROR
========================================================= */

function createApiError(
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
            || "Task creation failed."
        );

    error.code =
        normalizeString(
            code
        )
        || "TASK_CREATE_FAILED";

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
CREATE TASK API

The route requires the mutable task fields inside a single
top-level "task" object.
========================================================= */

async function createTask(
    payload
) {
    let response;

    const requestBody = {
        task:
            payload
    };

    try {
        response =
            await fetch(
                CREATE_TASK_API_URL,
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
                            requestBody
                        )
                }
            );
    }
    catch (
        cause
    ) {
        const error =
            createApiError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_CREATE_NETWORK_ERROR",

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
        throw createApiError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_CREATE_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createApiError({
            message:
                result?.message
                || result?.error
                || `Task creation failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_CREATE_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    return result;
}

/* =========================================================
CREATED TASK EXTRACTION
========================================================= */

function extractCreatedTask(
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
SUBMISSION STATE
========================================================= */

function setSubmitting(
    submitting
) {
    const {
        submit,
        close,
        cancel
    } =
        getCreateTaskElements();

    if (
        submit
    ) {
        submit.disabled =
            submitting;

        submit.textContent =
            submitting
                ? "Creating..."
                : "Create Task";
    }

    if (
        close
    ) {
        close.disabled =
            submitting;
    }

    if (
        cancel
    ) {
        cancel.disabled =
            submitting;
    }
}

/* =========================================================
FORM RESET
========================================================= */

function resetCreateTaskForm() {
    const {
        form
    } =
        getCreateTaskElements();

    if (
        form
    ) {
        form.reset();
    }

    resetTimelineOptions();

    clearCreateTaskMessage();
}

/* =========================================================
OPEN / CLOSE
========================================================= */

export async function openCreateTask(
    context =
        {}
) {
    await loadCreateTaskTemplate();

    createTaskContext = {
        access:
            context?.access
            || null,

        roles:
            normalizeRoles(
                context?.roles
            ),

        onCreated:
            typeof context?.onCreated ===
                "function"
                ? context.onCreated
                : null
    };

    setupCreateTask();

    applyAvailableRoles();

    resetCreateTaskForm();

    const {
        overlay,
        title
    } =
        getCreateTaskElements();

    if (
        overlay
    ) {
        overlay.hidden =
            false;
    }

    document.documentElement.classList.add(
        "task-create-open"
    );

    requestAnimationFrame(
        function() {
            title?.focus();
        }
    );
}

export function closeCreateTask() {
    const {
        overlay
    } =
        getCreateTaskElements();

    resetCreateTaskForm();

    if (
        overlay
    ) {
        overlay.hidden =
            true;
    }

    document.documentElement.classList.remove(
        "task-create-open"
    );
}

/* =========================================================
FORM SUBMISSION
========================================================= */

async function handleCreateTaskSubmit(
    event
) {
    event.preventDefault();

    clearCreateTaskMessage();

    try {
        const payload =
            getCreateTaskPayload();

        setSubmitting(
            true
        );

        const result =
            await createTask(
                payload
            );

        const createdTask =
            extractCreatedTask(
                result
            );

        setCreateTaskMessage(
            "Task created successfully.",
            "success"
        );

        if (
            typeof createTaskContext.onCreated ===
            "function"
        ) {
            await createTaskContext.onCreated(
                createdTask,
                result
            );
        }

        closeCreateTask();
    }
    catch (
        error
    ) {
        console.error(
            "[TASKBOARD CREATE TASK FAILED]",
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

        setCreateTaskMessage(
            error?.message
            || "The task could not be created.",
            "error"
        );
    }
    finally {
        setSubmitting(
            false
        );
    }
}

/* =========================================================
KEYBOARD
========================================================= */

function handleCreateTaskKeydown(
    event
) {
    if (
        event.key !==
        "Escape"
    ) {
        return;
    }

    const {
        overlay,
        submit
    } =
        getCreateTaskElements();

    if (
        !overlay
        || overlay.hidden
        || submit?.disabled
    ) {
        return;
    }

    closeCreateTask();
}

/* =========================================================
OVERLAY CLICK
========================================================= */

function handleOverlayClick(
    event
) {
    const {
        overlay,
        submit
    } =
        getCreateTaskElements();

    if (
        !overlay
        || event.target !==
            overlay
        || submit?.disabled
    ) {
        return;
    }

    closeCreateTask();
}

/* =========================================================
SETUP
========================================================= */

function setupCreateTask() {
    if (
        createTaskInitialized
    ) {
        return;
    }

    const {
        overlay,
        form,
        close,
        cancel,
        priority
    } =
        getCreateTaskElements();

    if (
        !overlay
        || !form
    ) {
        throw new Error(
            "The Create Task interface is incomplete."
        );
    }

    close?.addEventListener(
        "click",
        closeCreateTask
    );

    cancel?.addEventListener(
        "click",
        closeCreateTask
    );

    priority?.addEventListener(
        "change",
        populateTimelineOptions
    );

    form.addEventListener(
        "submit",
        handleCreateTaskSubmit
    );

    overlay.addEventListener(
        "click",
        handleOverlayClick
    );

    document.addEventListener(
        "keydown",
        handleCreateTaskKeydown
    );

    createTaskInitialized =
        true;
}