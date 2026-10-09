"use strict";

import { authorizeRequest } from "../../../services/auth/authorization.js";
import { acknowledgeNotificationState } from "../../../services/notifications/persistence.js";
import { createNotificationDiagnostics, isSameOriginMutation, notificationErrorResponse, notificationJson } from "../../../services/notifications/http.js";

const PUBLIC_CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, env, params }) {
    const diagnostics = createNotificationDiagnostics("acknowledge_notification");
    let error = null;
    let response;
    try {
        diagnostics.mark("origin_validation");
        if (!isSameOriginMutation(request)) {
            const forbidden = Object.assign(new Error("Cross-site mutation rejected."), { code: "CROSS_SITE_REQUEST_REJECTED", status: 403 });
            throw forbidden;
        }
        const authorization = await authorizeRequest(request, env, { session: true, diagnostics });
        if (!PUBLIC_CODE.test(authorization.accountId || "")) {
            throw Object.assign(new Error("Authenticated account identity is unavailable."), { code: "ACCOUNT_IDENTITY_MISSING", status: 401 });
        }
        diagnostics.mark("public_code_validation");
        if (!PUBLIC_CODE.test(params?.publicCode || "")) {
            const missing = Object.assign(new Error("Notification not found."), { code: "NOTIFICATION_NOT_FOUND", status: 404 });
            throw missing;
        }
        const state = await acknowledgeNotificationState(env, authorization.accountId, params.publicCode, fetch, diagnostics);
        if (!state) {
            const missing = Object.assign(new Error("Notification not found."), { code: "NOTIFICATION_NOT_FOUND", status: 404 });
            throw missing;
        }
        response = notificationJson({ success: true, acknowledged: true }, 200, diagnostics.debugId);
    } catch (caught) {
        error = caught;
        const failure = notificationErrorResponse(caught);
        response = notificationJson(failure.body, failure.status, diagnostics.debugId);
    }
    diagnostics.finish(error);
    return response;
}
