"use strict";

import { authorizeRequest } from "../../services/auth/authorization.js";
import { createNotificationDiagnostics, notificationErrorResponse, notificationJson } from "../../services/notifications/http.js";
import { collectConditionNotifications, mapOcrEventsToNotifications } from "../../services/notifications/producers.js";
import { normalizeNotificationCandidate } from "../../services/notifications/core.js";
import { listOcrNotificationEvents, notificationIsVisible, reconcileNotificationState } from "../../services/notifications/persistence.js";

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
    const diagnostics = createNotificationDiagnostics("list_notifications");
    let error = null;
    let response;
    try {
        const authorization = await authorizeRequest(request, env, { session: true, diagnostics });
        if (!ACCOUNT_ID.test(authorization.accountId || "")) {
            throw Object.assign(new Error("Authenticated account identity is unavailable."), { code: "ACCOUNT_IDENTITY_MISSING", status: 401 });
        }
        const now = new Date();
        const [conditionCandidates, ocrEvents] = await Promise.all([
            collectConditionNotifications(env, authorization.accountId, now),
            listOcrNotificationEvents(env, authorization.accountId, fetch, diagnostics)
        ]);
        const candidates = [...conditionCandidates, ...mapOcrEventsToNotifications(ocrEvents, now)];
        const notifications = [];
        for (const value of candidates) {
            const candidate = normalizeNotificationCandidate(value);
            if (!candidate) continue;
            const state = await reconcileNotificationState(env, authorization.accountId, candidate.dedupeKey, fetch, diagnostics, now);
            if (!notificationIsVisible(candidate, state, now)) continue;
            notifications.push({
                publicCode: state.publicCode,
                source: candidate.source,
                severity: candidate.severity,
                title: candidate.title,
                message: candidate.message,
                actionRequired: candidate.actionRequired,
                reviewAction: candidate.reviewAction,
                createdAt: candidate.createdAt,
                expiresAt: candidate.expiresAt,
                ...(candidate.reviewCode ? { reviewCode: candidate.reviewCode } : {})
            });
        }
        response = notificationJson({ success: true, notifications }, 200, diagnostics.debugId);
    } catch (caught) {
        error = caught;
        const failure = notificationErrorResponse(caught);
        response = notificationJson(failure.body, failure.status, diagnostics.debugId);
    }
    diagnostics.finish(error);
    return response;
}
