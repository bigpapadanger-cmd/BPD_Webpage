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
    try {
        const session =
            await getStoredSession(
                request,
                env
            );

        /*
         * No valid KV session means the user needs to
         * authenticate with Epic again.
         */
        if (!session) {
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

        /*
         * A stored session without the Epic account ID is
         * incomplete and cannot be trusted for RL identity.
         */
        if (!epicUser.EpicUniqueId) {
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

        let profile =
            null;

        let profileLoaded =
            false;

        let profileError =
            null;

        /*
         * Load the persisted Supabase profile.
         *
         * Failure here does not invalidate the Epic session.
         */
        try {
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

            /*
             * Treat the profile as successfully loaded only
             * when Supabase returned both identities.
             */
            profileLoaded =
                Boolean(
                    profile &&
                    userId &&
                    rlPlayerId
                );
        } catch (
            error
        ) {
            profileError =
                error?.message ||
                "Profile data is temporarily unavailable.";

            console.error(
                "ROCKET LEAGUE SESSION: Profile lookup failed.",
                {
                    name:
                        error?.name ||
                        "Error",

                    message:
                        error?.message ||
                        "Unknown error"
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
            profile?.active === true;

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
            "ROCKET LEAGUE SESSION: Session lookup failed.",
            {
                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error"
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