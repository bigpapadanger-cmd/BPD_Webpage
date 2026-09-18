"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE SAVE CLIENT

File:
    functions/services/supabase/rocketleague/save_profile.js

Purpose:
    Calls the Rocket League profile save RPC in Supabase.

Description:
    - Saves initial Rocket League profile/setup data.
    - Uses identity.accounts.id as the ownership key.
    - Sends only normalized fields expected by
      api.save_rocketleague_profile.
    - Requires age/eligibility confirmation.
    - Requires Terms of Service / Privacy acknowledgement.
    - Email and phone are optional.
    - Does not save a player-entered rank.
    - Uses notificationMethod instead of contactMethod.
    - Supports explicitly opted-in coarse region/time-zone
      storage.
    - Clears region/time-zone values when automatic detection
      is disabled.
    - Clears notification delivery settings when notifications
      are disabled.
    - Returns the authoritative RPC result.
    - Never accepts Epic account ID as ownership proof.

Database RPC:
    api.save_rocketleague_profile

Identity:
    accountId
        = identity.accounts.id

Important:
    - accountId must come from authenticated server context.
    - Browser-submitted account IDs are never passed here.
    - Browser-submitted Epic IDs are never passed here.
    - Age consent and policy/privacy consent must both be true.
    - Region/time-zone values are persisted only when
      autoDetectRegion=true.
    - This service does not manufacture profile completion,
      registration completion, or Rocket League access.
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
        : null;
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
LOCAL ERROR
========================================================= */

function createValidationError(
    code,
    message,
    status = 400
) {
    const error =
        new Error(
            message
        );

    error.code =
        code;

    error.status =
        status;

    return error;
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const url =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !url
        || !apiKey
    ) {
        return null;
    }

    return {
        url:
            url.endsWith("/")
                ? url
                : `${url}/`,

        apiKey
    };
}

/* =========================================================
RPC ERROR
========================================================= */

async function createRpcError(
    response
) {
    let data =
        null;

    try {
        data =
            await response.json();
    }
    catch {
        // Ignore malformed upstream response.
    }

    const message =
        normalizeString(
            data?.message
        )
        || normalizeString(
            data?.error
        )
        || `Rocket League profile save failed: ${response.status}`;

    const error =
        new Error(
            message
        );

    error.code =
        "ROCKET_LEAGUE_PROFILE_SAVE_RPC_FAILED";

    error.status =
        response.status;

    error.upstreamStatus =
        response.status;

    error.upstreamCode =
        normalizeNullableString(
            data?.code
        );

    return error;
}

/* =========================================================
AUTHORITATIVE REGISTRATION VALIDATION

This is a second server-side consent gate.

profile.js already validates these fields before calling this
service, but this service also refuses to call Supabase unless
both mandatory acknowledgements are true.

This prevents another server-side caller from accidentally
bypassing the required eligibility and policy gates.
========================================================= */

function validateRegistration(
    registration
) {
    if (
        !registration
        || typeof registration !==
            "object"
        || Array.isArray(
            registration
        )
    ) {
        throw createValidationError(
            "ROCKET_LEAGUE_REGISTRATION_INVALID",
            "Rocket League registration data is invalid."
        );
    }

    if (
        registration.ageConsent !==
        true
    ) {
        throw createValidationError(
            "ROCKET_LEAGUE_AGE_CONSENT_REQUIRED",
            "Eligibility confirmation is required."
        );
    }

    if (
        registration.policyConsent !==
        true
    ) {
        throw createValidationError(
            "ROCKET_LEAGUE_POLICY_CONSENT_REQUIRED",
            "Terms of Service and Privacy Policy acknowledgement is required."
        );
    }
}

/* =========================================================
RPC RESPONSE NORMALIZATION
========================================================= */

function normalizeRpcResult(
    result
) {
    const row =
        Array.isArray(
            result
        )
            ? result[0]
                || null
            : result;

    if (
        !row
        || typeof row !==
            "object"
        || Array.isArray(
            row
        )
    ) {
        throw createValidationError(
            "ROCKET_LEAGUE_PROFILE_SAVE_INVALID_RESPONSE",
            "Rocket League profile save returned no valid result.",
            502
        );
    }

    return row;
}

/* =========================================================
SAVE PROFILE
========================================================= */

