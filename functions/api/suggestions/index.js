"use strict";

import { authorizeRequest, getAuthorizationContext } from "../../services/auth/authorization.js";
import { readJsonBody } from "../../services/http/json.js";
import { callSuggestionsRpc, SUGGESTIONS_RPCS } from "../../services/supabase/suggestions.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function sameOrigin(request) {
    const origin = request.headers.get("Origin");
    return !origin || origin === new URL(request.url).origin;
}

function failure(error) {
    const status = Number(error?.status);
    if (status === 401 || status === 403) {
        const code = status === 401 ? "AUTHENTICATION_REQUIRED"
            : error?.code === "ACCOUNT_ACCESS_RESTRICTED" ? "ACCOUNT_ACCESS_RESTRICTED"
                : error?.code === "ACCOUNT_SUSPENDED" ? "ACCOUNT_SUSPENDED"
                    : "ACCOUNT_ACCESS_RESTRICTED";
        return json({ success: false, error: code }, status);
    }
    return json({ success: false, error: "SUGGESTIONS_UNAVAILABLE" }, 503);
}

export async function onRequestGet(context) {
    let accountId = null;
    try {
        const authorization = await getAuthorizationContext(context.request, context.env);
        if (authorization.active && UUID_PATTERN.test(authorization.accountId || "")) {
            accountId = authorization.accountId;
        }
    } catch {
        // Listing approved suggestions remains public if optional session lookup is unavailable.
    }

    try {
        const suggestions = await callSuggestionsRpc(
            context.env,
            SUGGESTIONS_RPCS.LIST_PUBLIC,
            { p_account_id: accountId }
        );
        return json({ success: true, suggestions: Array.isArray(suggestions) ? suggestions : [] });
    } catch (error) {
        return failure(error);
    }
}

export async function onRequestPost(context) {
    if (!sameOrigin(context.request)) return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

    let authorization;
    try {
        authorization = await authorizeRequest(context.request, context.env, { session: true, account: true, action: "post" });
    } catch (error) {
        return failure(error);
    }

    if (!UUID_PATTERN.test(authorization.accountId || "")) {
        return json({ success: false, error: "AUTHENTICATION_REQUIRED" }, 401);
    }

    const parsed = await readJsonBody(context.request, 8192);
    if (parsed.tooLarge) return json({ success: false, error: "INVALID_INPUT" }, 413);
    if (!parsed.success) return json({ success: false, error: "INVALID_INPUT" }, 400);
    const input = parsed.data;

    const title = typeof input?.title === "string" ? input.title.trim() : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    if (title.length < 3 || title.length > 100 || description.length < 10 || description.length > 2000) {
        return json({ success: false, error: "INVALID_INPUT" }, 400);
    }

    try {
        const result = await callSuggestionsRpc(context.env, SUGGESTIONS_RPCS.CREATE, {
            p_creator_account_id: authorization.accountId,
            p_title: title,
            p_description: description
        });
        return json({ success: true, suggestion: Array.isArray(result) ? result[0] : result }, 201);
    } catch (error) {
        return failure(error);
    }
}
