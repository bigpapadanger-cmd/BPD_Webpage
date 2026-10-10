"use strict";

import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";
import { getMmrProtocolDiagnostics } from "../../../services/admin/system_status.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
    try {
        await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE);
        return json({ success: true, protocolDiagnostics: await getMmrProtocolDiagnostics(env) });
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, error: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" }, status);
    }
}
