import {
    json
} from "../common_helpers/responses.js";
import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";
import {
    getRocketLeagueProfileByEpicId
} from "../supabase/rl/rocketleague_profile.js";

export async function handleRocketLeagueProfile(
    request,
    env
) {
    try {
        const storedSession =
            await getStoredSession(
                request,
                env
            );

        if (!storedSession) {
            return json(
                {
                    success: false,
                    authenticated: false,
                    message:
                        "Login is required to load Rocket League profile."
                },
                401
            );
        }

        const sessionData =
            storedSession.sessionData || {};

        const EpicUniqueId =
            String(
                sessionData.EpicUniqueId ||
                ""
            ).trim();

        const EpicDisplayName =
            String(
                sessionData.EpicDisplayName ||
                sessionData.EpicPreferredUsername ||
                ""
            ).trim();

        if (!EpicUniqueId) {
            return json(
                {
                    success: false,
                    authenticated: true,
                    message:
                        "Epic account identity is missing from the session."
                },
                400
            );
        }

        const databaseProfile =
            await getRocketLeagueProfileByEpicId(
                env,
                EpicUniqueId
            );

        if (!databaseProfile) {
            return json(
                {
                    success: true,
                    authenticated: true,
                    profileComplete: false,
                    profile: {
                        username:
                            EpicDisplayName ||
                            "Epic Player",
                        stats: {
                            ranked: {}
                        }
                    }
                },
                200
            );
        }

        return json(
            {
                success: true,
                authenticated: true,
                profileComplete:
                    databaseProfile.profileComplete ===
                    true,
                profile: {
                    username:
                        databaseProfile.displayName ||
                        EpicDisplayName ||
                        "Epic Player",
                    stats: {
                        ranked:
                            databaseProfile.ranked ||
                            {}
                    }
                }
            },
            200
        );

    } catch (error) {
        console.error(
            "ROCKET LEAGUE PROFILE: Unexpected failure.",
            {
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
                authenticated: true,
                message:
                    "Rocket League profile failed to load."
            },
            500
        );
    }
}