/* =========================================================
   BPD GAMING NETWORK — SPA SIDEBAR MODULE
   ========================================================= */

const BPD_AUTH_SESSION_URL = "/api/auth/session";
const BPD_AUTH_LOGOUT_URL = "/api/auth/logout";
let BPD_AUTH_SESSION_PROMISE = null;

/* =========================================================
   AUTH SESSION HELPERS
   ========================================================= */

function normalizeBpdAuthSession(data) {
    const authenticated = (
        data?.authenticated === true &&
        data?.user &&
        typeof data.user === "object"
    );

    return {
        authenticated,
        user: authenticated
            ? {
                epicAccountId: String(data.user.epicAccountId || ""),
                displayName: String(data.user.displayName || "Epic Player")
            }
            : null
    };
}

async function requestBpdAuthSession() {
    try {
        const response = await fetch(BPD_AUTH_SESSION_URL, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: { "accept": "application/json" }
        });

        if (!response.ok) return normalizeBpdAuthSession(null);

        const data = await response.json();
        return normalizeBpdAuthSession(data);

    } catch (error) {
        console.warn("BPD AUTH: Session check failed.", error);
        return normalizeBpdAuthSession(null);
    }
}

function getBpdAuthSession(forceRefresh = false) {
    if (forceRefresh || !BPD_AUTH_SESSION_PROMISE) {
        BPD_AUTH_SESSION_PROMISE = requestBpdAuthSession();
    }
    return BPD_AUTH_SESSION_PROMISE;
}

window.BPDAuth = { getSession: getBpdAuthSession };

/* =========================================================
   INITIALIZE SIDEBAR (call after HTML + hover loaded)
   ========================================================= */

export async function initializeSidebar() {
    const authSession = await BPDAuth.getSession(true);

    applyGlobalSettings();
    setupSidebarToggle();
    setupActiveNavigation();
    setupDisabledNavigation();
    applySidebarAuthState(authSession);
    setupSidebarTooltips();
}

/* =========================================================
   LOAD HOVER TOOLTIP HTML
   ========================================================= */

export async function loadSidebarHover() {
    const hoverFile = "/Framework/Shell/HTML/Sidebar/hover.html";

    try {
        const response = await fetch(hoverFile);
        if (!response.ok) throw new Error(`Hover failed: ${response.status}`);

        const hoverHTML = await response.text();

        const existingHover = document.getElementById("sidebarHover");
        if (existingHover) existingHover.remove();

        const container = document.createElement("div");
        container.innerHTML = hoverHTML;

        while (container.firstElementChild) {
            document.body.appendChild(container.firstElementChild);
        }

    } catch (error) {
        console.error("SIDEBAR HOVER LOAD FAILED:", error);
    }
}

/* =========================================================
   AUTH STATE
   ========================================================= */

function applySidebarAuthState(authSession) {
    const authenticated = authSession?.authenticated === true;

    const authenticatedItems = document.querySelectorAll(
        '#sidebar [data-auth="authenticated"]'
    );

    authenticatedItems.forEach(item => {
        item.hidden = !authenticated;
    });

    const authButton = document.getElementById("sidebarAuthButton");
    const authLabel = document.getElementById("sidebarAuthLabel");
    const authIcon = document.getElementById("sidebarAuthIcon");

    if (authButton && authLabel && authIcon) {
        if (authenticated) {
            authButton.href = BPD_AUTH_LOGOUT_URL;
            authButton.dataset.navRoute = BPD_AUTH_LOGOUT_URL;
            authButton.dataset.tooltip = "Logout";
            authLabel.textContent = "Logout";
            authIcon.textContent = "⇤";
            authButton.addEventListener("click", handleBpdLogout);
        } else {
            authButton.href = "/auth/epic/login";
            authButton.dataset.navRoute = "/auth/epic/login";
            authButton.dataset.tooltip = "Login or Register";
            authLabel.textContent = "Login / Register";
            authIcon.textContent = "⇥";
        }
    }

    document.body.dataset.authenticated = String(authenticated);
}

/* =========================================================
   LOGOUT HANDLER
   ========================================================= */

async function handleBpdLogout(event) {
    event.preventDefault();

    try {
        await fetch(BPD_AUTH_LOGOUT_URL, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "accept": "application/json" }
        });
    } catch (error) {
        console.warn("BPD AUTH: Logout failed.", error);
    } finally {
        BPD_AUTH_SESSION_PROMISE = null;
        window.location.assign("/");
    }
}

