"use strict";

import { getUserNotes, mutateUser, parseMutationInput } from "../../../../services/admin/user_management.js";
import { readUserManagementJson, userManagementErrorResponse, userManagementJson } from "../../../../services/admin/user_management_http.js";

export async function onRequestGet({ request, env, params }) {
    try {
        const query = new URL(request.url).searchParams;
        for (const key of query.keys()) if (key !== "page") throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        const pageText = query.get("page") || "1";
        if (!/^\d{1,7}$/u.test(pageText)) throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        const page = Number(pageText);
        if (!Number.isSafeInteger(page) || page < 1 || page > 33334) throw Object.assign(new Error(), { code: "USER_MANAGEMENT_QUERY_INVALID", status: 400 });
        return userManagementJson(await getUserNotes(request, env, params?.targetAccountId, { limit: 30, offset: (page - 1) * 30 }));
    } catch (error) { return userManagementErrorResponse(error); }
}

export async function onRequestPost({ request, env, params }) {
    try {
        const input = parseMutationInput(await readUserManagementJson(request));
        if (input.action !== "add-note") throw Object.assign(new Error(), { code: "USER_MANAGEMENT_INPUT_INVALID", status: 400 });
        return userManagementJson(await mutateUser(request, env, params?.targetAccountId, input.action, input));
    } catch (error) { return userManagementErrorResponse(error); }
}
