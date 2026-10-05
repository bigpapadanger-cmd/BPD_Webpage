"use strict";
import { withUpstreamDeadline, fetchBoundedResponse, safeUpstreamErrorCode } from "../../http/upstream.js";

import { getProfileSettingsAvailability, normalizeNotificationsV2, normalizeProfileSettings } from "../../rl/profile_settings.js";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE LOOKUP

File:
    functions/services/supabase/rocketleague/rocketleague_profile.js

Purpose:
    Loads the authenticated global BPD account's Rocket
    League profile data from Supabase.

Description:
    - Uses identity.accounts.id as the lookup key.
    - Calls api.get_rocketleague_profile_v2.
    - Keeps BPD and Epic display names separate.
    - Normalizes Supabase snake_case fields.
    - Exposes explicit profile existence and registration state.
    - Supports separate input/current rank collections.
    - Keeps missing rank collections empty rather than creating
      synthetic rank data.
    - Performs read-only profile retrieval.
    - Never determines authentication itself.

Expected RPC Return Fields:
    account_id
    user_id
    rl_player_id
    epic_account_id
    epic_display_name
    bpd_display_name
    email
    phone
    role
    active
    rl_platform
    display_timezone
    region
    country_code
    auto_detect_region
    preferred_mode
    other_mode
    find_profile_enabled
    show_online_status
    age_consent
    policy_consent
    registration_status
    profile_complete
    rocket_league_access
    notifications_enabled
    notification_method
    reminder_mode
    availability
    input_ranked
    current_ranked
    provider
    stats
========================================================= */

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
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

function normalizeSafeCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" || typeof value === "string"
        ? Number(value)
        : NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const timestamp = value.trim();
    return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

async function getLegacyFindProfileValue(baseUrl, apiKey, accountId, signal) {
    try {
        const response = await fetchBoundedResponse(`${baseUrl}rpc/get_rocketleague_profile`, {
            signal,
            method: "POST",
            headers: {
                apikey: apiKey,
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api",
                Accept: "application/json"
            },
            body: JSON.stringify({ p_account_id: accountId })
        });
        if (!response.ok) return null;
        const body = await response.json();
        const value = body?.settings?.find_profile_enabled
            ?? body?.settings?.findProfileEnabled
            ?? body?.find_profile_enabled
            ?? body?.findProfileEnabled;
        return typeof value === "boolean" ? value : null;
    } catch {
        return null;
    }
}

/* =========================================================
OBJECT DATA CHECK
========================================================= */

function hasObjectData(
    value
) {
    return Object.keys(
        normalizeObject(
            value
        )
    ).length > 0;
}

/* =========================================================
MAIN PROFILE LOOKUP
========================================================= */

