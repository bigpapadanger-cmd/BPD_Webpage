"use strict";

import { createRequestDiagnostics } from "../http/diagnostics.js";

const DIAGNOSTIC_CODES = new Set([
    "AUTH_REQUIRED", "ACCOUNT_IDENTITY_MISSING", "ACCOUNT_ACCESS_UNAVAILABLE", "ACCOUNT_ACCESS_RESTRICTED", "ACCOUNT_SUSPENDED",
    "CROSS_SITE_REQUEST_REJECTED",
    "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_RESPONSE_TOO_LARGE", "UPSTREAM_RESPONSE_INVALID",
    "42501", "42P01", "42703", "23505", "PGRST116", "PGRST204", "PGRST301",
    "NOTIFICATIONS_DATA_INVALID", "NOTIFICATIONS_UNAVAILABLE", "NOTIFICATION_NOT_FOUND"
]);

export function createNotificationDiagnostics(operation) {
    return createRequestDiagnostics({ label: "[NOTIFICATIONS DIAGNOSTIC]", operation, codes: DIAGNOSTIC_CODES, timeoutCode: "UPSTREAM_TIMEOUT" });
}

export function notificationErrorResponse(error) {
    const status = Number(error?.status);
    if (status === 401) return { body: { success: false, error: "AUTHENTICATION_REQUIRED" }, status };
    if (status === 403) return { body: { success: false, error: "ACCOUNT_ACCESS_DENIED" }, status };
    if (status === 404 && error?.code === "NOTIFICATION_NOT_FOUND") return { body: { success: false, error: "NOTIFICATION_NOT_FOUND" }, status };
    return { body: { success: false, error: "NOTIFICATIONS_UNAVAILABLE" }, status: 503 };
}

export function notificationJson(body, status = 200, debugId = null) {
    const headers = {
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "application/json; charset=utf-8"
    };
    if (debugId) headers["X-Debug-ID"] = debugId;
    return Response.json(body, { status, headers });
}

export function isSameOriginMutation(request) {
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
    const origin = request.headers.get("Origin");
    if (!origin) return Boolean(fetchSite && ["same-origin", "same-site", "none"].includes(fetchSite));
    try { return new URL(origin).origin === new URL(request.url).origin; }
    catch { return false; }
}
