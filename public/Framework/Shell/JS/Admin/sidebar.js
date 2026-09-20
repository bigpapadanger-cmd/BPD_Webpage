"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN SIDEBAR MODULE

File:
    /Framework/Shell/JS/Admin/sidebar.js

Purpose:
    Initializes and manages the Admin-specific sidebar only
    after server-side Admin access has been verified.

Admin Access Requirements:
    Every Admin page requires:

    1. An authenticated BPD account.
    2. An associated Discord identity.
    3. Current Discord-backed Admin staff authorization.
    4. At least one active responsibility role from:
           owner
           database
           security
           ui

    The authoritative access decision is provided by:
        GET /api/auth/admin/access

Admin Navigation:
    - Dashboard
    - Taskboard
    - Terms of Service
    - Privacy Policy

Initialization Priority:

    ACCESS
    - Verify server-side Admin access.
    - Keep Admin navigation inaccessible until verified.

    CRITICAL
    - Apply saved sidebar state.
    - Apply theme and animation settings.
    - Initialize sidebar toggle.
    - Mark active Admin navigation.
    - Initialize disabled navigation state.

    DEFERRED
    - Initialize tooltip behavior.
    - Initialize resize handling.

Description:
    - Verifies Admin access before enabling navigation.
    - Maintains user-controlled sidebar state.
    - Supports collapsed and expanded modes.
    - Applies shared theme and animation preferences.
    - Marks the current Admin route active.
    - Manages collapsed-sidebar tooltips.
    - Supports disabled Admin navigation items.

Security:
    - Admin authorization remains server-side.
    - Discord authorization is verified server-side.
    - Responsibility roles are verified server-side.
    - This module does not trust client-side role claims.
    - This module does not determine operation permissions.
    - Admin API endpoints remain independently protected.
    - Client-side sidebar protection is presentation only.
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

/* =========================================================
INTERNAL STATE
========================================================= */

let adminSidebarResizeInitialized =
    false;

let adminSidebarDeferredInitialized =
    false;

let adminSidebarAuthorized =
    false;

let adminSidebarAccessRequest =
    null;

/* =========================================================
ADMIN SIDEBAR ELEMENT
========================================================= */

function getAdminSidebar() {
    return document.getElementById(
        "sidebar"
    );
}

/* =========================================================
ADMIN SIDEBAR ACCESS STATE
========================================================= */

function lockAdminSidebar() {
    const sidebar =
        getAdminSidebar();

    adminSidebarAuthorized =
        false;

    hideAdminSidebarTooltip();

    if (
        !sidebar
    ) {
        return;
    }

    sidebar.hidden =
        true;

    sidebar.setAttribute(
        "aria-hidden",
        "true"
    );

    sidebar.dataset.adminAuthorized =
        "false";
}

function unlockAdminSidebar() {
    const sidebar =
        getAdminSidebar();

    adminSidebarAuthorized =
        true;

    if (
        !sidebar
    ) {
        return;
    }

    sidebar.hidden =
        false;

    sidebar.setAttribute(
        "aria-hidden",
        "false"
    );

    sidebar.dataset.adminAuthorized =
        "true";
}

/* =========================================================
VERIFY ADMIN ACCESS

/api/auth/admin/access is the canonical Admin entry gate.

A successful response means the server has verified:
    - authenticated BPD account
    - Discord-backed Admin authorization
    - active responsibility-role membership

The browser does not independently determine these roles.
========================================================= */

async function verifyAdminSidebarAccess() {
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
                response.status,

            reason:
                "INVALID_RESPONSE"
        };
    }

    const authorized =
        response.ok
        && result?.success ===
            true
        && result?.authorized ===
            true
        && result?.taskboard?.member ===
            true
        && Array.isArray(
            result?.taskboard?.roles
        )
        && result.taskboard.roles.length >
            0;

    return {
        authorized,

        status:
            response.status,

        reason:
            authorized
                ? null
                : result?.error
                    || "ADMIN_ACCESS_DENIED"
    };
}

/* =========================================================
LOAD ADMIN ACCESS

Deduplicates simultaneous Admin sidebar authorization
requests.
========================================================= */

