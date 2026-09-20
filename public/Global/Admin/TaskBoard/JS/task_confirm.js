"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD CONFIRMATION CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_confirm.js

Purpose:
    Provides a reusable Taskboard confirmation overlay for
    task actions that require confirmation and/or a reason.

Primary Uses:
    - Shelve Task
    - Archive Task
    - Delete Task
    - Other lifecycle confirmations as needed

Responsibilities:
    - Load task_confirm.html on demand.
    - Render confirmation title and message.
    - Show or hide the reason field.
    - Require a reason when requested.
    - Support normal and destructive actions.
    - Resolve the calling Promise with the user's decision.
    - Support Cancel, Close, Escape, and backdrop dismissal.
    - Preserve overlay scroll locking correctly when opened
      above another Taskboard overlay.

Shared Styling:
    public/Global/Admin/TaskBoard/CSS/overlays.css

Security:
    - This module is presentation only.
    - It does not authorize lifecycle operations.
    - Server-side APIs remain authoritative.
========================================================= */

/* =========================================================
PATHS
========================================================= */

const TASK_CONFIRM_TEMPLATE_URL =
    "/Global/Admin/TaskBoard/HTML/task_confirm.html";

/* =========================================================
MODULE STATE
========================================================= */

let taskConfirmLoaded =
    false;

let taskConfirmInitialized =
    false;

let taskConfirmResolver =
    null;

let taskConfirmState = {
    title:
        "Confirm Action",

    message:
        "",

    confirmLabel:
        "Confirm",

    requireReason:
        false,

    reasonLabel:
        "Reason",

    reasonPlaceholder:
        "Provide a reason...",

    danger:
        false,

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

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getTaskConfirmElements() {
    return {
        overlay:
            document.getElementById(
                "taskConfirmOverlay"
            ),

        dialog:
            document.getElementById(
                "taskConfirmDialog"
            ),

        form:
            document.getElementById(
                "taskConfirmForm"
            ),

        eyebrow:
            document.getElementById(
                "taskConfirmEyebrow"
            ),

        title:
            document.getElementById(
                "taskConfirmTitle"
            ),

        message:
            document.getElementById(
                "taskConfirmDescription"
            ),

        reasonSection:
            document.getElementById(
                "taskConfirmReasonSection"
            ),

        reasonLabel:
            document.getElementById(
                "taskConfirmReasonLabel"
            ),

        reason:
            document.getElementById(
                "taskConfirmReason"
            ),

        validation:
            document.getElementById(
                "taskConfirmMessage"
            ),

        close:
            document.getElementById(
                "taskConfirmClose"
            ),

        cancel:
            document.getElementById(
                "taskConfirmCancel"
            ),

        confirm:
            document.getElementById(
                "taskConfirmSubmit"
            )
    };
}

/* =========================================================
TEMPLATE LOADING
========================================================= */

async function loadTaskConfirmTemplate() {
    const existing =
        document.getElementById(
            "taskConfirmOverlay"
        );

    if (
        existing
    ) {
        taskConfirmLoaded =
            true;

        return;
    }

    let response;

    try {
        response =
            await fetch(
                TASK_CONFIRM_TEMPLATE_URL,
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
                "The confirmation interface could not be loaded."
            );

        error.cause =
            cause;

        throw error;
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `The confirmation interface could not be loaded (${response.status}).`
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
            "The confirmation template is empty."
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
            "The confirmation template does not contain a root element."
        );
    }

    document.body.appendChild(
        element
    );

    taskConfirmLoaded =
        true;
}

/* =========================================================
VALIDATION MESSAGE
========================================================= */

function clearValidationMessage() {
    const {
        validation
    } =
        getTaskConfirmElements();

    if (
        !validation
    ) {
        return;
    }

    validation.textContent =
        "";

    validation.hidden =
        true;

    validation.removeAttribute(
        "data-state"
    );
}

function setValidationMessage(
    text,
    state =
        "error"
) {
    const {
        validation
    } =
        getTaskConfirmElements();

    if (
        !validation
    ) {
        return;
    }

    validation.textContent =
        normalizeString(
            text
        );

    validation.hidden =
        false;

    if (
        state
    ) {
        validation.dataset.state =
            state;
    }
    else {
        validation.removeAttribute(
            "data-state"
        );
    }
}

