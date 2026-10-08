"use strict";

// Existing Task Board overlays keep their markup and dismissal rules.
// Only the top overlay owns keyboard focus; closing it restores its opener.
export function createModalFocusManager(doc) {
    const stack = [];
    const originalInert = new Map();
    const focusable = dialog => [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.getClientRects().length);
    const top = () => stack.at(-1);
    function focus(entry, last = false) {
        const nodes = focusable(entry.dialog);
        (last ? nodes.at(-1) : nodes[0])?.focus();
        if (!nodes.length) { entry.dialog.tabIndex = -1; entry.dialog.focus(); }
    }
    function sync() {
        for (const child of doc.body.children) {
            if (!originalInert.has(child)) originalInert.set(child, child.inert);
            child.inert = top() ? !child.contains(top().overlay) : originalInert.get(child);
        }
        if (!stack.length) originalInert.clear();
    }
    function keydown(event) {
        const entry = top();
        if (!entry || event.key !== "Tab") return;
        const nodes = focusable(entry.dialog);
        if (!nodes.length || !entry.dialog.contains(doc.activeElement)
            || (!event.shiftKey && doc.activeElement === nodes.at(-1))
            || (event.shiftKey && doc.activeElement === nodes[0])) {
            event.preventDefault(); focus(entry, event.shiftKey);
        }
    }
    function focusin(event) {
        const entry = top();
        if (entry && !entry.dialog.contains(event.target)) focus(entry);
    }
    function deactivate(overlay, restore = true) {
        const index = stack.findIndex(entry => entry.overlay === overlay);
        if (index < 0) return;
        const wasTop = index === stack.length - 1;
        const [entry] = stack.splice(index, 1);
        sync();
        if (!stack.length) {
            doc.removeEventListener("keydown", keydown, true);
            doc.removeEventListener("focusin", focusin, true);
            doc.removeEventListener("bpd:page-loaded", navigate);
        }
        if (restore && wasTop) {
            if (entry.opener?.isConnected && !entry.opener.closest('[hidden], [inert]')) entry.opener.focus();
            else if (top()) focus(top());
        }
    }
    function navigate() {
        for (const entry of [...stack].reverse()) {
            entry.onNavigate?.();
            entry.overlay.hidden = true;
            deactivate(entry.overlay, false);
        }
        doc.documentElement.classList.remove("task-overlay-open", "task-create-open");
    }
    function activate(overlay, onNavigate) {
        if (!overlay) return;
        deactivate(overlay, false);
        const dialog = overlay.querySelector('[role="dialog"]');
        if (!dialog) return;
        if (!stack.length) {
            doc.addEventListener("keydown", keydown, true);
            doc.addEventListener("focusin", focusin, true);
            doc.addEventListener("bpd:page-loaded", navigate);
        }
        const entry = { overlay, dialog, opener: doc.activeElement, onNavigate };
        stack.push(entry); sync(); focus(entry);
    }
    return { activate, deactivate };
}
let manager;
export function activateModalFocus(overlay, onNavigate) {
    manager ||= createModalFocusManager(document);
    manager.activate(overlay, onNavigate);
}
export function deactivateModalFocus(overlay) { manager?.deactivate(overlay); }
