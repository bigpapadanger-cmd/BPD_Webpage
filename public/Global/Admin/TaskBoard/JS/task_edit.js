"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD TASK EDIT CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_edit.js

Purpose:
    Controls the modular Edit Task overlay.

Responsibilities:
    - Load task_edit.html on demand.
    - Populate the form from the current task.
    - Validate editable task fields.
    - Enforce client-side priority/timeline rules.
    - Submit task updates to the protected Admin Task API.
    - Use optimistic concurrency through task versioning.
    - Notify Task Detail after a successful update.
    - Cleanly open, close, and reset the overlay.

Security:
    - This module is NOT a security boundary.
    - Client-side validation exists for UX only.
    - Server-side authorization and validation remain
      authoritative.
========================================================= */

/* =========================================================
ENDPOINTS
========================================================= */

const TASKS_API_URL =
    "/api/auth/admin/tasks";

/* =========================================================
RESOURCE RESOLUTION

The Edit Task template is resolved relative to this module
instead of using a hardcoded site-root path.

If this module is loaded as:
    task_edit.js?v=123

the template will be requested as:
    ../HTML/task_edit.html?v=123
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

function getTaskEditTemplateUrl() {
    return getRelativeResourceUrl(
        "../HTML/task_edit.html"
    );
}

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
TIMELINE RULES
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

let taskEditLoaded =
    false;

let taskEditInitialized =
    false;

let taskEditState = {
    taskCode:
        "",

    task:
        null,

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
    return normalizeString(
        task?.title
    );
}

function getTaskBody(
    task
) {
    return normalizeString(
        task?.body
        || task?.description
    );
}

function getTaskPriority(
    task
) {
    return normalizeString(
        task?.priority
    );
}

function getTaskTimelineDays(
    task
) {
    const value =
        Number(
            task?.timeline_days
            ?? task?.timelineDays
        );

    return Number.isInteger(
        value
    )
        ? value
        : null;
}

function getTaskRoles(
    task
) {
    return normalizeRoles(
        task?.responsible_roles
        || task?.responsibleRoles
    );
}

function getTaskVersion(
    task
) {
    const version =
        Number(
            task?.version
        );

    return Number.isSafeInteger(
        version
    )
    && version >=
        1
        ? version
        : null;
}

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getTaskEditElements() {
    return {
        overlay:
            document.getElementById(
                "taskEditOverlay"
            ),

        dialog:
            document.getElementById(
                "taskEditDialog"
            ),

        form:
            document.getElementById(
                "taskEditForm"
            ),

        close:
            document.getElementById(
                "taskEditClose"
            ),

        cancel:
            document.getElementById(
                "taskEditCancel"
            ),

        submit:
            document.getElementById(
                "taskEditSubmit"
            ),

        code:
            document.getElementById(
                "taskEditCode"
            ),

        title:
            document.getElementById(
                "taskEditName"
            ),

        body:
            document.getElementById(
                "taskEditBody"
            ),

        priority:
            document.getElementById(
                "taskEditPriority"
            ),

        timeline:
            document.getElementById(
                "taskEditTimeline"
            ),

        timelineHelp:
            document.getElementById(
                "taskEditTimelineHelp"
            ),

        message:
            document.getElementById(
                "taskEditMessage"
            )
    };
}

/* =========================================================
TEMPLATE LOADING
========================================================= */

async function loadTaskEditTemplate() {
    const existing =
        document.getElementById(
            "taskEditOverlay"
        );

    if (
        existing
    ) {
        taskEditLoaded =
            true;

        return;
    }

    let response;

    try {
        response =
            await fetch(
                getTaskEditTemplateUrl(),
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
                "The Edit Task interface could not be loaded."
            );

        error.cause =
            cause;

        throw error;
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `The Edit Task interface could not be loaded (${response.status}).`
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
            "The Edit Task template is empty."
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
            "The Edit Task template does not contain a root element."
        );
    }

    document.body.appendChild(
        element
    );

    taskEditLoaded =
        true;
}

/* =========================================================
MESSAGE
========================================================= */

