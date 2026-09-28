"use strict";

import { authorizeRequest } from "../../../services/auth/authorization.js";
import { callSuggestionsRpc, SUGGESTIONS_RPCS } from "../../../services/supabase/suggestions.js";

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
        authorization = await authorizeRequest(context.request, context.env, { session: true, account: true });
    } catch (error) {
        const status = Number(error?.status);
        if (status === 401 || status === 403) {
            return json({ success: false, error: status === 401 ? "AUTHENTICATION_REQUIRED" : "ACCOUNT_INACTIVE" }, status);
        }
        return json({ success: false, error: "SUGGESTIONS_UNAVAILABLE" }, 503);
    }

    try {
        const result = await callSuggestionsRpc(context.env, SUGGESTIONS_RPCS.TOGGLE_VOTE, {
            p_suggestion_id: suggestionId,
            p_account_id: authorization.accountId
        });
        const vote = Array.isArray(result) ? result[0] : result;
        return json({
            success: true,
            upvotes: Number(vote?.upvotes) || 0,
            userUpvoted: vote?.user_upvoted === true
        });
    } catch (error) {
        if (error?.status === 404) return json({ success: false, error: "SUGGESTION_NOT_FOUND" }, 404);
        return json({ success: false, error: "SUGGESTIONS_UNAVAILABLE" }, 503);
    }
}
