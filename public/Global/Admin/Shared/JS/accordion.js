"use strict";

// Native details/summary owns pointer and keyboard activation. Only synchronize
// explicit ARIA metadata; repeated initialization must not add another listener.
const initialized = new WeakSet();
let nextId = 0;

export function initializeAdminAccordions(root = document) {
    for (const details of root.querySelectorAll("details[data-admin-accordion]")) {
        const summary = details.querySelector(":scope > summary");
        if (!summary) continue;
        const panels = [...details.children].filter(child => child !== summary);
        for (const panel of panels) if (!panel.id) panel.id = `admin-accordion-panel-${++nextId}`;
        if (panels.length) summary.setAttribute("aria-controls", panels.map(panel => panel.id).join(" "));
        const sync = () => details.querySelector(":scope > summary")?.setAttribute("aria-expanded", String(details.open));
        sync();
        if (initialized.has(details)) continue;
        details.addEventListener("toggle", sync);
        initialized.add(details);
    }
}

export function setAdminAccordionSummary(element, text) {
    if (element) element.textContent = String(text);
}
