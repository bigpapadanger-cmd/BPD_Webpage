import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    getCookie,
    createCookie
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
                await env.AUTH_SESSIONS.delete(
                    `session:${sessionId}`
                );

                console.info(
                    "LOGOUT SERVICE: Cloudflare session deleted.",
                    {
                        debugId,
                        sessionDeleted:
                            true
                    }
                );
            }

        }


        /*
        =========================================================
        EXPIRE AUTH COOKIES
        =========================================================
        */

        const sessionCookie =
            createCookie(
                request,
                AUTH_SESSION_COOKIE,
                "",
                0
            );

        const stateCookie =
            createCookie(
                request,
                AUTH_STATE_COOKIE,
                "",
                0
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