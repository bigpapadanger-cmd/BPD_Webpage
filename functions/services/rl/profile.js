"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE SERVICE

File:
    functions/services/rl/profile.js

Public Route:
    GET  /api/auth/rocketleague/profile
    POST /api/auth/rocketleague/profile

API Route:
    functions/api/auth/rocketleague/profile.js

Purpose:
    Handles authenticated Rocket League profile retrieval
    and registration/profile updates.

Description:
    - Uses the global BPD session for account ownership.
    - Uses identity.accounts.id as the canonical account ID.
    - Requires a linked Epic provider for Rocket League.
    - Keeps GET profile operations read-only.
    - Ensures the Rocket League player exists during POST.
    - Loads Rocket League data by core.rl_players.account_id.
    - Saves Rocket League data by account_id.
    - Keeps BPD and Epic display names separate.
    - Returns only coarse Cloudflare request location.
    - Never accepts browser-submitted identity ownership.

Identity Model:
    session.userId
        = identity.accounts.id

    core.rl_players.account_id
        = identity.accounts.id

    providers.epic.accountId
        = Epic account ID

Display Name Model:
    bpdDisplayName
        = identity.accounts.display_name

    EpicDisplayName
        = linked Epic provider display name

Important:
    - Global BPD authentication is authoritative.
    - Epic is required for Rocket League functionality but
      is NOT the global ownership key.
    - Epic display names are never used for ownership.
    - BPD display names belong to identity.accounts.
    - There is no separate Rocket League display name.
    - Browser-submitted account IDs are ignored.
    - Browser-submitted Epic IDs are ignored.
    - Browser-submitted display names are ignored.
    - Browser-submitted location is ignored for authority.
    - Supabase global identity creation does not occur here.
========================================================= */

import {
    json
} from "../common_helpers/responses.js";

import {
    getSessionContext,
    getProviderContext
} from "../auth/sessions/session_context.js";

import {
    ensureRocketLeaguePlayer
} from "../supabase/rocketleague/ensure_player.js";

import {
    getRocketLeagueProfileByAccountId
} from "../supabase/rocketleague/rocketleague_profile.js";

import {
    saveRocketLeagueProfile
} from "../supabase/rocketleague/save_profile.js";

/* =========================================================
CONSTANTS
========================================================= */

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
    "both"
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

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value,
    maxLength = 255
) {
    return String(
        value
        ?? ""
    )
        .trim()
        .slice(
            0,
            maxLength
        );
}

function normalizeNullableString(
    value,
    maxLength = 255
) {
    const normalized =
        normalizeString(
            value,
            maxLength
        );

    return normalized
        || null;
}

function normalizeBoolean(
    value,
    fallback = false
) {
    if (
        value === true
        || value === false
    ) {
        return value;
    }

    return fallback;
}

/* =========================================================
COARSE CLOUDFLARE LOCATION
========================================================= */

function getRequestLocation(
    request
) {
    const headers =
        request.headers;

    const cf =
        request.cf
        && typeof request.cf === "object"
            ? request.cf
            : {};

    return {
        region:
            normalizeString(
                headers.get(
                    "cf-region"
                )
                || cf.region,
                100
            ),

        countryCode:
            normalizeString(
                headers.get(
                    "cf-ipcountry"
                )
                || cf.country,
                10
            ),

        timezone:
            normalizeString(
                headers.get(
                    "cf-timezone"
                )
                || cf.timezone,
                100
            )
    };
}

/* =========================================================
EPIC PROVIDER
========================================================= */

function buildEpicUser(
    sessionContext
) {
    const epic =
        getProviderContext(
            sessionContext,
            "epic"
        );

    return {
        linked:
            epic?.linked === true,

        authenticated:
            epic?.authenticated === true,

        EpicUniqueId:
            normalizeNullableString(
                epic?.accountId
            ),

        EpicDisplayName:
            normalizeNullableString(
                epic?.displayName
            ),

        EpicPreferredUsername:
            normalizeNullableString(
                epic?.preferredUsername
            )
    };
}

/* =========================================================
DATABASE PROFILE NORMALIZATION
========================================================= */

