import {
    json
} from "../common_helpers/responses.js";

import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";

import {
    getRocketLeagueProfileByEpicId
} from "../supabase/rocketleague/rocketleague_profile.js";


// ============================================================
// CLOUDFLARE LOCATION
// ============================================================

function getRequestLocation(
    request
) {
    const headers =
        request.headers;

    return {
        city:
            String(
                headers.get(
                    "cf-ipcity"
                ) ||
                ""
            ).trim(),

        region:
            String(
                headers.get(
                    "cf-region"
                ) ||
                ""
            ).trim(),

        country:
            String(
                headers.get(
                    "cf-ipcountry"
                ) ||
                ""
            ).trim(),

        countryCode:
            String(
                headers.get(
                    "cf-ipcountry"
                ) ||
                ""
            ).trim(),

        timezone:
            String(
                headers.get(
                    "cf-timezone"
                ) ||
                ""
            ).trim()
    };
}


// ============================================================
// EPIC USER
// ============================================================

function buildEpicUser(
    sessionData
) {
    const EpicUniqueId =
        String(
            sessionData?.EpicUniqueId ||
            ""
        ).trim();

    const EpicDisplayName =
        String(
            sessionData?.EpicDisplayName ||
            ""
        ).trim();

    const EpicPreferredUsername =
        String(
            sessionData?.EpicPreferredUsername ||
            ""
        ).trim();

    return {
        EpicUniqueId,

        EpicDisplayName,

        EpicPreferredUsername
    };
}


// ============================================================
// NORMALIZE DATABASE PROFILE
// ============================================================

function normalizeDatabaseProfile(
    databaseProfile,
    epicUser
) {
    if (!databaseProfile) {
        return null;
    }

    return {
        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicUser.EpicDisplayName,

        EpicPreferredUsername:
            epicUser.EpicPreferredUsername,

        username:
            databaseProfile.displayName ||
            epicUser.EpicDisplayName ||
            epicUser.EpicPreferredUsername ||
            "Epic Player",

        displayName:
            databaseProfile.displayName ||
            epicUser.EpicDisplayName ||
            epicUser.EpicPreferredUsername ||
            "",

        currentRank:
            databaseProfile.currentRank ||
            databaseProfile.current_rank ||
            "",

        contactMethod:
            databaseProfile.contactMethod ||
            databaseProfile.contact_method ||
            "email",

        email:
            databaseProfile.email ||
            "",

        phone:
            databaseProfile.phone ||
            "",

        preferredMode:
            databaseProfile.preferredMode ||
            databaseProfile.preferred_mode ||
            "",

        otherMode:
            databaseProfile.otherMode ||
            databaseProfile.other_mode ||
            "",

        timezone:
            databaseProfile.timezone ||
            "",

        availability:
            Array.isArray(
                databaseProfile.availability
            )
                ? databaseProfile.availability
                : [],

        showOnlineStatus:
            databaseProfile.showOnlineStatus ===
            true ||
            databaseProfile.show_online_status ===
            true,

        matchReminders:
            databaseProfile.matchReminders ===
            true ||
            databaseProfile.match_reminders ===
            true,

        reminderTiming:
            databaseProfile.reminderTiming ||
            databaseProfile.reminder_timing ||
            null,

        reminderSchedule:
            Array.isArray(
                databaseProfile.reminderSchedule
            )
                ? databaseProfile.reminderSchedule
                : Array.isArray(
                    databaseProfile.reminder_schedule
                )
                    ? databaseProfile.reminder_schedule
                    : [],

        ageConsent:
            databaseProfile.ageConsent ===
            true ||
            databaseProfile.age_consent ===
            true,

        profileComplete:
            databaseProfile.profileComplete ===
            true ||
            databaseProfile.profile_complete ===
            true,

        ranked:
            databaseProfile.ranked ||
            {},

        stats: {
            ranked:
                databaseProfile.ranked ||
                {}
        }
    };
}


// ============================================================
// FALLBACK PROFILE
// ============================================================

function buildFallbackProfile(
    epicUser
) {
    return {
        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicUser.EpicDisplayName,

        EpicPreferredUsername:
            epicUser.EpicPreferredUsername,

        username:
            epicUser.EpicDisplayName ||
            epicUser.EpicPreferredUsername ||
            "Epic Player",

        displayName:
            epicUser.EpicDisplayName ||
            epicUser.EpicPreferredUsername ||
            "",

        currentRank:
            "",

        contactMethod:
            "email",

        email:
            "",

        phone:
            "",

        preferredMode:
            "",

        otherMode:
            "",

        timezone:
            "",

        availability:
            [],

        showOnlineStatus:
            false,

        matchReminders:
            false,

        reminderTiming:
            null,

        reminderSchedule:
            [],

        ageConsent:
            false,

        profileComplete:
            false,

        ranked:
            {},

        stats: {
            ranked:
                {}
        }
    };
}


// ============================================================
// MAIN PROFILE HANDLER
// ============================================================

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
                    success:
                        false,

                    authenticated:
                        false,

                    message:
                        "Login is required to load Rocket League profile."
                },
                401
            );
        }

        const sessionData =
            storedSession.sessionData ||
            {};

        const epicUser =
            buildEpicUser(
                sessionData
            );

        if (
            !epicUser.EpicUniqueId
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    message:
                        "Epic account identity is missing from the session."
                },
                400
            );
        }

        const location =
            getRequestLocation(
                request
            );

        let databaseProfile =
            null;

        let profileLoaded =
            true;

        let warning =
            null;

        try {
            databaseProfile =
                await getRocketLeagueProfileByEpicId(
                    env,
                    epicUser.EpicUniqueId
                );

        } catch (
            error
        ) {
            profileLoaded =
                false;

            warning =
                (
                    "Your Epic account is signed in, "
                    + "but BPD profile data is temporarily unavailable."
                );

            console.error(
                "ROCKET LEAGUE PROFILE: Supabase profile load failed.",
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

        const profile =
            databaseProfile
                ? normalizeDatabaseProfile(
                    databaseProfile,
                    epicUser
                )
                : buildFallbackProfile(
                    epicUser
                );

        return json(
            {
                success:
                    true,

                authenticated:
                    true,

                profileLoaded,

                profileComplete:
                    profile.profileComplete ===
                    true,

                warning,

                user: {
                    EpicDisplayName:
                        epicUser.EpicDisplayName,

                    EpicPreferredUsername:
                        epicUser.EpicPreferredUsername
                },

                location,

                profile
            },
            200
        );

    } catch (
        error
    ) {
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
                success:
                    false,

                authenticated:
                    false,

                message:
                    "Rocket League profile failed to load."
            },
            500
        );
    }
}