"use strict";

/*
 * Shared notification model and state rules.
 * Producers supply candidates; persistence and rendering are separate layers.
 */

export const NOTIFICATION_SNOOZE_MS = 60 * 60 * 1000;

const SOURCES = new Set(["ocr", "submission", "faq", "account", "profile"]);
const SEVERITIES = new Set(["info", "notice", "warning", "error"]);
const REVIEW_ACTIONS = new Set([
    "ocr.review",
    "submission.review",
    "faq.review",
    "account.status",
    "profile.complete",
    "provider.reauthorize"
]);
const PUBLIC_CODE = /^(?:[A-Z0-9]{12,32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const DEDUPE_KEY = /^[a-z0-9][a-z0-9:._-]{0,159}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_VALUE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_IN_VALUE = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const OCR_REVIEW_CODE = /^[A-Z0-9]{16}$/;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value, optional = false) {
    if (value == null && optional) return null;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
}

function boundedText(value, maximum) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : null;
}

export function normalizeNotificationCandidate(value) {
    if (!isRecord(value)) return null;

    const publicCode = typeof value.publicCode === "string" ? value.publicCode.trim().toUpperCase() : "";
    const dedupeKey = typeof value.dedupeKey === "string" ? value.dedupeKey.trim().toLowerCase() : "";
    const source = typeof value.source === "string" ? value.source.trim().toLowerCase() : "";
    const behavior = value.behavior;
    const severity = typeof value.severity === "string" ? value.severity.trim().toLowerCase() : "";
    const reviewAction = value.reviewAction;
    const createdAt = timestamp(value.createdAt);
    const updatedAt = timestamp(value.updatedAt, true);
    const resolvedAt = timestamp(value.resolvedAt, true);
    const expiresAt = timestamp(value.expiresAt, true);
    const acknowledgedAt = timestamp(value.acknowledgedAt, true);
    const suppressUntil = timestamp(value.suppressUntil, true);
    const reviewCode = value.reviewCode == null ? null : String(value.reviewCode).trim().toUpperCase();
    const title = boundedText(value.title, 100);
    const message = boundedText(value.message, 280);

    if (!PUBLIC_CODE.test(publicCode)
        || !DEDUPE_KEY.test(dedupeKey) || !dedupeKey.startsWith(`${source}:`) || UUID_IN_VALUE.test(dedupeKey)
        || !SOURCES.has(source) || !["event", "condition"].includes(behavior)
        || !SEVERITIES.has(severity) || typeof value.actionRequired !== "boolean"
        || !REVIEW_ACTIONS.has(reviewAction) || !createdAt || !title || !message
        || (reviewCode !== null && (source !== "ocr" || !OCR_REVIEW_CODE.test(reviewCode)))
        || UUID_IN_VALUE.test(title) || UUID_IN_VALUE.test(message)
        || EMAIL_IN_VALUE.test(title) || EMAIL_IN_VALUE.test(message)) return null;

    return Object.freeze({
        publicCode,
        source,
        behavior,
        dedupeKey,
        severity,
        title,
        message,
        actionRequired: value.actionRequired,
        reviewAction,
        reviewCode,
        createdAt,
        updatedAt,
        acknowledgedAt,
        suppressUntil,
        resolvedAt,
        expiresAt
    });
}

function activeAt(notification, now) {
    const instant = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(instant)) return false;
    if (notification.resolvedAt && Date.parse(notification.resolvedAt) <= instant) return false;
    if (notification.expiresAt && Date.parse(notification.expiresAt) <= instant) return false;
    if (!notification.actionRequired && notification.acknowledgedAt) return false;
    if (notification.actionRequired && notification.suppressUntil && Date.parse(notification.suppressUntil) > instant) return false;
    return true;
}

export function dedupeNotificationCandidates(values, now = new Date()) {
    if (!Array.isArray(values)) return [];
    const winners = new Map();
    for (const value of values) {
        const candidate = normalizeNotificationCandidate(value);
        if (!candidate) continue;
        const key = `${candidate.source}:${candidate.dedupeKey}`;
        const previous = winners.get(key);
        const candidateTime = Date.parse(candidate.updatedAt || candidate.createdAt);
        if (!previous || candidateTime > Date.parse(previous.updatedAt || previous.createdAt)) winners.set(key, candidate);
    }
    const priority = { error: 4, warning: 3, notice: 2, info: 1 };
    return [...winners.values()].filter(candidate => activeAt(candidate, now)).sort((left, right) =>
        Number(right.actionRequired) - Number(left.actionRequired)
        || priority[right.severity] - priority[left.severity]
        || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
}

export function acknowledgeNotification(candidateValue, now = new Date()) {
    const candidate = normalizeNotificationCandidate(candidateValue);
    const instant = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!candidate || !Number.isFinite(instant)) return null;
    const acknowledgedAt = new Date(instant).toISOString();
    return Object.freeze({
        acknowledgedAt,
        suppressUntil: candidate.actionRequired
            ? new Date(instant + NOTIFICATION_SNOOZE_MS).toISOString()
            : null
    });
}
