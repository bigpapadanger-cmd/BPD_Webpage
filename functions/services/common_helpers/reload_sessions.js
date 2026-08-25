// =========================================================
// BPD SESSION MODULE — CLEAN REWRITE
// =========================================================

// How long sessions last (in hours)
import { SESSION_TTL_SECONDS } from "../../api_vars.js";

// =========================================================
// COOKIE HELPERS
// =========================================================

export function getCookie(request, name) {
    const header = request.headers.get("cookie") || "";
    if (!header.includes("=")) return "";

    const cookies = header.split(";");

    for (const cookie of cookies) {
        const [n, v] = cookie.split("=").map(x => x.trim());
        if (n === name && typeof v === "string") {
            try {
                return decodeURIComponent(v);
            } catch {
                return "";
            }
        }
    }

    return "";
}

export function createCookie(request, name, value, maxAgeSeconds) {
    const safeName = typeof name === "string" ? name.trim() : "";
    const safeValue = typeof value === "string" ? value.trim() : "";
    const safeMaxAge = Number.isInteger(maxAgeSeconds) ? maxAgeSeconds : 0;

    if (!safeName) return "";

    const url = new URL(request.url);

    const parts = [
        `${safeName}=${encodeURIComponent(safeValue)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${safeMaxAge}`
    ];

    if (url.protocol === "https:") {
        parts.push("Secure");
    }

    return parts.join("; ");
}

export function clearCookie(request, name) {
    return createCookie(request, name, "", 0);
}

// =========================================================
// SESSION RETRIEVAL (KV TTL handles expiration)
// =========================================================

export async function getStoredSession(request, env) {
    const sessionId = getCookie(request, "bpd_session");

    if (!sessionId || sessionId.length < 5) {
        return null;
    }

    const key = `session:${sessionId}`;
    const data = await env.AUTH_SESSIONS.get(key, "json");

    if (!data || typeof data !== "object") {
        return null;
    }

    return {
        sessionId,
        sessionData: data
    };
}

// =========================================================
// EXPORT TTL FOR USE IN CALLBACK
// =========================================================

export const SESSION_TTL = SESSION_TTL_SECONDS;
