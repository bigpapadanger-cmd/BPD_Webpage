"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE SERVICE

Purpose:
    Handles authenticated Rocket League profile GET and POST
    requests.

Trust model:
    - Epic/KV session is authoritative for authentication.
    - Epic identity comes only from the server-side session.
    - Browser-submitted identity/location values are ignored.
    - Supabase is authoritative for persisted profile state,
      registration completion, role, active status, and
      Rocket League access.

GET:
    1. Validate Epic/KV session.
    2. Attempt to load persisted Supabase profile.
    3. If unavailable, return a temporary fallback profile.
    4. Return only coarse location information.

POST:
    1. Validate Epic/KV session.
    2. Normalize only fields needed for registration.
    3. Ignore unrelated browser fields.
    4. Ensure the Supabase user/player identity exists.
    5. Save the Rocket League profile.
    6. Return the authoritative Supabase result.

Privacy:
    - City-level location is intentionally not returned.
    - Browser-supplied location is never saved or forwarded.
    - Only region, country code, and timezone are exposed.
========================================================= */

import {
    json
} from "../common_helpers/responses.js";

import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";

import {
    getRocketLeagueProfileByEpicId
} from "../supabase/rocketleague/rocketleague_profile.js";

import {
    saveRocketLeagueProfile
} from "../supabase/rocketleague/save_profile.js";

import {
    callSupabaseSignin
} from "../supabase/rocketleague/signin.js";

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
// COARSE CLOUDFLARE LOCATION
// ============================================================

