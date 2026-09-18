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
    and initial Rocket League profile setup.

Description:
    - Uses the global BPD session for account ownership.
    - Uses identity.accounts.id as the canonical account ID.
    - Requires a linked Epic provider for Rocket League.
    - Keeps GET profile operations read-only.
    - Ensures the Rocket League player exists during POST.
    - Loads Rocket League data by core.rl_players.account_id.
    - Saves Rocket League data by account_id.
    - Does not collect a configurable Rocket League username.
    - Email and phone are optional.
    - Supports Email, Phone, and Discord notifications.
    - Verifies Discord notification eligibility server-side.
    - Uses Cloudflare request metadata only for explicit
      opt-in coarse region/time-zone detection.
    - Never accepts browser-submitted identity ownership.
    - Requires age eligibility AND policy/privacy consent for
      registration completion and Rocket League access.
    - Wakes the Rocket League presence monitor for eligible
      active opted-in Rocket League profiles.

Initial Registration Model:
    ageConsent
    policyConsent
    autoDetectRegion
    showOnlineStatus
    email
    phone
    preferredMode
    otherMode
    availability
    notificationsEnabled
    notificationMethod
    reminderMode

Identity Model:
    session.userId
        = identity.accounts.id

    core.rl_players.account_id
        = identity.accounts.id

    providers.epic.accountId
        = Epic account ID

Important:
    - Current rank is NOT collected during initial setup.
    - Contact method is replaced by notificationMethod.
    - Email and phone may both be empty.
    - Location submitted by the browser is ignored.
    - Region detection defaults off.
    - Coarse Cloudflare request data is read only when the
      user explicitly enables automatic region detection.
    - Discord notification eligibility is enforced on POST.
    - Age consent and policy/privacy consent are mandatory.
========================================================= */

import {
    fetchRocketLeaguePresence
} from "./presence/fetch_presence.js";

import {
    wakeRocketLeaguePresenceMonitor
} from "./presence/wake_monitor.js";

import {
    json
} from "../common_helpers/responses.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../auth/authorization.js";

import {
    ensureRocketLeaguePlayer
} from "../supabase/rocketleague/ensure_player.js";

import {
    getRocketLeagueProfileByAccountId
} from "../supabase/rocketleague/rocketleague_profile.js";

import {
    saveRocketLeagueProfile
} from "../supabase/rocketleague/save_profile.js";

import {
    getDiscordMatchBotEligibility
} from "../auth/providers/discord_matchbot/eligibility.js";

/* =========================================================
CONSTANTS
========================================================= */

