
/*
=========================================================
HOMEPAGE JAVASCRIPT
=========================================================

The global sidebar is injected separately by:
    /Global/Sidebar/JS/sidebar.js

This file handles homepage-specific behavior and applies
the shared BPD Gaming Network settings.

Shared localStorage settings:
    bpdSidebar
    bpdTheme
    bpdAnimations

=========================================================
*/


/*
=========================================================
SIDEBAR ELEMENTS
=========================================================
*/

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");


/*
=========================================================
APPLY GLOBAL SETTINGS
=========================================================

Loads the user's saved preferences and applies them to
the current page.

These settings are shared across the entire website.
=========================================================
*/

function applyGlobalSettings() {
    const savedSidebar = localStorage.getItem("bpdSidebar") || "open";
    const savedTheme = localStorage.getItem("bpdTheme") || "blue";
    const savedAnimations = localStorage.getItem("bpdAnimations") || "on";

    /*
    ---------------------------------------------------------
    SIDEBAR STATE
    ---------------------------------------------------------
    */

    if (sidebar) {
        if (savedSidebar === "collapsed") {
            sidebar.classList.add("collapsed");
        } else {
            sidebar.classList.remove("collapsed");
        }
    }

    /*
    ---------------------------------------------------------
    SIDEBAR ACCESSIBILITY STATE
    ---------------------------------------------------------
    */

    if (sidebarToggle) {
        sidebarToggle.setAttribute(
            "aria-expanded",
            savedSidebar !== "collapsed"
        );
    }

    /*
    ---------------------------------------------------------
    THEME
    ---------------------------------------------------------
    */

    document.body.dataset.theme = savedTheme;

    /*
    ---------------------------------------------------------
    ANIMATIONS
    ---------------------------------------------------------
    */

    document.body.dataset.animations = savedAnimations;

    if (savedAnimations === "off") {
        document.body.classList.add("animations-off");
    } else {
        document.body.classList.remove("animations-off");
    }
}


/*
=========================================================
TOGGLE SIDEBAR
=========================================================

Allows the user to collapse or expand the sidebar.

The selected state is saved so it remains consistent
when the user navigates to another page.
=========================================================
*/

function toggleSidebar() {
    if (!sidebar) {
        return;
    }

    const isCollapsed = sidebar.classList.contains("collapsed");

    if (isCollapsed) {
        sidebar.classList.remove("collapsed");

        localStorage.setItem(
            "bpdSidebar",
            "open"
        );

        if (sidebarToggle) {
            sidebarToggle.setAttribute(
                "aria-expanded",
                "true"
            );
        }
    } else {
        sidebar.classList.add("collapsed");

        localStorage.setItem(
            "bpdSidebar",
            "collapsed"
        );

        if (sidebarToggle) {
            sidebarToggle.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    }
}


/*
=========================================================
SIDEBAR TOGGLE EVENT
=========================================================
*/

if (sidebarToggle) {
    sidebarToggle.addEventListener(
        "click",
        toggleSidebar
    );
}


/*
=========================================================
ACTIVE NAVIGATION
=========================================================

Determines which navigation item should be highlighted
based on the current URL.

This means you do NOT need to manually change:

    class="nav-item active"

on every page.

Example:

    /
        -> Home

    /RocketLeague
        -> Rocket League

    /Settings
        -> Settings

=========================================================
*/

function updateActiveNavigation() {
    const currentPath =
        window.location.pathname.replace(/\/$/, "") || "/";

    document
        .querySelectorAll(".nav-item")
        .forEach((item) => {
            item.classList.remove("active");

            const href = item.getAttribute("href");

            if (!href || href === "#") {
                return;
            }

            let linkPath;

            try {
                linkPath = new URL(
                    href,
                    window.location.origin
                ).pathname.replace(/\/$/, "") || "/";
            } catch (error) {
                return;
            }

            if (linkPath === currentPath) {
                item.classList.add("active");
            }
        });
}


/*
=========================================================
DISABLED NAVIGATION
=========================================================

Prevents unfinished/future sections from navigating
anywhere.

Example:

    <a href="#" class="nav-item disabled">

=========================================================
*/

function setupDisabledNavigation() {
    document
        .querySelectorAll(".nav-item.disabled")
        .forEach((item) => {
            item.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                }
            );
        });
}


/*
=========================================================
INITIALIZE PAGE
=========================================================

Apply settings first, then configure navigation.
=========================================================
*/

applyGlobalSettings();
updateActiveNavigation();
setupDisabledNavigation();