function normalizeDatabaseProfile(
    databaseProfile,
    sessionContext,
    epicUser
) {
    if (
        !databaseProfile
        || typeof databaseProfile !== "object"
        || Array.isArray(
            databaseProfile
        )
    ) {
        return null;
    }

    const accountId =
        databaseProfile.accountId
        || databaseProfile.account_id
        || databaseProfile.userId
        || databaseProfile.user_id
        || sessionContext.userId
        || null;

    const rlPlayerId =
        databaseProfile.rlPlayerId
        || databaseProfile.rl_player_id
        || null;

    const bpdDisplayName =
        normalizeNullableString(
            databaseProfile.bpdDisplayName
            || databaseProfile.bpd_display_name
        );

    const epicDisplayName =
        normalizeNullableString(
            databaseProfile.epicDisplayName
            || databaseProfile.epic_display_name
            || epicUser.EpicDisplayName
        );

    const ranked =
        databaseProfile.ranked
        && typeof databaseProfile.ranked === "object"
        && !Array.isArray(
            databaseProfile.ranked
        )
            ? databaseProfile.ranked
            : {};

    return {
        accountId,

        /*
         * Temporary compatibility alias.
         *
         * userId and accountId both represent:
         * identity.accounts.id
         */
        userId:
            accountId,

        rlPlayerId,

        bpdDisplayName,

        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicDisplayName,

        EpicPreferredUsername:
            epicUser.EpicPreferredUsername,

        role:
            databaseProfile.role
            || sessionContext.role
            || null,

        active:
            databaseProfile.active === true,

        currentRank:
            databaseProfile.currentRank
            || databaseProfile.current_rank
            || "",

        contactMethod:
            databaseProfile.contactMethod
            || databaseProfile.contact_method
            || "email",

        email:
            databaseProfile.email
            || "",

        phone:
            databaseProfile.phone
            || "",

        preferredMode:
            databaseProfile.preferredMode
            || databaseProfile.preferred_mode
            || "",

        otherMode:
            databaseProfile.otherMode
            || databaseProfile.other_mode
            || "",

        timezone:
            databaseProfile.displayTimezone
            || databaseProfile.display_timezone
            || databaseProfile.timezone
            || "",

        availability:
            Array.isArray(
                databaseProfile.availability
            )
                ? databaseProfile.availability
                : [],

        showOnlineStatus:
            databaseProfile.showOnlineStatus === true
            || databaseProfile.show_online_status === true,

        notificationsEnabled:
            databaseProfile.notificationsEnabled === true
            || databaseProfile.notifications_enabled === true,

        reminderMode:
            databaseProfile.reminderMode
            || databaseProfile.reminder_mode
            || "24-hours",

        ageConsent:
            databaseProfile.ageConsent === true
            || databaseProfile.age_consent === true,

        registrationStatus:
            databaseProfile.registrationStatus
            || databaseProfile.registration_status
            || "incomplete",

        profileComplete:
            databaseProfile.profileComplete === true
            || databaseProfile.profile_complete === true,

        rocketLeagueAccess:
            databaseProfile.rocketLeagueAccess === true
            || databaseProfile.rocket_league_access === true,

        ranked,

        stats: {
            ranked
        }
    };
}

/* =========================================================
FALLBACK PROFILE
========================================================= */

function buildFallbackProfile(
    sessionContext,
    epicUser
) {
    const accountId =
        sessionContext.userId
        || null;

    return {
        accountId,

        /*
         * Temporary compatibility alias.
         */
        userId:
            accountId,

        rlPlayerId:
            null,

        bpdDisplayName:
            normalizeNullableString(
                sessionContext.displayName
            ),

        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicUser.EpicDisplayName,

        EpicPreferredUsername:
            epicUser.EpicPreferredUsername,

        role:
            sessionContext.role
            || null,

        active:
            sessionContext.active === true,

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

/* =========================================================
AVAILABILITY
========================================================= */

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
            item => ({
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
            item =>
                ALLOWED_DAYS.includes(
                    item.day
                )
        )
        .slice(
            0,
            7
        );
}

/* =========================================================
REGISTRATION PAYLOAD
========================================================= */

function normalizeRegistrationPayload(
    body
) {
    /*
     * Explicit allow-list.
     *
     * Anything not listed here is discarded.
     *
     * In particular:
     *     body.accountId is ignored.
     *     body.userId is ignored.
     *     body.EpicUniqueId is ignored.
     *     body.displayName is ignored.
     *     body.role is ignored.
     *     body.active is ignored.
     *     body.location is ignored.
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
            )
                .toLowerCase(),

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
            )
                .toLowerCase(),

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
                    body?.reminderMode
                    || "24-hours",
                    30
                )
                    .toLowerCase()
                : null
    };
}

/* =========================================================
REGISTRATION VALIDATION
========================================================= */

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
            profile.contactMethod === "email"
            || profile.contactMethod === "both"
        )
        && !profile.email
    ) {
        return (
            "Email address is required."
        );
    }

    if (
        (
            profile.contactMethod === "phone"
            || profile.contactMethod === "both"
        )
        && !profile.phone
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
        profile.preferredMode === "other"
        && !profile.otherMode
    ) {
        return (
            "Describe your preferred mode."
        );
    }

    if (
        profile.availability.length === 0
    ) {
        return (
            "Select at least one day when you are available."
        );
    }

    const invalidAvailability =
        profile.availability.some(
            item =>
                !item.start
                || !item.end
                || item.start < AVAILABILITY_START
                || item.start > AVAILABILITY_END
                || item.end < AVAILABILITY_START
                || item.end > AVAILABILITY_END
                || item.start >= item.end
        );

    if (
        invalidAvailability
    ) {
        return (
            "Availability must be between 5:00 PM and 11:00 PM, with the end time later than the start time."
        );
    }

    if (
        profile.notificationsEnabled
        && !ALLOWED_REMINDER_MODES.includes(
            profile.reminderMode
        )
    ) {
        return (
            "Select a valid reminder preference."
        );
    }

    return null;
}

