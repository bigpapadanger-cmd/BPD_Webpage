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
// CONSTANTS
// ============================================================

const ALLOWED_CONTACT_METHODS = [
    "email",
    "phone",
    "both"
];

const ALLOWED_MODES = [
    "1s",
    "2s",
    "3s",
    "customs",
    "other"
];

const ALLOWED_REMINDER_MODES = [
    "24-hours",
    "1-hour",
    "both",
    "specific-times"
];

const ALLOWED_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
];

const AVAILABILITY_START =
    "17:00";

const AVAILABILITY_END =
    "23:00";

// ============================================================
// CLOUDFLARE LOCATION
// ============================================================

function getRequestLocation(
    request
) {
    const headers =
        request.headers;

    const cf =
        request.cf &&
        typeof request.cf === "object"
            ? request.cf
            : {};

    const countryCode =
        String(
            headers.get(
                "cf-ipcountry"
            ) ||
            cf.country ||
            ""
        ).trim();

    return {
        city:
            String(
                headers.get(
                    "cf-ipcity"
                ) ||
                cf.city ||
                ""
            ).trim(),

        region:
            String(
                headers.get(
                    "cf-region"
                ) ||
                cf.region ||
                ""
            ).trim(),

        country:
            countryCode,

        countryCode,

        timezone:
            String(
                headers.get(
                    "cf-timezone"
                ) ||
                cf.timezone ||
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
    return {
        EpicUniqueId:
            String(
                sessionData?.EpicUniqueId ||
                ""
            ).trim(),

        EpicDisplayName:
            String(
                sessionData?.EpicDisplayName ||
                ""
            ).trim(),

        EpicPreferredUsername:
            String(
                sessionData?.EpicPreferredUsername ||
                ""
            ).trim()
    };
}

// ============================================================
// NORMALIZATION HELPERS
// ============================================================

function normalizeBoolean(
    value,
    fallback = false
) {
    if (
        value === true ||
        value === false
    ) {
        return value;
    }

    return fallback;
}

function normalizeString(
    value,
    maxLength = 255
) {
    return String(
        value ||
        ""
    )
        .trim()
        .slice(
            0,
            maxLength
        );
}

function normalizeStringArray(
    value,
    maxItems = 100
) {
    if (
        !Array.isArray(
            value
        )
    ) {
        return [];
    }

    return value
        .map(
            (item) =>
                normalizeString(
                    item,
                    50
                )
        )
        .filter(
            Boolean
        )
        .slice(
            0,
            maxItems
        );
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

    const notificationsEnabled =
        databaseProfile.notificationsEnabled ===
        true ||
        databaseProfile.notifications_enabled ===
        true ||
        databaseProfile.matchReminders ===
        true ||
        databaseProfile.match_reminders ===
        true;

    const reminderMode =
        databaseProfile.reminderMode ||
        databaseProfile.reminder_mode ||
        databaseProfile.reminderTiming ||
        databaseProfile.reminder_timing ||
        "24-hours";

    const specificReminderTimes =
        Array.isArray(
            databaseProfile.specificReminderTimes
        )
            ? databaseProfile.specificReminderTimes
            : Array.isArray(
                databaseProfile.specific_reminder_times
            )
                ? databaseProfile.specific_reminder_times
                : Array.isArray(
                    databaseProfile.reminderSchedule
                )
                    ? databaseProfile.reminderSchedule
                    : Array.isArray(
                        databaseProfile.reminder_schedule
                    )
                        ? databaseProfile.reminder_schedule
                        : [];

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
            databaseProfile.display_name ||
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

        notificationsEnabled,

        reminderMode,

        specificReminderTimes,

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

        notificationsEnabled:
            true,

        reminderMode:
            "24-hours",

        specificReminderTimes:
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
// REGISTRATION PAYLOAD
// ============================================================

function normalizeAvailability(
    availability
) {
    if (
        !Array.isArray(
            availability
        )
    ) {
        return [];
    }

    return availability
        .map(
            (item) => ({
                day:
                    normalizeString(
                        item?.day,
                        12
                    )
                        .toLowerCase(),

                start:
                    normalizeString(
                        item?.start,
                        5
                    ),

                end:
                    normalizeString(
                        item?.end,
                        5
                    )
            })
        )
        .filter(
            (item) =>
                ALLOWED_DAYS.includes(
                    item.day
                )
        )
        .slice(
            0,
            7
        );
}

function normalizeRegistrationPayload(
    body
) {
    const notificationsEnabled =
        normalizeBoolean(
            body?.notificationsEnabled,
            true
        );

    return {
        ageConsent:
            normalizeBoolean(
                body?.ageConsent
            ),

        displayName:
            normalizeString(
                body?.displayName,
                32
            ),

        currentRank:
            normalizeString(
                body?.currentRank,
                50
            ),

        showOnlineStatus:
            normalizeBoolean(
                body?.showOnlineStatus
            ),

        contactMethod:
            normalizeString(
                body?.contactMethod,
                10
            ),

        email:
            normalizeString(
                body?.email,
                254
            ),

        phone:
            normalizeString(
                body?.phone,
                24
            ),

        preferredMode:
            normalizeString(
                body?.preferredMode,
                20
            ),

        otherMode:
            normalizeString(
                body?.otherMode,
                50
            ),

        timezone:
            normalizeString(
                body?.timezone,
                100
            ),

        availability:
            normalizeAvailability(
                body?.availability
            ),

        notificationsEnabled,

        reminderMode:
            notificationsEnabled
                ? normalizeString(
                    body?.reminderMode ||
                    "24-hours",
                    30
                )
                : null,

        specificReminderTimes:
            notificationsEnabled
                ? normalizeStringArray(
                    body?.specificReminderTimes,
                    48
                )
                : []
    };
}

function validateRegistrationPayload(
    profile
) {
    if (
        profile.ageConsent !== true
    ) {
        return (
            "Eligibility confirmation is required."
        );
    }

    if (
        !profile.displayName
    ) {
        return (
            "Display name is required."
        );
    }

    if (
        !profile.currentRank
    ) {
        return (
            "Current rank is required."
        );
    }

    if (
        !ALLOWED_CONTACT_METHODS.includes(
            profile.contactMethod
        )
    ) {
        return (
            "Select a valid contact method."
        );
    }

    if (
        (
            profile.contactMethod ===
                "email" ||
            profile.contactMethod ===
                "both"
        ) &&
        !profile.email
    ) {
        return (
            "Email address is required."
        );
    }

    if (
        (
            profile.contactMethod ===
                "phone" ||
            profile.contactMethod ===
                "both"
        ) &&
        !profile.phone
    ) {
        return (
            "Phone number is required."
        );
    }

    if (
        !ALLOWED_MODES.includes(
            profile.preferredMode
        )
    ) {
        return (
            "Select a valid preferred mode."
        );
    }

    if (
        profile.preferredMode ===
            "other" &&
        !profile.otherMode
    ) {
        return (
            "Describe your preferred mode."
        );
    }

    if (
        profile.availability.length ===
        0
    ) {
        return (
            "Select at least one day when you are available."
        );
    }

    const invalidAvailability =
        profile.availability.some(
            (item) =>
                item.start <
                    AVAILABILITY_START ||
                item.start >
                    AVAILABILITY_END ||
                item.end <
                    AVAILABILITY_START ||
                item.end >
                    AVAILABILITY_END ||
                item.start >=
                    item.end
        );

    if (
        invalidAvailability
    ) {
        return (
            "Availability must be between 5:00 PM and 11:00 PM, with the end time later than the start time."
        );
    }

    if (
        profile.notificationsEnabled &&
        !ALLOWED_REMINDER_MODES.includes(
            profile.reminderMode
        )
    ) {
        return (
            "Select a valid reminder preference."
        );
    }

    if (
        profile.notificationsEnabled &&
        profile.reminderMode ===
            "specific-times" &&
        profile.specificReminderTimes.length ===
            0
    ) {
        return (
            "Select at least one specific reminder time."
        );
    }

    return null;
}

// ============================================================
// AUTHENTICATED SESSION
// ============================================================

async function getAuthenticatedContext(
    request,
    env
) {
    const storedSession =
        await getStoredSession(
            request,
            env
        );

    if (!storedSession) {
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            false,

                        message:
                            "Login is required to access Rocket League profile."
                    },
                    401
                )
        };
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
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            true,

                        message:
                            "Epic account identity is missing from the session."
                    },
                    400
                )
        };
    }

    return {
        storedSession,
        epicUser
    };
}

