"use strict";

/* =========================================================
BPD GAMING NETWORK
SPA SIDEBAR MODULE

File:
    /Framework/Shell/JS/Sidebar/sidebar.js

Purpose:
    Coordinates shared sidebar initialization and behavior.

Responsibilities:
    - Applies stored sidebar/theme preferences.
    - Handles sidebar expansion and collapse.
    - Handles route visibility and active navigation.
    - Handles disabled navigation items.
    - Handles collapsed-sidebar tooltips.
    - Handles resize behavior.
    - Delegates Admin navigation authorization.
    - Delegates submenu behavior.

Important:
    - Admin authorization belongs to admin_navigation.js.
    - Submenu behavior belongs to submenu.js.
    - This file should coordinate those modules rather than
      duplicate their implementations.
========================================================= */

import {
    setupAdminNavigation
} from "./admin_navigation.js";

import {
    initializeSidebarSubmenus
} from "./submenu.js";

let sidebarResizeInitialized =
    false;

/* =========================================================
INITIALIZE SIDEBAR

Initialization is split into priority phases:

1. Critical
   Runs immediately before yielding to the browser.

2. Interactive
   Runs on the next animation frame after initial paint.

3. Deferred
   Runs during browser idle time when possible.
========================================================= */

export function initializeSidebar() {
    initializeCriticalSidebar();

    window.requestAnimationFrame(
        () => {
            initializeInteractiveSidebar();

            scheduleSidebarIdleWork();
        }
    );
}

/* =========================================================
CRITICAL INITIALIZATION

Required for correct first-render behavior.
Keep this phase lightweight and synchronous.
========================================================= */

function initializeCriticalSidebar() {
    applyGlobalSettings();

    setupSidebarToggle();

    setupRouteVisibility();

    setupActiveNavigation();

    setupDisabledNavigation();
}

/* =========================================================
INTERACTIVE INITIALIZATION

Runs after the browser has had an opportunity to paint.

These features should become available quickly but do not
need to block the initial sidebar render.
========================================================= */

function initializeInteractiveSidebar() {
    initializeSidebarSubmenus();

    /*
     * Authorization is asynchronous.
     *
     * Do not block sidebar initialization while waiting for
     * the Admin access API.
     */
    void setupAdminNavigation();
}

/* =========================================================
DEFERRED INITIALIZATION

Non-critical enhancements are initialized when the browser
has idle time available.
========================================================= */

function scheduleSidebarIdleWork() {
    if (
        typeof window.requestIdleCallback ===
        "function"
    ) {
        window.requestIdleCallback(
            () => {
                initializeDeferredSidebar();
            },
            {
                timeout:
                    1000
            }
        );

        return;
    }

    /*
     * Fallback for browsers without requestIdleCallback.
     */
    window.setTimeout(
        () => {
            initializeDeferredSidebar();
        },
        100
    );
}

/* =========================================================
DEFERRED SIDEBAR FEATURES
========================================================= */

function initializeDeferredSidebar() {
    setupSidebarTooltips();

    setupSidebarResize();
}

/*
=========================================================
LOAD HOVER TOOLTIP HTML
=========================================================
*/

