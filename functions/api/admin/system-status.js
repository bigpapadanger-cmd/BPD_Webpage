"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../services/admin/permissions.js";
import { readJsonBody } from "../../services/http/json.js";
import { getSystemStatus, performSystemStatusAction, updateMmrBuildConfiguration } from "../../services/admin/system_status.js";

function json(body, status = 200, headers = {}) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function authorize(request, env) {
    try {
        return await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE);
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        throw Object.assign(new Error("Authorization failed."), { status, code: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" });
    }
}

export async function onRequestGet({ request, env }) {
    try { await authorize(request, env); }
    catch (error) { return json({ success: false, error: error.code }, error.status); }
    return json(await getSystemStatus(env));
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    let authorization;
    try { authorization = await authorize(request, env); }
    catch (error) { return json({ success: false, error: error.code }, error.status); }
    const parsed = await readJsonBody(request, 1024);
    if (!parsed.success) return json({ success: false, error: "INVALID_INPUT" }, parsed.tooLarge ? 413 : 400);
    const service = typeof parsed.data?.service === "string" ? parsed.data.service.trim() : "";
    const action = typeof parsed.data?.action === "string" ? parsed.data.action.trim() : "";
    const startedAt = Date.now();
    try {
        const result = service === "mmr-api" && action === "update-build"
            ? await updateMmrBuildConfiguration(env, parsed.data)
            : await performSystemStatusAction(env, service, action, parsed.data);
        console.info("ADMIN SYSTEM ACTION", { service, action, accountId: authorization.accountId, requestedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), result: "success", durationMs: Date.now() - startedAt });
        return json(result);
    } catch (error) {
        console.warn("ADMIN SYSTEM ACTION", { service, action, accountId: authorization.accountId, requestedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), result: error?.code || "failed", durationMs: Date.now() - startedAt });
        const status = [400, 409, 429, 502, 503, 504].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, error: error?.code || "SYSTEM_ACTION_FAILED", providerCode: error?.providerCode || null, retryAfterSeconds: error?.retryAfterSeconds || null }, status, error?.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {});
    }
}