// ============================================================
// GET PROFILE
// ============================================================

async function handleProfileGet(
    request,
    env,
    epicUser
) {
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
                + "but permanent BPD profile data is not currently available."
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

    if (!databaseProfile) {
        profileLoaded =
            false;
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

            profileSaved:
                Boolean(
                    databaseProfile
                ),

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
}

// ============================================================
// POST REGISTRATION
// ============================================================

async function handleProfilePost(
    request,
    epicUser
) {
    let body;

    try {
        body =
            await request.json();

    } catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Registration JSON invalid.",
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
                    true,

                profileSaved:
                    false,

                profileComplete:
                    false,

                message:
                    "Registration data was invalid."
            },
            400
        );
    }

    const registration =
        normalizeRegistrationPayload(
            body
        );

    const validationError =
        validateRegistrationPayload(
            registration
        );

    if (
        validationError
    ) {
        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                profileSaved:
                    false,

                profileComplete:
                    false,

                message:
                    validationError
            },
            400
        );
    }

    /*
     * TEMPORARY:
     *
     * The submitted registration has been validated,
     * but permanent Supabase profile persistence has
     * not been enabled yet.
     *
     * Do not report profileSaved=true until the
     * Supabase write succeeds.
     */

    return json(
        {
            success: true,
            authenticated: true,

            registrationAccepted: true,

            profileSaved: false,
            profileComplete: false,
            persistenceAvailable: false,

            message:
                "Your registration was received, but permanent profile saving is not available yet.",

            redirectTo:
                "/RocketLeague"
        },
        200
    );
}

// ============================================================
// MAIN PROFILE HANDLER
// ============================================================

export async function handleRocketLeagueProfile(
    request,
    env
) {
    try {
        const authenticated =
            await getAuthenticatedContext(
                request,
                env
            );

        if (
            authenticated.error
        ) {
            return authenticated.error;
        }

        const epicUser =
            authenticated.epicUser;

        if (
            request.method ===
            "GET"
        ) {
            return handleProfileGet(
                request,
                env,
                epicUser
            );
        }

        if (
            request.method ===
            "POST"
        ) {
            return handleProfilePost(
                request,
                epicUser
            );
        }

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                message:
                    "Method not allowed."
            },
            405,
            {
                "Allow":
                    "GET, POST"
            }
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

                profileSaved:
                    false,

                profileComplete:
                    false,

                message:
                    "Rocket League profile request failed."
            },
            500
        );
    }
}