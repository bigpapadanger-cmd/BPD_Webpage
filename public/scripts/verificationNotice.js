"use strict";

const activeTimers = new WeakMap();

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