async function loadAdminSidebarAccess() {
    if (
        adminSidebarAccessRequest
    ) {
        return adminSidebarAccessRequest;
    }

    adminSidebarAccessRequest =
        (
            async () => {
                try {
                    return await verifyAdminSidebarAccess();
                }
                catch (
                    error
                ) {
                    console.error(
                        "ADMIN SIDEBAR ACCESS CHECK FAILED:",
                        {
                            name:
                                error?.name
                                || "Error",

                            message:
                                error?.message
                                || "Unknown error"
                        }
                    );

                    return {
                        authorized:
                            false,

                        status:
                            null,

                        reason:
                            "ADMIN_ACCESS_CHECK_FAILED"
                    };
                }
                finally {
                    adminSidebarAccessRequest =
                        null;
                }
            }
        )();

    return adminSidebarAccessRequest;
}

/* =========================================================
INITIALIZE ADMIN SIDEBAR

The sidebar remains inaccessible until the canonical Admin
access endpoint confirms authorization.
========================================================= */

export async function initializeAdminSidebar() {
    lockAdminSidebar();

    const access =
        await loadAdminSidebarAccess();

    if (
        !access.authorized
    ) {
        lockAdminSidebar();

        return false;
    }

    initializeAdminSidebarCritical();

    unlockAdminSidebar();

    return true;
}

/* =========================================================
CRITICAL INITIALIZATION

This function is exported for shell integration, but it
still fails closed unless Admin access has already been
verified by initializeAdminSidebar().
========================================================= */

export function initializeAdminSidebarCritical() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return false;
    }

    applyAdminGlobalSettings();
    setupAdminSidebarToggle();
    setupAdminActiveNavigation();
    setupAdminDisabledNavigation();

    return true;
}

/* =========================================================
DEFERRED INITIALIZATION

Call after the sidebar hover HTML has been loaded.

Deferred behavior is not initialized unless Admin access
has already been verified.
========================================================= */

export function initializeAdminSidebarDeferred() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return false;
    }

    if (
        adminSidebarDeferredInitialized
    ) {
        return true;
    }

    adminSidebarDeferredInitialized =
        true;

    setupAdminSidebarTooltips();
    setupAdminSidebarResize();

    return true;
}

/* =========================================================
LOAD ADMIN SIDEBAR HOVER TOOLTIP HTML

The Admin sidebar uses the shared sidebar tooltip markup.

Tooltip HTML is not loaded for an unauthorized Admin
session.
========================================================= */

