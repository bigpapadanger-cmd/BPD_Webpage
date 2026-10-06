import { authorizationErrorResponse } from "./authorization.js";
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
    - Activates scheduled presence monitoring only after an
      explicit profile save with sharing enabled.

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
//For the next step, the important file is functions/services/rl/profile.js. 
//That is where we should fire the first MMR lookup after a Rocket League
//profile becomes fully valid.

import {
    refreshStatsWithGate
} from "./stats/refresh_with_gate.js";
import {
    refreshProviderDataWithGate
} from "./provider_data/refresh.js";
import {
    getLatestMmr
} from "./stats/latest_mmr.js";
import {
    json
} from "../common_helpers/responses.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../auth/authorization.js";
import { canAccountPerform } from "../auth/account/access.js";

import {
    ensureRocketLeaguePlayer
} from "../supabase/rocketleague/ensure_player.js";

import {
    getRocketLeagueProfileByAccountId
} from "../supabase/rocketleague/rocketleague_profile.js";
import {
    getRocketLeagueMmrProgressionSafely
} from "../supabase/rocketleague/get_mmr_progression.js";

import {
    saveRocketLeagueProfile
} from "../supabase/rocketleague/save_profile.js";

import {
    getDiscordMatchBotEligibility
} from "../auth/providers/discord_matchbot/eligibility.js";
import { getProfileSettingsAvailability, getProfileUpdateSafetyError, normalizeProfileSettings, PROFILE_SETTING_FIELDS } from "./profile_settings.js";
import { getRocketLeagueMmrHistorySafely } from "../supabase/rocketleague/get_mmr_history.js";

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

const ALLOWED_PRIMARY_PLATFORMS = ["epic", "steam", "playstation", "xbox", "nintendo_switch", "other"];
const MAX_REMINDER_MINUTES = 11460;
const MIN_REMINDER_MINUTES = 15;

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

