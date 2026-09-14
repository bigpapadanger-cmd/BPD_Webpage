"use strict";

/*
=========================================================
BPD GAMING NETWORK
ADMIN SIDEBAR MODULE

File:
    Framework/Shell/JS/Admin/sidebar.js

Purpose:
    Initializes and manages the Admin-specific sidebar.

Admin Navigation:
    - Dashboard
    - Taskboard
    - Terms of Service
    - Privacy Policy

Description:
    - Maintains user-controlled sidebar state.
    - Supports collapsed and expanded modes.
    - Applies shared theme and animation preferences.
    - Marks the current Admin route active.
    - Manages collapsed-sidebar tooltips.
    - Supports disabled Admin navigation items.
    - Does not perform public-site Admin-link visibility
      checks because this module is only used by Admin pages.

Security:
    - Admin authorization remains server-side.
    - This module does not determine Admin permissions.
    - Admin API endpoints remain independently protected.
=========================================================
*/

let adminSidebarResizeInitialized =
    false;

/*
=========================================================
INITIALIZE ADMIN SIDEBAR

Call after Admin sidebar HTML and sidebar hover HTML have
been loaded into the DOM.
=========================================================
*/

export function initializeAdminSidebar() {
    applyAdminGlobalSettings();
    setupAdminSidebarToggle();
    setupAdminActiveNavigation();
    setupAdminDisabledNavigation();
    setupAdminSidebarTooltips();
    setupAdminSidebarResize();
}

/*
=========================================================
LOAD ADMIN SIDEBAR HOVER TOOLTIP HTML

The Admin sidebar can continue using the shared sidebar
tooltip markup.
=========================================================
*/

export async function loadAdminSidebarHover() {
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
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN SIDEBAR HOVER LOAD FAILED:",
            error
        );
    }
}

/*
=========================================================
GLOBAL SETTINGS

Uses the same saved user preferences as the normal site
shell so switching between the public site and Admin area
does not unexpectedly change sidebar/theme behavior.
=========================================================
*/

function applyAdminGlobalSettings() {
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

/*
=========================================================
SET ADMIN SIDEBAR STATE
=========================================================
*/

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

/*
=========================================================
ADMIN SIDEBAR TOGGLE
=========================================================
*/

function setupAdminSidebarToggle() {
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
}

/*
=========================================================
ADMIN SIDEBAR RESIZE
=========================================================
*/

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

    setAdminSidebarCollapsed(
        sidebar,
        sidebarToggle,
        savedSidebar ===
            "collapsed"
    );

    hideAdminSidebarTooltip();
}

/*
=========================================================
ADMIN SIDEBAR TOOLTIPS
=========================================================
*/

function setupAdminSidebarTooltips() {
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
        }
    );

    sidebar.addEventListener(
        "mouseleave",
        hideAdminSidebarTooltip
    );

    sidebar.addEventListener(
        "scroll",
        hideAdminSidebarTooltip
    );
}

/*
=========================================================
SHOW ADMIN SIDEBAR TOOLTIP
=========================================================
*/

function showAdminSidebarTooltip(
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
HIDE ADMIN SIDEBAR TOOLTIP
=========================================================
*/

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

/*
=========================================================
ADMIN ACTIVE NAVIGATION

Admin routes are evaluated against the current browser path.

Examples:
    /Dashboard
        -> Dashboard active

    /Admin/Taskboard
        -> Taskboard active

    /Admin/Taskboard/TASK-A7K9Q2
        -> Taskboard remains active
=========================================================
*/

function setupAdminActiveNavigation() {
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

            item.classList.toggle(
                "active",
                exactMatch
                || childMatch
            );

            if (
                exactMatch
                || childMatch
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

/*
=========================================================
NORMALIZE ADMIN PATH
=========================================================
*/

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
            normalizedPath === ""
        ) {
            normalizedPath =
                "/";
        }
    }

    return normalizedPath;
}

/*
=========================================================
DISABLED ADMIN NAVIGATION
=========================================================
*/

function setupAdminDisabledNavigation() {
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

            item.setAttribute(
                "tabindex",
                "-1"
            );
        }
    );
}