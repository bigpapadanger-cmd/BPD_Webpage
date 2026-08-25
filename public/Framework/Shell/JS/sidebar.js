/*
=========================================================
BPD GAMING NETWORK
SPA SIDEBAR MODULE

Authentication does not run from the global shell.
Epic authentication begins only from the dedicated
login control on the Rocket League page.
=========================================================
*/

/*
=========================================================
INITIALIZE SIDEBAR
Call after sidebar HTML and hover HTML are loaded.
=========================================================
*/

export function initializeSidebar() {

    applyGlobalSettings();
    setupSidebarToggle();
    setupActiveNavigation();
    setupDisabledNavigation();
    setupSidebarTooltips();

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
            await fetch(hoverFile);

        if (!response.ok) {

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

        if (existingHover) {
            existingHover.remove();
        }

        const container =
            document.createElement("div");

        container.innerHTML =
            hoverHTML;

        while (container.firstElementChild) {

            document.body.appendChild(
                container.firstElementChild
            );

        }

    } catch (error) {

        console.error(
            "SIDEBAR HOVER LOAD FAILED:",
            error
        );

    }

}

/*
=========================================================
GLOBAL SETTINGS
Theme, animations and collapsed state.
=========================================================
*/

function applyGlobalSettings() {

    const sidebar =
        document.getElementById("sidebar");

    const sidebarToggle =
        document.getElementById(
            "sidebarToggle"
        );

    if (!sidebar) {
        return;
    }

    const savedSidebar =
        localStorage.getItem("bpdSidebar")
        || "open";

    const savedTheme =
        localStorage.getItem("bpdTheme")
        || "blue";

    const savedAnimations =
        localStorage.getItem("bpdAnimations")
        || "on";

    if (savedSidebar === "collapsed") {

        sidebar.classList.add(
            "collapsed"
        );

        document.body.classList.add(
            "sidebar-collapsed"
        );

    } else {

        sidebar.classList.remove(
            "collapsed"
        );

        document.body.classList.remove(
            "sidebar-collapsed"
        );

    }

    if (sidebarToggle) {

        sidebarToggle.setAttribute(
            "aria-expanded",
            String(
                savedSidebar
                !== "collapsed"
            )
        );

    }

    document.body.dataset.theme =
        savedTheme;

    document.body.dataset.animations =
        savedAnimations;

    document.body.classList.toggle(
        "animations-off",
        savedAnimations === "off"
    );

}

/*
=========================================================
SIDEBAR TOGGLE
=========================================================
*/

function setupSidebarToggle() {

    const sidebar =
        document.getElementById("sidebar");

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

            const willCollapse =
                !sidebar.classList.contains(
                    "collapsed"
                );

            sidebar.classList.toggle(
                "collapsed",
                willCollapse
            );

            document.body.classList.toggle(
                "sidebar-collapsed",
                willCollapse
            );

            localStorage.setItem(
                "bpdSidebar",
                willCollapse
                    ? "collapsed"
                    : "open"
            );

            sidebarToggle.setAttribute(
                "aria-expanded",
                String(!willCollapse)
            );

            if (!willCollapse) {
                hideSidebarTooltip();
            }

        }
    );

}

/*
=========================================================
TOOLTIP SYSTEM
=========================================================
*/

function setupSidebarTooltips() {

    const sidebar =
        document.getElementById("sidebar");

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
        function(item) {

            item.addEventListener(
                "mouseenter",
                function(event) {

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

                    if (!text) {
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
                function(event) {

                    if (
                        !sidebar.classList.contains(
                            "collapsed"
                        )
                    ) {
                        return;
                    }

                    const text =
                        item.dataset.tooltip;

                    if (!text) {
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

    if (!tooltip) {
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
        function(item) {

            const route =
                normalizePath(
                    item.dataset.navRoute
                );

            const exactMatch =
                currentPath === route;

            const childMatch =
                route !== "/"
                && currentPath.startsWith(
                    `${route}/`
                );

            item.classList.toggle(
                "active",
                exactMatch || childMatch
            );

        }
    );

}

/*
=========================================================
NORMALIZE PATH
=========================================================
*/

function normalizePath(path) {

    if (!path) {
        return "/";
    }

    let normalizedPath =
        String(path);

    if (
        normalizedPath.length > 1
        && normalizedPath.endsWith("/")
    ) {

        normalizedPath =
            normalizedPath.slice(0, -1);

    }

    if (
        normalizedPath
        === "/index.html"
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
        function(item) {

            item.addEventListener(
                "click",
                function(event) {

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