export function normalizeDatabaseProfile(
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
    const provider = normalizeObject(databaseProfile.provider);
    const careerStats = normalizeObject(databaseProfile.careerStats);
    const settings = normalizeProfileSettings(databaseProfile);
    const settingsAvailability = {
        ...getProfileSettingsAvailability(databaseProfile),
        ...normalizeObject(databaseProfile.settingsAvailability),
        // A valid persisted boolean is authoritative if an older availability
        // projection incorrectly says this field is unavailable.
        findProfileEnabled: typeof settings.findProfileEnabled === "boolean"
    };

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
            settings.autoDetectRegion === true,

        location: {
            region: settings.region ?? "",
            countryCode: settings.countryCode ?? "",
            timezone: settings.displayTimezone ?? ""
        },

        timezone:
            settings.displayTimezone ?? "",

        showOnlineStatus:
            settings.showOnlineStatus === true,

        findProfileEnabled:
            settings.findProfileEnabled,

        email:
            normalizeString(
                settings.email,
                254
            ),

        phone:
            normalizeString(
                settings.phone,
                24
            ),

        preferredMode:
            normalizeString(
                settings.preferredMode,
                20
            ),

        otherMode:
            normalizeString(
                settings.otherMode,
                50
            ),

        availability:
            Array.isArray(
                settings.availability
            )
                ? settings.availability
                : [],

        notificationsEnabled:
            settings.notificationsEnabled === true,

        notificationMethod:
            normalizeNullableString(
                settings.notificationMethod,
                20
            ),

        reminderMode:
            normalizeNullableString(
                settings.reminderMode,
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

        provider: {
            displayUsername:
                normalizeNullableString(
                    provider.displayUsername
                    || provider.display_username
                ),
            providerUpdatedAt:
                provider.providerUpdatedAt
                || provider.provider_updated_at
                || null,
            capturedAt:
                provider.capturedAt
                || provider.captured_at
                || null,
            updatedAt:
                provider.updatedAt
                || provider.updated_at
                || null
        },

        ranks,

        ranked:
            ranks.current,

        stats: {
            ranked: ranks.current,
            career: {
                ...careerStats,
                capturedAt: careerStats.capturedAt || careerStats.captured_at || null
            }
        },

        settings,
        settingsAvailability
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

        findProfileEnabled:
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
            ranked: {},
            career: {
                wins: null,
                goals: null,
                assists: null,
                saves: null,
                shots: null,
                mvps: null,
                capturedAt: null
            }
        },
        provider: {
            displayUsername: null,
            providerUpdatedAt: null
        },
        settings: normalizeProfileSettings({
            autoDetectRegion: false,
            region: null,
            countryCode: null,
            displayTimezone: null,
            preferredMode: "",
            otherMode: "",
            showOnlineStatus: false,
            findProfileEnabled: false,
            email: "",
            phone: "",
            availability: [],
            notificationsEnabled: true,
            notificationMethod: null,
            reminderMode: "24-hours"
        }),
        settingsAvailability: Object.fromEntries([
            ...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"
        ].map(key => [key, false]))
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

function normalizeOptionalString(
    body,
    key,
    maxLength
) {
    if (Object.prototype.hasOwnProperty.call(body || {}, key) && body[key] === null) {
        return null;
    }
    return normalizeString(body?.[key], maxLength);
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

        primaryPlatform:
            normalizeOptionalString(body, "primaryPlatform", 32)?.toLowerCase() ?? null,

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

        findProfileEnabled:
            Object.prototype.hasOwnProperty.call(body || {}, "findProfileEnabled")
                ? (typeof body.findProfileEnabled === "boolean" ? body.findProfileEnabled : null)
                : false,

        email:
            normalizeOptionalString(
                body,
                "email",
                254
            ),

        phone:
            normalizeOptionalString(
                body,
                "phone",
                24
            ),

        preferredMode:
            normalizeOptionalString(
                body,
                "preferredMode",
                20
            )
                ?.toLowerCase?.()
                ?? null,

        otherMode:
            normalizeOptionalString(
                body,
                "otherMode",
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
                    body?.reminderMode,
                    30
                )
                    .toLowerCase()
                : null,

        notificationsV2:
            body?.notificationsV2 && typeof body.notificationsV2 === "object" && !Array.isArray(body.notificationsV2)
                ? body.notificationsV2
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

    if (profile.primaryPlatform && !ALLOWED_PRIMARY_PLATFORMS.includes(profile.primaryPlatform)) {
        return "Select a valid primary platform.";
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

    if (profile.notificationsV2) {
        for (const channel of ["email", "sms", "discord"]) {
            const value = profile.notificationsV2[channel];
            if (!value || typeof value.enabled !== "boolean" || !Array.isArray(value.reminders)
                || value.reminders.length > 3
                || value.reminders.some(minutes => !Number.isInteger(minutes) || minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES)) {
                return "Check the notification channels and reminder times.";
            }
        }
        if (profile.notificationsV2.email.enabled && !profile.email) return "Add an email address to enable email notifications.";
        if (profile.notificationsV2.sms.enabled && !profile.phone) return "Add a phone number to enable SMS notifications.";
        return null;
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

function hasSavedDiscordNotificationsEnabled(profile) {
    const settings = profile?.settings && typeof profile.settings === "object"
        ? profile.settings
        : profile;
    const notifications = settings?.notificationsV2 || settings?.notifications_v2;
    if (typeof notifications?.discord?.enabled === "boolean") return notifications.discord.enabled;
    return settings?.notificationsEnabled === true && settings?.notificationMethod === "discord";
}

export function canEnableDiscordNotifications(requestedEnabled, previouslyEnabled, eligibility) {
    return requestedEnabled !== true || previouslyEnabled === true || eligibility?.eligible === true;
}

async function verifyDiscordNotificationAccess(
    request,
    env,
    accountId,
    registration,
    previouslyEnabled = false
) {
    const discordNotificationsEnabled = registration.notificationsV2
        ? registration.notificationsV2.discord?.enabled === true
        : registration.notificationsEnabled === true && registration.notificationMethod === "discord";
    if (!discordNotificationsEnabled) {
        return {
            valid: true,
            eligible: false
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
                valid: canEnableDiscordNotifications(true, previouslyEnabled, null),
                eligible: false,
                status: "not_linked",

                code:
                    "DISCORD_ACCOUNT_REQUIRED",

                message:
                    "A linked Discord account is required for Discord notifications."
            };
        }

        if (
            isAuthorizationError(error)
            && (error.status >= 500 || error.code === "AUTHORIZATION_UNAVAILABLE")
        ) {
            return {
                valid: canEnableDiscordNotifications(true, previouslyEnabled, null),
                status: "unavailable",
                eligible: false,
                reason: error.code || "DISCORD_AUTHORIZATION_UNAVAILABLE"
            };
        }

        if (
            isAuthorizationError(
                error
            )
        ) {
            return {
                valid: canEnableDiscordNotifications(true, previouslyEnabled, null),
                eligible: false,
                status: error.status >= 500 ? "unavailable" : "not_linked",

                code:
                    error.code
                    || "DISCORD_AUTHORIZATION_FAILED",

                message:
                    previouslyEnabled === true
                        ? "Your saved Discord reminder preference was preserved, but eligibility could not be verified."
                        : "Discord notification authorization could not be verified."
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
            valid: canEnableDiscordNotifications(true, previouslyEnabled, null),
            eligible: false,
            status: "not_linked",

            code:
                "DISCORD_IDENTITY_MISSING",

            message:
                "Your verified Discord identity could not be resolved."
        };
    }

    const eligibility =
        await getDiscordMatchBotEligibility(
            env,
            accountId
        );

    if (eligibility?.status === "unavailable" || eligibility?.status === "partial") {
        return {
            valid: canEnableDiscordNotifications(true, previouslyEnabled, eligibility),
            status: eligibility.status,
            reason: eligibility.reason,
            eligible: false,
            eligibility
        };
    }

    if (
        eligibility?.eligible !==
        true
    ) {
        return {
            valid: canEnableDiscordNotifications(true, previouslyEnabled, eligibility),
            eligible: false,
            status: eligibility?.status || "unavailable",

            code:
                eligibility?.reason
                || "MATCHBOT_REQUIRED",

            message:
                previouslyEnabled === true
                    ? "Your saved Discord reminder preference was preserved, but Discord notifications are not currently eligible."
                    : "Your Discord account must share a server with BPD MatchBot before Discord notifications can be enabled.",
            eligibility
        };
    }

    return {
        valid:
            true,
        eligible: true,
        eligibility,

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
    env,
    action = "manage_profile"
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

                    action,
                    requireFreshProvider: request.method === "POST",

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

        if (error.status >= 500 || error.code === "PROVIDER_REAUTHORIZATION_REQUIRED") {
            return { error: authorizationErrorResponse(error) };
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
    const requestUrl =
        new URL(
            request.url
        );

    const detectLocationRequested =
        requestUrl.searchParams.get(
            "detectLocation"
        ) ===
        "true";

    const includeMmrProgression =
        requestUrl.searchParams.get("includeMmrProgression") === "true";

    const includeMmrHistory =
        requestUrl.searchParams.get("includeMmrHistory") === "true";

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
                accountId,
                { includeLegacyFindProfileFallback: requestUrl.searchParams.get("includeLegacyFindProfile") === "true" }
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
            || databaseProfile?.rl_player_id
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

        console.error("ROCKET LEAGUE PROFILE: Profile load failed.", { code: "RL_PROFILE_OPERATION_FAILED" });
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
            "complete";

    const profileComplete =
        profileExists
        && registrationAccepted ===
            true
        && profile.profileComplete ===
            true;

    const rocketLeagueAccess = await canAccountPerform(env, accountId, "rocket_league");

    // Normal profile reads stay read-only: refresh jobs are triggered by
    // explicit/session lifecycle paths, not by every page load.
    const statsRefresh = null;

    /* =====================================================
    LATEST RECORDED MMR

    Reads KV first.

    Supabase is only checked when:
        - KV is missing, or
        - KV verification is due.

    Existing KV data remains available as a stale fallback
    if the authoritative Supabase read fails.
    ===================================================== */

    let latestMmr =
        null;

    let mmrProgression =
        null;

    let mmrHistory =
        null;

    if (
        profileExists
        && profile.active ===
            true
        && epicUser.linked ===
            true
    ) {
        if (includeMmrProgression && rocketLeagueAccess) {
            mmrProgression = await getRocketLeagueMmrProgressionSafely(env, accountId);
        }

        if (includeMmrHistory && rocketLeagueAccess) {
            mmrHistory = await getRocketLeagueMmrHistorySafely(env, accountId);
        }

        try {
            latestMmr =
                await getLatestMmr(
                    env,
                    accountId
                );

            console.info(
                "ROCKET LEAGUE PROFILE: Latest MMR resolved.",
                {
                    accountId,

                    available:
                        latestMmr?.available ===
                        true,

                    stale:
                        latestMmr?.stale ===
                        true,

                    verified:
                        latestMmr?.verified ===
                        true,

                    source:
                        latestMmr?.source
                        || null,

                    capturedAt:
                        latestMmr?.capturedAt
                        || null
                }
            );
        }
        catch (
            error
        ) {
            console.error("ROCKET LEAGUE PROFILE: Latest MMR load failed.", { code: "RL_PROFILE_OPERATION_FAILED" });

            latestMmr = {
                available:
                    false,

                stale:
                    false,

                verified:
                    false,

                source:
                    null,

                capturedAt:
                    null,

                ones: {
                    mmr:
                        null,

                    tier:
                        null
                },

                twos: {
                    mmr:
                        null,

                    tier:
                        null
                },

                threes: {
                    mmr:
                        null,

                    tier:
                        null
                }
            };
        }
    }

    /* =====================================================
    EXPOSE CURRENT MMR THROUGH PROFILE COMPATIBILITY FIELDS
    ===================================================== */

    if (
        latestMmr?.available ===
        true
    ) {
        profile.ranks = {
            ...profile.ranks,

            current: {
                ones:
                    latestMmr.ones,

                twos:
                    latestMmr.twos,

                threes:
                    latestMmr.threes,

                capturedAt:
                    latestMmr.capturedAt,

                stale:
                    latestMmr.stale ===
                    true,

                verified:
                    latestMmr.verified ===
                    true
            }
        };

        profile.ranked =
            profile.ranks.current;

        profile.stats = {
            ...profile.stats,

            ranked:
                profile.ranks.current
        };
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
                        ? profile.rlPlayerId
                        : null,

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

            location:
                detectLocationRequested
                    ? detectedLocation
                    : null,

            locationDetectionRequested:
                detectLocationRequested,

            presence:
                null,

            statsRefresh,

            latestMmr,

            mmrProgression,

            mmrHistory,

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
        console.error("ROCKET LEAGUE PROFILE: Registration JSON invalid.", { code: "RL_PROFILE_OPERATION_FAILED" });

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
    let previouslyEnabled = false;

    if (registration.notificationsV2?.discord?.enabled === true) {
        try {
            const currentProfile = await getRocketLeagueProfileByAccountId(env, accountId);
            previouslyEnabled = hasSavedDiscordNotificationsEnabled(currentProfile);
        } catch (error) {
            console.error("ROCKET LEAGUE PROFILE: Existing Discord preference could not be confirmed.", { code: "RL_PROFILE_OPERATION_FAILED" });
            return json({
                success: false,
                authenticated: true,
                registrationAccepted: false,
                profileSaved: false,
                code: "PROFILE_SETTINGS_UNAVAILABLE",
                message: "Your saved notification settings could not be verified. Try again before enabling Discord reminders."
            }, 503);
        }
    }

    try {
        discordNotificationAccess =
            await verifyDiscordNotificationAccess(
                request,
                env,
                accountId,
                registration,
                previouslyEnabled
            );
    }
    catch (
        error
    ) {
        console.error("ROCKET LEAGUE PROFILE: Discord notification verification failed.", { code: "RL_PROFILE_OPERATION_FAILED" });

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

    if (discordNotificationAccess.valid !== true) {
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
            discordNotificationAccess.status === "unavailable" ? 503 : 400
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
        console.error("ROCKET LEAGUE PROFILE: Player initialization failed.", { code: "RL_PROFILE_OPERATION_FAILED" });

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
        console.error("ROCKET LEAGUE PROFILE: Profile save failed.", { code: "RL_PROFILE_OPERATION_FAILED" });

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

    const registrationAccepted =
        profileSaved ===
            true
        && (result?.registrationStatus ?? result?.registration_status) === "complete";

    const profileComplete =
        registrationAccepted ===
            true
        && storedProfileComplete ===
            true;

    const rocketLeagueAccess = await canAccountPerform(env, accountId, "rocket_league");

    /* =====================================================
    INITIAL / GATED MMR REFRESH

    Successful Rocket League registration requests a stats
    refresh through the KV gate.

    Flow:
        KV gate active
            -> skip refresh work

        KV gate missing
            -> refreshStats() performs authoritative checks

    MMR failures do not undo successful registration.
    ===================================================== */

    let statsRefresh =
        null;
    let providerDataRefresh =
        null;
    if (
        profileSaved ===
            true
        && registrationAccepted ===
            true
        && rocketLeagueAccess ===
            true
    ) {
        let mayRefreshRocketLeague = false;
        try { mayRefreshRocketLeague = await canAccountPerform(env, accountId, "refresh_rl_stats"); }
        catch { /* Fail closed for background provider work; retain the saved profile. */ }
        if (!mayRefreshRocketLeague) {
            statsRefresh = { success: false, refreshed: false, skipped: true, code: "RL_REFRESH_NOT_AUTHORIZED" };
        } else {
        try {
            statsRefresh =
                await refreshStatsWithGate(
                    env,
                    accountId
                );

            console.info(
                "ROCKET LEAGUE PROFILE: Background stats refresh completed.",
                {
                    accountId,

                    result:
                        statsRefresh
                }
            );
        }
        catch (
            error
        ) {
            console.error("ROCKET LEAGUE PROFILE: Background stats refresh failed.", { code: "RL_PROFILE_OPERATION_FAILED" });

            statsRefresh = {
                success:
                    false,

                refreshed:
                    false,

                code:
                    error?.code
                    || "STATS_REFRESH_FAILED"
            };
        }

        if (statsRefresh?.refreshed === true) {
            try {
                providerDataRefresh = await refreshProviderDataWithGate(
                    env,
                    accountId,
                    statsRefresh
                );
            } catch (error) {
                providerDataRefresh = {
                    refreshed: false,
                    reason: error?.code || "PROVIDER_REFRESH_FAILED"
                };
            }
        }
        }
    }

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

            statsRefresh,

            providerDataRefresh,

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
                    ? "/RocketLeague/MyProfile"
                    : null
        },
        profileSaved
            ? 200
            : 500
    );
}

async function handleProfilePatch(request, env, sessionContext, accountId) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ success: false, code: "INVALID_PROFILE_SETTINGS", message: "Profile settings were invalid." }, 400);
    }

    let current;
    try {
        current = await getRocketLeagueProfileByAccountId(env, accountId);
    } catch {
        return json({ success: false, code: "PROFILE_SETTINGS_UNAVAILABLE", message: "Your saved profile could not be verified." }, 503);
    }
    if (!await canAccountPerform(env, accountId, "rocket_league")) {
        return json({ success: false, code: "PROFILE_SETUP_REQUIRED", message: "Complete Rocket League profile setup before editing preferences." }, 409);
    }

    const safetyError = getProfileUpdateSafetyError(current, body);
    if (safetyError) {
        return json({ success: false, code: safetyError, message: safetyError === "PROFILE_SETTINGS_UNAVAILABLE"
            ? "Your saved settings could not be confirmed. Reload your profile before saving."
            : "Send the complete editable profile settings before saving." }, safetyError === "PROFILE_SETTINGS_UNAVAILABLE" ? 503 : 400);
    }

    const settings = normalizeRegistrationPayload(body, request);
    // Consent is setup-owned: preserve the authoritative saved values and never
    // make a My Profile edit act as a fresh consent submission.
    settings.ageConsent = current.ageConsent === true;
    settings.policyConsent = current.policyConsent === true;
    const validationError = validateRegistrationPayload(settings);
    if (validationError) return json({ success: false, code: "INVALID_PROFILE_SETTINGS", message: validationError }, 400);

    const previouslyEnabled = hasSavedDiscordNotificationsEnabled(current);
    const discordAccess = await verifyDiscordNotificationAccess(request, env, accountId, settings, previouslyEnabled);
    if (discordAccess.valid !== true) {
        return json({ success: false, code: discordAccess.code || "DISCORD_NOTIFICATION_NOT_AVAILABLE", message: discordAccess.message || "Discord notifications are not currently available." }, discordAccess.status === "unavailable" ? 503 : 400);
    }

    try {
        const saved = await saveRocketLeagueProfile(env, accountId, settings);
        return json({
            success: saved?.saved !== false,
            authenticated: true,
            profileSaved: saved?.saved !== false,
            registrationAccepted: true,
            profileComplete: true,
            rocketLeagueAccess: true,
            message: saved?.saved === false ? "Your profile settings are unchanged." : "Your Rocket League profile settings were updated."
        }, saved?.saved === false ? 200 : 200);
    } catch (error) {
        console.error("ROCKET LEAGUE PROFILE: Settings update failed.", { code: error?.code || null, status: error?.status || null });
        return json({ success: false, authenticated: true, profileSaved: false, code: error?.code || "PROFILE_SETTINGS_SAVE_FAILED", message: "Your profile settings could not be saved." }, Number.isInteger(error?.status) ? error.status : 500);
    }
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
                env,
                request.method === "GET" ? "view_account" : "manage_profile"
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
            return await handleProfileGet(
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
            return await handleProfilePost(
                request,
                env,
                sessionContext,
                accountId,
                epicUser
            );
        }

        if (request.method === "PATCH") {
            return await handleProfilePatch(request, env, sessionContext, accountId);
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
                    "GET, POST, PATCH"
            }
        );
    }
    catch (
        error
    ) {
        console.error("ROCKET LEAGUE PROFILE: Unexpected failure.", { code: "RL_PROFILE_OPERATION_FAILED" });

        return authorizationErrorResponse(
            error
        );
    }
}
