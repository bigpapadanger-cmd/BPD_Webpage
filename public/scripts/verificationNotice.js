"use strict";

const activeTimers = new WeakMap();
const outcomeStates = new WeakMap();

export function showVerificationOutcome(anchor, message, { state = "info", durationMs = 7000 } = {}) {
    if (!anchor?.parentNode || !message) return;
    let record = outcomeStates.get(anchor);
    if (!record) {
        const element = document.createElement("p");
        element.className = "verification-action-result";
        element.setAttribute("role", "status");
        element.setAttribute("aria-live", "polite");
        const actionGroup = anchor.closest?.(".worker-status-card-actions");
        const container = actionGroup || anchor.parentElement;
        if (container?.insertAdjacentElement) container.insertAdjacentElement("afterend", element);
        else anchor.insertAdjacentElement("afterend", element);
        record = { element, timer: null };
        outcomeStates.set(anchor, record);
    }
    if (record.timer) clearTimeout(record.timer);
    record.element.dataset.state = ["success", "error", "info"].includes(state) ? state : "info";
    record.element.textContent = String(message).slice(0, 240);
    record.element.hidden = false;
    record.timer = setTimeout(() => {
        record.element.textContent = "";
        record.element.hidden = true;
        record.timer = null;
    }, Math.min(10000, Math.max(5000, Number(durationMs) || 7000)));
}

export function beginVerificationNotice(element, {
    checkingText,
    fallbackText,
    delayMs = 3000
} = {}) {
    if (!element || typeof element.textContent !== "string") return;

    clearVerificationNotice(element);
    element.textContent = String(checkingText || "Checking...");

    const timer = setTimeout(() => {
        if (activeTimers.get(element) !== timer) return;
        activeTimers.delete(element);
        element.textContent = String(fallbackText || "Please wait.");
    }, Math.max(0, Number(delayMs) || 0));

    activeTimers.set(element, timer);
}

export function clearVerificationNotice(element) {
    if (!element) return;
    const timer = activeTimers.get(element);
    if (timer !== undefined) clearTimeout(timer);
    activeTimers.delete(element);
}

export function finishVerificationNotice(element, finalText) {
    if (!element || typeof element.textContent !== "string") return;
    clearVerificationNotice(element);
    element.textContent = String(finalText ?? "");
}
