"use strict";

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
    - Calls api.get_rocketleague_profile.
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

export async function getRocketLeagueProfileByAccountId(
    env,
    accountId
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
        await fetch(
            `${baseUrl}rpc/get_rocketleague_profile`,
            {
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
        responseData =
            responseText;
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
                message
                || "Supabase profile request failed."
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
                ? normalizeNullableString(
                    responseData.code
                )
                : null;

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

        /*
         * Compatibility aliases while older UI components
         * still consume ranked/stats.ranked.
         */
        ranked:
            currentRanked,

        stats: {
            ranked:
                currentRanked
        }
    };
}