export async function loadSidebarHover() {
    const hoverFile =
        "/Framework/Shell/HTML/Sidebar/hover.html";

    try {
        const response =
            await fetch(
                hoverFile
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Hover failed: ${response.status}`
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
    }
    catch (
        error
    ) {
        console.error(
            "SIDEBAR HOVER LOAD FAILED:",
            error
        );
    }
}


/*
=========================================================
GLOBAL SETTINGS
Theme, animations and saved sidebar state.

Sidebar preference is respected at every viewport size.
=========================================================
*/

function applyGlobalSettings() {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

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

    /*
     * Existing users keep their preference.
     *
     * New users:
     * desktop -> open
     * small screen -> collapsed
     *
     * This is only the initial state.
     * Expansion is NEVER blocked.
     */
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

    setSidebarCollapsed(
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


/*
=========================================================
SET SIDEBAR STATE
=========================================================
*/

function setSidebarCollapsed(
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
                ? "Expand navigation"
                : "Collapse navigation"
        );
    }
}


/*
=========================================================
SIDEBAR TOGGLE

Expansion is available on every screen size.
=========================================================
*/

function setupSidebarToggle() {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

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

    sidebarToggle.addEventListener(
        "click",
        function() {
            const isCollapsed =
                sidebar.classList.contains(
                    "collapsed"
                );

            const willCollapse =
                !isCollapsed;

            setSidebarCollapsed(
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

            hideSidebarTooltip();
        }
    );
}
/*
=========================================================
ADMIN NAVIGATION

Displays the Admin navigation item only when the current
authenticated account has Discord-backed Admin access.

Authorization remains server-side.
=========================================================
*/

async function setupAdminNavigation() {
    const adminNavItem =
        document.getElementById(
            "adminNavItem"
        );

    if (
        !adminNavItem
    ) {
        return;
    }

    /*
     * Always start hidden.
     *
     * This prevents unauthorized users from briefly seeing
     * the Admin navigation item while authorization loads.
     */
    adminNavItem.hidden =
        true;

    try {
        const response =
            await fetch(
                "/api/auth/admin/access",
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

        if (
            !response.ok
        ) {
            return;
        }

        let result;

        try {
            result =
                await response.json();
        }
        catch {
            return;
        }

        if (
            result?.authorized ===
            true
        ) {
            adminNavItem.hidden =
                false;
        }
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN NAVIGATION ACCESS CHECK FAILED:",
            error
        );
    }
}

/*
=========================================================
WINDOW RESIZE

Do not force a sidebar state during resize.

The user's explicit state remains authoritative.
=========================================================
*/

function setupSidebarResize() {
    if (
        sidebarResizeInitialized
    ) {
        return;
    }

    sidebarResizeInitialized =
        true;

    window.addEventListener(
        "resize",
        handleSidebarResize
    );
}

function handleSidebarResize() {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

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

    setSidebarCollapsed(
        sidebar,
        sidebarToggle,
        savedSidebar ===
            "collapsed"
    );

    hideSidebarTooltip();
}


/*
=========================================================
TOOLTIP SYSTEM
=========================================================
*/

function setupSidebarTooltips() {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

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
            item.addEventListener(
                "mouseenter",
                function(
                    event
                ) {
                    if (
                        !sidebar.classList.contains(
                            "collapsed"
                        )
                    ) {
                        hideSidebarTooltip();

                        return;
                    }

                    const text =
                        item.dataset.tooltip;

                    if (
                        !text
                    ) {
                        return;
                    }

                    showSidebarTooltip(
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
                        !sidebar.classList.contains(
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

                    showSidebarTooltip(
                        tooltip,
                        tooltipText,
                        event,
                        text
                    );
                }
            );

            item.addEventListener(
                "mouseleave",
                hideSidebarTooltip
            );
        }
    );

    sidebar.addEventListener(
        "mouseleave",
        hideSidebarTooltip
    );

    sidebar.addEventListener(
        "scroll",
        hideSidebarTooltip
    );
}


/*
=========================================================
SHOW TOOLTIP
=========================================================
*/

function showSidebarTooltip(
    tooltip,
    tooltipText,
    event,
    text
) {
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


/*
=========================================================
HIDE TOOLTIP
=========================================================
*/

function hideSidebarTooltip() {
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
/*
=========================================================
ROUTE VISIBILITY

Hides navigation items configured to be hidden on an exact
route.

Example:
    data-hide-on-route="/RocketLeague"
=========================================================
*/

function setupRouteVisibility() {
    const currentPath =
        normalizePath(
            window.location.pathname
        );

    const items =
        document.querySelectorAll(
            "[data-hide-on-route]"
        );

    items.forEach(
        function(
            item
        ) {
            const hiddenRoute =
                normalizePath(
                    item.dataset.hideOnRoute
                );

            item.hidden =
                currentPath.toLowerCase() ===
                hiddenRoute.toLowerCase();
        }
    );
}

/*
=========================================================
ACTIVE NAVIGATION
=========================================================
*/

function setupActiveNavigation() {
    const currentPath =
        normalizePath(
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
                normalizePath(
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

            item.classList.toggle(
                "active",
                exactMatch
                || childMatch
            );
        }
    );
}


/*
=========================================================
NORMALIZE PATH
=========================================================
*/

function normalizePath(
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

    if (
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
        normalizedPath ===
        "/index.html"
    ) {
        return "/";
    }

    return normalizedPath;
}


/*
=========================================================
DISABLED NAVIGATION
=========================================================
*/

function setupDisabledNavigation() {
    const disabledItems =
        document.querySelectorAll(
            ".nav-item.disabled"
        );

    disabledItems.forEach(
        function(
            item
        ) {
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
        }
    );
}