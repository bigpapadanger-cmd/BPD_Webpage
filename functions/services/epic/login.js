import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    createCookie
} from "../common_helpers/reload_sessions.js";

import {
    EPIC_AUTHORIZE_URL,
    AUTH_STATE_COOKIE,
    AUTH_STATE_MAX_AGE_SECONDS
} from "../../api_vars.js";

import {
    createRandomState,
    getMissingAuthConfiguration
} from "../common_helpers/utils.js";

export async function handleEpicLogin(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        const missing =
            getMissingAuthConfiguration(env);

        if (
            Array.isArray(missing) &&
            missing.length > 0
        ) {
            console.error(
                "EPIC LOGIN: Configuration missing.",
                {
                    debugId,
                    missing
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic OAuth configuration is incomplete.",
                    missing,
                    debugId
                },
                503
            );
        }

        const clientId =
            typeof env.EPIC_CLIENT_ID === "string"
                ? env.EPIC_CLIENT_ID.trim()
                : "";

        const redirectUri =
            typeof env.EPIC_REDIRECT_URI === "string"
                ? env.EPIC_REDIRECT_URI.trim()
                : "";

        if (
            !clientId ||
            !redirectUri
        ) {
            console.error(
                "EPIC LOGIN: OAuth configuration invalid.",
                {
                    debugId,
                    hasClientId:
                        Boolean(clientId),
                    hasRedirectUri:
                        Boolean(redirectUri)
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic OAuth configuration invalid.",
                    debugId
                },
                500
            );
        }

        try {
            new URL(
                redirectUri
            );

        } catch (
            error
        ) {
            console.error(
                "EPIC LOGIN: Redirect URI invalid.",
                {
                    debugId,
                    message:
                        error?.message ||
                        "Unknown error"
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic OAuth redirect URI is invalid.",
                    debugId
                },
                500
            );
        }

        const state =
            createRandomState();

        if (
            !state ||
            typeof state !== "string"
        ) {
            console.error(
                "EPIC LOGIN: State generation failed.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Failed to generate OAuth state.",
                    debugId
                },
                500
            );
        }

        const url =
            new URL(
                EPIC_AUTHORIZE_URL
            );

        url.searchParams.set(
            "client_id",
            clientId
        );

        url.searchParams.set(
            "response_type",
            "code"
        );

        url.searchParams.set(
            "redirect_uri",
            redirectUri
        );

        url.searchParams.set(
            "scope",
            "basic_profile presence"
        );

        url.searchParams.set(
            "state",
            state
        );

        const cookie =
            createCookie(
                request,
                AUTH_STATE_COOKIE,
                state,
                AUTH_STATE_MAX_AGE_SECONDS
            );

        if (!cookie) {
            console.error(
                "EPIC LOGIN: Failed to create OAuth state cookie.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Failed to create OAuth state cookie.",
                    debugId
                },
                500
            );
        }

        return redirect(
            url.toString(),
            [
                cookie
            ]
        );

    } catch (
        error
    ) {
        console.error(
            "EPIC LOGIN: Unexpected failure.",
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
                    "Epic login initialization failed.",
                debugId
            },
            500
        );
    }
}