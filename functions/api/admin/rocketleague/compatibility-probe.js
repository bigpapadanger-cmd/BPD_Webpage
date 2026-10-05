import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";
import { revokeAllRlProbeSessions } from "../../../services/rl/probe_security.js";
import { beginProbeReauthorization, executePreparedProbe, PROBE_COOKIE } from "../../../services/rl/probe_reauth.js";
import { clearCookie } from "../../../services/auth/sessions/session.js";

function json(body, status) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Deliberately no provider execution or cached-credential bootstrap in this phase.
export async function onRequestPost({ request, env }) {
    try {
        await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE);
    } catch (error) {
        const status = [401, 403].includes(error?.status) ? error.status : 503;
        return json({ success: false, code: status === 503 ? "AUTHORIZATION_UNAVAILABLE" : "ADMIN_PERMISSION_REQUIRED" }, status);
    }
    if (request.headers.get("origin") !== new URL(request.url).origin
        || request.headers.get("sec-fetch-site") === "cross-site") return json({ success: false, code: "ORIGIN_REQUIRED" }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400); }
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1
        || !["CHECK_RL_COMPATIBILITY", "REVOKE_ALL_RL_PROBES", "START_FRESH_EPIC_REAUTH", "EXECUTE_PREPARED_PROBE"].includes(body.confirmation)) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
    if (body.confirmation === "REVOKE_ALL_RL_PROBES") {
        try {
            await revokeAllRlProbeSessions(env);
            return json({ success: true, code: "RL_PROBES_REVOKED", probeExecutionEnabled: false }, 200);
        } catch { return json({ success: false, code: "RL_PROBE_REVOCATION_UNAVAILABLE" }, 503); }
    }
    if (body.confirmation === "START_FRESH_EPIC_REAUTH") {
        try {
            const started = await beginProbeReauthorization(request, env);
            const response = json({ success: true, redirectUrl: started.redirectUrl, probeExecutionEnabled: false }, 200);
            for (const cookie of started.cookies) response.headers.append("Set-Cookie", cookie);
            return response;
        } catch { return json({ success: false, code: "RL_PROBE_REAUTH_UNAVAILABLE" }, 503); }
    }
    if (body.confirmation === "EXECUTE_PREPARED_PROBE") {
        try {
            const result = await executePreparedProbe(request, env);
            // Allowlist only safe diagnostic fields. Never forward internal state.
            const response = json({ success: false, code: result.code === "RL_PROBE_IDENTITY_PROOF_BLOCKED"
                ? "RL_PROBE_IDENTITY_PROOF_BLOCKED" : "RL_PROBE_EXECUTION_DISABLED",
                handoffAccepted: result.handoffAccepted === true, identityVerified: false,
                probeStarted: false, probeExecutionEnabled: false }, 503);
            response.headers.append("Set-Cookie", clearCookie(request, PROBE_COOKIE));
            return response;
        } catch { return json({ success: false, code: "RL_PROBE_FRESH_REAUTH_REQUIRED", probeExecutionEnabled: false }, 409); }
    }
    return json({ success: false, probeStarted: false, handoffAccepted: false, identityVerified: false,
        probeExecutionEnabled: false, code: "RL_PROBE_EXECUTION_DISABLED" }, 503);
}
