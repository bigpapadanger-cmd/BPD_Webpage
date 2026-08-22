import { json } from "../responses.js";

export function getCookie(request, name) {
    const header = request.headers.get("cookie") || "";
    const cookies = header.split(";");

    for (const cookie of cookies) {
        const [n, v] = cookie.split("=").map(x => x.trim());
        if (n === name) return decodeURIComponent(v);
    }
    return "";
}

export function createCookie(request, name, value, maxAge) {
    const url = new URL(request.url);
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAge}`
    ];
    if (url.protocol === "https:") parts.push("Secure");
    return parts.join("; ");
}

export function clearCookie(request, name) {
    return createCookie(request, name, "", 0);
}

export async function getStoredSession(request, env) {
    const sessionId = getCookie(request, "bpd_session");
    if (!sessionId) return null;

    const data = await env.AUTH_SESSIONS.get(`session:${sessionId}`, "json");
    if (!data || data.expiresAt <= Date.now()) return null;

    return { sessionId, sessionData: data };
}