/* =========================================================
OVERLAY LOCK STATE

Do not blindly remove task-overlay-open when closing this
dialog because Task Confirm may be sitting above Task Detail
or Edit Task.

The class is removed only when no visible Taskboard overlay
remains.
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
SUBMITTING STATE
========================================================= */

function setSubmitting(
    submitting
) {
    taskConfirmState.submitting =
        submitting;

    const {
        reason,
        close,
        cancel,
        confirm
    } =
        getTaskConfirmElements();

    if (
        reason
    ) {
        reason.disabled =
            submitting;
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

    if (
        confirm
    ) {
        confirm.disabled =
            submitting;
    }
}

/* =========================================================
RESET DIALOG
========================================================= */

function resetTaskConfirm() {
    const {
        form,
        confirm
    } =
        getTaskConfirmElements();

    if (
        form
    ) {
        form.reset();
    }

    if (
        confirm
    ) {
        confirm.classList.remove(
            "task-dialog-danger"
        );

        confirm.classList.remove(
            "task-dialog-primary"
        );
    }

    clearValidationMessage();

    setSubmitting(
        false
    );
}

/* =========================================================
CONFIGURE DIALOG
========================================================= */

function configureTaskConfirm(
    options
) {
    const {
        eyebrow,
        title,
        message,
        reasonSection,
        reasonLabel,
        reason,
        confirm
    } =
        getTaskConfirmElements();

    if (
        eyebrow
    ) {
        eyebrow.textContent =
            taskConfirmState.danger
                ? "Confirmation Required"
                : "Task Action";
    }

    if (
        title
    ) {
        title.textContent =
            taskConfirmState.title;
    }

    if (
        message
    ) {
        message.textContent =
            taskConfirmState.message;
    }

    if (
        reasonSection
    ) {
        reasonSection.hidden =
            !taskConfirmState.requireReason;
    }

    if (
        reasonLabel
    ) {
        reasonLabel.textContent =
            taskConfirmState.reasonLabel;
    }

    if (
        reason
    ) {
        reason.placeholder =
            taskConfirmState.reasonPlaceholder;

        reason.required =
            taskConfirmState.requireReason;
    }

    if (
        confirm
    ) {
        confirm.textContent =
            taskConfirmState.confirmLabel;

        confirm.classList.toggle(
            "task-dialog-danger",
            taskConfirmState.danger
        );

        confirm.classList.toggle(
            "task-dialog-primary",
            !taskConfirmState.danger
        );
    }
}

/* =========================================================
RESULT RESOLUTION
========================================================= */

function resolveTaskConfirm(
    result
) {
    const resolver =
        taskConfirmResolver;

    taskConfirmResolver =
        null;

    if (
        typeof resolver ===
        "function"
    ) {
        resolver(
            result
        );
    }
}

/* =========================================================
CLOSE INTERNAL
========================================================= */

function closeTaskConfirmInternal(
    {
        confirmed =
            false,

        reason =
            ""
    } = {}
) {
    const {
        overlay
    } =
        getTaskConfirmElements();

    if (
        overlay
    ) {
        overlay.hidden =
            true;
    }

    resetTaskConfirm();

    synchronizeOverlayLock();

    resolveTaskConfirm({
        confirmed:
            confirmed ===
            true,

        reason:
            normalizeString(
                reason
            )
    });
}

/* =========================================================
PUBLIC CANCEL
========================================================= */

export function closeTaskConfirm() {
    if (
        taskConfirmState.submitting
    ) {
        return;
    }

    closeTaskConfirmInternal({
        confirmed:
            false,

        reason:
            ""
    });
}

/* =========================================================
FORM SUBMISSION
========================================================= */

function handleTaskConfirmSubmit(
    event
) {
    event.preventDefault();

    if (
        taskConfirmState.submitting
    ) {
        return;
    }

    const {
        reason
    } =
        getTaskConfirmElements();

    clearValidationMessage();

    const reasonValue =
        normalizeString(
            reason?.value
        );

    if (
        taskConfirmState.requireReason
        && !reasonValue
    ) {
        setValidationMessage(
            "A reason is required for this action."
        );

        reason?.focus();

        return;
    }

    closeTaskConfirmInternal({
        confirmed:
            true,

        reason:
            reasonValue
    });
}

/* =========================================================
ESCAPE
========================================================= */

function handleTaskConfirmKeydown(
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
        getTaskConfirmElements();

    if (
        !overlay
        || overlay.hidden
        || taskConfirmState.submitting
    ) {
        return;
    }

    event.preventDefault();

    event.stopPropagation();

    closeTaskConfirm();
}

/* =========================================================
BACKDROP
========================================================= */

function handleTaskConfirmBackdrop(
    event
) {
    const {
        overlay
    } =
        getTaskConfirmElements();

    if (
        !overlay
        || event.target !==
            overlay
        || taskConfirmState.submitting
    ) {
        return;
    }

    closeTaskConfirm();
}

/* =========================================================
SETUP
========================================================= */

function setupTaskConfirm() {
    if (
        taskConfirmInitialized
    ) {
        return;
    }

    const {
        overlay,
        form,
        close,
        cancel
    } =
        getTaskConfirmElements();

    if (
        !overlay
        || !form
    ) {
        throw new Error(
            "The Task Confirmation interface is incomplete."
        );
    }

    close?.addEventListener(
        "click",
        closeTaskConfirm
    );

    cancel?.addEventListener(
        "click",
        closeTaskConfirm
    );

    form.addEventListener(
        "submit",
        handleTaskConfirmSubmit
    );

    overlay.addEventListener(
        "click",
        handleTaskConfirmBackdrop
    );

    document.addEventListener(
        "keydown",
        handleTaskConfirmKeydown,
        true
    );

    taskConfirmInitialized =
        true;
}

/* =========================================================
PUBLIC OPEN

Returns:
    {
        confirmed: boolean,
        reason: string
    }

Example:
    const result =
        await openTaskConfirm({
            title: "Delete Task",
            message: "This task will be marked deleted.",
            confirmLabel: "Delete Task",
            requireReason: true,
            danger: true
        });

    if (!result.confirmed) {
        return;
    }
========================================================= */

export async function openTaskConfirm(
    {
        title =
            "Confirm Action",

        message =
            "Are you sure you want to continue?",

        confirmLabel =
            "Confirm",

        requireReason =
            false,

        reasonLabel =
            "Reason",

        reasonPlaceholder =
            "Provide a reason...",

        danger =
            false
    } = {}
) {
    await loadTaskConfirmTemplate();

    setupTaskConfirm();

    /*
     * If another confirmation is somehow still waiting,
     * resolve it as cancelled before opening the new one.
     */
    if (
        typeof taskConfirmResolver ===
        "function"
    ) {
        resolveTaskConfirm({
            confirmed:
                false,

            reason:
                ""
        });
    }

    taskConfirmState = {
        title:
            normalizeString(
                title
            )
            || "Confirm Action",

        message:
            normalizeString(
                message
            )
            || "Are you sure you want to continue?",

        confirmLabel:
            normalizeString(
                confirmLabel
            )
            || "Confirm",

        requireReason:
            requireReason ===
            true,

        reasonLabel:
            normalizeString(
                reasonLabel
            )
            || "Reason",

        reasonPlaceholder:
            normalizeString(
                reasonPlaceholder
            )
            || "Provide a reason...",

        danger:
            danger ===
            true,

        submitting:
            false
    };

    resetTaskConfirm();

    configureTaskConfirm();

    const {
        overlay,
        reason,
        confirm
    } =
        getTaskConfirmElements();

    if (
        overlay
    ) {
        overlay.hidden =
            false;
    }

    synchronizeOverlayLock();

    requestAnimationFrame(
        function() {
            if (
                taskConfirmState.requireReason
            ) {
                reason?.focus();
            }
            else {
                confirm?.focus();
            }
        }
    );

    return new Promise(
        resolve => {
            taskConfirmResolver =
                resolve;
        }
    );
}