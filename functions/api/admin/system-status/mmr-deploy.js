import { sanitizeLogMetadata } from "../../../services/http/diagnostics.js";
"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";
import { readJsonBody } from "../../../services/http/json.js";
import { getMmrDeploymentStatus, startMmrDeployment } from "../../../services/admin/mmr_deployment.js";

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

async function authorize(request, env) {
    try { return await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.MMR_DEPLOY); }
    catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        throw Object.assign(new Error("Authorization failed."), { status, code: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" });
    }
}

export async function onRequestGet({ request, env }) {
    try {
        await authorize(request, env);
        return json({ success: true, deployment: await getMmrDeploymentStatus(env) });
    } catch (error) { return json({ success: false, error: error?.code || "MMR_DEPLOY_STATUS_UNAVAILABLE" }, Number(error?.status) || 503); }
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    let authorization;
    try { authorization = await authorize(request, env); }
    catch (error) { return json({ success: false, error: error.code }, error.status); }
    const parsed = await readJsonBody(request, 256);
    if (!parsed.success || parsed.data?.confirm !== true || Object.keys(parsed.data || {}).some(key => key !== "confirm")) return json({ success: false, error: "MMR_DEPLOY_CONFIRMATION_REQUIRED" }, 400);
    const startedAt = Date.now();
    try {
        const deployment = await startMmrDeployment(env, authorization.accountId);
        console.info("ADMIN DEPLOYMENT ACTION", sanitizeLogMetadata({ action: "mmr_worker_deploy", accountId: authorization.accountId, target: deployment.target, deploymentId: deployment.deploymentId, timestamp: new Date().toISOString(), result: "MMR_DEPLOY_STARTED" }));
        return json({ success: true, deployment }, 202);
    } catch (error) {
        console.warn("ADMIN DEPLOYMENT ACTION", sanitizeLogMetadata({ action: "mmr_worker_deploy", accountId: authorization.accountId, target: "bpd-mmr-api", timestamp: new Date().toISOString(), result: error?.code || "MMR_DEPLOY_TRIGGER_FAILED", durationMs: Date.now() - startedAt }));
        return json({ success: false, error: error?.code || "MMR_DEPLOY_TRIGGER_FAILED", retryAfterSeconds: error?.retryAfterSeconds || null }, Number(error?.status) || 503, error?.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {});
    }
}
