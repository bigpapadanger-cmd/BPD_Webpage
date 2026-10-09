"use strict";

import { BPD_NOTIFICATIONS_URL } from "../../../scripts/apiRoutes.js";
import { getNotificationReviewDestination } from "./notification_destinations.js";
export { getNotificationReviewDestination } from "./notification_destinations.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 60 * 1000;
const PUBLIC_CODE = /^(?:[A-Z0-9]{12,32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_IN_TEXT = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const OCR_PUBLIC_CODE = /^[A-Z0-9]{16}$/;
const SOURCES = new Set(["ocr", "submission", "faq", "account", "profile"]);
const SEVERITIES = new Set(["info", "notice", "warning", "error"]);
const REVIEW_ACTIONS = new Set(["ocr.review", "submission.review", "faq.review", "account.status", "profile.complete", "provider.reauthorize"]);

export function normalizeClientNotification(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const publicCode = typeof value.publicCode === "string" ? value.publicCode.trim() : "";
    const source = typeof value.source === "string" ? value.source.trim().toLowerCase() : "";
    const severity = typeof value.severity === "string" ? value.severity.trim().toLowerCase() : "";
    const reviewAction = typeof value.reviewAction === "string" ? value.reviewAction : "";
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const createdAt = typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
        ? new Date(value.createdAt).toISOString() : null;
    const expiresAt = value.expiresAt == null ? null
        : typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))
            ? new Date(value.expiresAt).toISOString() : undefined;
    const reviewCode = value.reviewCode == null ? null
        : typeof value.reviewCode === "string" && OCR_PUBLIC_CODE.test(value.reviewCode.trim().toUpperCase())
            ? value.reviewCode.trim().toUpperCase() : undefined;
    if (!PUBLIC_CODE.test(publicCode) || !SOURCES.has(source) || !SEVERITIES.has(severity)
        || typeof value.actionRequired !== "boolean" || !createdAt || expiresAt === undefined || reviewCode === undefined
        || !title || title.length > 100 || !message || message.length > 280
        || UUID_IN_TEXT.test(title) || UUID_IN_TEXT.test(message) || EMAIL_IN_TEXT.test(title) || EMAIL_IN_TEXT.test(message)
        || !REVIEW_ACTIONS.has(reviewAction)) return null;
    return Object.freeze({ publicCode, source, severity, title, message, actionRequired: value.actionRequired,
        reviewAction, createdAt, expiresAt, reviewCode });
}

