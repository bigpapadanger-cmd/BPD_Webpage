"use strict";

import { authorizeAdminContext } from "../../../services/admin/permissions.js";
import { readJsonBody } from "../../../services/http/json.js";
import { withUpstreamDeadline } from "../../../services/http/upstream.js";
import { callCustomMatchRpc } from "../../../services/supabase/rocketleague/custom_matches.js";
import { validateCustomMatchRequest, toCustomMatchRpcParameters, CustomMatchError } from "../../../services/rl/custom_matches/contracts.js";
import { customMatchJson } from "../../../services/rl/custom_matches/http.js";

// Live database contract accepted. Runtime errors never use a host/direct-table fallback.
export async function onRequest({ request, env }) {
    if (request.method !== "POST") return customMatchJson({ success: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    if (request.headers.get("Origin") !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site") return customMatchJson({ success: false, code: "CUSTOM_MATCH_ORIGIN_FORBIDDEN" }, 403);
    try {
        const actor = await authorizeAdminContext(request, env);
        if (actor.admin?.isAdmin !== true) return customMatchJson({ success: false, code: "ADMIN_PERMISSION_REQUIRED" }, 403);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) return customMatchJson({ success: false, code: "CUSTOM_MATCH_INPUT_INVALID" }, 415);
        const parsed = await withUpstreamDeadline(signal => readJsonBody(request, 2048, signal), 3000);
        if (!parsed.success) return customMatchJson({ success: false, code: "CUSTOM_MATCH_INPUT_INVALID" }, parsed.tooLarge ? 413 : 400);
        const input = validateCustomMatchRequest("adminTransferHost", parsed.data);
        const result = await callCustomMatchRpc(env, "adminTransferHost", toCustomMatchRpcParameters("adminTransferHost", input, actor.accountId));
        if (result.matchCode !== input.matchCode || result.version <= input.expectedVersion) throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502);
        return customMatchJson(result);
    } catch (error) {
        const status = error instanceof CustomMatchError ? error.status : [401, 403].includes(error?.status) ? error.status : error?.code === "UPSTREAM_TIMEOUT" ? 408 : 503;
        const code = error instanceof CustomMatchError ? error.code : status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "CUSTOM_MATCH_UNAVAILABLE";
        return customMatchJson({ success: false, code }, status);
    }
}
