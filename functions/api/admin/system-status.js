"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../services/admin/permissions.js";
import { readJsonBody } from "../../services/http/json.js";
import { getSystemStatus, performSystemStatusAction, updateMmrBuildConfiguration } from "../../services/admin/system_status.js";

function json(body, status = 200, headers = {}) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function authorize(request, env, permission = ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE) {
    try {
        return await authorizeAdminPermission(request, env, permission);
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
    if (!String(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return json({ success: false, error: "CONTENT_TYPE_REQUIRED" }, 415);
    const parsed = await readJsonBody(request, 4096);
    if (!parsed.success) return json({ success: false, error: "INVALID_INPUT" }, parsed.tooLarge ? 413 : 400);
    const service = typeof parsed.data?.service === "string" ? parsed.data.service.trim() : "";
    const action = typeof parsed.data?.action === "string" ? parsed.data.action.trim() : "";
    if (action === "refresh-shop") {
        try { await authorize(request, env, ADMIN_PERMISSIONS.RL_FORCE_REFRESH); }
        catch (error) { return json({ success: false, error: error.code }, error.status); }
    }
    if ((["discord-matchbot", "discord-authz-bot"].includes(service) || action === "refresh-shop")
        && Object.keys(parsed.data).some(key => !["service", "action"].includes(key))) return json({ success: false, error: "INVALID_INPUT" }, 400);
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    try {
        const result = service === "mmr-api" && action === "validate-build"
            ? await updateMmrBuildConfiguration(env, parsed.data)
            : await performSystemStatusAction(env, service, action, parsed.data);
        console.info("ADMIN SYSTEM ACTION", { service, action, requestId, requestedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), result: "success", durationMs: Date.now() - startedAt });
        return json(result);
    } catch (error) {
        console.warn("ADMIN SYSTEM ACTION", { service, action, requestId, requestedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), result: error?.code || "failed", durationMs: Date.now() - startedAt });
        const status = [400, 401, 403, 409, 422, 429, 502, 503, 504].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, code: error?.code || "SYSTEM_ACTION_FAILED", message: error?.safeMessage || "The requested MMR operation could not be completed.", providerCode: error?.providerCode || null, retryAfterSeconds: error?.retryAfterSeconds || null, rootCause: error?.rootCause || null, action: error?.action || null }, status, error?.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {});
    }
}