function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function createNotificationController({ document, window, fetcher = window.fetch.bind(window) }) {
    let trigger;
    let drawer;
    let list;
    let status;
    let lastFetchAt = 0;
    let inFlight = null;
    let intervalId = null;
    let signedIn = false;
    let authScope = null;
    let authGeneration = 0;
    let restoreFocus = null;

    function createShell() {
        const inner = document.querySelector(".bpd-account-banner__inner");
        if (!inner || document.getElementById("globalNotificationTrigger")) return;

        trigger = element(document, "button", "global-notification-trigger");
        trigger.id = "globalNotificationTrigger";
        trigger.type = "button";
        trigger.hidden = true;
        trigger.setAttribute("aria-label", "Notifications");
        trigger.setAttribute("aria-controls", "globalNotificationDrawer");
        trigger.setAttribute("aria-expanded", "false");
        const icon = element(document, "span", "global-notification-trigger__icon", "🔔");
        icon.setAttribute("aria-hidden", "true");
        const label = element(document, "span", "global-notification-trigger__label", "Notifications");
        const count = element(document, "span", "global-notification-trigger__count");
        count.id = "globalNotificationCount";
        count.setAttribute("aria-hidden", "true");
        trigger.append(icon, label, count);

        drawer = element(document, "section", "global-notification-drawer");
        drawer.id = "globalNotificationDrawer";
        drawer.hidden = true;
        drawer.setAttribute("aria-label", "Notifications");
        drawer.setAttribute("aria-describedby", "globalNotificationStatus");
        const header = element(document, "header", "global-notification-drawer__header");
        const heading = element(document, "h2", "", "Notifications");
        heading.id = "globalNotificationHeading";
        heading.tabIndex = -1;
        const close = element(document, "button", "global-notification-drawer__close", "Close");
        close.type = "button";
        close.setAttribute("aria-label", "Close notifications");
        header.append(heading, close);
        status = element(document, "p", "global-notification-drawer__status");
        status.id = "globalNotificationStatus";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        list = element(document, "ul", "global-notification-list");
        list.setAttribute("aria-label", "Your notifications");
        drawer.append(header, status, list);
        document.body.append(drawer);
        inner.append(trigger);

        trigger.addEventListener("click", () => drawer.hidden ? open() : closeDrawer());
        close.addEventListener("click", () => closeDrawer());
        document.addEventListener("click", event => {
            if (!drawer.hidden && !drawer.contains(event.target) && !trigger.contains(event.target)) closeDrawer(false);
        });
        document.addEventListener("bpd:page-loaded", () => {
            closeDrawer(false);
            const schedule = window.requestIdleCallback || (callback => window.setTimeout(callback, 100));
            schedule(() => { void refresh(); });
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && drawer && !drawer.hidden) closeDrawer();
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && signedIn) void refresh();
        });
        window.addEventListener("focus", () => { if (signedIn) void refresh(); });
        list.addEventListener("click", event => { void handleAction(event); });
        document.addEventListener("bpd:notifications-refresh", () => { void refresh(true); });
    }

    function open() {
        if (!drawer || !trigger || trigger.disabled || !signedIn) return;
        restoreFocus = document.activeElement;
        drawer.hidden = false;
        drawer.dataset.open = "true";
        trigger.setAttribute("aria-expanded", "true");
        document.getElementById("globalNotificationHeading")?.focus({ preventScroll: true });
        void refresh();
    }

    function closeDrawer(restore = true) {
        if (!drawer || !trigger) return;
        drawer.hidden = true;
        delete drawer.dataset.open;
        trigger.setAttribute("aria-expanded", "false");
        if (restore && restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
        restoreFocus = null;
    }

    function render(values, message = "") {
        const notifications = values.map(normalizeClientNotification).filter(Boolean);
        list.replaceChildren();
        status.textContent = message || (notifications.length ? `${notifications.length} notification${notifications.length === 1 ? "" : "s"}.` : "You’re all caught up.");
        const count = document.getElementById("globalNotificationCount");
        count.textContent = notifications.length ? String(notifications.length) : "";
        count.hidden = notifications.length === 0;
        trigger.setAttribute("aria-label", notifications.length ? `Notifications, ${notifications.length} requiring attention` : "Notifications, none requiring attention");
        trigger.classList.toggle("has-notifications", notifications.length > 0);

        for (const notification of notifications) {
            const item = element(document, "li", "global-notification-card");
            item.dataset.severity = notification.severity;
            const title = element(document, "h3", "", notification.title);
            const messageNode = element(document, "p", "global-notification-card__message", notification.message);
            const time = element(document, "time", "global-notification-card__time");
            time.dateTime = notification.createdAt;
            time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(notification.createdAt));
            const actions = element(document, "div", "global-notification-card__actions");
            const destination = getNotificationReviewDestination(notification.reviewAction, notification.reviewCode,
                window.location?.origin || "https://bpd-gaming-network.com");
            if (destination) {
                const review = element(document, "a", "global-notification-card__review", "Review");
                review.href = destination;
                review.dataset.routerLink = "";
                actions.append(review);
            }
            const acknowledge = element(document, "button", "global-notification-card__acknowledge", "Acknowledge");
            acknowledge.type = "button";
            acknowledge.dataset.acknowledgeCode = notification.publicCode;
            acknowledge.dataset.actionRequired = String(notification.actionRequired);
            actions.append(acknowledge);
            item.append(title, messageNode, time, actions);
            list.append(item);
        }
        if (typeof window.CustomEvent === "function") {
            document.dispatchEvent(new window.CustomEvent("bpd:notifications-updated", {
                detail: {
                    signedIn,
                    message,
                    notifications: notifications.map(({ title, message: body, reviewAction, createdAt, reviewCode }) =>
                        ({ title, message: body, reviewAction, createdAt, reviewCode }))
                }
            }));
        }
    }

    async function refresh(force = false) {
        if (!signedIn || document.visibilityState === "hidden" || document.body.classList.contains("page-loading")) return;
        if (inFlight) return inFlight;
        if (!force && Date.now() - lastFetchAt < MIN_REFRESH_GAP_MS) return;
        const generation = authGeneration;
        trigger.disabled = true;
        status.textContent = "Loading notifications…";
        inFlight = (async () => {
            let timeoutId = null;
            try {
                const controller = new AbortController();
                timeoutId = window.setTimeout(() => controller.abort(), 12_000);
                const response = await fetcher(BPD_NOTIFICATIONS_URL, {
                    method: "GET", credentials: "same-origin", cache: "no-store",
                    headers: { Accept: "application/json" }, signal: controller.signal
                });
                if (generation !== authGeneration) return;
                lastFetchAt = Date.now();
                if ([401, 403].includes(response.status)) {
                    window.clearTimeout(timeoutId);
                    signedIn = false;
                    trigger.hidden = true;
                    closeDrawer(false);
                    if (intervalId !== null) window.clearInterval(intervalId);
                    intervalId = null;
                    render([], "Sign in to view notifications.");
                    return;
                }
                if (!response.ok) throw new Error("unavailable");
                const body = await response.json();
                if (generation !== authGeneration) return;
                if (body?.success !== true || !Array.isArray(body.notifications)) throw new Error("invalid");
                render(body.notifications);
                window.clearTimeout(timeoutId);
            } catch {
                if (generation !== authGeneration) return;
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                if (drawer && !drawer.hidden) status.textContent = "Notifications are temporarily unavailable. Please try again.";
                if (typeof window.CustomEvent === "function") {
                    document.dispatchEvent(new window.CustomEvent("bpd:notifications-unavailable", {
                        detail: { signedIn }
                    }));
                }
            } finally {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
            }
        })();
        try { await inFlight; } finally {
            inFlight = null;
            trigger.disabled = !signedIn;
            if (signedIn && generation !== authGeneration) void refresh(true);
        }
    }

    async function handleAction(event) {
        const button = event.target.closest("button[data-acknowledge-code]");
        if (!button || !list.contains(button) || button.disabled) return;
        const code = button.dataset.acknowledgeCode;
        if (!PUBLIC_CODE.test(code || "")) return;
        button.disabled = true;
        try {
            const response = await fetcher(`${BPD_NOTIFICATIONS_URL}/${encodeURIComponent(code)}/acknowledge`, {
                method: "POST", credentials: "same-origin", cache: "no-store",
                headers: { Accept: "application/json" }
            });
            const body = await response.json().catch(() => null);
            if (!response.ok || body?.success !== true) throw new Error("unavailable");
            button.closest(".global-notification-card")?.remove();
            const remaining = list.querySelectorAll(".global-notification-card").length;
            const count = document.getElementById("globalNotificationCount");
            count.textContent = remaining ? String(remaining) : "";
            count.hidden = remaining === 0;
            trigger.classList.toggle("has-notifications", remaining > 0);
            status.textContent = remaining ? `${remaining} notification${remaining === 1 ? "" : "s"} remaining.` : "You’re all caught up.";
            lastFetchAt = 0;
            void refresh(true);
        } catch {
            button.disabled = false;
            status.textContent = "That notification could not be acknowledged. Please retry.";
        }
    }

    function setAuthState(state) {
        const nextSignedIn = state?.authenticated === true && state?.available === true;
        const nextScope = state?.accountScope || null;
        if (signedIn === nextSignedIn && authScope === nextScope && trigger) return;
        authGeneration++;
        signedIn = nextSignedIn;
        authScope = nextScope;
        lastFetchAt = 0;
        if (!trigger) createShell();
        if (!trigger) return;
        trigger.hidden = !signedIn;
        trigger.disabled = !signedIn;
        list.replaceChildren();
        const count = document.getElementById("globalNotificationCount");
        count.textContent = "";
        count.hidden = true;
        trigger.classList.remove("has-notifications");
        status.textContent = signedIn ? "Loading notifications…" : "Sign in to view notifications.";
        if (intervalId !== null) window.clearInterval(intervalId);
        intervalId = null;
        if (!signedIn) {
            closeDrawer(false);
            render([], "Sign in to view notifications.");
            return;
        }
        intervalId = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
        void refresh(true);
    }

    return { async initialize() {
        createShell();
        const { getAuthState, peekAuthState, subscribeToAuthState } = await import("../../Auth/auth.js");
        setAuthState(peekAuthState());
        subscribeToAuthState(setAuthState);
        setAuthState(await getAuthState());
        await refresh();
    }, mount: createShell, setAuthState, refresh, open, close: closeDrawer };
}

let initialized = false;
export async function initializeGlobalNotifications() {
    if (initialized || typeof document === "undefined") return;
    initialized = true;
    await createNotificationController({ document, window }).initialize();
}
