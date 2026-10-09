"use strict";

import { setSidebarCollapsed } from "./state.js";
import { closeSidebarSubmenus } from "./submenu.js";

let initialized = false;
let backgroundState = [];

function isMobileViewport() {
    return typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 700px)").matches
        : window.innerWidth <= 700;
}

function focusableItems(sidebar) {
    return [...sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true");
}

function setBackgroundInert(inert) {
    const elements = [document.querySelector(".site-page"), document.querySelector(".skip-navigation")].filter(Boolean);
    if (inert) {
        backgroundState = elements.map(element => [element, element.inert]);
        elements.forEach(element => { element.inert = true; });
        return;
    }
    for (const [element, wasInert] of backgroundState) element.inert = wasInert;
    backgroundState = [];
}

export function syncMobileSidebarDrawer({ focusOnOpen = false } = {}) {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebarToggle");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (!sidebar || !toggle || !backdrop) return false;

    const open = isMobileViewport()
        && !sidebar.hidden
        && sidebar.getAttribute("aria-hidden") !== "true"
        && !sidebar.classList.contains("collapsed");
    const wasOpen = document.body.classList.contains("sidebar-mobile-open");
    document.body.classList.toggle("sidebar-mobile-open", open);
    document.documentElement.classList.toggle("sidebar-mobile-open", open);
    backdrop.hidden = !open;

    if (open) {
        sidebar.setAttribute("role", "dialog");
        sidebar.setAttribute("aria-modal", "true");
        if (!wasOpen) setBackgroundInert(true);
        if (focusOnOpen || !sidebar.contains(document.activeElement)) toggle.focus();
    } else {
        sidebar.removeAttribute("role");
        sidebar.removeAttribute("aria-modal");
        if (wasOpen) setBackgroundInert(false);
    }
    return open;
}

function closeDrawer({ focusContent = false } = {}) {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebarToggle");
    if (!sidebar || !toggle) return;

    closeSidebarSubmenus({ restoreSidebar: false });
    setSidebarCollapsed(sidebar, toggle, true);
    localStorage.setItem("bpdSidebar", "collapsed");
    syncMobileSidebarDrawer();
    if (focusContent) document.getElementById("siteContent")?.focus({ preventScroll: true });
    else toggle.focus();
}

function handleDrawerKeydown(event) {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar || !document.body.classList.contains("sidebar-mobile-open")) return;
    if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
    }
    if (event.key !== "Tab") return;

    const items = focusableItems(sidebar);
    if (!items.length) {
        event.preventDefault();
        return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
    }
}

export function initializeMobileSidebarDrawer() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (!sidebar || !backdrop) return;

    if (!initialized) {
        backdrop.addEventListener("click", () => closeDrawer());
        sidebar.addEventListener("click", event => {
            if (document.body.classList.contains("sidebar-mobile-open")
                && event.target.closest?.("a[data-router-link], a.submenu-item[data-nav-route]")) closeDrawer({ focusContent: true });
        });
        document.addEventListener("keydown", handleDrawerKeydown);
        document.addEventListener("bpd:sidebar-state-change", () => syncMobileSidebarDrawer());
        initialized = true;
    }
    syncMobileSidebarDrawer();
}