async function readRocketLeagueProfile(
    env,
    accountId,
    { includeLegacyFindProfileFallback = false } = {},
    signal
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        throw new Error(
            "Rocket League profile lookup requires an account ID."
        );
    }

    const supabaseUrl =
        normalizeString(
            env.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env.SUPABASE_AUTH
        );

    if (
        !supabaseUrl
        || !apiKey
    ) {
        throw new Error(
            "Supabase configuration is unavailable."
        );
    }

    const baseUrl =
        supabaseUrl.endsWith(
            "/"
        )
            ? supabaseUrl
            : `${supabaseUrl}/`;

    const response =
        await fetchBoundedResponse(
            `${baseUrl}rpc/get_rocketleague_profile_v2`,
            {
                signal,
                method:
                    "POST",

                headers: {
                    "apikey":
                        apiKey,

                    "Authorization":
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            normalizedAccountId
                    })
            }
        );

    const responseText =
        await response.text();

    let responseData =
        null;

    try {
        responseData =
            responseText
                ? JSON.parse(
                    responseText
                )
                : null;
    }
    catch {
        throw Object.assign(new Error("Supabase profile response was invalid."), {
            code: "UPSTREAM_RESPONSE_INVALID", status: 503
        });
    }

    /* =====================================================
    SUPABASE REQUEST FAILURE
    ===================================================== */

    if (
        !response.ok
    ) {
        console.error(
            "ROCKET LEAGUE PROFILE GET: Supabase rejected request.",
            {
                status:
                    response.status,

                statusText:
                    response.statusText,

                responseType:
                    typeof responseData
            }
        );

        const message =
            (
                responseData
                && typeof responseData ===
                    "object"
                && !Array.isArray(
                    responseData
                )
            )
                ? (
                    normalizeString(
                        responseData.message
                    )
                    || normalizeString(
                        responseData.error
                    )
                )
                : "";

        const error =
            new Error(
                "Supabase profile request failed."
            );

        error.upstreamStatus =
            response.status;

        error.upstreamCode =
            (
                responseData
                && typeof responseData ===
                    "object"
                && !Array.isArray(
                    responseData
                )
            )
                ? safeUpstreamErrorCode(responseData.code)
                : "UPSTREAM_REJECTED";

        throw error;
    }

    /* =====================================================
    NO PROFILE RETURNED

    The RPC may return null when no persisted Rocket League
    profile exists for this BPD account.
    ===================================================== */

    if (
        !responseData
        || typeof responseData !==
            "object"
        || Array.isArray(
            responseData
        )
    ) {
        return null;
    }

    /* =====================================================
    ACCOUNT OWNERSHIP VALIDATION
    ===================================================== */

    const returnedAccountId =
        normalizeNullableString(
            responseData.account_id
            ?? responseData.user_id
        );

    if (
        returnedAccountId
        && returnedAccountId !==
            normalizedAccountId
    ) {
        throw new Error(
            "Rocket League profile returned an unexpected account ID."
        );
    }

    /* =====================================================
    PROFILE IDENTITY
    ===================================================== */

    const rlPlayerId =
        normalizeNullableString(
            responseData.rl_player_id
        );

    const profileExists =
        Boolean(
            rlPlayerId
        );

    /* =====================================================
    REGISTRATION STATE
    ===================================================== */

    const registrationStatus =
        normalizeString(
            responseData.registration_status
        )
            .toLowerCase()
        || "incomplete";

    const registrationAccepted =
        registrationStatus ===
        "complete";

    const profileComplete =
        responseData.profile_complete ===
        true;

    const rocketLeagueAccess =
        responseData.rocket_league_access ===
        true;

    /* =====================================================
    INPUT RANK DATA

    Player-entered/start-of-registration data.

    Missing data remains an empty object.
    ===================================================== */

    const inputRanked =
        hasObjectData(
            responseData.input_ranked
        )
            ? normalizeObject(
                responseData.input_ranked
            )
            : {};

    /* =====================================================
    CURRENT AUTHORITATIVE RANK DATA

    Preferred:
        current_ranked

    Transitional compatibility:
        ranked

    Missing rank data remains {}.

    Do not synthesize "Unranked" objects here because that
    would incorrectly make the UI believe authoritative rank
    data exists.
    ===================================================== */

    const currentRanked =
        hasObjectData(
            responseData.current_ranked
        )
            ? normalizeObject(
                responseData.current_ranked
            )
            : (
                hasObjectData(
                    responseData.ranked
                )
                    ? normalizeObject(
                        responseData.ranked
                    )
                    : {}
            );

    const providerData = normalizeObject(responseData.provider);
    const careerData = normalizeObject(responseData.stats);
    const careerFields = ["wins", "goals", "assists", "saves", "shots", "mvps"];
    const careerStats = Object.fromEntries(careerFields.map(field => [field, normalizeSafeCount(careerData[field])]));
    careerStats.capturedAt = normalizeTimestamp(careerData.captured_at);
    careerStats.updatedAt = normalizeTimestamp(careerData.updated_at);
    const provider = {
        displayUsername: normalizeNullableString(providerData.display_username),
        providerUpdatedAt: normalizeTimestamp(providerData.provider_updated_at),
        capturedAt: normalizeTimestamp(providerData.captured_at),
        updatedAt: normalizeTimestamp(providerData.updated_at)
    };
    let settings = normalizeProfileSettings(responseData);
    if (includeLegacyFindProfileFallback && typeof settings.findProfileEnabled !== "boolean") {
        const findProfileEnabled = await getLegacyFindProfileValue(baseUrl, apiKey, normalizedAccountId, signal);
        if (typeof findProfileEnabled === "boolean") {
            settings = normalizeProfileSettings({ ...responseData, find_profile_enabled: findProfileEnabled });
        }
    }
    if (Object.hasOwn(responseData, "notifications_v2")) {
        settings.notificationsV2 = normalizeNotificationsV2(responseData.notifications_v2);
    }
    const settingsAvailability = getProfileSettingsAvailability({ ...responseData, find_profile_enabled: typeof settings.findProfileEnabled === "boolean" ? settings.findProfileEnabled : responseData.find_profile_enabled });

    /* =====================================================
    NORMALIZED PROFILE
    ===================================================== */

    return {
        accountId:
            returnedAccountId
            || normalizedAccountId,

        userId:
            returnedAccountId
            || normalizedAccountId,

        rlPlayerId,

        profileExists,

        bpdDisplayName:
            normalizeNullableString(
                responseData.bpd_display_name
            ),

        epicAccountId:
            normalizeNullableString(
                responseData.epic_account_id
            ),

        epicDisplayName:
            normalizeNullableString(
                responseData.epic_display_name
            ),

        email:
            normalizeString(
                responseData.email
            ),

        phone:
            normalizeString(
                responseData.phone
            ),

        role:
            normalizeString(
                responseData.role
            )
            || "user",

        active:
            responseData.active ===
            true,

        rlPlatform:
            normalizeNullableString(
                responseData.rl_platform
            ),

        primaryPlatform:
            normalizeNullableString(
                responseData.primary_platform
            ),

        notificationsV2:
            Object.hasOwn(responseData, "notifications_v2")
                ? normalizeNotificationsV2(responseData.notifications_v2)
                : null,

        discordNotificationState:
            normalizeObject(responseData.discord_notification_state),

        autoDetectRegion:
            responseData.auto_detect_region ===
            true,

        location: {
            region:
                normalizeString(
                    responseData.region
                ),

            countryCode:
                normalizeString(
                    responseData.country_code
                ),

            timezone:
                normalizeString(
                    responseData.display_timezone
                )
        },

        displayTimezone:
            normalizeNullableString(
                responseData.display_timezone
            ),

        preferredMode:
            normalizeNullableString(
                responseData.preferred_mode
            ),

        otherMode:
            normalizeString(
                responseData.other_mode
            ),

        findProfileEnabled:
            settings.findProfileEnabled,

        showOnlineStatus:
            responseData.show_online_status ===
            true,

        ageConsent:
            responseData.age_consent ===
            true,

        policyConsent:
            responseData.policy_consent ===
            true,

        registrationStatus,

        registrationAccepted,

        profileComplete,

        rocketLeagueAccess,

        notificationsEnabled:
            responseData.notifications_enabled ===
            true,

        notificationMethod:
            normalizeNullableString(
                responseData.notification_method
            ),

        reminderMode:
            normalizeNullableString(
                responseData.reminder_mode
            ),

        availability:
            Array.isArray(
                responseData.availability
            )
                ? responseData.availability
                : [],

        ranks: {
            input:
                inputRanked,

            current:
                currentRanked
        },

        provider,

        careerStats,

        /*
         * Compatibility aliases while older UI components
         * still consume ranked/stats.ranked.
         */
        ranked:
            currentRanked,

        stats: {
            ranked:
                currentRanked
        },

        settings,
        settingsAvailability
    };
}

export function getRocketLeagueProfileByAccountId(env, accountId, options = {}) {
    return withUpstreamDeadline(signal => readRocketLeagueProfile(env, accountId, options, signal));
}
