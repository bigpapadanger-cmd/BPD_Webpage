"use strict";

import { getUserHistory } from "../../../services/admin/user_management.js";
import { userManagementErrorResponse, userManagementJson } from "../../../services/admin/user_management_http.js";

export async function onRequestGet({ request, env }) {
    try {
        const params = new URL(request.url).searchParams;
        for (const key of params.keys()) if (!["targetAccountId", "eventType", "page"].includes(key)) throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        const pageText = params.get("page") || "1", eventType = params.get("eventType") || null;
        if (!/^\d{1,7}$/u.test(pageText) || (eventType && !/^[A-Za-z0-9_-]{1,80}$/u.test(eventType))) throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        const page = Number(pageText);
        if (!Number.isSafeInteger(page) || page < 1 || page > 33334) throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        return userManagementJson(await getUserHistory(request, env, { target: params.get("targetAccountId") || null, eventType, limit: 30, offset: (page - 1) * 30 }));
    } catch (error) { return userManagementErrorResponse(error); }
}
