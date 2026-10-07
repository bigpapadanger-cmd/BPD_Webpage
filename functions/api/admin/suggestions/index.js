"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";
import { callSuggestionsRpc, SUGGESTIONS_RPCS } from "../../../services/supabase/suggestions.js";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

async function authorize(request, env) {
    try {
        return await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.SUGGESTIONS_MANAGE);
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        throw Object.assign(new Error("NOT_AUTHORIZED"), { status });
    }
}

export async function onRequestGet(context) {
    try {
        await authorize(context.request, context.env);
        const suggestions = await callSuggestionsRpc(context.env, SUGGESTIONS_RPCS.LIST_PENDING);
        if (!Array.isArray(suggestions)) throw new Error("SUGGESTIONS_RESPONSE_INVALID");
        return json({ success: true, suggestions });
    } catch (error) {
        const status = Number(error?.status);
        if ([401, 403].includes(status)) {
            return json({ success: false, error: status === 401 ? "AUTHENTICATION_REQUIRED" : "ADMIN_PERMISSION_REQUIRED" }, status);
        }
        return json({ success: false, error: "SUGGESTIONS_UNAVAILABLE" }, 503);
    }
}