export async function loadAdminSidebarHover() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return false;
    }

    const hoverFile =
        "/Framework/Shell/HTML/Sidebar/hover.html";

    try {
        const response =
            await fetch(
                hoverFile,
                {
                    cache:
                        "no-store"
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Admin sidebar hover failed: ${response.status}`
            );
        }

        const hoverHTML =
            await response.text();

        const existingHover =
            document.getElementById(
                "sidebarHover"
            );

        if (
            existingHover
        ) {
            existingHover.remove();
        }

        const container =
            document.createElement(
                "div"
            );

        container.innerHTML =
            hoverHTML;

        while (
            container.firstElementChild
        ) {
            document.body.appendChild(
                container.firstElementChild
            );
        }

        return true;
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN SIDEBAR HOVER LOAD FAILED:",
            error
        );

        return false;
    }
}

/* =========================================================
GLOBAL SETTINGS

Uses the same saved user preferences as the normal site
shell so switching between the public site and Admin area
does not unexpectedly change sidebar/theme behavior.
========================================================= */

function applyAdminGlobalSettings() {
    const sidebar =
        getAdminSidebar();

    const sidebarToggle =
        document.getElementById(
            "sidebarToggle"
        );

    if (
        !sidebar
    ) {
        return;
    }

    const savedSidebar =
        localStorage.getItem(
            "bpdSidebar"
        );

    const savedTheme =
        localStorage.getItem(
            "bpdTheme"
        )
        || "blue";

    const savedAnimations =
        localStorage.getItem(
            "bpdAnimations"
        )
        || "on";

    let shouldCollapse;

    if (
        savedSidebar ===
        "collapsed"
    ) {
        shouldCollapse =
            true;
    }
    else if (
        savedSidebar ===
        "open"
    ) {
        shouldCollapse =
            false;
    }
    else {
        shouldCollapse =
            window.innerWidth <=
            700;
    }

    setAdminSidebarCollapsed(
        sidebar,
        sidebarToggle,
        shouldCollapse
    );

    document.body.dataset.theme =
        savedTheme;

    document.body.dataset.animations =
        savedAnimations;

    document.body.classList.toggle(
        "animations-off",
        savedAnimations ===
            "off"
    );
}

/* =========================================================
SET ADMIN SIDEBAR STATE
========================================================= */

function setAdminSidebarCollapsed(
    sidebar,
    sidebarToggle,
    collapsed
) {
    if (
        !sidebar
    ) {
        return;
    }

    sidebar.classList.toggle(
        "collapsed",
        collapsed
    );

    document.body.classList.toggle(
        "sidebar-collapsed",
        collapsed
    );

    document.body.dataset.sidebar =
        collapsed
            ? "collapsed"
            : "open";

    if (
        sidebarToggle
    ) {
        sidebarToggle.setAttribute(
            "aria-expanded",
            String(
                !collapsed
            )
        );

        sidebarToggle.setAttribute(
            "aria-label",
            collapsed
                ? "Expand Admin navigation"
                : "Collapse Admin navigation"
        );
    }
}

/* =========================================================
ADMIN SIDEBAR TOGGLE
========================================================= */

function setupAdminSidebarToggle() {
    const sidebar =
        getAdminSidebar();

    const sidebarToggle =
        document.getElementById(
            "sidebarToggle"
        );

    if (
        !sidebar
        || !sidebarToggle
    ) {
        return;
    }

    if (
        sidebarToggle.dataset
            .adminSidebarInitialized ===
        "true"
    ) {
        return;
    }

    sidebarToggle.addEventListener(
        "click",
        function() {
            if (
                adminSidebarAuthorized !==
                true
            ) {
                return;
            }

            const isCollapsed =
                sidebar.classList.contains(
                    "collapsed"
                );

            const willCollapse =
                !isCollapsed;

            setAdminSidebarCollapsed(
                sidebar,
                sidebarToggle,
                willCollapse
            );

            localStorage.setItem(
                "bpdSidebar",
                willCollapse
                    ? "collapsed"
                    : "open"
            );

            hideAdminSidebarTooltip();
        }
    );

    sidebarToggle.dataset.adminSidebarInitialized =
        "true";
}

/* =========================================================
ADMIN SIDEBAR RESIZE
========================================================= */

function setupAdminSidebarResize() {
    if (
        adminSidebarResizeInitialized
    ) {
        return;
    }

    adminSidebarResizeInitialized =
        true;

    window.addEventListener(
        "resize",
        handleAdminSidebarResize
    );
}

function handleAdminSidebarResize() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return;
    }

    const sidebar =
        getAdminSidebar();

    const sidebarToggle =
        document.getElementById(
            "sidebarToggle"
        );

    if (
        !sidebar
    ) {
        return;
    }

    const savedSidebar =
        localStorage.getItem(
            "bpdSidebar"
        );

    if (
        savedSidebar !==
            "open"
        && savedSidebar !==
            "collapsed"
    ) {
        return;
    }

    setAdminSidebarCollapsed(
        sidebar,
        sidebarToggle,
        savedSidebar ===
            "collapsed"
    );

    hideAdminSidebarTooltip();
}

/* =========================================================
ADMIN SIDEBAR TOOLTIPS
========================================================= */

function setupAdminSidebarTooltips() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return;
    }

    const sidebar =
        getAdminSidebar();

    const tooltip =
        document.getElementById(
            "sidebarHover"
        );

    const tooltipText =
        document.getElementById(
            "sidebarHoverText"
        );

    if (
        !sidebar
        || !tooltip
        || !tooltipText
    ) {
        return;
    }

    const tooltipItems =
        sidebar.querySelectorAll(
            ".nav-item[data-tooltip]"
        );

    tooltipItems.forEach(
        function(
            item
        ) {
            if (
                item.dataset
                    .adminTooltipInitialized ===
                "true"
            ) {
                return;
            }

            item.addEventListener(
                "mouseenter",
                function(
                    event
                ) {
                    if (
                        adminSidebarAuthorized !==
                        true
                        || !sidebar.classList.contains(
                            "collapsed"
                        )
                    ) {
                        hideAdminSidebarTooltip();

                        return;
                    }

                    const text =
                        item.dataset.tooltip;

                    if (
                        !text
                    ) {
                        return;
                    }

                    showAdminSidebarTooltip(
                        tooltip,
                        tooltipText,
                        event,
                        text
                    );
                }
            );

            item.addEventListener(
                "mousemove",
                function(
                    event
                ) {
                    if (
                        adminSidebarAuthorized !==
                        true
                        || !sidebar.classList.contains(
                            "collapsed"
                        )
                    ) {
                        return;
                    }

                    const text =
                        item.dataset.tooltip;

                    if (
                        !text
                    ) {
                        return;
                    }

                    showAdminSidebarTooltip(
                        tooltip,
                        tooltipText,
                        event,
                        text
                    );
                }
            );

            item.addEventListener(
                "mouseleave",
                hideAdminSidebarTooltip
            );

            item.dataset.adminTooltipInitialized =
                "true";
        }
    );

    if (
        sidebar.dataset
            .adminTooltipContainerInitialized !==
        "true"
    ) {
        sidebar.addEventListener(
            "mouseleave",
            hideAdminSidebarTooltip
        );

        sidebar.addEventListener(
            "scroll",
            hideAdminSidebarTooltip
        );

        sidebar.dataset
            .adminTooltipContainerInitialized =
            "true";
    }
}

/* =========================================================
SHOW ADMIN SIDEBAR TOOLTIP
========================================================= */

function showAdminSidebarTooltip(
    tooltip,
    tooltipText,
    event,
    text
) {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return;
    }

    tooltipText.textContent =
        text;

    tooltip.style.left =
        `${event.clientX + 25}px`;

    tooltip.style.top =
        `${event.clientY + 10}px`;

    tooltip.classList.add(
        "visible"
    );

    tooltip.setAttribute(
        "aria-hidden",
        "false"
    );
}

/* =========================================================
HIDE ADMIN SIDEBAR TOOLTIP
========================================================= */

function hideAdminSidebarTooltip() {
    const tooltip =
        document.getElementById(
            "sidebarHover"
        );

    if (
        !tooltip
    ) {
        return;
    }

    tooltip.classList.remove(
        "visible"
    );

    tooltip.setAttribute(
        "aria-hidden",
        "true"
    );
}

/* =========================================================
ADMIN ACTIVE NAVIGATION
========================================================= */

function setupAdminActiveNavigation() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return;
    }

    const currentPath =
        normalizeAdminPath(
            window.location.pathname
        );

    const navItems =
        document.querySelectorAll(
            ".nav-item[data-nav-route]"
        );

    navItems.forEach(
        function(
            item
        ) {
            const route =
                normalizeAdminPath(
                    item.dataset.navRoute
                );

            const exactMatch =
                currentPath ===
                route;

            const childMatch =
                route !== "/"
                && currentPath.startsWith(
                    `${route}/`
                );

            const active =
                exactMatch
                || childMatch;

            item.classList.toggle(
                "active",
                active
            );

            if (
                active
            ) {
                item.setAttribute(
                    "aria-current",
                    "page"
                );
            }
            else {
                item.removeAttribute(
                    "aria-current"
                );
            }
        }
    );
}

/* =========================================================
NORMALIZE ADMIN PATH
========================================================= */

function normalizeAdminPath(
    path
) {
    if (
        !path
    ) {
        return "/";
    }

    let normalizedPath =
        String(
            path
        );

    while (
        normalizedPath.length > 1
        && normalizedPath.endsWith(
            "/"
        )
    ) {
        normalizedPath =
            normalizedPath.slice(
                0,
                -1
            );
    }

    if (
        normalizedPath.endsWith(
            "/index.html"
        )
    ) {
        normalizedPath =
            normalizedPath.slice(
                0,
                -11
            );

        if (
            normalizedPath ===
            ""
        ) {
            normalizedPath =
                "/";
        }
    }

    return normalizedPath;
}

/* =========================================================
DISABLED ADMIN NAVIGATION
========================================================= */

function setupAdminDisabledNavigation() {
    if (
        adminSidebarAuthorized !==
        true
    ) {
        return;
    }

    const disabledItems =
        document.querySelectorAll(
            ".nav-item.disabled"
        );

    disabledItems.forEach(
        function(
            item
        ) {
            if (
                item.dataset
                    .adminDisabledInitialized ===
                "true"
            ) {
                return;
            }

            item.addEventListener(
                "click",
                function(
                    event
                ) {
                    event.preventDefault();
                }
            );

            item.setAttribute(
                "aria-disabled",
                "true"
            );

            item.setAttribute(
                "tabindex",
                "-1"
            );

            item.dataset.adminDisabledInitialized =
                "true";
        }
    );
}