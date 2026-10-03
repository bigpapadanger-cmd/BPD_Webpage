"use strict";

export function setSidebarCollapsed(sidebar, sidebarToggle, collapsed) {
    if (!sidebar) return;

    sidebar.classList.toggle("collapsed", collapsed);
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    document.body.dataset.sidebar = collapsed ? "collapsed" : "open";

    if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
        sidebarToggle.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
    }
}
