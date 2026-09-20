"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD TASK COMMENTS CONTROLLER

File:
    public/Global/Admin/TaskBoard/JS/task_comments.js

Purpose:
    Controls task comments and discussion inside the
    Task Detail overlay.

Responsibilities:
    - Load comment events for the current task.
    - Render existing comments.
    - Submit new comments.
    - Display comment loading and error states.
    - Prevent duplicate submissions.
    - Notify Task Detail after a new comment is created.

Security:
    - This module is NOT a security boundary.
    - Comment access and creation remain enforced
      server-side by the protected Admin Task API.
    - Actor identity comes from the authenticated session.
========================================================= */

/* =========================================================
MODULE STATE
========================================================= */

let commentsState = {
    taskCode:
        "",

    comments:
        [],

    onUpdated:
        null,

    loading:
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

function getCommentsElements() {
    const root =
        document.getElementById(
            "taskDetailComments"
        );

    return {
        root,

        list:
            root?.querySelector(
                "[data-task-comments-list]"
            )
            || null,

        form:
            root?.querySelector(
                "[data-task-comments-form]"
            )
            || null,

        textarea:
            root?.querySelector(
                "[data-task-comments-input]"
            )
            || null,

        submit:
            root?.querySelector(
                "[data-task-comments-submit]"
            )
            || null,

        message:
            root?.querySelector(
                "[data-task-comments-message]"
            )
            || null
    };
}

/* =========================================================
API URL
========================================================= */

function getCommentsApiUrl() {
    const taskCode =
        normalizeString(
            commentsState.taskCode
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

function createCommentsError(
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
            || "Task comments request failed."
        );

    error.code =
        normalizeString(
            code
        )
        || "TASK_COMMENTS_FAILED";

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
GET EVENTS
========================================================= */

async function requestTaskEvents() {
    const url =
        getCommentsApiUrl();

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
            createCommentsError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_COMMENTS_NETWORK_ERROR",

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
        throw createCommentsError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_COMMENTS_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createCommentsError({
            message:
                result?.message
                || result?.error
                || `Task comments request failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_COMMENTS_FAILED",

            status:
                response.status,

            response:
                result
        });
    }

    return result;
}

/* =========================================================
POST COMMENT
========================================================= */

async function submitTaskComment(
    comment
) {
    const url =
        getCommentsApiUrl();

    const payload = {
        comment
    };

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
            createCommentsError({
                message:
                    "The Taskboard service is temporarily unavailable.",

                code:
                    "TASK_COMMENT_NETWORK_ERROR",

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
        throw createCommentsError({
            message:
                "The Taskboard service returned an invalid response.",

            code:
                "TASK_COMMENT_INVALID_RESPONSE",

            status:
                response.status
        });
    }

    if (
        !response.ok
    ) {
        throw createCommentsError({
            message:
                result?.message
                || result?.error
                || `Comment submission failed with status ${response.status}.`,

            code:
                result?.code
                || result?.error
                || "TASK_COMMENT_FAILED",

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
COMMENT FILTERING

Comments are represented in admin.task_events using
event_type = "comment".
========================================================= */

function extractComments(
    result
) {
    return extractEvents(
        result
    )
        .filter(
            event =>
                normalizeString(
                    event?.event_type
                    || event?.eventType
                )
                    .toLowerCase() ===
                "comment"
        );
}

/* =========================================================
COMMENT VALUES
========================================================= */

function getCommentBody(
    event
) {
    return (
        normalizeString(
            event?.note
        )
        || normalizeString(
            event?.comment
        )
        || normalizeString(
            event?.body
        )
        || ""
    );
}

function getCommentActor(
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

function getCommentTimestamp(
    event
) {
    return normalizeString(
        event?.created_at
        || event?.createdAt
        || event?.timestamp
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
MESSAGE
========================================================= */

function clearCommentsMessage() {
    const {
        message
    } =
        getCommentsElements();

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

function setCommentsMessage(
    text,
    state =
        ""
) {
    const {
        message
    } =
        getCommentsElements();

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
COMMENT CARD
========================================================= */

function createCommentElement(
    event
) {
    const article =
        document.createElement(
            "article"
        );

    article.className =
        "task-comment";

    const header =
        document.createElement(
            "div"
        );

    header.className =
        "task-comment-header";

    const author =
        document.createElement(
            "span"
        );

    author.className =
        "task-comment-author";

    author.textContent =
        getCommentActor(
            event
        );

    const time =
        document.createElement(
            "time"
        );

    time.className =
        "task-comment-time";

    const timestamp =
        getCommentTimestamp(
            event
        );

    time.textContent =
        formatDateTime(
            timestamp
        );

    if (
        timestamp
    ) {
        time.dateTime =
            timestamp;
    }

    header.append(
        author,
        time
    );

    const body =
        document.createElement(
            "p"
        );

    body.className =
        "task-comment-body";

    body.textContent =
        getCommentBody(
            event
        )
        || "Comment";

    article.append(
        header,
        body
    );

    return article;
}

/* =========================================================
RENDER COMMENTS
========================================================= */

function renderComments() {
    const {
        list
    } =
        getCommentsElements();

    if (
        !list
    ) {
        return;
    }

    list.replaceChildren();

    if (
        commentsState.comments.length ===
        0
    ) {
        const empty =
            document.createElement(
                "p"
            );

        empty.className =
            "task-dialog-empty";

        empty.textContent =
            "No comments have been added yet.";

        list.appendChild(
            empty
        );

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const comment of commentsState.comments
    ) {
        fragment.appendChild(
            createCommentElement(
                comment
            )
        );
    }

    list.appendChild(
        fragment
    );
}

/* =========================================================
ROOT RENDER
========================================================= */

function renderCommentsInterface() {
    const {
        root
    } =
        getCommentsElements();

    if (
        !root
    ) {
        return;
    }

    root.replaceChildren();

    const list =
        document.createElement(
            "div"
        );

    list.className =
        "task-comments-list";

    list.dataset.taskCommentsList =
        "";

    const form =
        document.createElement(
            "form"
        );

    form.className =
        "task-comments-form";

    form.dataset.taskCommentsForm =
        "";

    const field =
        document.createElement(
            "div"
        );

    field.className =
        "task-dialog-field";

    const label =
        document.createElement(
            "label"
        );

    label.htmlFor =
        "taskCommentInput";

    label.textContent =
        "Add Comment";

    const textarea =
        document.createElement(
            "textarea"
        );

    textarea.id =
        "taskCommentInput";

    textarea.dataset.taskCommentsInput =
        "";

    textarea.rows =
        4;

    textarea.maxLength =
        10000;

    textarea.placeholder =
        "Add a question, update, or comment...";

    textarea.required =
        true;

    field.append(
        label,
        textarea
    );

    const message =
        document.createElement(
            "div"
        );

    message.className =
        "task-dialog-message";

    message.dataset.taskCommentsMessage =
        "";

    message.hidden =
        true;

    const actions =
        document.createElement(
            "div"
        );

    actions.className =
        "task-dialog-actions";

    const submit =
        document.createElement(
            "button"
        );

    submit.type =
        "submit";

    submit.className =
        "task-dialog-primary";

    submit.dataset.taskCommentsSubmit =
        "";

    submit.textContent =
        "Add Comment";

    actions.appendChild(
        submit
    );

    form.append(
        field,
        message,
        actions
    );

    root.append(
        list,
        form
    );

    form.addEventListener(
        "submit",
        handleCommentSubmit
    );

    renderComments();
}

/* =========================================================
LOADING STATE
========================================================= */

function renderCommentsLoading() {
    const {
        root
    } =
        getCommentsElements();

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
        "Loading comments...";

    root.appendChild(
        loading
    );
}

/* =========================================================
ERROR STATE
========================================================= */

function renderCommentsError(
    message
) {
    const {
        root
    } =
        getCommentsElements();

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
        || "Comments could not be loaded.";

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
        refreshTaskComments
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
SUBMIT STATE
========================================================= */

function setSubmitting(
    submitting
) {
    commentsState.submitting =
        submitting;

    const {
        textarea,
        submit
    } =
        getCommentsElements();

    if (
        textarea
    ) {
        textarea.disabled =
            submitting;
    }

    if (
        submit
    ) {
        submit.disabled =
            submitting;

        submit.textContent =
            submitting
                ? "Adding..."
                : "Add Comment";
    }
}

/* =========================================================
LOAD COMMENTS
========================================================= */

export async function refreshTaskComments() {
    if (
        commentsState.loading
    ) {
        return;
    }

    commentsState.loading =
        true;

    renderCommentsLoading();

    try {
        const result =
            await requestTaskEvents();

        commentsState.comments =
            extractComments(
                result
            );

        renderCommentsInterface();
    }
    catch (
        error
    ) {
        console.error(
            "[TASK COMMENTS LOAD FAILED]",
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

        renderCommentsError(
            error?.message
            || "Comments could not be loaded."
        );
    }
    finally {
        commentsState.loading =
            false;
    }
}

/* =========================================================
SUBMIT COMMENT
========================================================= */

async function handleCommentSubmit(
    event
) {
    event.preventDefault();

    if (
        commentsState.submitting
    ) {
        return;
    }

    const {
        textarea
    } =
        getCommentsElements();

    const comment =
        normalizeString(
            textarea?.value
        );

    clearCommentsMessage();

    if (
        !comment
    ) {
        setCommentsMessage(
            "Enter a comment before submitting.",
            "error"
        );

        return;
    }

    if (
        comment.length >
        10000
    ) {
        setCommentsMessage(
            "Comments cannot exceed 10,000 characters.",
            "error"
        );

        return;
    }

    try {
        setSubmitting(
            true
        );

        await submitTaskComment(
            comment
        );

        if (
            textarea
        ) {
            textarea.value =
                "";
        }

        await refreshTaskComments();

        if (
            typeof commentsState.onUpdated ===
            "function"
        ) {
            await commentsState.onUpdated();
        }
    }
    catch (
        error
    ) {
        console.error(
            "[TASK COMMENT SUBMIT FAILED]",
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

        setCommentsMessage(
            error?.message
            || "The comment could not be added.",
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
PUBLIC MOUNT
========================================================= */

export async function mountTaskComments(
    {
        taskCode,
        onUpdated = null
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
            "Task Comments requires a task code."
        );
    }

    commentsState = {
        taskCode:
            normalizedTaskCode,

        comments:
            [],

        onUpdated:
            typeof onUpdated ===
                "function"
                ? onUpdated
                : null,

        loading:
            false,

        submitting:
            false
    };

    await refreshTaskComments();
}

/* =========================================================
PUBLIC CLEAR
========================================================= */

export function clearTaskComments() {
    const {
        root
    } =
        getCommentsElements();

    commentsState = {
        taskCode:
            "",

        comments:
            [],

        onUpdated:
            null,

        loading:
            false,

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
            "Loading comments...";

        root.appendChild(
            loading
        );
    }
}