/* =========================================================
AUTHENTICATED ROCKET LEAGUE CONTEXT
========================================================= */

async function getAuthenticatedContext(
    request,
    env
) {
    const sessionContext =
        await getSessionContext(
            request,
            env
        );

    if (
        sessionContext.authenticated !== true
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

                        code:
                            "AUTH_REQUIRED",

                        message:
                            "Login is required to access the Rocket League profile."
                    },
                    401
                )
        };
    }

    const accountId =
        normalizeNullableString(
            sessionContext.userId
        );

    if (
        !accountId
    ) {
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            true,

                        requiresEpicLogin:
                            false,

                        code:
                            "ACCOUNT_IDENTITY_MISSING",

                        message:
                            "Your global BPD account identity could not be resolved."
                    },
                    409
                )
        };
    }

    if (
        sessionContext.active !== true
    ) {
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            true,

                        requiresEpicLogin:
                            false,

                        code:
                            "ACCOUNT_INACTIVE",

                        message:
                            "This BPD account is not active."
                    },
                    403
                )
        };
    }

    const epicUser =
        buildEpicUser(
            sessionContext
        );

    if (
        epicUser.linked !== true
        || !epicUser.EpicUniqueId
    ) {
        return {
            error:
                json(
                    {
                        success:
                            false,

                        authenticated:
                            true,

                        requiresEpicLogin:
                            true,

                        accountId,

                        userId:
                            accountId,

                        code:
                            "EPIC_ACCOUNT_REQUIRED",

                        message:
                            "A linked Epic account is required to access Rocket League."
                    },
                    409
                )
        };
    }

    return {
        sessionContext,
        accountId,
        epicUser
    };
}

/* =========================================================
GET PROFILE
========================================================= */

async function handleProfileGet(
    request,
    env,
    sessionContext,
    accountId,
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
            await getRocketLeagueProfileByAccountId(
                env,
                accountId
            );

        if (
            databaseProfile
        ) {
            const returnedAccountId =
                normalizeNullableString(
                    databaseProfile.accountId
                    || databaseProfile.account_id
                    || databaseProfile.userId
                    || databaseProfile.user_id
                );

            if (
                returnedAccountId
                && returnedAccountId !== accountId
            ) {
                throw new Error(
                    "Rocket League profile returned an unexpected global account."
                );
            }
        }

        const rlPlayerId =
            databaseProfile?.rlPlayerId
            || databaseProfile?.rl_player_id
            || null;

        profileLoaded =
            Boolean(
                databaseProfile
                && rlPlayerId
            );
    }
    catch (
        error
    ) {
        warning =
            (
                "Your BPD account is signed in, "
                + "but permanent Rocket League profile data is not currently available."
            );

        console.error(
            "ROCKET LEAGUE PROFILE: Profile load failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );
    }

    const profile =
        databaseProfile
            ? normalizeDatabaseProfile(
                databaseProfile,
                sessionContext,
                epicUser
            )
            : buildFallbackProfile(
                sessionContext,
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

            accountId,

            /*
             * Temporary compatibility alias.
             */
            userId:
                accountId,

            profileLoaded,

            profileComplete:
                profile.profileComplete === true,

            rocketLeagueAccess:
                profile.rocketLeagueAccess === true,

            role:
                profile.role,

            active:
                profile.active === true,

            warning,

            user: {
                accountId,

                userId:
                    accountId,

                rlPlayerId:
                    profile.rlPlayerId,

                bpdDisplayName:
                    profile.bpdDisplayName,

                role:
                    profile.role,

                active:
                    profile.active,

                EpicUniqueId:
                    epicUser.EpicUniqueId,

                EpicDisplayName:
                    profile.EpicDisplayName,

                EpicPreferredUsername:
                    epicUser.EpicPreferredUsername
            },

            location,

            profile
        },
        200
    );
}

/* =========================================================
POST REGISTRATION
========================================================= */