const ALLOWED_NOTIFICATION_METHODS = [
    "email",
    "phone",
    "discord"
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

function normalizeObject(
    value
) {
    return (
        value
        && typeof value ===
            "object"
        && !Array.isArray(
            value
        )
    )
        ? value
        : {};
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
        && typeof request.cf ===
            "object"
            ? request.cf
            : {};

    return {
        city:
            normalizeString(
                cf.city,
                100
            ),

        region:
            normalizeString(
                headers.get(
                    "cf-region"
                )
                || cf.region,
                100
            ),

        country:
            normalizeString(
                cf.country,
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
    authorization
) {
    const verifiedEpic =
        authorization?.provider
        || null;

    const sessionEpic =
        authorization
            ?.providers
            ?.epic
        || null;

    return {
        linked:
            Boolean(
                verifiedEpic?.subject
            ),

        authenticated:
            sessionEpic
                ?.authenticated ===
            true,

        EpicUniqueId:
            normalizeNullableString(
                verifiedEpic?.subject
            ),

        EpicDisplayName:
            normalizeNullableString(
                verifiedEpic
                    ?.displayUsername
                || sessionEpic
                    ?.displayName
            ),

        EpicPreferredUsername:
            normalizeNullableString(
                sessionEpic
                    ?.preferredUsername
                || verifiedEpic
                    ?.displayUsername
            )
    };
}

/* =========================================================
RANK DATA

Initial registration no longer collects rank information.

These fields remain read-only compatibility for the future
current-MMR/rank system.
========================================================= */

function normalizeRanks(
    databaseProfile
) {
    const ranks =
        normalizeObject(
            databaseProfile?.ranks
        );

    const input =
        normalizeObject(
            ranks.input
            || databaseProfile
                ?.inputRanked
            || databaseProfile
                ?.input_ranked
        );

    const current =
        normalizeObject(
            ranks.current
            || databaseProfile
                ?.currentRanked
            || databaseProfile
                ?.current_ranked
            || databaseProfile
                ?.ranked
        );

    return {
        input,
        current
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
        || typeof databaseProfile !==
            "object"
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

    const ranks =
        normalizeRanks(
            databaseProfile
        );

    return {
        accountId,

        userId:
            accountId,

        rlPlayerId:
            databaseProfile.rlPlayerId
            || databaseProfile
                .rl_player_id
            || null,

        bpdDisplayName:
            normalizeNullableString(
                databaseProfile
                    .bpdDisplayName
                || databaseProfile
                    .bpd_display_name
            ),

        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            normalizeNullableString(
                databaseProfile
                    .epicDisplayName
                || databaseProfile
                    .epic_display_name
                || epicUser
                    .EpicDisplayName
            ),

        EpicPreferredUsername:
            epicUser
                .EpicPreferredUsername,

        role:
            databaseProfile.role
            || sessionContext.role
            || null,

        active:
            databaseProfile.active ===
            true,

        ageConsent:
            databaseProfile
                .ageConsent ===
                true
            || databaseProfile
                .age_consent ===
                true,

        policyConsent:
            databaseProfile
                .policyConsent ===
                true
            || databaseProfile
                .policy_consent ===
                true,

        autoDetectRegion:
            databaseProfile
                .autoDetectRegion ===
                true
            || databaseProfile
                .auto_detect_region ===
                true,

        location:
            normalizeObject(
                databaseProfile.location
            ),

        timezone:
            normalizeString(
                databaseProfile
                    .displayTimezone
                || databaseProfile
                    .display_timezone
                || databaseProfile
                    .timezone
            ),

        showOnlineStatus:
            databaseProfile
                .showOnlineStatus ===
                true
            || databaseProfile
                .show_online_status ===
                true,

        email:
            normalizeString(
                databaseProfile.email,
                254
            ),

        phone:
            normalizeString(
                databaseProfile.phone,
                24
            ),

        preferredMode:
            normalizeString(
                databaseProfile
                    .preferredMode
                || databaseProfile
                    .preferred_mode,
                20
            ),

        otherMode:
            normalizeString(
                databaseProfile
                    .otherMode
                || databaseProfile
                    .other_mode,
                50
            ),

        availability:
            Array.isArray(
                databaseProfile
                    .availability
            )
                ? databaseProfile
                    .availability
                : [],

        notificationsEnabled:
            databaseProfile
                .notificationsEnabled ===
                true
            || databaseProfile
                .notifications_enabled ===
                true,

        notificationMethod:
            normalizeNullableString(
                databaseProfile
                    .notificationMethod
                || databaseProfile
                    .notification_method,
                20
            ),

        reminderMode:
            normalizeNullableString(
                databaseProfile
                    .reminderMode
                || databaseProfile
                    .reminder_mode,
                30
            ),

        registrationStatus:
            databaseProfile
                .registrationStatus
            || databaseProfile
                .registration_status
            || "incomplete",

        profileComplete:
            databaseProfile
                .profileComplete ===
                true
            || databaseProfile
                .profile_complete ===
                true,

        rocketLeagueAccess:
            databaseProfile
                .rocketLeagueAccess ===
                true
            || databaseProfile
                .rocket_league_access ===
                true,

        ranks,

        ranked:
            ranks.current,

        stats: {
            ranked:
                ranks.current
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

        userId:
            accountId,

        rlPlayerId:
            null,

        bpdDisplayName:
            normalizeNullableString(
                sessionContext
                    .displayName
            ),

        EpicUniqueId:
            epicUser.EpicUniqueId,

        EpicDisplayName:
            epicUser.EpicDisplayName,

        EpicPreferredUsername:
            epicUser
                .EpicPreferredUsername,

        role:
            sessionContext.role
            || null,

        active:
            sessionContext.active ===
            true,

        ageConsent:
            false,

        policyConsent:
            false,

        autoDetectRegion:
            false,

        location:
            {},

        timezone:
            "",

        showOnlineStatus:
            false,

        email:
            "",

        phone:
            "",

        preferredMode:
            "",

        otherMode:
            "",

        availability:
            [],

        notificationsEnabled:
            true,

        notificationMethod:
            null,

        reminderMode:
            "24-hours",

        registrationStatus:
            "incomplete",

        profileComplete:
            false,

        rocketLeagueAccess:
            false,

        ranks: {
            input:
                {},

            current:
                {}
        },

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
                ALLOWED_DAYS
                    .includes(
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
    body,
    request
) {
    /*
     * Explicit allow-list.
     *
     * These browser values are deliberately ignored:
     *
     * body.accountId
     * body.userId
     * body.EpicUniqueId
     * body.displayName
     * body.role
     * body.active
     * body.currentRank
     * body.location
     * body.timezone
     *
     * Account and provider ownership always come from the
     * authenticated server session.
     *
     * Location/time-zone data is derived server-side only
     * when autoDetectRegion is explicitly true.
     */

    const notificationsEnabled =
        normalizeBoolean(
            body?.notificationsEnabled,
            true
        );

    /*
     * Region detection is opt-in.
     *
     * Missing, malformed, or omitted values resolve to false.
     */
    const autoDetectRegion =
        normalizeBoolean(
            body?.autoDetectRegion,
            false
        );

    /*
     * Do not inspect request location metadata unless the
     * user explicitly opted in for this submission.
     */
    const detectedLocation =
        autoDetectRegion
            ? getRequestLocation(
                request
            )
            : null;

    return {
        ageConsent:
            normalizeBoolean(
                body?.ageConsent,
                false
            ),

        policyConsent:
            normalizeBoolean(
                body?.policyConsent,
                false
            ),

        autoDetectRegion,

        showOnlineStatus:
            normalizeBoolean(
                body?.showOnlineStatus,
                false
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
            )
                .toLowerCase(),

        otherMode:
            normalizeString(
                body?.otherMode,
                50
            ),

        timezone:
            autoDetectRegion
                ? normalizeNullableString(
                    detectedLocation
                        ?.timezone,
                    100
                )
                : null,

        location:
            autoDetectRegion
                ? detectedLocation
                : null,

        availability:
            normalizeAvailability(
                body?.availability
            ),

        notificationsEnabled,

        notificationMethod:
            notificationsEnabled
                ? normalizeString(
                    body
                        ?.notificationMethod,
                    20
                )
                    .toLowerCase()
                : null,

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
    /*
     * Mandatory eligibility / age verification.
     */
    if (
        profile.ageConsent !==
        true
    ) {
        return (
            "Eligibility confirmation is required."
        );
    }

    /*
     * Mandatory Terms / Privacy acknowledgement.
     */
    if (
        profile.policyConsent !==
        true
    ) {
        return (
            "Terms of Service and Privacy Policy acknowledgement is required."
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
            "other"
        && !profile.otherMode
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
            item =>
                !item.start
                || !item.end
                || item.start <
                    AVAILABILITY_START
                || item.start >
                    AVAILABILITY_END
                || item.end <
                    AVAILABILITY_START
                || item.end >
                    AVAILABILITY_END
                || item.start >=
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
        profile.notificationsEnabled !==
        true
    ) {
        return null;
    }

    if (
        !ALLOWED_NOTIFICATION_METHODS
            .includes(
                profile.notificationMethod
            )
    ) {
        return (
            "Select a valid notification method."
        );
    }

    if (
        profile.notificationMethod ===
            "email"
        && !profile.email
    ) {
        return (
            "An email address is required when email notifications are selected."
        );
    }

    if (
        profile.notificationMethod ===
            "phone"
        && !profile.phone
    ) {
        return (
            "A phone number is required when phone notifications are selected."
        );
    }

    if (
        !ALLOWED_REMINDER_MODES
            .includes(
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
DISCORD NOTIFICATION VERIFICATION
========================================================= */

async function verifyDiscordNotificationAccess(
    request,
    env,
    registration
) {
    if (
        registration
            .notificationsEnabled !==
            true
        || registration
            .notificationMethod !==
            "discord"
    ) {
        return {
            valid:
                true
        };
    }

    let discordAuthorization;

    try {
        discordAuthorization =
            await authorizeRequest(
                request,
                env,
                {
                    account:
                        true,

                    provider:
                        "discord"
                }
            );
    }
    catch (
        error
    ) {
        if (
            isAuthorizationError(
                error
            )
            && error.code ===
                "PROVIDER_REQUIRED"
        ) {
            return {
                valid:
                    false,

                code:
                    "DISCORD_ACCOUNT_REQUIRED",

                message:
                    "A linked Discord account is required for Discord notifications."
            };
        }

        if (
            isAuthorizationError(
                error
            )
        ) {
            return {
                valid:
                    false,

                code:
                    error.code
                    || "DISCORD_AUTHORIZATION_FAILED",

                message:
                    "Discord notification authorization could not be verified."
            };
        }

        throw error;
    }

    const discordUserId =
        normalizeNullableString(
            discordAuthorization
                ?.provider
                ?.subject
        );

    if (
        !discordUserId
    ) {
        return {
            valid:
                false,

            code:
                "DISCORD_IDENTITY_MISSING",

            message:
                "Your verified Discord identity could not be resolved."
        };
    }

    const eligibility =
        await getDiscordMatchBotEligibility(
            env,
            discordUserId
        );

    if (
        eligibility?.eligible !==
        true
    ) {
        return {
            valid:
                false,

            code:
                eligibility?.reason
                || "MATCHBOT_REQUIRED",

            message:
                "Your Discord account must share a server with BPD MatchBot before Discord notifications can be enabled."
        };
    }

    return {
        valid:
            true,

        discordUserId,

        mutualGuild:
            eligibility.mutualGuild
            || null
    };
}

/* =========================================================
AUTHENTICATED ROCKET LEAGUE CONTEXT
========================================================= */

async function getAuthenticatedContext(
    request,
    env
) {
    let authorization;

    try {
        authorization =
            await authorizeRequest(
                request,
                env,
                {
                    account:
                        true,

                    provider:
                        "epic"
                }
            );
    }
    catch (
        error
    ) {
        if (
            !isAuthorizationError(
                error
            )
        ) {
            throw error;
        }

        if (
            error.code ===
            "AUTH_REQUIRED"
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
                                false,

                            registrationAccepted:
                                false,

                            profileSaved:
                                false,

                            profileComplete:
                                false,

                            rocketLeagueAccess:
                                false,

                            code:
                                "AUTH_REQUIRED",

                            message:
                                "Login is required to access the Rocket League profile."
                        },
                        401
                    )
            };
        }

        if (
            error.code ===
            "ACCOUNT_IDENTITY_MISSING"
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

                            registrationAccepted:
                                false,

                            profileSaved:
                                false,

                            profileComplete:
                                false,

                            rocketLeagueAccess:
                                false,

                            code:
                                "ACCOUNT_IDENTITY_MISSING",

                            message:
                                "Your global BPD account identity could not be resolved."
                        },
                        401
                    )
            };
        }

        if (
            error.code ===
            "ACCOUNT_INACTIVE"
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

                            registrationAccepted:
                                false,

                            profileSaved:
                                false,

                            profileComplete:
                                false,

                            rocketLeagueAccess:
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

        if (
            error.code ===
                "PROVIDER_REQUIRED"
            && error?.details
                ?.provider ===
                "epic"
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

                            registrationAccepted:
                                false,

                            profileSaved:
                                false,

                            profileComplete:
                                false,

                            rocketLeagueAccess:
                                false,

                            code:
                                "EPIC_ACCOUNT_REQUIRED",

                            message:
                                "A linked Epic account is required to access Rocket League."
                        },
                        403
                    )
            };
        }

        if (
            error.code ===
            "PROVIDER_VERIFICATION_UNAVAILABLE"
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

                            registrationAccepted:
                                false,

                            profileSaved:
                                false,

                            profileComplete:
                                false,

                            rocketLeagueAccess:
                                false,

                            code:
                                "AUTHORIZATION_UNAVAILABLE",

                            message:
                                "Epic account authorization is temporarily unavailable."
                        },
                        503
                    )
            };
        }

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

                        registrationAccepted:
                            false,

                        profileSaved:
                            false,

                        profileComplete:
                            false,

                        rocketLeagueAccess:
                            false,

                        code:
                            error.code
                            || "AUTHORIZATION_FAILED",

                        message:
                            "You are not authorized to access this Rocket League resource."
                    },
                    Number.isInteger(
                        error.status
                    )
                        ? error.status
                        : 403
                )
        };
    }

    const accountId =
        normalizeNullableString(
            authorization.accountId
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

                        registrationAccepted:
                            false,

                        profileSaved:
                            false,

                        profileComplete:
                            false,

                        rocketLeagueAccess:
                            false,

                        code:
                            "ACCOUNT_IDENTITY_MISSING",

                        message:
                            "Your global BPD account identity could not be resolved."
                    },
                    500
                )
        };
    }

    const epicUser =
        buildEpicUser(
            authorization
        );

    if (
        epicUser.linked !==
            true
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
                            false,

                        registrationAccepted:
                            false,

                        profileSaved:
                            false,

                        profileComplete:
                            false,

                        rocketLeagueAccess:
                            false,

                        code:
                            "EPIC_IDENTITY_VERIFICATION_INVALID",

                        message:
                            "The verified Epic account identity could not be resolved."
                    },
                    503
                )
        };
    }

    return {
        authorization,

        sessionContext:
            authorization.sessionContext,

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
    /*
     * Coarse location detection is explicit.
     *
     * A normal:
     *
     *     GET /api/auth/rocketleague/profile
     *
     * does not inspect Cloudflare request location metadata.
     *
     * Only:
     *
     *     GET /api/auth/rocketleague/profile?detectLocation=true
     *
     * performs a fresh coarse location lookup.
     */

    const requestUrl =
        new URL(
            request.url
        );

    const detectLocationRequested =
        requestUrl.searchParams.get(
            "detectLocation"
        ) ===
        "true";

    const detectedLocation =
        detectLocationRequested
            ? getRequestLocation(
                request
            )
            : null;

    let databaseProfile =
        null;

    let profileLoaded =
        false;

    let profileExists =
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
                    databaseProfile
                        .accountId
                    || databaseProfile
                        .account_id
                    || databaseProfile
                        .userId
                    || databaseProfile
                        .user_id
                );

            if (
                returnedAccountId
                && returnedAccountId !==
                    accountId
            ) {
                throw new Error(
                    "Rocket League profile returned an unexpected global account."
                );
            }
        }

        const rlPlayerId =
            databaseProfile?.rlPlayerId
            || databaseProfile
                ?.rl_player_id
            || null;

        profileExists =
            Boolean(
                databaseProfile
                && rlPlayerId
            );

        profileLoaded =
            profileExists;
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
        profileExists
            ? normalizeDatabaseProfile(
                databaseProfile,
                sessionContext,
                epicUser
            )
            : buildFallbackProfile(
                sessionContext,
                epicUser
            );

    const registrationAccepted =
        profileExists
        && profile.registrationStatus ===
            "complete"
        && profile.ageConsent ===
            true
        && profile.policyConsent ===
            true;

    const profileComplete =
        profileExists
        && registrationAccepted ===
            true
        && profile.profileComplete ===
            true;

    const rocketLeagueAccess =
        epicUser.linked ===
            true
        && profileExists
        && profile.active ===
            true
        && registrationAccepted ===
            true
        && profileComplete ===
            true
        && profile.rocketLeagueAccess ===
            true;

    /* =====================================================
    ROCKET LEAGUE PRESENCE MONITOR

    Presence opt-in remains intentionally separate from full
    league registration/access.

    Supabase performs its own authoritative wake eligibility
    validation before the Worker is triggered.
    ===================================================== */

    const presenceEligible =
        profileExists
        && epicUser.linked ===
            true
        && profile.active ===
            true
        && profile.showOnlineStatus ===
            true
        && Boolean(
            profile.rlPlayerId
        )
        && Boolean(
            epicUser.EpicUniqueId
        );

    if (
        presenceEligible
    ) {
        try {
            await wakeRocketLeaguePresenceMonitor(
                env,
                accountId
            );
        }
        catch (
            error
        ) {
            console.error(
                "ROCKET LEAGUE PROFILE: Presence monitor wake failed.",
                {
                    name:
                        error?.name
                        || "Error",

                    code:
                        error?.code
                        || null,

                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }

    /* =====================================================
    CURRENT PLAYER PRESENCE
    ===================================================== */

    let presence =
        null;

    if (
        presenceEligible
    ) {
        try {
            presence =
                await fetchRocketLeaguePresence(
                    env,
                    epicUser
                        .EpicUniqueId
                );
        }
        catch (
            error
        ) {
            console.error(
                "ROCKET LEAGUE PROFILE: Presence load failed.",
                {
                    name:
                        error?.name
                        || "Error",

                    message:
                        error?.message
                        || "Unknown error"
                }
            );

            presence =
                null;
        }
    }

    return json(
        {
            success:
                true,

            authenticated:
                true,

            epicLinked:
                epicUser.linked ===
                true,

            requiresEpicLogin:
                false,

            accountId,

            userId:
                accountId,

            profileExists,

            profileLoaded,

            profileComplete,

            registrationAccepted,

            rocketLeagueAccess,

            role:
                profile.role,

            active:
                profile.active ===
                true,

            warning,

            user: {
                accountId,

                userId:
                    accountId,

                rlPlayerId:
                    profileExists
                        ? profile
                            .rlPlayerId
                        : null,

                bpdDisplayName:
                    profile
                        .bpdDisplayName,

                role:
                    profile.role,

                active:
                    profile.active,

                EpicUniqueId:
                    epicUser
                        .EpicUniqueId,

                EpicDisplayName:
                    profile
                        .EpicDisplayName,

                EpicPreferredUsername:
                    epicUser
                        .EpicPreferredUsername
            },

            location:
                detectLocationRequested
                    ? detectedLocation
                    : null,

            locationDetectionRequested:
                detectLocationRequested,

            presence,

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

                registrationAccepted:
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
            body,
            request
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

                registrationAccepted:
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
    DISCORD NOTIFICATION VERIFICATION
    ===================================================== */

    let discordNotificationAccess;

    try {
        discordNotificationAccess =
            await verifyDiscordNotificationAccess(
                request,
                env,
                registration
            );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE: Discord notification verification failed.",
            {
                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || null,

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

                registrationAccepted:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    "DISCORD_NOTIFICATION_VERIFICATION_FAILED",

                message:
                    "Discord notification eligibility could not be verified."
            },
            503
        );
    }

    if (
        discordNotificationAccess.valid !==
        true
    ) {
        return json(
            {
                success:
                    false,

                authenticated:
                    true,

                requiresEpicLogin:
                    false,

                registrationAccepted:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                code:
                    discordNotificationAccess
                        .code
                    || "DISCORD_NOTIFICATION_NOT_AVAILABLE",

                message:
                    discordNotificationAccess
                        .message
                    || "Discord notifications are not currently available."
            },
            400
        );
    }

    /* =====================================================
    ENSURE ROCKET LEAGUE PLAYER
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
                    || error
                        ?.upstreamCode
                    || null,

                upstreamStatus:
                    error
                        ?.upstreamStatus
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            error?.code ===
                "EPIC_ACCOUNT_REQUIRED"
            || error?.message ===
                "EPIC_IDENTITY_NOT_LINKED"
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    requiresEpicLogin:
                        true,

                    registrationAccepted:
                        false,

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

                registrationAccepted:
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

                registrationAccepted:
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
                    error
                        ?.upstreamStatus
                    || null,

                upstreamCode:
                    error
                        ?.upstreamCode
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

                registrationAccepted:
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
        && returnedAccountId !==
            accountId
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

                registrationAccepted:
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
        result?.profile_saved ===
            true
        || result?.profileSaved ===
            true;

    const storedProfileComplete =
        result?.profile_complete ===
            true
        || result?.profileComplete ===
            true;

    const storedRocketLeagueAccess =
        result
            ?.rocket_league_access ===
            true
        || result
            ?.rocketLeagueAccess ===
            true;

    const registrationAccepted =
        profileSaved ===
            true
        && registration.ageConsent ===
            true
        && registration.policyConsent ===
            true
        && storedProfileComplete ===
            true;

    const profileComplete =
        registrationAccepted ===
            true
        && storedProfileComplete ===
            true;

    const rocketLeagueAccess =
        registrationAccepted ===
            true
        && profileComplete ===
            true
        && storedRocketLeagueAccess ===
            true;

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

            registrationAccepted,

            profileSaved,

            profileComplete,

            rocketLeagueAccess,

            accountId,

            userId:
                accountId,

            rlPlayerId,

            playerCreated:
                ensuredPlayer
                    .createdPlayer ===
                true,

            playerAdopted:
                ensuredPlayer
                    .adoptedPlayer ===
                true,

            role:
                result?.role
                || sessionContext.role
                || null,

            active:
                result?.active ===
                true,

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
                    result?.active ===
                    true,

                EpicUniqueId:
                    epicUser
                        .EpicUniqueId,

                EpicDisplayName:
                    epicUser
                        .EpicDisplayName,

                EpicPreferredUsername:
                    epicUser
                        .EpicPreferredUsername
            },

            message:
                profileSaved
                    ? (
                        registrationAccepted
                            ? "Your Rocket League profile was saved."
                            : "Your Rocket League profile was saved but registration requirements remain incomplete."
                    )
                    : "Your Rocket League profile could not be confirmed as saved.",

            redirectTo:
                profileSaved
                && registrationAccepted
                && rocketLeagueAccess
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
            request.method ===
            "GET"
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
            request.method ===
            "POST"
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

                registrationAccepted:
                    false,

                profileSaved:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
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

                code:
                    error?.code
                    || null,

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

                registrationAccepted:
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