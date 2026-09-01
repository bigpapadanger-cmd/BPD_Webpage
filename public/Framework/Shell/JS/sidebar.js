/*
=========================================================
BPD GAMING NETWORK
SPA SIDEBAR MODULE

Authentication does not run from the global shell.
Epic authentication begins only from the dedicated
login control on the Rocket League page.
=========================================================
*/

const SIDEBAR_AUTO_COLLAPSE_WIDTH = 900;
let sidebarResizeInitialized = false;


/*
=========================================================
INITIALIZE SIDEBAR
Call after sidebar HTML and hover HTML are loaded.
=========================================================
*/

export function initializeSidebar() {
    applyGlobalSettings();
    applyAutomaticSidebarState();
    setupSidebarToggle();
    setupActiveNavigation();
    setupDisabledNavigation();
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
Theme, animations and saved sidebar state.
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

    if (!sidebar) {
        return;
    }

    const savedSidebar =
        localStorage.getItem(
            "bpdSidebar"
        ) || "open";

    const savedTheme =
        localStorage.getItem(
            "bpdTheme"
        ) || "blue";

    const savedAnimations =
        localStorage.getItem(
            "bpdAnimations"
        ) || "on";

    const shouldCollapse =
        savedSidebar === "collapsed";

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
        savedAnimations === "off"
    );
}


/*
=========================================================
AUTOMATIC SIDEBAR STATE
Force collapse where screen space is limited.
=========================================================
*/

function shouldAutoCollapseSidebar() {
    return (
        window.innerWidth <=
        SIDEBAR_AUTO_COLLAPSE_WIDTH
    );
}

function applyAutomaticSidebarState() {
    if (!shouldAutoCollapseSidebar()) {
        return;
    }

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    const sidebarToggle =
        document.getElementById(
            "sidebarToggle"
        );

    if (!sidebar) {
        return;
    }

    setSidebarCollapsed(
        sidebar,
        sidebarToggle,
        true
    );

    hideSidebarTooltip();
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
    if (!sidebar) {
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

    if (sidebarToggle) {
        sidebarToggle.setAttribute(
            "aria-expanded",
            String(!collapsed)
        );
    }
}


/*
=========================================================
SIDEBAR TOGGLE
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
        !sidebar ||
        !sidebarToggle
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

            const expansionBlocked =
                isCollapsed &&
                shouldAutoCollapseSidebar();

            if (expansionBlocked) {
                sidebarToggle.classList.remove(
                    "expand-denied"
                );

                void sidebarToggle.offsetWidth;

                sidebarToggle.classList.add(
                    "expand-denied"
                );

                sidebarToggle.setAttribute(
                    "aria-label",
                    "Navigation cannot expand at this screen size"
                );

                window.setTimeout(
                    function() {
                        sidebarToggle.classList.remove(
                            "expand-denied"
                        );

                        sidebarToggle.setAttribute(
                            "aria-label",
                            "Toggle navigation"
                        );
                    },
                    500
                );

                return;
            }

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

            if (!willCollapse) {
                hideSidebarTooltip();
            }
        }
    );
}


/*
=========================================================
WINDOW RESIZE
Automatically collapse when entering a narrow viewport.

The saved desktop preference is not overwritten.
=========================================================
*/

function setupSidebarResize() {
    if (sidebarResizeInitialized) {
        return;
    }

    sidebarResizeInitialized = true;

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

    if (!sidebar) {
        return;
    }

    if (shouldAutoCollapseSidebar()) {
        setSidebarCollapsed(
            sidebar,
            sidebarToggle,
            true
        );

        hideSidebarTooltip();

        return;
    }

    const savedSidebar =
        localStorage.getItem(
            "bpdSidebar"
        ) || "open";

    setSidebarCollapsed(
        sidebar,
        sidebarToggle,
        savedSidebar === "collapsed"
    );
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
        !sidebar ||
        !tooltip ||
        !tooltipText
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
                route !== "/" &&
                currentPath.startsWith(
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
        normalizedPath.length > 1 &&
        normalizedPath.endsWith("/")
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