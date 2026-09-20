"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN MANAGEMENT CLIENT

File:
    public/Global/Admin/Home/JS/index.js

Purpose:
    Initializes and populates the Admin Management landing
    page when loaded by the BPD client-side router.

Responsibilities:
    - Load centralized BPD Admin authorization.
    - Require current Discord-backed Admin authorization.
    - Render verified responsibility roles.
    - Load Admin Taskboard summary data.
    - Load recent administrative activity.
    - Check administrative service availability.
    - Populate Admin overview cards.
    - Support retrying initialization.
    - Export initializePage() for the BPD router.

Security:
    - This module is NOT a security boundary.
    - Admin authorization is verified server-side.
    - Client-side state controls presentation only.
    - Protected Admin APIs independently enforce access.
    - Client-supplied roles and permissions are never
      authoritative.

Important:
    - This module must not initialize the sidebar.
    - This module must not call /api/auth/admin/access
      directly.
    - Admin authorization is obtained through:
          /Framework/Auth/auth.js
========================================================= */

/* =========================================================
IMPORTS
========================================================= */

import {
    getAuthState,
    hasAdminAccess,
    getAdminResponsibilityRoles
} from "/Framework/Auth/auth.js";

/* =========================================================
ENDPOINTS
========================================================= */

const TASK_SUMMARY_URL =
    "/api/auth/admin/tasks/task-summary";

const TASK_ACTIVITY_URL =
    "/api/auth/admin/tasks/task-activity";

const SYSTEM_HEALTH_URL =
    "/api/health/apihealth";

/* =========================================================
SUPPORTED RESPONSIBILITY ROLES
========================================================= */

const ADMIN_RESPONSIBILITY_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
CLIENT STATE
========================================================= */

