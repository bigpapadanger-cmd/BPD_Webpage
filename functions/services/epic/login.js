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

function maskClientId(clientId) {
    if (!clientId || clientId.length < 10) {
        return "missing-or-invalid";
    }

    return `${clientId.slice(0, 6)}...${clientId.slice(-4)}`;
}

export async function handleEpicLogin(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    console.info(
        "EPIC LOGIN SERVICE: Started.",
        {
            debugId,
            method:
                request.method,
            pathname:
                new URL(request.url).pathname
        }
    );

    try {
        const missing =
            getMissingAuthConfiguration(env);

        console.info(
            "EPIC LOGIN SERVICE: Configuration checked.",
            {
                debugId,
                missing:
                    Array.isArray(missing)
                        ? missing
                        : []
            }
        );

        if (
            Array.isArray(missing) &&
            missing.length > 0
        ) {
            console.error(
                "EPIC LOGIN SERVICE: Configuration missing.",
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

        console.info(
            "EPIC LOGIN SERVICE: OAuth values loaded.",
            {
                debugId,
                clientId:
                    maskClientId(clientId),
                redirectUri,
                authorizeUrl:
                    EPIC_AUTHORIZE_URL,
                stateCookie:
                    AUTH_STATE_COOKIE,
                stateMaxAge:
                    AUTH_STATE_MAX_AGE_SECONDS
            }
        );

        if (!clientId || !redirectUri) {
            console.error(
                "EPIC LOGIN SERVICE: OAuth values invalid.",
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

        let parsedRedirectUri;

        try {
            parsedRedirectUri =
                new URL(redirectUri);
        } catch (error) {
            console.error(
                "EPIC LOGIN SERVICE: Redirect URI invalid.",
                {
                    debugId,
                    redirectUri,
                    message:
                        error.message
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
                "EPIC LOGIN SERVICE: State generation failed.",
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

        console.info(
            "EPIC LOGIN SERVICE: State generated.",
            {
                debugId,
                stateLength:
                    state.length
            }
        );

        const url =
            new URL(EPIC_AUTHORIZE_URL);

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

        console.info(
            "EPIC LOGIN SERVICE: Redirect prepared.",
            {
                debugId,
                epicOrigin:
                    url.origin,
                epicPathname:
                    url.pathname,
                clientId:
                    maskClientId(clientId),
                redirectOrigin:
                    parsedRedirectUri.origin,
                redirectPathname:
                    parsedRedirectUri.pathname,
                scope:
                    url.searchParams.get("scope")
            }
        );

        const cookie =
            createCookie(
                request,
                AUTH_STATE_COOKIE,
                state,
                AUTH_STATE_MAX_AGE_SECONDS
            );

        console.info(
            "EPIC LOGIN SERVICE: Redirecting to Epic.",
            {
                debugId,
                cookieCreated:
                    Boolean(cookie)
            }
        );

        return redirect(
            url.toString(),
            [cookie]
        );
    } catch (error) {
        console.error(
            "EPIC LOGIN SERVICE: Unexpected failure.",
            {
                debugId,
                name:
                    error?.name || "Error",
                message:
                    error?.message || "Unknown error",
                stack:
                    error?.stack || null
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