export async function saveRocketLeagueProfile(
    env,
    accountId,
    registration
) {
    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        throw createValidationError(
            "SUPABASE_CONFIGURATION_MISSING",
            "Supabase configuration is unavailable.",
            500
        );
    }

    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        throw createValidationError(
            "ACCOUNT_ID_REQUIRED",
            "Rocket League profile save requires an account ID.",
            400
        );
    }

    /*
     * Fail closed before any database write.
     */
    validateRegistration(
        registration
    );

    /*
     * Automatic region detection is explicitly opt-in.
     *
     * Missing or malformed values are false.
     */
    const autoDetectRegion =
        normalizeBoolean(
            registration.autoDetectRegion,
            false
        );

    /*
     * Only retain location information when region detection
     * is currently enabled.
     *
     * If the user previously enabled detection and later turns
     * it off, all region/time-zone values sent to Supabase are
     * explicitly null so the RPC can clear persisted values.
     */
    const location =
        autoDetectRegion
            ? normalizeObject(
                registration.location
            )
            : null;

    const region =
        autoDetectRegion
            ? normalizeNullableString(
                location?.region
            )
            : null;

    const countryCode =
        autoDetectRegion
            ? normalizeNullableString(
                location?.countryCode
            )
            : null;

    const displayTimezone =
        autoDetectRegion
            ? normalizeNullableString(
                registration.timezone
            )
            : null;

    /*
     * Notification settings also fail closed.
     *
     * When notifications are disabled, delivery method and
     * reminder settings are cleared rather than allowing stale
     * values to remain authoritative.
     */
    const notificationsEnabled =
        registration.notificationsEnabled ===
        true;

    const notificationMethod =
        notificationsEnabled
            ? normalizeNullableString(
                registration.notificationMethod
            )
            : null;

    const reminderMode =
        notificationsEnabled
            ? normalizeNullableString(
                registration.reminderMode
            )
            : null;

    const preferredMode =
        normalizeNullableString(
            registration.preferredMode
        );

    const otherMode =
        preferredMode ===
            "other"
            ? normalizeNullableString(
                registration.otherMode
            )
            : null;

    const payload = {
        s_account_id:
            normalizedAccountId,

        /*
         * Both values are guaranteed true here because
         * validateRegistration() rejects anything else.
         */
        s_age_consent:
            true,

        s_policy_consent:
            true,

        s_auto_detect_region:
            autoDetectRegion,

        /*
         * These become null whenever automatic region
         * detection is disabled.
         */
        s_region:
            region,

        s_country_code:
            countryCode,

        s_display_timezone:
            displayTimezone,

        s_show_online_status:
            registration.showOnlineStatus ===
            true,

        s_email_address:
            normalizeNullableString(
                registration.email
            ),

        s_phone_number:
            normalizeNullableString(
                registration.phone
            ),

        s_preferred_mode:
            preferredMode,

        s_other_mode:
            otherMode,

        s_availability:
            Array.isArray(
                registration.availability
            )
                ? registration.availability
                : [],

        s_notifications_enabled:
            notificationsEnabled,

        s_notification_method:
            notificationMethod,

        s_reminder_mode:
            reminderMode
    };

    const url =
        new URL(
            "rpc/save_rocketleague_profile",
            configuration.url
        );

    let response;

    try {
        response =
            await fetch(
                url.href,
                {
                    method:
                        "POST",

                    headers: {
                        "apikey":
                            configuration.apiKey,

                        "Authorization":
                            `Bearer ${configuration.apiKey}`,

                        "Content-Profile":
                            "api",

                        "Accept-Profile":
                            "api",

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );
    }
    catch (
        error
    ) {
        const networkError =
            new Error(
                "Rocket League profile save service is unavailable."
            );

        networkError.code =
            "ROCKET_LEAGUE_PROFILE_SAVE_UNAVAILABLE";

        networkError.status =
            502;

        networkError.cause =
            error;

        throw networkError;
    }

    if (
        !response.ok
    ) {
        throw await createRpcError(
            response
        );
    }

    let result;

    try {
        result =
            await response.json();
    }
    catch {
        throw createValidationError(
            "ROCKET_LEAGUE_PROFILE_SAVE_INVALID_JSON",
            "Rocket League profile save returned an invalid response.",
            502
        );
    }

    const row =
        normalizeRpcResult(
            result
        );

    /*
     * Supabase is the final authority for:
     *
     * - whether the profile was saved;
     * - registration status;
     * - profile completion;
     * - Rocket League access;
     * - canonical RL player identity.
     *
     * This service intentionally does not manufacture those
     * values.
     */
    return row;
}