const adminState = {
    auth:
        null,

    roles:
        [],

    taskSummary:
        null,

    activity:
        [],

    systemAvailable:
        null
};

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getAdminElements() {
    return {
        adminContent:
            document.getElementById(
                "adminContent"
            ),

        adminLoading:
            document.getElementById(
                "adminLoading"
            ),

        adminDenied:
            document.getElementById(
                "adminDenied"
            ),

        adminError:
            document.getElementById(
                "adminError"
            ),

        adminErrorMessage:
            document.getElementById(
                "adminErrorMessage"
            ),

        adminRetry:
            document.getElementById(
                "adminRetry"
            ),

        adminStatus:
            document.getElementById(
                "adminStatus"
            ),

        adminRoleList:
            document.getElementById(
                "adminRoleList"
            ),

        adminActiveTaskCount:
            document.getElementById(
                "adminActiveTaskCount"
            ),

        adminLateTaskCount:
            document.getElementById(
                "adminLateTaskCount"
            ),

        adminUserCount:
            document.getElementById(
                "adminUserCount"
            ),

        adminSystemStatus:
            document.getElementById(
                "adminSystemStatus"
            ),

        adminActivityList:
            document.getElementById(
                "adminActivityList"
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

function normalizeAdminRoles(
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
                        ADMIN_RESPONSIBILITY_ROLES.has(
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
ROLE DISPLAY NAMES
========================================================= */

function formatAdminRole(
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
PAGE STATE
========================================================= */

function hideAdminStates() {
    const {
        adminContent,
        adminLoading,
        adminDenied,
        adminError
    } =
        getAdminElements();

    if (
        adminContent
    ) {
        adminContent.hidden =
            true;
    }

    if (
        adminLoading
    ) {
        adminLoading.hidden =
            true;
    }

    if (
        adminDenied
    ) {
        adminDenied.hidden =
            true;
    }

    if (
        adminError
    ) {
        adminError.hidden =
            true;
    }
}

function showLoading() {
    const {
        adminLoading
    } =
        getAdminElements();

    hideAdminStates();

    if (
        adminLoading
    ) {
        adminLoading.hidden =
            false;
    }
}

function showAuthorized() {
    const {
        adminContent
    } =
        getAdminElements();

    hideAdminStates();

    if (
        adminContent
    ) {
        adminContent.hidden =
            false;
    }
}

function showDenied() {
    const {
        adminDenied
    } =
        getAdminElements();

    hideAdminStates();

    if (
        adminDenied
    ) {
        adminDenied.hidden =
            false;
    }
}

function showError(
    message =
        "Admin Management could not be loaded."
) {
    const {
        adminError,
        adminErrorMessage
    } =
        getAdminElements();

    hideAdminStates();

    if (
        adminErrorMessage
    ) {
        adminErrorMessage.textContent =
            message;
    }

    if (
        adminError
    ) {
        adminError.hidden =
            false;
    }
}

/* =========================================================
GLOBAL ADMIN STATUS
========================================================= */

function setAdminStatus(
    message,
    state =
        ""
) {
    const {
        adminStatus
    } =
        getAdminElements();

    if (
        !adminStatus
    ) {
        return;
    }

    const normalized =
        normalizeString(
            message
        );

    if (
        !normalized
    ) {
        adminStatus.hidden =
            true;

        adminStatus.textContent =
            "";

        adminStatus.removeAttribute(
            "data-state"
        );

        return;
    }

    adminStatus.textContent =
        normalized;

    adminStatus.hidden =
        false;

    if (
        state
    ) {
        adminStatus.dataset.state =
            state;
    }
    else {
        adminStatus.removeAttribute(
            "data-state"
        );
    }
}

/* =========================================================
ADMIN ACCESS
========================================================= */

async function loadAdminAuthorization() {
    const state =
        await getAuthState({
            force:
                true
        });

    return {
        state,

        authorized:
            hasAdminAccess(
                state
            )
    };
}

/* =========================================================
ADMIN ROLE RENDERING
========================================================= */

function renderAdminRoles(
    state
) {
    const {
        adminRoleList
    } =
        getAdminElements();

    if (
        !adminRoleList
    ) {
        return;
    }

    const roles =
        normalizeAdminRoles(
            getAdminResponsibilityRoles(
                state
            )
        );

    adminState.roles =
        roles;

    adminRoleList.replaceChildren();

    if (
        roles.length ===
        0
    ) {
        const roleElement =
            document.createElement(
                "span"
            );

        roleElement.className =
            "admin-role";

        roleElement.textContent =
            "No Responsibility Role";

        adminRoleList.appendChild(
            roleElement
        );

        return;
    }

    for (
        const role of roles
    ) {
        const roleElement =
            document.createElement(
                "span"
            );

        roleElement.className =
            "admin-role";

        roleElement.dataset.role =
            role;

        roleElement.textContent =
            formatAdminRole(
                role
            );

        adminRoleList.appendChild(
            roleElement
        );
    }
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
ADMIN API REQUEST
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

function getNumericValue(
    source,
    keys
) {
    for (
        const key of keys
    ) {
        const value =
            source?.[key];

        const number =
            Number(
                value
            );

        if (
            Number.isFinite(
                number
            )
        ) {
            return number;
        }
    }

    return 0;
}

function renderTaskSummary(
    summary
) {
    const {
        adminActiveTaskCount,
        adminLateTaskCount
    } =
        getAdminElements();

    const source =
        summary?.summary
        || summary?.data
        || summary
        || {};

    const active =
        getNumericValue(
            source,
            [
                "active",
                "activeCount",
                "active_count"
            ]
        );

    const late =
        getNumericValue(
            source,
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
        adminActiveTaskCount
    ) {
        adminActiveTaskCount.textContent =
            String(
                active
            );
    }

    if (
        adminLateTaskCount
    ) {
        adminLateTaskCount.textContent =
            String(
                late
            );
    }
}

/* =========================================================
ADMIN USER COUNT

A dedicated Admin-user count endpoint has not yet been
established.

Do not infer or fabricate this number client-side.
========================================================= */

function renderAdminUserCountUnavailable() {
    const {
        adminUserCount
    } =
        getAdminElements();

    if (
        adminUserCount
    ) {
        adminUserCount.textContent =
            "—";

        adminUserCount.title =
            "Admin user count is not yet available.";
    }
}

/* =========================================================
SYSTEM HEALTH
========================================================= */

async function loadSystemHealth() {
    let response;

    try {
        response =
            await fetch(
                SYSTEM_HEALTH_URL,
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
    catch {
        return false;
    }

    return response.ok;
}

function renderSystemHealth(
    available
) {
    const {
        adminSystemStatus
    } =
        getAdminElements();

    if (
        !adminSystemStatus
    ) {
        return;
    }

    if (
        available ===
        true
    ) {
        adminSystemStatus.textContent =
            "Operational";

        adminSystemStatus.dataset.state =
            "operational";

        return;
    }

    adminSystemStatus.textContent =
        "Unavailable";

    adminSystemStatus.dataset.state =
        "unavailable";
}

/* =========================================================
ACTIVITY API
========================================================= */

async function loadAdminActivity() {
    const url =
        new URL(
            TASK_ACTIVITY_URL,
            window.location.origin
        );

    url.searchParams.set(
        "limit",
        "10"
    );

    return requestAdminApi(
        url.toString()
    );
}

function extractActivity(
    result
) {
    if (
        Array.isArray(
            result
        )
    ) {
        return result;
    }

    if (
        Array.isArray(
            result?.events
        )
    ) {
        return result.events;
    }

    if (
        Array.isArray(
            result?.activity
        )
    ) {
        return result.activity;
    }

    if (
        Array.isArray(
            result?.items
        )
    ) {
        return result.items;
    }

    if (
        Array.isArray(
            result?.data
        )
    ) {
        return result.data;
    }

    return [];
}

/* =========================================================
ACTIVITY PRESENTATION
========================================================= */

function formatActivityType(
    event
) {
    const eventType =
        normalizeString(
            event?.event_type
            || event?.eventType
            || event?.type
        )
            .toLowerCase();

    switch (
        eventType
    ) {
        case "created":
            return {
                icon:
                    "＋",

                title:
                    "Task created"
            };

        case "updated":
            return {
                icon:
                    "✎",

                title:
                    "Task updated"
            };

        case "status_changed":
            return {
                icon:
                    "↻",

                title:
                    "Task status changed"
            };

        case "completed":
            return {
                icon:
                    "✓",

                title:
                    "Task completed"
            };

        case "reopened":
            return {
                icon:
                    "↻",

                title:
                    "Task reopened"
            };

        case "shelved":
            return {
                icon:
                    "▣",

                title:
                    "Task shelved"
            };

        case "restored":
            return {
                icon:
                    "↥",

                title:
                    "Task restored"
            };

        case "archived":
            return {
                icon:
                    "□",

                title:
                    "Task archived"
            };

        case "deleted":
            return {
                icon:
                    "×",

                title:
                    "Task deleted"
            };

        case "comment":
            return {
                icon:
                    "●",

                title:
                    "Task comment added"
            };

        case "assignment_changed":
            return {
                icon:
                    "⇄",

                title:
                    "Task assignment changed"
            };

        default:
            return {
                icon:
                    "•",

                title:
                    eventType
                        ? eventType
                            .replaceAll(
                                "_",
                                " "
                            )
                        : "Administrative activity"
            };
    }
}

/* =========================================================
ACTIVITY DATE
========================================================= */

function formatActivityDate(
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
ACTIVITY DESCRIPTION
========================================================= */

function getActivityDescription(
    event
) {
    const taskCode =
        normalizeString(
            event?.task_code
            || event?.taskCode
            || event?.task?.task_code
        );

    const note =
        normalizeString(
            event?.note
        );

    if (
        note
        && taskCode
    ) {
        return `${taskCode} — ${note}`;
    }

    if (
        note
    ) {
        return note;
    }

    if (
        taskCode
    ) {
        return taskCode;
    }

    return "Administrative activity recorded.";
}

/* =========================================================
ACTIVITY RENDERING
========================================================= */

function renderAdminActivity(
    events
) {
    const {
        adminActivityList
    } =
        getAdminElements();

    if (
        !adminActivityList
    ) {
        return;
    }

    adminActivityList.replaceChildren();

    const normalizedEvents =
        normalizeArray(
            events
        );

    if (
        normalizedEvents.length ===
        0
    ) {
        const empty =
            document.createElement(
                "p"
            );

        empty.className =
            "admin-empty-state";

        empty.textContent =
            "No recent administrative activity.";

        adminActivityList.appendChild(
            empty
        );

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const event of normalizedEvents
    ) {
        const presentation =
            formatActivityType(
                event
            );

        const item =
            document.createElement(
                "article"
            );

        item.className =
            "admin-activity-item";

        const icon =
            document.createElement(
                "span"
            );

        icon.className =
            "admin-activity-icon";

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        icon.textContent =
            presentation.icon;

        const content =
            document.createElement(
                "div"
            );

        content.className =
            "admin-activity-content";

        const title =
            document.createElement(
                "strong"
            );

        title.textContent =
            presentation.title;

        const description =
            document.createElement(
                "span"
            );

        description.textContent =
            getActivityDescription(
                event
            );

        content.append(
            title,
            description
        );

        const time =
            document.createElement(
                "time"
            );

        time.className =
            "admin-activity-time";

        const createdAt =
            normalizeString(
                event?.created_at
                || event?.createdAt
            );

        if (
            createdAt
        ) {
            time.dateTime =
                createdAt;

            time.textContent =
                formatActivityDate(
                    createdAt
                );
        }

        item.append(
            icon,
            content,
            time
        );

        fragment.appendChild(
            item
        );
    }

    adminActivityList.appendChild(
        fragment
    );
}

/* =========================================================
PARTIAL LOAD ERROR
========================================================= */

function logDashboardLoadFailure(
    area,
    error
) {
    console.warn(
        `ADMIN MANAGEMENT: ${area} could not be loaded.`,
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

/* =========================================================
LOAD DASHBOARD DATA
========================================================= */

async function loadAdminDashboardData() {
    setAdminStatus(
        "Loading administrative data..."
    );

    renderAdminUserCountUnavailable();

    const [
        summaryResult,
        activityResult,
        healthResult
    ] =
        await Promise.allSettled([
            loadTaskSummary(),
            loadAdminActivity(),
            loadSystemHealth()
        ]);

    /* -----------------------------------------------------
    TASK SUMMARY
    ----------------------------------------------------- */

    if (
        summaryResult.status ===
        "fulfilled"
    ) {
        adminState.taskSummary =
            summaryResult.value;

        renderTaskSummary(
            summaryResult.value
        );
    }
    else {
        logDashboardLoadFailure(
            "Task summary",
            summaryResult.reason
        );
    }

    /* -----------------------------------------------------
    ACTIVITY
    ----------------------------------------------------- */

    if (
        activityResult.status ===
        "fulfilled"
    ) {
        const events =
            extractActivity(
                activityResult.value
            );

        adminState.activity =
            events;

        renderAdminActivity(
            events
        );
    }
    else {
        logDashboardLoadFailure(
            "Recent activity",
            activityResult.reason
        );

        renderAdminActivity(
            []
        );
    }

    /* -----------------------------------------------------
    SYSTEM HEALTH
    ----------------------------------------------------- */

    if (
        healthResult.status ===
        "fulfilled"
    ) {
        adminState.systemAvailable =
            healthResult.value;

        renderSystemHealth(
            healthResult.value
        );
    }
    else {
        adminState.systemAvailable =
            false;

        renderSystemHealth(
            false
        );
    }

    /* -----------------------------------------------------
    ACCESS FAILURE DURING DATA LOAD

    If a protected Admin endpoint rejects current access,
    treat that as authoritative even if the page-level
    authorization check succeeded moments earlier.
    ----------------------------------------------------- */

    for (
        const result of [
            summaryResult,
            activityResult
        ]
    ) {
        if (
            result.status ===
                "rejected"
            && (
                result.reason?.status ===
                    401
                || result.reason?.status ===
                    403
            )
        ) {
            throw result.reason;
        }
    }

    setAdminStatus(
        ""
    );
}

/* =========================================================
RETRY
========================================================= */

function setupAdminRetry() {
    const {
        adminRetry
    } =
        getAdminElements();

    if (
        !adminRetry
        || adminRetry
            .dataset
            .initialized ===
            "true"
    ) {
        return;
    }

    adminRetry.addEventListener(
        "click",
        function() {
            initializePage();
        }
    );

    adminRetry.dataset.initialized =
        "true";
}

/* =========================================================
RESET DISPLAY
========================================================= */

function resetAdminDashboardDisplay() {
    const {
        adminActiveTaskCount,
        adminLateTaskCount,
        adminUserCount,
        adminSystemStatus,
        adminActivityList
    } =
        getAdminElements();

    if (
        adminActiveTaskCount
    ) {
        adminActiveTaskCount.textContent =
            "—";
    }

    if (
        adminLateTaskCount
    ) {
        adminLateTaskCount.textContent =
            "—";
    }

    if (
        adminUserCount
    ) {
        adminUserCount.textContent =
            "—";
    }

    if (
        adminSystemStatus
    ) {
        adminSystemStatus.textContent =
            "Checking";

        adminSystemStatus.removeAttribute(
            "data-state"
        );
    }

    if (
        adminActivityList
    ) {
        adminActivityList.replaceChildren();

        const loading =
            document.createElement(
                "p"
            );

        loading.className =
            "admin-empty-state";

        loading.textContent =
            "Loading recent administrative activity...";

        adminActivityList.appendChild(
            loading
        );
    }
}

/* =========================================================
ROUTER ENTRY POINT
========================================================= */

export async function initializePage() {
    showLoading();

    setupAdminRetry();

    resetAdminDashboardDisplay();

    try {
        const {
            state,
            authorized
        } =
            await loadAdminAuthorization();

        /* -------------------------------------------------
        AUTHORIZATION UNAVAILABLE
        ------------------------------------------------- */

        if (
            state?.admin?.available ===
            false
        ) {
            console.warn(
                "ADMIN MANAGEMENT: Admin authorization is unavailable.",
                {
                    code:
                        state?.admin?.error?.code
                        || null,

                    status:
                        state?.admin?.error?.status
                        || null
                }
            );

            showError(
                "Admin authorization is temporarily unavailable."
            );

            return;
        }

        /* -------------------------------------------------
        ACCESS DENIED
        ------------------------------------------------- */

        if (
            !authorized
        ) {
            showDenied();

            return;
        }

        /* -------------------------------------------------
        AUTHORIZED
        ------------------------------------------------- */

        adminState.auth =
            state;

        renderAdminRoles(
            state
        );

        console.log(
            "ADMIN MANAGEMENT: Authorized.",
            {
                roles:
                    adminState.roles,

                isOwner:
                    state?.admin?.isOwner ===
                    true
            }
        );

        showAuthorized();

        try {
            await loadAdminDashboardData();
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
                showDenied();

                return;
            }

            console.error(
                "ADMIN MANAGEMENT: Dashboard data load failed.",
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

            setAdminStatus(
                "Some administrative information could not be loaded.",
                "warning"
            );
        }
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN MANAGEMENT: Initialization failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showError(
            error?.message
            || "Admin Management could not be initialized."
        );
    }
}