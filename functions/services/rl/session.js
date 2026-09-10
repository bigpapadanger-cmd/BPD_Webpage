import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";

import {
    getRocketLeagueProfileByEpicId
} from "../supabase/rocketleague/rocketleague_profile.js";

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

        if (
            !session
        ) {
            return jsonResponse({
                success: true,
                authenticated: false,
                requiresEpicLogin: true,
                user: null,
                profileLoaded: false,
                profileComplete: false,
                rocketLeagueAccess: false,
                profileError: null
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

        if (
            !epicUser.EpicUniqueId
        ) {
            return jsonResponse({
                success: true,
                authenticated: false,
                requiresEpicLogin: true,
                user: null,
                profileLoaded: false,
                profileComplete: false,
                rocketLeagueAccess: false,
                profileError: null
            });
        }

        let profile =
            null;

        let profileLoaded =
            false;

        let profileError =
            null;

        try {
            profile =
                await getRocketLeagueProfileByEpicId(
                    env,
                    epicUser.EpicUniqueId
                );

            profileLoaded =
                profile !== null &&
                profile !== undefined;
        } catch (
            error
        ) {
            profileError =
                error?.message ||
                "Profile data is temporarily unavailable.";

            console.error(
                "ROCKET LEAGUE SESSION: Profile lookup failed.",
                error
            );
        }

        const userId =
            profile?.user_id ||
            null;

        const rlPlayerId =
            profile?.rl_player_id ||
            null;

        const role =
            profile?.role ||
            null;

        const active =
            profile?.active === true;

        const profileComplete =
            profile?.profileComplete === true;

        const rocketLeagueAccess =
            profile?.rocketLeagueAccess === true;

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
            success: true,
            authenticated: true,
            requiresEpicLogin: false,
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
            error
        );

        return jsonResponse(
            {
                success: false,
                authenticated: false,
                requiresEpicLogin: false,
                user: null,
                profileLoaded: false,
                profileComplete: false,
                rocketLeagueAccess: false,
                profileError: null,
                message:
                    "Authentication service is temporarily unavailable."
            },
            500
        );
    }
}