function getRequestLocation(
    request
) {
    const headers =
        request.headers;

    const cf =
        request.cf &&
        typeof request.cf ===
            "object"
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
        region:
            String(
                headers.get(
                    "cf-region"
                ) ||
                cf.region ||
                ""
            ).trim(),

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

    const displayName =
        databaseProfile.displayName ||
        databaseProfile.display_name ||
        epicUser.EpicDisplayName ||
        epicUser.EpicPreferredUsername ||
        "";

    const ranked =
        databaseProfile.ranked &&
        typeof databaseProfile.ranked ===
            "object"
            ? databaseProfile.ranked
            : {};

    return {
        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicUser.EpicDisplayName,

        EpicPreferredUsername:
            epicUser.EpicPreferredUsername,

        userId:
            databaseProfile.userId ||
            databaseProfile.user_id ||
            null,

        rlPlayerId:
            databaseProfile.rlPlayerId ||
            databaseProfile.rl_player_id ||
            null,

        role:
            databaseProfile.role ||
            null,

        active:
            databaseProfile.active ===
            true,

        username:
            displayName ||
            "Epic Player",

        displayName,

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
            databaseProfile.displayTimezone ||
            databaseProfile.display_timezone ||
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

        notificationsEnabled:
            databaseProfile.notificationsEnabled ===
                true ||
            databaseProfile.notifications_enabled ===
                true,

        reminderMode:
            databaseProfile.reminderMode ||
            databaseProfile.reminder_mode ||
            "24-hours",

        ageConsent:
            databaseProfile.ageConsent ===
                true ||
            databaseProfile.age_consent ===
                true,

        registrationStatus:
            databaseProfile.registrationStatus ||
            databaseProfile.registration_status ||
            "incomplete",

        profileComplete:
            databaseProfile.profileComplete ===
                true ||
            databaseProfile.profile_complete ===
                true,

        rocketLeagueAccess:
            databaseProfile.rocketLeagueAccess ===
                true ||
            databaseProfile.rocket_league_access ===
                true,

        ranked,

        stats: {
            ranked
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

        userId:
            null,

        rlPlayerId:
            null,

        role:
            null,

        active:
            false,

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

        ageConsent:
            false,

        registrationStatus:
            "incomplete",

        profileComplete:
            false,

        rocketLeagueAccess:
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
// AVAILABILITY
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
                    ).toLowerCase(),

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

// ============================================================
// REGISTRATION PAYLOAD
// ============================================================

function normalizeRegistrationPayload(
    body
) {
    /*
     * Explicit allow-list.
     *
     * Browser values not listed here are discarded.
     *
     * In particular:
     *     body.location is intentionally ignored.
     *     body.EpicUniqueId is intentionally ignored.
     *     body.role is intentionally ignored.
     *     body.active is intentionally ignored.
     */
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
                : null
    };
}

// ============================================================
// REGISTRATION VALIDATION
// ============================================================

function validateRegistrationPayload(
    profile
) {
    if (
        profile.ageConsent !==
        true
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
                !item.start ||
                !item.end ||
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
            "specific-times"
    ) {
        return (
            "Specific reminder times are not available yet. Select 24 hours, 1 hour, or both."
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

    if (
        !storedSession
    ) {
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            false,

                        requiresEpicLogin:
                            true,

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
                            false,

                        requiresEpicLogin:
                            true,

                        message:
                            "Epic account identity is missing from the session."
                    },
                    401
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
        false;

    let warning =
        null;

    try {
        databaseProfile =
            await getRocketLeagueProfileByEpicId(
                env,
                epicUser.EpicUniqueId
            );

        profileLoaded =
            Boolean(
                databaseProfile &&
                (
                    databaseProfile.userId ||
                    databaseProfile.user_id
                ) &&
                (
                    databaseProfile.rlPlayerId ||
                    databaseProfile.rl_player_id
                )
            );
    } catch (
        error
    ) {
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

            requiresEpicLogin:
                false,

            profileLoaded,

            profileComplete:
                profile.profileComplete ===
                true,

            rocketLeagueAccess:
                profile.rocketLeagueAccess ===
                true,

            role:
                profile.role,

            active:
                profile.active ===
                true,

            warning,

            user: {
                EpicUniqueId:
                    epicUser.EpicUniqueId,

                EpicDisplayName:
                    epicUser.EpicDisplayName,

                EpicPreferredUsername:
                    epicUser.EpicPreferredUsername,

                userId:
                    profile.userId,

                rlPlayerId:
                    profile.rlPlayerId,

                role:
                    profile.role,

                active:
                    profile.active
            },

            location,

            profile
        },
        200
    );
}

// ============================================================
// ENSURE SUPABASE IDENTITY
// ============================================================

async function ensureSupabaseIdentity(
    env,
    epicUser
) {
    /*
     * Uses only trusted Epic identity from the authenticated
     * KV session.
     *
     * This makes profile registration self-healing if the
     * original Epic callback could not create the Supabase
     * player/user record.
     */
    const result =
        await callSupabaseSignin(
            env,
            {
                EpicUniqueId:
                    epicUser.EpicUniqueId,

                EpicDisplayName:
                    epicUser.EpicDisplayName,

                EpicPreferredUsername:
                    epicUser.EpicPreferredUsername
            }
        );

    const userId =
        result?.user_id ||
        result?.userId ||
        null;

    const rlPlayerId =
        result?.rl_player_id ||
        result?.rlPlayerId ||
        null;

    if (
        !userId ||
        !rlPlayerId
    ) {
        throw new Error(
            "Supabase identity synchronization returned incomplete identity."
        );
    }

    return {
        userId,
        rlPlayerId
    };
}

// ============================================================
// POST REGISTRATION
// ============================================================

async function handleProfilePost(
    request,
    env,
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

                rocketLeagueAccess:
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

                rocketLeagueAccess:
                    false,

                message:
                    validationError
            },
            400
        );
    }

    /*
     * Make sure a Supabase user/player identity exists before
     * attempting to save the registration.
     */
    try {
        await ensureSupabaseIdentity(
            env,
            epicUser
        );
    } catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Supabase identity initialization failed.",
            {
                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error",

                epicAccountPresent:
                    Boolean(
                        epicUser?.EpicUniqueId
                    )
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

                rocketLeagueAccess:
                    false,

                message:
                    "Your BPD profile could not be initialized."
            },
            500
        );
    }

    let result;

    try {
        result =
            await saveRocketLeagueProfile(
                env,
                epicUser.EpicUniqueId,
                registration
            );
    } catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Supabase profile save failed.",
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

                epicAccountPresent:
                    Boolean(
                        epicUser?.EpicUniqueId
                    )
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

                rocketLeagueAccess:
                    false,

                message:
                    "Your Rocket League registration could not be saved."
            },
            500
        );
    }

    const profileSaved =
        result?.profile_saved ===
            true ||
        result?.profileSaved ===
            true;

    const profileComplete =
        result?.profile_complete ===
            true ||
        result?.profileComplete ===
            true;

    const rocketLeagueAccess =
        result?.rocket_league_access ===
            true ||
        result?.rocketLeagueAccess ===
            true;

    return json(
        {
            success:
                true,

            authenticated:
                true,

            requiresEpicLogin:
                false,

            registrationAccepted:
                true,

            profileSaved,

            profileComplete,

            rocketLeagueAccess,

            role:
                result?.role ||
                null,

            active:
                result?.active ===
                true,

            userId:
                result?.user_id ||
                result?.userId ||
                null,

            rlPlayerId:
                result?.rl_player_id ||
                result?.rlPlayerId ||
                null,

            message:
                profileSaved
                    ? "Your Rocket League registration was saved."
                    : "Your Rocket League registration could not be confirmed as saved.",

            redirectTo:
                profileSaved
                    ? "/RocketLeague"
                    : null
        },
        profileSaved
            ? 200
            : 500
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
                env,
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

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                message:
                    "Rocket League profile request failed."
            },
            500
        );
    }
}