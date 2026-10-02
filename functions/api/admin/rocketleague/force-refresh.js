"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";
import { readJsonBody } from "../../../services/http/json.js";
import { forceRocketLeagueRefresh } from "../../../services/rl/admin_force_refresh.js";

function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

    let authorization;
    try {
        authorization = await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.RL_FORCE_REFRESH);
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, error: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" }, status);
    }

    if (!String(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
        return json({ success: false, error: "CONTENT_TYPE_REQUIRED" }, 415);
    }
    const parsed = await readJsonBody(request, 512);
    if (!parsed.success) return json({ success: false, error: "INVALID_INPUT" }, parsed.tooLarge ? 413 : 400);

    const body = parsed.data;
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some(key => !["accountId", "confirm"].includes(key))
        || body.confirm !== true
        || typeof body.accountId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.accountId.trim())) {
        return json({ success: false, error: "INVALID_INPUT" }, 400);
    }

    const startedAt = Date.now();
    try {
        const result = await forceRocketLeagueRefresh(env, body.accountId.trim());
        console.info("ADMIN ROCKET LEAGUE FORCE REFRESH", {
            actorAccountId: authorization.accountId || null,
            completedAt: result.completedAt,
            durationMs: Date.now() - startedAt,
            outcome: result.success ? "partial_or_full_success" : "no_capability_updated"
        });
        return json(result);
    } catch (error) {
        const status = [400, 409, 429, 502, 503, 504].includes(Number(error?.status)) ? Number(error.status) : 503;
        const code = /^[A-Z0-9_]{3,80}$/.test(String(error?.code || "")) ? error.code : "RL_FORCE_REFRESH_FAILED";
        console.warn("ADMIN ROCKET LEAGUE FORCE REFRESH", {
            actorAccountId: authorization.accountId || null,
            durationMs: Date.now() - startedAt,
            code
        });
        return json({ success: false, error: code }, status);
    }
}
