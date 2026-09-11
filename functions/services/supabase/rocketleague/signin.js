"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SIGN-IN SYNC

Purpose:
    Synchronizes a successfully authenticated Epic Games
    account with the BPD Gaming Network Supabase profile
    system.

Flow:
    Epic OAuth callback succeeds
        ↓
    Cloudflare creates/updates the Epic KV session
        ↓
    handleRocketLeagueSignin()
        ↓
    callSupabaseSignin()
        ↓
    Supabase RPC:
        api.rocketleague_signin
        ↓
    Supabase creates or updates:
        - global BPD user identity
        - Rocket League player identity
        - Epic linked account
        - current Epic alias
        - registration state

Important:
    - Epic authentication is already complete before this
      file runs.
    - Supabase does NOT determine whether the Epic browser
      session is valid.
    - Failure to sync Supabase must NOT invalidate the Epic
      login/session.
    - EpicUniqueId comes from the trusted authenticated Epic
      session data, not from browser-submitted JSON.
    - The browser never receives the Supabase secret.
    - This file does not save registration form data.
    - Registration/profile updates are handled separately by
      saveRocketLeagueProfile().
    - Rocket League access returned here comes from Supabase
      and should not be independently recalculated here.

handleRocketLeagueSignin():
    Wraps the Supabase sync so that an Epic login can still
    succeed if Supabase is temporarily unavailable.

callSupabaseSignin():
    Performs the actual server-side call to:
        api.rocketleague_signin

Supabase RPC inputs:
    epic_unique_id
    epic_display_name
    epic_preferred_username

Supabase RPC returns:
    user_id
    rl_player_id
    role
    active
    profile_complete
    rocket_league_access
    registration_status
    epic_account_id
    epic_display_name

Failure behavior:
    - Configuration or RPC errors throw inside
      callSupabaseSignin().
    - handleRocketLeagueSignin() catches those errors.
    - Epic authentication remains successful.
    - profileLoaded is returned as false so downstream code
      knows BPD profile data could not be loaded.
========================================================= */
export async function handleRocketLeagueSignin(
    env,
    sessionData
) {
    try {
        const result =
            await callSupabaseSignin(
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

        return {
            success: true,

            profileLoaded: true,

            userId:
                result.user_id ||
                null,

            rlPlayerId:
                result.rl_player_id ||
                null,

            role:
                result.role ||
                "user",

            active:
                result.active === true,

            profileComplete:
                result.profile_complete === true,

            rocketLeagueAccess:
                result.rocket_league_access === true,

            profile:
                result,

            warning:
                null
        };
    } catch (
        error
    ) {
        console.error(
            "[ROCKET LEAGUE PROFILE] Supabase signin failed:",
            error
        );

        return {
            success: true,

            profileLoaded: false,

            userId:
                null,

            rlPlayerId:
                null,

            role:
                null,

            active:
                null,

            profileComplete:
                false,

            rocketLeagueAccess:
                false,

            profile:
                null,

            warning:
                "Your Epic account is authenticated, but your BPD Gaming Network profile could not be loaded."
        };
    }
}

export async function callSupabaseSignin(
    env,
    epicData
) {
    if (
        !env.SUPABASE_URL
    ) {
        throw new Error(
            "SUPABASE_URL is not configured."
        );
    }

    if (
        !env.SUPABASE_AUTH
    ) {
        throw new Error(
            "SUPABASE_AUTH is not configured."
        );
    }

    if (
        !epicData?.EpicUniqueId
    ) {
        throw new Error(
            "EpicUniqueId is required."
        );
    }

    const response =
        await fetch(
            `${env.SUPABASE_URL}rpc/rocketleague_signin`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        env.SUPABASE_AUTH,

                    "Content-Type":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        epic_unique_id:
                            epicData.EpicUniqueId,

                        epic_display_name:
                            epicData.EpicDisplayName ||
                            null,

                        epic_preferred_username:
                            epicData.EpicPreferredUsername ||
                            null
                    })
            }
        );

    const responseText =
        await response.text();

    let responseData =
        null;

    if (
        responseText
    ) {
        try {
            responseData =
                JSON.parse(
                    responseText
                );
        } catch {
            responseData =
                responseText;
        }
    }

    if (
        !response.ok
    ) {
        console.error(
            "[ROCKET LEAGUE SIGNIN] Supabase signin failed:",
            {
                status:
                    response.status,

                statusText:
                    response.statusText,

                response:
                    responseData
            }
        );

        throw new Error(
            responseData?.message ||
            responseData?.error ||
            `Supabase signin failed: ${response.status}`
        );
    }

    if (
        Array.isArray(
            responseData
        )
    ) {
        return (
            responseData[0] ||
            {}
        );
    }

    return (
        responseData ||
        {}
    );
}