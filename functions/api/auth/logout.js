"use strict";
import { handleLogout } from "../../services/auth/account/logout.js";
import { json } from "../../services/common_helpers/responses.js";

// Logout changes session state. Never allow navigation/prefetch to perform it.
export function onRequestGet() {
    return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
}

export async function onRequestPost({ request, env }) {
    if (request.headers.get("Origin") !== new URL(request.url).origin
        || request.headers.get("Sec-Fetch-Site") === "cross-site") {
        return json({ success: false, code: "LOGOUT_ORIGIN_FORBIDDEN" }, 403);
    }
    const debugId = crypto.randomUUID();
    try {
        return await handleLogout(request, env);
    } catch {
        console.error("LOGOUT ROUTE: Unexpected failure.", { debugId, code: "LOGOUT_FAILED" });
        return json({ success: false, code: "LOGOUT_FAILED", message: "Logout failed.", debugId }, 500);
    }
}
