import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE,
    AUTH_SESSION_COOKIE,
    SESSION_IDLE_TTL_SECONDS,
    SESSION_ABSOLUTE_TTL_SECONDS
} from "../../api_vars.js";

import {
    getCookie,
    createCookie
} from "../common_helpers/reload_sessions.js";

import {
    handleRocketLeagueSignin
} from "../supabase/rocketleague/signin.js";

function limitMessage(value) {
    return String(
        value || ""
    )
        .replace(
            /\s+/g,
            " "
        )
        .slice(
            0,
            300
        );
}

export async function handleEpicCallback(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    const url =
        new URL(
            request.url
        );

    const code =
        url.searchParams.get(
            "code"
        );

    const state =
        url.searchParams.get(
            "state"
        );

    try {
        if (
            !code ||
            !state
        ) {
            console.error(
                "EPIC CALLBACK: OAuth parameters missing.",
                {
                    debugId,
                    hasCode:
                        Boolean(code),
                    hasState:
                        Boolean(state),
                    hasOAuthError:
                        url.searchParams.has(
                            "error"
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

        if (
            !storedState ||
            storedState !== state
        ) {
            console.error(
                "EPIC CALLBACK: OAuth state invalid.",
                {
                    debugId
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

        if (
            !clientId ||
            !clientSecret ||
            !redirectUri
        ) {
            console.error(
                "EPIC CALLBACK: Configuration invalid.",
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

        const tokenResponse =
            await fetch(
                EPIC_TOKEN_URL,
                {
                    method:
                        "POST",
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

        if (
            !tokenResponse.ok
        ) {
            const tokenError =
                await tokenResponse.text();

            console.error(
                "EPIC CALLBACK: Token exchange failed.",
                {
                    debugId,
                    status:
                        tokenResponse.status,
                    response:
                        limitMessage(
                            tokenError
                        )
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

        const tokenAccountId =
            typeof tokenData.account_id === "string"
                ? tokenData.account_id.trim()
                : "";

        const accessToken =
            typeof tokenData.access_token === "string"
                ? tokenData.access_token.trim()
                : "";

        const EpicTokenExpiresIn =
            Number.isFinite(
                Number(
                    tokenData.expires_in
                )
            )
                ? Number(
                    tokenData.expires_in
                )
                : null;

        if (
            !accessToken
        ) {
            console.error(
                "EPIC CALLBACK: Access token missing.",
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
                    method:
                        "GET",
                    headers: {
                        "Authorization":
                            `Bearer ${accessToken}`,
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (
            !profileResponse.ok
        ) {
            const profileError =
                await profileResponse.text();

            console.error(
                "EPIC CALLBACK: Profile request failed.",
                {
                    debugId,
                    status:
                        profileResponse.status,
                    response:
                        limitMessage(
                            profileError
                        )
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

        const EpicUniqueId =
            (
                typeof profile?.id === "string"
                    ? profile.id
                    : typeof profile?.sub === "string"
                        ? profile.sub
                        : tokenAccountId
            ).trim();

        const EpicDisplayName =
            (
                typeof profile?.displayName === "string"
                    ? profile.displayName
                    : typeof profile?.preferred_username === "string"
                        ? profile.preferred_username
                        : ""
            ).trim();

        const EpicPreferredUsername =
            typeof profile?.preferred_username === "string"
                ? profile.preferred_username.trim()
                : null;

        if (
            !EpicUniqueId
        ) {
            console.error(
                "EPIC CALLBACK: Valid Epic identity missing.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Epic authentication returned no account identity.",
                    debugId
                },
                502
            );
        }

        if (
            !env.AUTH_SESSIONS
        ) {
            console.error(
                "EPIC CALLBACK: Session storage unavailable.",
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

        const existingSessionId =
            getCookie(
                request,
                AUTH_SESSION_COOKIE
            );

        if (
            existingSessionId
            && env.AUTH_SESSIONS
        ) {
            try {
                await env.AUTH_SESSIONS.delete(
                    `session:${existingSessionId}`
                );
            }
            catch (
                error
            ) {
                console.warn(
                    "EPIC CALLBACK: Existing session cleanup failed.",
                    {
                        debugId,
                        message:
                            error?.message
                            || "Unknown error"
                    }
                );
            }
        }

        const sessionId =
            crypto.randomUUID();

        const sessionKey =
            `session:${sessionId}`;

        const now =
            Date.now();

        const sessionData = {
            EpicUniqueId,

            EpicDisplayName:
                EpicDisplayName ||
                null,

            EpicPreferredUsername,

            EpicTokenExpiresIn,

            AuthenticatedAt:
                now,

            LastSeenAt:
                now,

            AbsoluteExpiresAt:
                now +
                (
                    SESSION_ABSOLUTE_TTL_SECONDS *
                    1000
                ),

            EpicStatus:
                "Unknown",

            EpicStatusUpdatedAt:
                null
        };

        await env.AUTH_SESSIONS.put(
            sessionKey,
            JSON.stringify(
                sessionData
            ),
            {
                expirationTtl:
                    SESSION_IDLE_TTL_SECONDS
            }
        );

        const cookie =
            createCookie(
                request,
                AUTH_SESSION_COOKIE,
                sessionId,
                SESSION_ABSOLUTE_TTL_SECONDS
            );

        if (
            !cookie
        ) {
            await env.AUTH_SESSIONS.delete(
                sessionKey
            );

            console.error(
                "EPIC CALLBACK: Session cookie creation failed.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    message:
                        "Failed to create login session.",
                    debugId
                },
                500
            );
        }

        try {
            await handleRocketLeagueSignin(
                env,
                {
                    EpicUniqueId:
                        sessionData.EpicUniqueId,

                    EpicDisplayName:
                        sessionData.EpicDisplayName,

                    EpicPreferredUsername:
                        sessionData.EpicPreferredUsername
                }
            );

        } catch (
            error
        ) {
            console.error(
                "EPIC CALLBACK: Supabase profile sync failed.",
                {
                    debugId,
                    name:
                        error?.name ||
                        "Error",
                    message:
                        error?.message ||
                        "Unknown error"
                }
            );
        }

        return redirect(
            "/RocketLeague",
            [
                cookie
            ]
        );

    } catch (
        error
    ) {
        console.error(
            "EPIC CALLBACK: Unexpected failure.",
            {
                debugId,
                name:
                    error?.name ||
                    "Error",
                message:
                    error?.message ||
                    "Unknown error"
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