/* =========================================================
   GLOBAL SETTINGS (theme, animations, collapsed)
   ========================================================= */

function applyGlobalSettings() {
    const sidebar = document.getElementById("sidebar");
    const sidebarToggle = document.getElementById("sidebarToggle");

    const savedSidebar = localStorage.getItem("bpdSidebar") || "open";
    const savedTheme = localStorage.getItem("bpdTheme") || "blue";
    const savedAnimations = localStorage.getItem("bpdAnimations") || "on";

    if (savedSidebar === "collapsed") {
        sidebar.classList.add("collapsed");
        document.body.classList.add("sidebar-collapsed");
    } else {
        sidebar.classList.remove("collapsed");
        document.body.classList.remove("sidebar-collapsed");
    }

    if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", savedSidebar !== "collapsed");
    }

    document.body.dataset.theme = savedTheme;
    document.body.dataset.animations = savedAnimations;

    if (savedAnimations === "off") {
        document.body.classList.add("animations-off");
    } else {
        document.body.classList.remove("animations-off");
    }
}

/* =========================================================
   SIDEBAR TOGGLE
   ========================================================= */

function setupSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    const sidebarToggle = document.getElementById("sidebarToggle");

    if (!sidebarToggle) return;

    sidebarToggle.addEventListener("click", () => {
        const isCollapsed = sidebar.classList.contains("collapsed");

        if (isCollapsed) {
            sidebar.classList.remove("collapsed");
            document.body.classList.remove("sidebar-collapsed");
            localStorage.setItem("bpdSidebar", "open");
            sidebarToggle.setAttribute("aria-expanded", "true");
            hideSidebarTooltip();
        } else {
            sidebar.classList.add("collapsed");
            document.body.classList.add("sidebar-collapsed");
            localStorage.setItem("bpdSidebar", "collapsed");
            sidebarToggle.setAttribute("aria-expanded", "false");
        }
    });
}

/* =========================================================
   TOOLTIP SYSTEM
   ========================================================= */

function setupSidebarTooltips() {
    const sidebar = document.getElementById("sidebar");
    const tooltip = document.getElementById("sidebarHover");
    const tooltipText = document.getElementById("sidebarHoverText");

    if (!sidebar || !tooltip || !tooltipText) return;

    const tooltipItems = sidebar.querySelectorAll(".nav-item[data-tooltip]");

    tooltipItems.forEach(item => {
        item.addEventListener("mouseenter", event => {
            if (!sidebar.classList.contains("collapsed")) {
                hideSidebarTooltip();
                return;
            }

            const text = item.dataset.tooltip;
            if (!text) return;

            showSidebarTooltip(tooltip, tooltipText, event, text);
        });

        item.addEventListener("mousemove", event => {
            if (!sidebar.classList.contains("collapsed")) return;

            const text = item.dataset.tooltip;
            if (!text) return;

            showSidebarTooltip(tooltip, tooltipText, event, text);
        });

        item.addEventListener("mouseleave", hideSidebarTooltip);
    });

    sidebar.addEventListener("mouseleave", hideSidebarTooltip);
    sidebar.addEventListener("scroll", hideSidebarTooltip);
}

function showSidebarTooltip(tooltip, tooltipText, event, text) {
    tooltipText.textContent = text;
    tooltip.style.left = `${event.clientX + 25}px`;
    tooltip.style.top = `${event.clientY + 10}px`;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
}

function hideSidebarTooltip() {
    const tooltip = document.getElementById("sidebarHover");
    if (!tooltip) return;

    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
}

/* =========================================================
   ACTIVE NAVIGATION
   ========================================================= */

function setupActiveNavigation() {
    const currentPath = normalizePath(window.location.pathname);
    const navItems = document.querySelectorAll(".nav-item[data-nav-route]");

    navItems.forEach(item => {
        const route = normalizePath(item.dataset.navRoute);

        if (currentPath === route) {
            item.classList.add("active");
            return;
        }

        if (route !== "/" && currentPath.startsWith(route + "/")) {
            item.classList.add("active");
        }
    });
}

/* =========================================================
   NORMALIZE PATH
   ========================================================= */

function normalizePath(path) {
    if (!path) return "/";

    if (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
    }

    if (path === "/index.html") return "/";

    return path;
}

/* =========================================================
   DISABLED NAVIGATION
   ========================================================= */

function setupDisabledNavigation() {
    document.querySelectorAll(".nav-item.disabled").forEach(item => {
        item.addEventListener("click", event => {
            event.preventDefault();
        });
    });
}
