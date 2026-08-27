import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE,
    AUTH_SESSION_COOKIE
} from "../../api_vars.js";

import {
    getCookie,
    createCookie,
    SESSION_TTL
} from "../common_helpers/reload_sessions.js";

function maskClientId(clientId) {
    if (!clientId || clientId.length < 10) {
        return "missing-or-invalid";
    }

    return `${clientId.slice(0, 6)}...${clientId.slice(-4)}`;
}

function limitMessage(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .slice(0, 500);
}

export async function handleEpicCallback(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    const url =
        new URL(request.url);

    const code =
        url.searchParams.get("code");

    const state =
        url.searchParams.get("state");

    console.info(
        "EPIC CALLBACK SERVICE: Started.",
        {
            debugId,
            method:
                request.method,
            pathname:
                url.pathname,
            hasCode:
                Boolean(code),
            hasState:
                Boolean(state),
            hasOAuthError:
                url.searchParams.has("error")
        }
    );

    try {
        if (!code || !state) {
            console.error(
                "EPIC CALLBACK SERVICE: OAuth parameters missing.",
                {
                    debugId,
                    hasCode:
                        Boolean(code),
                    hasState:
                        Boolean(state),
                    oauthError:
                        url.searchParams.get("error"),
                    oauthErrorDescription:
                        limitMessage(
                            url.searchParams.get(
                                "error_description"
                            )
                        )
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Missing OAuth parameters.",
                    debugId
                },
                400
            );
        }

        const storedState =
            getCookie(
                request,
                AUTH_STATE_COOKIE
            );

        console.info(
            "EPIC CALLBACK SERVICE: State checked.",
            {
                debugId,
                hasStoredState:
                    Boolean(storedState),
                stateMatches:
                    Boolean(
                        storedState &&
                        storedState === state
                    )
            }
        );

        if (
            !storedState ||
            storedState !== state
        ) {
            console.error(
                "EPIC CALLBACK SERVICE: OAuth state invalid.",
                {
                    debugId,
                    hasStoredState:
                        Boolean(storedState)
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Invalid OAuth state.",
                    debugId
                },
                400
            );
        }

        const clientId =
            typeof env.EPIC_CLIENT_ID === "string"
                ? env.EPIC_CLIENT_ID.trim()
                : "";

        const clientSecret =
            typeof env.EPIC_CLIENT_SECRET === "string"
                ? env.EPIC_CLIENT_SECRET.trim()
                : "";

        const redirectUri =
            typeof env.EPIC_REDIRECT_URI === "string"
                ? env.EPIC_REDIRECT_URI.trim()
                : "";

        console.info(
            "EPIC CALLBACK SERVICE: Configuration loaded.",
            {
                debugId,
                clientId:
                    maskClientId(clientId),
                hasClientSecret:
                    Boolean(clientSecret),
                redirectUri,
                tokenUrl:
                    EPIC_TOKEN_URL,
                userInfoUrl:
                    EPIC_USER_INFO_URL,
                hasSessionBinding:
                    Boolean(env.AUTH_SESSIONS)
            }
        );

        if (
            !clientId ||
            !clientSecret ||
            !redirectUri
        ) {
            console.error(
                "EPIC CALLBACK SERVICE: Configuration invalid.",
                {
                    debugId,
                    hasClientId:
                        Boolean(clientId),
                    hasClientSecret:
                        Boolean(clientSecret),
                    hasRedirectUri:
                        Boolean(redirectUri)
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic callback configuration invalid.",
                    debugId
                },
                500
            );
        }

        console.info(
            "EPIC CALLBACK SERVICE: Starting token exchange.",
            {
                debugId,
                clientId:
                    maskClientId(clientId),
                redirectUri
            }
        );

        const tokenResponse =
            await fetch(
                EPIC_TOKEN_URL,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",
                        "Authorization":
                            "Basic " +
                            btoa(
                                `${clientId}:${clientSecret}`
                            )
                    },
                    body:
                        new URLSearchParams({
                            grant_type:
                                "authorization_code",
                            code,
                            redirect_uri:
                                redirectUri
                        })
                }
            );

        console.info(
            "EPIC CALLBACK SERVICE: Token response received.",
            {
                debugId,
                status:
                    tokenResponse.status,
                ok:
                    tokenResponse.ok
            }
        );

        if (!tokenResponse.ok) {
            const tokenError =
                await tokenResponse.text();

            console.error(
                "EPIC CALLBACK SERVICE: Token exchange failed.",
                {
                    debugId,
                    status:
                        tokenResponse.status,
                    response:
                        limitMessage(tokenError)
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Token exchange failed.",
                    upstreamStatus:
                        tokenResponse.status,
                    debugId
                },
                502
            );
        }

        const tokenData =
            await tokenResponse.json();

        const accessToken =
            typeof tokenData.access_token === "string"
                ? tokenData.access_token
                : "";

        console.info(
            "EPIC CALLBACK SERVICE: Token exchange completed.",
            {
                debugId,
                hasAccessToken:
                    Boolean(accessToken),
                tokenType:
                    tokenData.token_type || null,
                expiresIn:
                    tokenData.expires_in || null
            }
        );

        if (!accessToken) {
            console.error(
                "EPIC CALLBACK SERVICE: Access token missing.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic returned no access token.",
                    debugId
                },
                502
            );
        }

        const profileResponse =
            await fetch(
                EPIC_USER_INFO_URL,
                {
                    method: "GET",
                    headers: {
                        "Authorization":
                            `Bearer ${accessToken}`,
                        "Accept":
                            "application/json"
                    }
                }
            );

        console.info(
            "EPIC CALLBACK SERVICE: Profile response received.",
            {
                debugId,
                status:
                    profileResponse.status,
                ok:
                    profileResponse.ok
            }
        );

        if (!profileResponse.ok) {
            const profileError =
                await profileResponse.text();

            console.error(
                "EPIC CALLBACK SERVICE: Profile request failed.",
                {
                    debugId,
                    status:
                        profileResponse.status,
                    response:
                        limitMessage(profileError)
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Failed to fetch Epic profile.",
                    upstreamStatus:
                        profileResponse.status,
                    debugId
                },
                502
            );
        }

        const profile =
            await profileResponse.json();

        console.info(
            "EPIC CALLBACK SERVICE: Profile loaded.",
            {
                debugId,
                hasAccountId:
                    Boolean(profile.id),
                hasDisplayName:
                    Boolean(profile.displayName)
            }
        );

        if (!env.AUTH_SESSIONS) {
            console.error(
                "EPIC CALLBACK SERVICE: AUTH_SESSIONS binding missing.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Session storage is unavailable.",
                    debugId
                },
                500
            );
        }

        const sessionId =
            crypto.randomUUID();

        const sessionKey =
            `session:${sessionId}`;

        const sessionData = {
            epicAccountId:
                profile.id || "",
            displayName:
                profile.displayName ||
                "Epic Player",
            createdAt:
                Date.now()
        };

        await env.AUTH_SESSIONS.put(
            sessionKey,
            JSON.stringify(sessionData),
            {
                expirationTtl:
                    SESSION_TTL
            }
        );

        console.info(
            "EPIC CALLBACK SERVICE: Session stored.",
            {
                debugId,
                sessionTtl:
                    SESSION_TTL
            }
        );

        const cookie =
            createCookie(
                request,
                AUTH_SESSION_COOKIE,
                sessionId,
                SESSION_TTL
            );

        console.info(
            "EPIC CALLBACK SERVICE: Completed successfully.",
            {
                debugId,
                cookieCreated:
                    Boolean(cookie),
                redirectDestination:
                    "/RocketLeague"
            }
        );

        const redirectDestination =
            registrationComplete
                ? "/RocketLeague"
                : "/RocketLeague/Register";

        return redirect(
            redirectDestination,
            [cookie]
        );
    } catch (error) {
        console.error(
            "EPIC CALLBACK SERVICE: Unexpected failure.",
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
                    "Epic callback failed unexpectedly.",
                debugId
            },
            500
        );
    }
}