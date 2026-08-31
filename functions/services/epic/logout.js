import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    getCookie,
    clearCookie
} from "../common_helpers/reload_sessions.js";

import {
    AUTH_SESSION_COOKIE,
    AUTH_STATE_COOKIE
} from "../../api_vars.js";

export async function handleLogout(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    console.info(
        "LOGOUT SERVICE: Started.",
        {
            debugId,
            method:
                request.method
        }
    );

    try {
        const sessionId =
            getCookie(
                request,
                AUTH_SESSION_COOKIE
            );

        /*
        =========================================================
        DELETE SERVER-SIDE SESSION
        =========================================================
        */

        if (sessionId) {
            if (!env.AUTH_SESSIONS) {
                console.warn(
                    "LOGOUT SERVICE: AUTH_SESSIONS binding unavailable.",
                    {
                        debugId
                    }
                );
            } else {
                try {
                    await env.AUTH_SESSIONS.delete(
                        `session:${sessionId}`
                    );
                } catch (error) {
                    console.error(
                        "LOGOUT SERVICE: Session deletion failed.",
                        {
                            debugId,
                            message:
                                error?.message ||
                                "Unknown error"
                        }
                    );
                }
            }
        }

        /*
        =========================================================
        EXPIRE AUTH COOKIES
        =========================================================
        */

        const sessionCookie =
            clearCookie(
                request,
                AUTH_SESSION_COOKIE
            );

        const stateCookie =
            clearCookie(
                request,
                AUTH_STATE_COOKIE
            );

        console.info(
            "LOGOUT SERVICE: Completed.",
            {
                debugId,
                hadSession:
                    Boolean(sessionId)
            }
        );

        /*
        =========================================================
        RETURN TO LOGGED-OUT PAGE
        =========================================================
        */

        return redirect(
            "/RocketLeague",
            [
                sessionCookie,
                stateCookie
            ]
        );

    } catch (error) {
        console.error(
            "LOGOUT SERVICE: Failed.",
            {
                debugId,
                name:
                    error?.name ||
                    "Error",
                message:
                    error?.message ||
                    "Unknown error",
                stack:
                    error?.stack ||
                    null
            }
        );

        return json(
            {
                success: false,
                message:
                    "Logout failed.",
                debugId
            },
            500
        );
    }
}