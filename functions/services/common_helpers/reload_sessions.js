// =========================================================
// BPD SESSION MODULE
// =========================================================

import {
    SESSION_IDLE_TTL_SECONDS,
    SESSION_ABSOLUTE_TTL_SECONDS
} from "../../api_vars.js";

// =========================================================
// COOKIE HELPERS
// =========================================================

export function getCookie(
    request,
    name
) {
    const header =
        request.headers.get("cookie") || "";

    if (!header.includes("=")) {
        return "";
    }

    const cookies =
        header.split(";");

    for (const cookie of cookies) {
        const separatorIndex =
            cookie.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const cookieName =
            cookie
                .slice(
                    0,
                    separatorIndex
                )
                .trim();

        const cookieValue =
            cookie
                .slice(
                    separatorIndex + 1
                )
                .trim();

        if (
            cookieName !== name
        ) {
            continue;
        }

        try {
            return decodeURIComponent(
                cookieValue
            );
        } catch {
            return "";
        }
    }

    return "";
}

export function createCookie(
    request,
    name,
    value,
    maxAgeSeconds
) {
    const safeName =
        typeof name === "string"
            ? name.trim()
            : "";

    const safeValue =
        typeof value === "string"
            ? value.trim()
            : "";

    const safeMaxAge =
        Number.isInteger(
            maxAgeSeconds
        ) &&
        maxAgeSeconds >= 0
            ? maxAgeSeconds
            : 0;

    if (!safeName) {
        return "";
    }

    const url =
        new URL(
            request.url
        );

    const parts = [
        `${safeName}=${encodeURIComponent(safeValue)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${safeMaxAge}`
    ];

    if (
        url.protocol === "https:"
    ) {
        parts.push(
            "Secure"
        );
    }

    return parts.join(
        "; "
    );
}

export function clearCookie(
    request,
    name
) {
    return createCookie(
        request,
        name,
        "",
        0
    );
}

// =========================================================
// SESSION RETRIEVAL
// =========================================================

export async function getStoredSession(
    request,
    env
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        return null;
    }

    const sessionId =
        getCookie(
            request,
            "bpd_session"
        );

    if (
        !sessionId ||
        sessionId.length < 5
    ) {
        return null;
    }

    const key =
        `session:${sessionId}`;

    const data =
        await env.AUTH_SESSIONS.get(
            key,
            "json"
        );

    if (
        !data ||
        typeof data !== "object"
    ) {
        return null;
    }

    const now =
        Date.now();

    const absoluteExpiresAt =
        Number(
            data.AbsoluteExpiresAt
        );

    if (
        !Number.isFinite(
            absoluteExpiresAt
        ) ||
        absoluteExpiresAt <= now
    ) {
        await env.AUTH_SESSIONS.delete(
            key
        );

        return null;
    }

    const remainingAbsoluteSeconds =
        Math.max(
            0,
            Math.floor(
                (
                    absoluteExpiresAt -
                    now
                ) /
                1000
            )
        );

    if (
        remainingAbsoluteSeconds <= 0
    ) {
        await env.AUTH_SESSIONS.delete(
            key
        );

        return null;
    }

    const nextIdleTtl =
        Math.min(
            SESSION_IDLE_TTL_SECONDS,
            remainingAbsoluteSeconds
        );

    data.LastSeenAt =
        now;

    try {
        await env.AUTH_SESSIONS.put(
            key,
            JSON.stringify(
                data
            ),
            {
                expirationTtl:
                    nextIdleTtl
            }
        );
    } catch (
        error
    ) {
        console.error(
            "BPD SESSION: Failed to refresh session TTL.",
            {
                name:
                    error?.name ||
                    "Error",
                message:
                    error?.message ||
                    "Unknown error"
            }
        );
    }

    return {
        sessionId,
        sessionData:
            data
    };
}

// =========================================================
// SESSION TTL EXPORTS
// =========================================================

export const SESSION_IDLE_TTL =
    SESSION_IDLE_TTL_SECONDS;

export const SESSION_ABSOLUTE_TTL =
    SESSION_ABSOLUTE_TTL_SECONDS;