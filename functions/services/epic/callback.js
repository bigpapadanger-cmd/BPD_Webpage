"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH CALLBACK

Purpose:
    Completes the Epic Games OAuth login flow, creates the
    authenticated BPD KV session, then synchronizes the Epic
    identity with Supabase.

Flow:
    Epic redirects back with code + state
        ↓
    Validate OAuth state
        ↓
    Exchange authorization code for Epic access token
        ↓
    Fetch Epic account profile
        ↓
    Create BPD KV session
        ↓
    Create browser session cookie
        ↓
    Synchronize Epic identity with Supabase
        ↓
    Redirect to /RocketLeague

Important:
    - Epic/KV authentication remains authoritative for the
      browser login session.
    - Supabase synchronization is intentionally separate.
    - A Supabase sync failure must NOT destroy an otherwise
      valid Epic login.
    - handleRocketLeagueSignin() catches normal Supabase
      failures and returns profileLoaded:false rather than
      necessarily throwing.
    - Therefore this callback MUST inspect the returned
      signin result instead of relying only on catch().
    - Epic access tokens and secrets must never be logged.
========================================================= */

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

/* =========================================================
LOG MESSAGE LIMITER
========================================================= */

function limitMessage(
    value
) {
    return String(
        value ||
        ""
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

/* =========================================================
MAIN EPIC CALLBACK
========================================================= */

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
        /* =================================================
        VALIDATE CALLBACK PARAMETERS
        ================================================= */

        if (
            !code ||
            !state
        ) {
            console.error(
                "EPIC CALLBACK: OAuth parameters missing.",
                {
                    debugId,

                    hasCode:
                        Boolean(
                            code
                        ),

                    hasState:
                        Boolean(
                            state
                        ),

                    hasOAuthError:
                        url.searchParams.has(
                            "error"
                        )
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Missing OAuth parameters.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        VALIDATE OAUTH STATE
        ================================================= */

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
                    success:
                        false,

                    message:
                        "Invalid OAuth state.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        VALIDATE EPIC CONFIGURATION
        ================================================= */

        const clientId =
            typeof env.EPIC_CLIENT_ID ===
                "string"
                ? env.EPIC_CLIENT_ID.trim()
                : "";

        const clientSecret =
            typeof env.EPIC_CLIENT_SECRET ===
                "string"
                ? env.EPIC_CLIENT_SECRET.trim()
                : "";

        const redirectUri =
            typeof env.EPIC_REDIRECT_URI ===
                "string"
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
                        Boolean(
                            clientId
                        ),

                    hasClientSecret:
                        Boolean(
                            clientSecret
                        ),

                    hasRedirectUri:
                        Boolean(
                            redirectUri
                        )
                }
            );

            return json(
                {
                    success:
                        false,

                    message:
                        "Epic callback configuration invalid.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        EXCHANGE AUTHORIZATION CODE
        ================================================= */

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
                    success:
                        false,

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
            typeof tokenData.account_id ===
                "string"
                ? tokenData.account_id.trim()
                : "";

        const accessToken =
            typeof tokenData.access_token ===
                "string"
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
                    success:
                        false,

                    message:
                        "Epic returned no access token.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        LOAD EPIC PROFILE
        ================================================= */

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
                    success:
                        false,

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

        /* =================================================
        NORMALIZE EPIC IDENTITY
        ================================================= */

        const EpicUniqueId =
            (
                typeof profile?.id ===
                    "string"
                    ? profile.id

                    : typeof profile?.sub ===
                        "string"
                        ? profile.sub

                        : tokenAccountId
            ).trim();

        const EpicDisplayName =
            (
                typeof profile?.displayName ===
                    "string"
                    ? profile.displayName

                    : typeof profile?.preferred_username ===
                        "string"
                        ? profile.preferred_username

                        : ""
            ).trim();

        const EpicPreferredUsername =
            typeof profile?.preferred_username ===
                "string"
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
                    success:
                        false,

                    message:
                        "Epic authentication returned no account identity.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        VALIDATE KV SESSION STORAGE
        ================================================= */

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
                    success:
                        false,

                    message:
                        "Session storage is unavailable.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        REMOVE PREVIOUS SESSION
        ================================================= */

        const existingSessionId =
            getCookie(
                request,
                AUTH_SESSION_COOKIE
            );

        if (
            existingSessionId
        ) {
            try {
                await env.AUTH_SESSIONS.delete(
                    `session:${existingSessionId}`
                );
            } catch (
                error
            ) {
                console.warn(
                    "EPIC CALLBACK: Existing session cleanup failed.",
                    {
                        debugId,

                        message:
                            error?.message ||
                            "Unknown error"
                    }
                );
            }
        }

        /* =================================================
        CREATE NEW KV SESSION
        ================================================= */

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

        /* =================================================
        CREATE SESSION COOKIE
        ================================================= */

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
                    success:
                        false,

                    message:
                        "Failed to create login session.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        SYNC EPIC IDENTITY TO SUPABASE

        IMPORTANT:
            handleRocketLeagueSignin() intentionally catches
            normal Supabase failures and returns
            profileLoaded:false.

            Therefore we must inspect the returned result.
        ================================================= */

        try {
            const signinResult =
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

            if (
                signinResult?.profileLoaded ===
                true
            ) {
                console.info(
                    "EPIC CALLBACK: Supabase profile sync completed.",
                    {
                        debugId,

                        hasUserId:
                            Boolean(
                                signinResult.userId
                            ),

                        hasRlPlayerId:
                            Boolean(
                                signinResult.rlPlayerId
                            ),

                        role:
                            signinResult.role ||
                            null,

                        active:
                            signinResult.active ===
                            true,

                        profileComplete:
                            signinResult.profileComplete ===
                            true,

                        rocketLeagueAccess:
                            signinResult.rocketLeagueAccess ===
                            true
                    }
                );
            } else {
                console.warn(
                    "EPIC CALLBACK: Epic login succeeded but Supabase profile sync did not complete.",
                    {
                        debugId,

                        profileLoaded:
                            false,

                        warning:
                            signinResult?.warning ||
                            null
                    }
                );
            }
        } catch (
            error
        ) {
            /*
             * An unexpected Supabase sync exception should
             * be logged but must not invalidate the already
             * successful Epic/KV login.
             */
            console.error(
                "EPIC CALLBACK: Supabase profile sync failed unexpectedly.",
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
        }

        /* =================================================
        COMPLETE LOGIN

        At this point Epic authentication + KV session are
        valid even if Supabase synchronization failed.
        ================================================= */

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
                    "Unknown error",

                stack:
                    error?.stack ||
                    null
            }
        );

        return json(
            {
                success:
                    false,

                message:
                    "Epic callback failed unexpectedly.",

                debugId
            },
            500
        );
    }
}