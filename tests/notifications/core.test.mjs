import test from "node:test";
import assert from "node:assert/strict";
import {
    acknowledgeNotification,
    dedupeNotificationCandidates,
    normalizeNotificationCandidate,
    NOTIFICATION_SNOOZE_MS
} from "../../functions/services/notifications/core.js";

const NOW = "2026-10-08T12:00:00.000Z";
const base = Object.freeze({
    publicCode: "11111111-1111-4111-8111-111111111111",
    source: "profile",
    behavior: "condition",
    dedupeKey: "profile:incomplete",
    severity: "warning",
    title: "Finish your profile",
    message: "Complete the required Rocket League profile details.",
    actionRequired: true,
    reviewAction: "profile.complete",
    createdAt: NOW,
    updatedAt: null,
    acknowledgedAt: null,
    suppressUntil: null,
    resolvedAt: null,
    expiresAt: null
});

test("candidate normalization accepts safe, bounded server-produced values", () => {
    const result = normalizeNotificationCandidate(base);
    assert.equal(result?.source, "profile");
    assert.equal(result?.reviewAction, "profile.complete");
    assert.equal(Object.isFrozen(result), true);
});

test("candidate normalization rejects internal UUIDs and arbitrary actions", () => {
    assert.equal(normalizeNotificationCandidate({ ...base, publicCode: "not-a-public-code" }), null);
    assert.equal(normalizeNotificationCandidate({ ...base, dedupeKey: "profile:123e4567-e89b-42d3-a456-426614174000" }), null);
    assert.equal(normalizeNotificationCandidate({ ...base, reviewAction: "javascript:alert(1)" }), null);
    assert.equal(normalizeNotificationCandidate({ ...base, title: "x".repeat(101) }), null);
    assert.equal(normalizeNotificationCandidate({ ...base, message: "Restriction on account 123e4567-e89b-42d3-a456-426614174000" }), null);
    assert.equal(normalizeNotificationCandidate({ ...base, message: "Review request from player@example.com" }), null);
});

test("stable source and dedupe keys collapse repeated candidates and prioritize action-required", () => {
    const duplicate = { ...base, publicCode: "22222222-2222-4222-8222-222222222222", updatedAt: "2026-10-08T12:01:00Z" };
    const oneTime = { ...base, source: "faq", behavior: "event", actionRequired: false, dedupeKey: "faq:answered:QUESTIONCODE01", severity: "info", title: "FAQ answered", reviewAction: "faq.review" };
    const result = dedupeNotificationCandidates([base, duplicate, oneTime], NOW);
    assert.equal(result.length, 2);
    assert.equal(result[0].publicCode, duplicate.publicCode);
    assert.equal(result[0].actionRequired, true);
});

test("one-time acknowledgment is permanent while action-required acknowledgment snoozes exactly one hour", () => {
    const conditionState = acknowledgeNotification(base, NOW);
    assert.equal(Date.parse(conditionState.suppressUntil) - Date.parse(conditionState.acknowledgedAt), NOTIFICATION_SNOOZE_MS);
    const event = { ...base, source: "faq", behavior: "event", dedupeKey: "faq:answered:question-code", actionRequired: false, reviewAction: "faq.review" };
    assert.equal(acknowledgeNotification(event, NOW).suppressUntil, null);
});

test("resolved, expired, acknowledged and snoozed candidates are filtered by authoritative state", () => {
    const event = { ...base, source: "faq", behavior: "event", actionRequired: false, reviewAction: "faq.review" };
    const result = dedupeNotificationCandidates([
        base,
        { ...base, dedupeKey: "profile:resolved", resolvedAt: NOW },
        { ...base, dedupeKey: "profile:expired", expiresAt: NOW },
        { ...event, dedupeKey: "faq:acknowledged", acknowledgedAt: NOW },
        { ...base, dedupeKey: "profile:snoozed", suppressUntil: "2026-10-08T13:00:00Z" }
    ], NOW);
    assert.deepEqual(result.map(item => item.dedupeKey), [base.dedupeKey]);
    assert.equal(dedupeNotificationCandidates([{ ...base, dedupeKey: "profile:returns", suppressUntil: "2026-10-08T11:59:59Z" }], NOW).length, 1);
    assert.equal(dedupeNotificationCandidates([
        { ...base, dedupeKey: "profile:resolution-update", createdAt: "2026-10-08T11:00:00Z" },
        { ...base, dedupeKey: "profile:resolution-update", createdAt: "2026-10-08T11:30:00Z", updatedAt: "2026-10-08T11:30:00Z", resolvedAt: "2026-10-08T11:30:00Z" }
    ], NOW).length, 0, "a newer resolved state must not reveal a stale duplicate");
});
