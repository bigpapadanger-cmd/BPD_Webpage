"use strict";

// Shared sidebar artwork. Change a value here to update every use of its key.
export const SIDEBAR_ICONS = Object.freeze({
    dashboard: "📊",
    home: "🏠",
    rocketleague: "⚽",
    minecraft: "🧊",
    ark: "🦖",
    admin: "🛠️",
    taskboard: "📋",
    status: "🩺",
    player: "👤",
    play: "🎮",
    community: "👥",
    settings: "⚙️",
    faq: "❓",
    suggestions: "💡",
    terms: "📜",
    about: "ℹ️",
    privacy: "👁️‍🗨️",
    chevron: "›"
});

export function initializeSidebarIcons(root) {
    if (!root) return;
    for (const node of root.querySelectorAll("[data-sidebar-icon]")) {
        const key = node.dataset.sidebarIcon;
        node.textContent = Object.hasOwn(SIDEBAR_ICONS, key) ? SIDEBAR_ICONS[key] : "";
        node.setAttribute("aria-hidden", "true");
    }
}
