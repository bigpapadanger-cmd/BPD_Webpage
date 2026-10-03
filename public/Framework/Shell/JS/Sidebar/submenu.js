"use strict";

import { setSidebarCollapsed } from "./state.js";

let globalListenersInitialized = false;
let temporarilyExpandedFromCollapsed = false;

function getMenu(button) {
    const submenuId = button.getAttribute("aria-controls");
    return submenuId ? document.getElementById(submenuId) : null;
}

function closeSubmenu(button) {
    const submenu = getMenu(button);
    button.setAttribute("aria-expanded", "false");
    if (submenu) submenu.hidden = true;
}

function updateSidebarState(collapsed) {
    const sidebar = document.getElementById("sidebar");
    const sidebarToggle = document.getElementById("sidebarToggle");
    setSidebarCollapsed(sidebar, sidebarToggle, collapsed);
}

function expandTemporarilyForSubmenu() {
    if (!document.body.classList.contains("sidebar-collapsed")) return;

    temporarilyExpandedFromCollapsed = true;
    document.body.dataset.sidebarTemporaryExpanded = "true";
    updateSidebarState(false);
}

function restoreTemporarySidebarState(restoreSidebar) {
    if (!temporarilyExpandedFromCollapsed) return;

    temporarilyExpandedFromCollapsed = false;
    delete document.body.dataset.sidebarTemporaryExpanded;

    if (!restoreSidebar || localStorage.getItem("bpdSidebar") === "open") return;
    updateSidebarState(true);
}

function closeOtherSubmenus(currentButton) {
    document.querySelectorAll("#sidebar .sidebar-menu-toggle").forEach(button => {
        if (button !== currentButton) closeSubmenu(button);
    });
}

function toggleSubmenu(button) {
    const submenu = getMenu(button);
    if (!submenu) return;

    const opening = button.getAttribute("aria-expanded") !== "true";
    if (!opening) {
        closeSubmenu(button);
        restoreTemporarySidebarState(true);
        return;
    }

    closeOtherSubmenus(button);
    expandTemporarilyForSubmenu();
    button.setAttribute("aria-expanded", "true");
    submenu.hidden = false;
}

export function closeSidebarSubmenus({ restoreSidebar = true } = {}) {
    document.querySelectorAll("#sidebar .sidebar-menu-toggle").forEach(closeSubmenu);
    restoreTemporarySidebarState(restoreSidebar);
}

function handleOutsideClick(event) {
    if (event.target.closest?.("#sidebar .sidebar-menu")) return;
    closeSidebarSubmenus();
}

function handleKeydown(event) {
    if (event.key === "Escape") closeSidebarSubmenus();
}

export function initializeSidebarSubmenus() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    sidebar.querySelectorAll(".sidebar-menu-toggle").forEach(button => {
        if (button.dataset.submenuInitialized === "true") return;

        button.addEventListener("click", event => {
            event.stopPropagation();
            toggleSubmenu(button);
        });
        button.dataset.submenuInitialized = "true";
    });

    if (!sidebar.dataset.submenuLinksInitialized) {
        sidebar.addEventListener("click", event => {
            if (event.target.closest?.(".sidebar-submenu .submenu-item")) {
                closeSidebarSubmenus();
            }
        });
        sidebar.dataset.submenuLinksInitialized = "true";
    }

    if (globalListenersInitialized) return;

    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleKeydown);
    globalListenersInitialized = true;
}
