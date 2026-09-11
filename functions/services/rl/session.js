"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SESSION SERVICE

Purpose:
    Validates the current Epic/KV session and then loads the
    linked Rocket League profile from Supabase.

Flow:
    Browser request
        ↓
    getStoredSession()
        ↓
    Valid Epic session?
        ↓
    getRocketLeagueProfileByEpicId()
        ↓
    Return combined authentication + profile state

Important:
    - KV remains authoritative for whether the Epic session
      is authenticated.
    - Supabase is authoritative for profile identity,
      registration state, role, active status, and Rocket
      League access.
    - A Supabase failure must NOT automatically invalidate
      the Epic login.
    - profileLoaded is only true when Supabase returns both
      a valid BPD user ID and Rocket League player ID.
========================================================= */

import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";

import {
    getRocketLeagueProfileByEpicId
} from "../supabase/rocketleague/rocketleague_profile.js";

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    data,
    status = 200
) {
    return new Response(
        JSON.stringify(
            data
        ),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}

/* =========================================================
NORMALIZE PROFILE STATE
========================================================= */

function getProfileUserId(
    profile
) {
    return (
        profile?.userId ||
        profile?.user_id ||
        null
    );
}

function getProfileRlPlayerId(
    profile
) {
    return (
        profile?.rlPlayerId ||
        profile?.rl_player_id ||
        null
    );
}

function getProfileComplete(
    profile
) {
    return (
        profile?.profileComplete === true ||
        profile?.profile_complete === true
    );
}

function getRocketLeagueAccess(
    profile
) {
    return (
        profile?.rocketLeagueAccess === true ||
        profile?.rocket_league_access === true
    );
}

/* =========================================================
MAIN SESSION HANDLER
========================================================= */

export async function handleRocketLeagueSession(
    request,
    env
) {
    console.log(
        "[RL SESSION HANDLER HIT]",
        {
            method:
                request.method,

            url:
                request.url
        }
    );

    try {
        const session =
            await getStoredSession(
                request,
                env
            );

        if (!session) {
            console.log(
                "[RL SESSION NO KV SESSION]"
            );

            return jsonResponse({
                success:
                    true,

                authenticated:
                    false,

                requiresEpicLogin:
                    true,

                user:
                    null,

                profileLoaded:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                profileError:
                    null
            });
        }

        const sessionData =
            session.sessionData ||
            {};

        const epicUser = {
            EpicUniqueId:
                sessionData.EpicUniqueId ||
                null,

            EpicDisplayName:
                sessionData.EpicDisplayName ||
                null,

            EpicPreferredUsername:
                sessionData.EpicPreferredUsername ||
                null
        };

        if (!epicUser.EpicUniqueId) {
            console.warn(
                "[RL SESSION INVALID KV IDENTITY]"
            );

            return jsonResponse({
                success:
                    true,

                authenticated:
                    false,

                requiresEpicLogin:
                    true,

                user:
                    null,

                profileLoaded:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                profileError:
                    null
            });
        }

        console.log(
            "[RL SESSION KV AUTH OK]",
            {
                epicAccountPresent:
                    true
            }
        );

        let profile =
            null;

        let profileLoaded =
            false;

        let profileError =
            null;

        try {
            console.log(
                "[RL SESSION SUPABASE PROFILE LOOKUP START]"
            );

            profile =
                await getRocketLeagueProfileByEpicId(
                    env,
                    epicUser.EpicUniqueId
                );

            const userId =
                getProfileUserId(
                    profile
                );

            const rlPlayerId =
                getProfileRlPlayerId(
                    profile
                );

            profileLoaded =
                Boolean(
                    profile &&
                    userId &&
                    rlPlayerId
                );

            console.log(
                "[RL SESSION SUPABASE PROFILE LOOKUP COMPLETE]",
                {
                    profileReturned:
                        Boolean(
                            profile
                        ),

                    profileLoaded,

                    hasUserId:
                        Boolean(
                            userId
                        ),

                    hasRlPlayerId:
                        Boolean(
                            rlPlayerId
                        )
                }
            );
        } catch (
            error
        ) {
            profileError =
                error?.message ||
                "Profile data is temporarily unavailable.";

            console.error(
                "[RL SESSION SUPABASE PROFILE LOOKUP FAILED]",
                {
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

        const userId =
            getProfileUserId(
                profile
            );

        const rlPlayerId =
            getProfileRlPlayerId(
                profile
            );

        const role =
            profile?.role ||
            null;

        const active =
            profile?.active ===
            true;

        const profileComplete =
            getProfileComplete(
                profile
            );

        const rocketLeagueAccess =
            getRocketLeagueAccess(
                profile
            );

        const user = {
            EpicUniqueId:
                epicUser.EpicUniqueId,

            EpicDisplayName:
                epicUser.EpicDisplayName,

            EpicPreferredUsername:
                epicUser.EpicPreferredUsername,

            userId,

            rlPlayerId,

            role,

            active
        };

        console.log(
            "[RL SESSION RESPONSE]",
            {
                authenticated:
                    true,

                profileLoaded,

                profileComplete,

                rocketLeagueAccess,

                hasUserId:
                    Boolean(
                        userId
                    ),

                hasRlPlayerId:
                    Boolean(
                        rlPlayerId
                    )
            }
        );

        return jsonResponse({
            success:
                true,

            authenticated:
                true,

            requiresEpicLogin:
                false,

            user,

            profileLoaded,

            profileComplete,

            rocketLeagueAccess,

            profileError
        });
    } catch (
        error
    ) {
        console.error(
            "[RL SESSION UNEXPECTED FAILURE]",
            {
                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error",

                stack:
                    error?.stack ||
                    null,

                method:
                    request.method,

                url:
                    request.url
            }
        );

        return jsonResponse(
            {
                success:
                    false,

                authenticated:
                    false,

                requiresEpicLogin:
                    false,

                user:
                    null,

                profileLoaded:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                profileError:
                    null,

                message:
                    "Authentication service is temporarily unavailable."
            },
            500
        );
    }
}