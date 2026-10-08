"use strict";

// Static _headers rules do not cover Pages Functions responses.
export async function onRequest({ request, next }) {
    const url = new URL(request.url);
    let path = url.pathname;
    // Match encoded route segments too; authorization still belongs to the route.
    try { path = decodeURIComponent(path); } catch { /* Router handles malformed URLs. */ }
    const adminWrite = ["/api/admin/", "/api/auth/admin/"].some(prefix => path.startsWith(prefix))
        && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
    const forbidden = adminWrite && (request.headers.get("Origin") !== new URL(request.url).origin
        || request.headers.get("Sec-Fetch-Site") === "cross-site");
    const response = forbidden
        ? Response.json({ success: false, code: "ORIGIN_REQUIRED", message: "Admin changes must be made from this website." }, { status: 403 })
        : await next();
    // Preserve the runtime upgrade object and its WebSocket transport unchanged.
    if (response.status === 101) return response;
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("X-Frame-Options", "SAMEORIGIN");
    secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    secured.headers.set("Permissions-Policy", "camera=(), microphone=()");
    // Observe template sinks and navigation boundaries without blocking current UI.
    secured.headers.set("Content-Security-Policy-Report-Only", "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; require-trusted-types-for 'script'");
    if (new URL(request.url).protocol === "https:") secured.headers.set("Strict-Transport-Security", "max-age=300");
    if (path.startsWith("/api/")) {
        secured.headers.set("Cache-Control", "no-store");
    }
    return secured;
}
