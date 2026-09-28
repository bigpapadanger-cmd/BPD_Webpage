"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../../services/admin/permissions.js";
import { readJsonBody } from "../../../../services/http/json.js";
import { callSuggestionsRpc, SUGGESTIONS_RPCS } from "../../../../services/supabase/suggestions.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export async function onRequestPost(context) {
    const origin = context.request.headers.get("Origin");
    if (origin && origin !== new URL(context.request.url).origin) {
        return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    }

    const suggestionId = context.params?.suggestionId;
    if (!UUID_PATTERN.test(suggestionId || "")) {
        return json({ success: false, error: "SUGGESTION_NOT_FOUND" }, 404);
    }

    let authorization;
    try {
        authorization = await authorizeAdminPermission(context.request, context.env, ADMIN_PERMISSIONS.SUGGESTIONS_MANAGE);
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, error: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" }, status);
    }

    const parsed = await readJsonBody(context.request, 4096);
    if (parsed.tooLarge) return json({ success: false, error: "INVALID_INPUT" }, 413);
    if (!parsed.success) return json({ success: false, error: "INVALID_INPUT" }, 400);
    const input = parsed.data;

    const status = input?.status;
    const reviewNote = typeof input?.reviewNote === "string" ? input.reviewNote.trim() : "";
    if (!new Set(["approved", "rejected"]).has(status) || reviewNote.length > 1000) {
        return json({ success: false, error: "INVALID_INPUT" }, 400);
    }

    try {
        const result = await callSuggestionsRpc(context.env, SUGGESTIONS_RPCS.REVIEW, {
            p_suggestion_id: suggestionId,
            p_reviewer_account_id: authorization.accountId,
            p_status: status,
            p_review_note: reviewNote || null
        });
        return json({ success: true, suggestion: Array.isArray(result) ? result[0] : result });
    } catch (error) {
        if (error?.status === 409) return json({ success: false, error: "SUGGESTION_NOT_PENDING" }, 409);
        return json({ success: false, error: "SUGGESTIONS_UNAVAILABLE" }, 503);
    }
}