async function handleProfilePost(
    request,
    env,
    sessionContext,
    accountId,
    epicUser
) {
    let body;

    try {
        body =
            await request.json();
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Registration JSON invalid.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "INVALID_REGISTRATION_DATA",

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

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "INVALID_REGISTRATION_DATA",

                message:
                    validationError
            },
            400
        );
    }

    /* =====================================================
    ENSURE ROCKET LEAGUE PLAYER

    This is deliberately a POST-side effect.

    GET profile/session requests remain read-only and never
    create core.rl_players records.
    ===================================================== */

    let ensuredPlayer;

    try {
        ensuredPlayer =
            await ensureRocketLeaguePlayer(
                env,
                accountId
            );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Player initialization failed.",
            {
                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || error?.upstreamCode
                    || null,

                upstreamStatus:
                    error?.upstreamStatus
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            error?.code === "EPIC_ACCOUNT_REQUIRED"
            || error?.message === "EPIC_IDENTITY_NOT_LINKED"
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    requiresEpicLogin:
                        true,

                    profileSaved:
                        false,

                    profileComplete:
                        false,

                    rocketLeagueAccess:
                        false,

                    code:
                        "EPIC_ACCOUNT_REQUIRED",

                    message:
                        "A linked Epic account is required to register for Rocket League."
                },
                409
            );
        }

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    error?.upstreamCode
                    || "ROCKET_LEAGUE_PLAYER_INITIALIZATION_FAILED",

                message:
                    "Your Rocket League player profile could not be initialized."
            },
            500
        );
    }

    if (
        !ensuredPlayer?.rlPlayerId
    ) {
        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "ROCKET_LEAGUE_PLAYER_INITIALIZATION_INVALID",

                message:
                    "Your Rocket League player profile could not be verified."
            },
            500
        );
    }

    /* =====================================================
    SAVE REGISTRATION
    ===================================================== */

    let result;

    try {
        result =
            await saveRocketLeagueProfile(
                env,
                accountId,
                registration
            );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Profile save failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error",

                upstreamStatus:
                    error?.upstreamStatus
                    || null,

                upstreamCode:
                    error?.upstreamCode
                    || null
            }
        );

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    error?.upstreamCode
                    || "ROCKET_LEAGUE_PROFILE_SAVE_FAILED",

                message:
                    "Your Rocket League registration could not be saved."
            },
            500
        );
    }

    const returnedAccountId =
        normalizeNullableString(
            result?.account_id
            || result?.accountId
            || result?.user_id
            || result?.userId
        );

    if (
        returnedAccountId
        && returnedAccountId !== accountId
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Save returned unexpected account."
        );

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "ACCOUNT_IDENTITY_MISMATCH",

                message:
                    "The Rocket League profile could not be verified after saving."
            },
            500
        );
    }

    const profileSaved =
        result?.profile_saved === true
        || result?.profileSaved === true;

    const profileComplete =
        result?.profile_complete === true
        || result?.profileComplete === true;

    const rocketLeagueAccess =
        result?.rocket_league_access === true
        || result?.rocketLeagueAccess === true;

    const rlPlayerId =
        result?.rl_player_id
        || result?.rlPlayerId
        || ensuredPlayer.rlPlayerId
        || null;

    return json(
        {
            success:
                profileSaved,

            authenticated:
                true,

            requiresEpicLogin:
                false,

            registrationAccepted:
                true,

            profileSaved,

            profileComplete,

            rocketLeagueAccess,

            accountId,

            /*
             * Temporary compatibility alias.
             */
            userId:
                accountId,

            rlPlayerId,

            playerCreated:
                ensuredPlayer.createdPlayer === true,

            playerAdopted:
                ensuredPlayer.adoptedPlayer === true,

            role:
                result?.role
                || sessionContext.role
                || null,

            active:
                result?.active === true,

            user: {
                accountId,

                userId:
                    accountId,

                rlPlayerId,

                role:
                    result?.role
                    || sessionContext.role
                    || null,

                active:
                    result?.active === true,

                EpicUniqueId:
                    epicUser.EpicUniqueId,

                EpicDisplayName:
                    epicUser.EpicDisplayName,

                EpicPreferredUsername:
                    epicUser.EpicPreferredUsername
            },

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

/* =========================================================
MAIN PROFILE HANDLER
========================================================= */

export async function handleRocketLeagueProfile(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

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

        const {
            sessionContext,
            accountId,
            epicUser
        } =
            authenticated;

        if (
            request.method === "GET"
        ) {
            return handleProfileGet(
                request,
                env,
                sessionContext,
                accountId,
                epicUser
            );
        }

        if (
            request.method === "POST"
        ) {
            return handleProfilePost(
                request,
                env,
                sessionContext,
                accountId,
                epicUser
            );
        }

        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                code:
                    "METHOD_NOT_ALLOWED",

                message:
                    "Method not allowed.",

                debugId
            },
            405,
            {
                "Allow":
                    "GET, POST"
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Unexpected failure.",
            {
                debugId,

                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error",

                method:
                    request.method
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

                code:
                    "ROCKET_LEAGUE_PROFILE_FAILED",

                message:
                    "Rocket League profile request failed.",

                debugId
            },
            500
        );
    }
}