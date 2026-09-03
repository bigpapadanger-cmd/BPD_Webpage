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
        !sessionId
        || sessionId.length < 5
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
        !data
        || typeof data !== "object"
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
        )
        || absoluteExpiresAt <= now
    ) {
        return null;
    }

    const remainingAbsoluteSeconds =
        Math.max(
            0,
            Math.floor(
                (
                    absoluteExpiresAt
                    - now
                )
                / 1000
            )
        );

    if (
        remainingAbsoluteSeconds <= 0
    ) {
        return null;
    }

    const lastSeenAt =
        Number(
            data.LastSeenAt
            || 0
        );

    const SESSION_REFRESH_INTERVAL_MS =
        5
        * 24
        * 60
        * 60
        * 1000;

    const shouldRefresh =
        (
            !Number.isFinite(
                lastSeenAt
            )
            || lastSeenAt <= 0
            || (
                now
                - lastSeenAt
            )
            >= SESSION_REFRESH_INTERVAL_MS
        );

    if (
        shouldRefresh
    ) {
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
        }
        catch (
            error
        ) {
            console.error(
                "BPD SESSION: Failed to refresh session TTL.",
                {
                    name:
                        error?.name
                        || "Error",
                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }

    return {
        sessionId,
        sessionData:
            data
    };
}