function clearTaskEditMessage() {
    const {
        message
    } =
        getTaskEditElements();

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

function setTaskEditMessage(
    text,
    state =
        ""
) {
    const {
        message
    } =
        getTaskEditElements();

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
TIMELINE
========================================================= */

function populateTimelineOptions(
    selectedValue =
        null
) {
    const {
        priority,
        timeline,
        timelineHelp
    } =
        getTaskEditElements();

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
        const option =
            document.createElement(
                "option"
            );

        option.value =
            "";

        option.textContent =
            "Select priority first";

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
            `${days} days`;

        if (
            Number(
                selectedValue
            ) ===
            days
        ) {
            option.selected =
                true;
        }

        timeline.appendChild(
            option
        );
    }

    if (
        !values.includes(
            Number(
                selectedValue
            )
        )
    ) {
        placeholder.selected =
            true;
    }

    timeline.disabled =
        false;

    if (
        timelineHelp
    ) {
        timelineHelp.textContent =
            values.length ===
                1
                ? `${priorityValue} tasks use a ${values[0]}-day timeline.`
                : `${priorityValue} tasks allow ${values[0]}–${values.at(-1)} days.`;
    }
}

/* =========================================================
ROLE POPULATION
========================================================= */

function populateRoleSelection(
    roles
) {
    const selected =
        new Set(
            normalizeRoles(
                roles
            )
        );

    const inputs =
        document.querySelectorAll(
            '#taskEditForm input[name="responsible_roles"]'
        );

    for (
        const input of inputs
    ) {
        const role =
            normalizeString(
                input.value
            )
                .toLowerCase();

        input.checked =
            selected.has(
                role
            );
    }
}

/* =========================================================
POPULATE FORM
========================================================= */

function populateTaskEditForm(
    task
) {
    const {
        code,
        title,
        body,
        priority
    } =
        getTaskEditElements();

    const taskCode =
        getTaskCode(
            task
        );

    if (
        code
    ) {
        code.textContent =
            taskCode
            || "Task";
    }

    if (
        title
    ) {
        title.value =
            getTaskTitle(
                task
            );
    }

    if (
        body
    ) {
        body.value =
            getTaskBody(
                task
            );
    }

    if (
        priority
    ) {
        priority.value =
            getTaskPriority(
                task
            );
    }

    populateTimelineOptions(
        getTaskTimelineDays(
            task
        )
    );

    populateRoleSelection(
        getTaskRoles(
            task
        )
    );

    clearTaskEditMessage();
}

/* =========================================================
PAYLOAD
========================================================= */

function getTaskEditPayload() {
    const {
        form
    } =
        getTaskEditElements();

    if (
        !form
    ) {
        throw new Error(
            "The Edit Task form is unavailable."
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

function createTaskEditError(
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
        || "TASK_UPDATE_FAILED";

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
UPDATE API

Expected Body:
{
    expectedVersion,
    changes
}

The task code comes from the route.

The server remains authoritative for:
    - mutable field validation
    - assignment authorization
    - optimistic concurrency
    - deadline recalculation
    - version increments
========================================================= */

async function updateTask(
    taskCode,
    expectedVersion,
    changes
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

    if (
        !Number.isSafeInteger(
            expectedVersion
        )
        || expectedVersion <
            1
    ) {
        throw new Error(
            "A valid task version is required."
        );
    }

    if (
        !changes
        || typeof changes !==
            "object"
        || Array.isArray(
            changes
        )
    ) {
        throw new Error(
            "Valid task changes are required."
        );
    }

    const url =
        `${TASKS_API_URL}/${encodeURIComponent(normalizedTaskCode)}`;

    const requestBody = {
        expectedVersion,

        changes
    };

    let response;

    try {
        response =
            await fetch(
                url,
                {
                    method:
                        "PATCH",

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
            createTaskEditError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_UPDATE_NETWORK_ERROR",

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
        throw createTaskEditError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_UPDATE_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createTaskEditError({
            message:
                result?.message
                || result?.error
                || `Task update failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_UPDATE_FAILED",

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
SUBMIT STATE
========================================================= */

function setSubmitting(
    submitting
) {
    taskEditState.submitting =
        submitting;

    const {
        submit,
        close,
        cancel
    } =
        getTaskEditElements();

    if (
        submit
    ) {
        submit.disabled =
            submitting;

        submit.textContent =
            submitting
                ? "Saving..."
                : "Save Changes";
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
OPEN / CLOSE
========================================================= */

export async function openTaskEdit(
    task,
    context =
        {}
) {
    const taskCode =
        getTaskCode(
            task
        );

    if (
        !taskCode
    ) {
        throw new Error(
            "A task code is required to edit a task."
        );
    }

    await loadTaskEditTemplate();

    setupTaskEdit();

    taskEditState = {
        taskCode,

        task,

        onUpdated:
            typeof context?.onUpdated ===
                "function"
                ? context.onUpdated
                : null,

        submitting:
            false
    };

    populateTaskEditForm(
        task
    );

    const {
        overlay,
        title
    } =
        getTaskEditElements();

    if (
        overlay
    ) {
        overlay.hidden =
            false;
    }

    document.documentElement.classList.add(
        "task-overlay-open"
    );

    requestAnimationFrame(
        function() {
            title?.focus();
        }
    );
}

export function closeTaskEdit() {
    if (
        taskEditState.submitting
    ) {
        return;
    }

    const {
        overlay
    } =
        getTaskEditElements();

    if (
        overlay
    ) {
        overlay.hidden =
            true;
    }

    document.documentElement.classList.remove(
        "task-overlay-open"
    );

    taskEditState.taskCode =
        "";

    taskEditState.task =
        null;

    taskEditState.onUpdated =
        null;

    clearTaskEditMessage();
}

/* =========================================================
SUBMIT
========================================================= */

async function handleTaskEditSubmit(
    event
) {
    event.preventDefault();

    if (
        taskEditState.submitting
    ) {
        return;
    }

    clearTaskEditMessage();

    try {
        const changes =
            getTaskEditPayload();

        const expectedVersion =
            getTaskVersion(
                taskEditState.task
            );

        if (
            !expectedVersion
        ) {
            throw new Error(
                "The current task version is unavailable. Refresh the task and try again."
            );
        }

        setSubmitting(
            true
        );

        const result =
            await updateTask(
                taskEditState.taskCode,
                expectedVersion,
                changes
            );

        const updatedTask =
            extractUpdatedTask(
                result
            );

        if (
            updatedTask
        ) {
            taskEditState.task =
                updatedTask;
        }

        setTaskEditMessage(
            "Task updated successfully.",
            "success"
        );

        if (
            typeof taskEditState.onUpdated ===
                "function"
        ) {
            await taskEditState.onUpdated(
                updatedTask,
                result
            );
        }

        closeTaskEdit();
    }
    catch (
        error
    ) {
        console.error(
            "[TASK EDIT FAILED]",
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

        setTaskEditMessage(
            error?.message
            || "The task could not be updated.",
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
PRIORITY CHANGE
========================================================= */

function handlePriorityChange() {
    populateTimelineOptions();
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
        getTaskEditElements();

    if (
        !overlay
        || overlay.hidden
        || taskEditState.submitting
    ) {
        return;
    }

    closeTaskEdit();
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
        getTaskEditElements();

    if (
        !overlay
        || event.target !==
            overlay
        || taskEditState.submitting
    ) {
        return;
    }

    closeTaskEdit();
}

/* =========================================================
SETUP
========================================================= */

function setupTaskEdit() {
    if (
        taskEditInitialized
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
        getTaskEditElements();

    if (
        !overlay
        || !form
    ) {
        throw new Error(
            "The Edit Task interface is incomplete."
        );
    }

    close?.addEventListener(
        "click",
        closeTaskEdit
    );

    cancel?.addEventListener(
        "click",
        closeTaskEdit
    );

    priority?.addEventListener(
        "change",
        handlePriorityChange
    );

    form.addEventListener(
        "submit",
        handleTaskEditSubmit
    );

    overlay.addEventListener(
        "click",
        handleBackdropClick
    );

    document.addEventListener(
        "keydown",
        handleKeydown
    );

    taskEditInitialized =
        true;
}