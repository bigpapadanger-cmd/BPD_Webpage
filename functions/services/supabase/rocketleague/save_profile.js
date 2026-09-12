"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE SAVE CLIENT

File:
    functions/services/supabase/rocketleague/save_profile.js

Purpose:
    Calls the Rocket League profile save RPC in Supabase.

Description:
    - Saves Rocket League registration/profile data.
    - Uses identity.accounts.id as the ownership key.
    - Sends only normalized registration fields expected by
      api.save_rocketleague_profile.
    - Returns the authoritative RPC result.
    - Never accepts Epic account ID as ownership proof.

Database RPC:
    api.save_rocketleague_profile

Identity:
    accountId
        = identity.accounts.id

Important:
    - accountId must come from the authenticated BPD session.
    - Browser-submitted account IDs must never be passed here.
    - Epic account ID is not used to determine ownership.
========================================================= */

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value.trim();
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

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const url =
        normalizeString(
            env.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env.SUPABASE_AUTH
        );

    if (
        !url
        || !apiKey
    ) {
        return null;
    }

    return {
        url:
            url.endsWith(
                "/"
            )
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

    error.upstreamStatus =
        response.status;

    error.upstreamCode =
        normalizeNullableString(
            data?.code
        );

    return error;
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
        throw new Error(
            "Supabase configuration is unavailable."
        );
    }

    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        throw new Error(
            "Rocket League profile save requires an account ID."
        );
    }

    if (
        !registration
        || typeof registration !== "object"
        || Array.isArray(
            registration
        )
    ) {
        throw new Error(
            "Rocket League registration data is invalid."
        );
    }

    const response =
        await fetch(
            `${configuration.url}rpc/save_rocketleague_profile`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Content-Profile":
                        "api",

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        s_account_id:
                            normalizedAccountId,

                        s_age_consent:
                            registration.ageConsent === true,

                        s_current_rank:
                            normalizeNullableString(
                                registration.currentRank
                            ),

                        s_contact_method:
                            normalizeNullableString(
                                registration.contactMethod
                            ),

                        s_email_address:
                            normalizeNullableString(
                                registration.email
                            ),

                        s_phone_number:
                            normalizeNullableString(
                                registration.phone
                            ),

                        s_preferred_mode:
                            normalizeNullableString(
                                registration.preferredMode
                            ),

                        s_other_mode:
                            normalizeNullableString(
                                registration.otherMode
                            ),

                        s_display_timezone:
                            normalizeNullableString(
                                registration.timezone
                            ),

                        s_availability:
                            Array.isArray(
                                registration.availability
                            )
                                ? registration.availability
                                : [],

                        s_show_online_status:
                            registration.showOnlineStatus === true,

                        s_notifications_enabled:
                            registration.notificationsEnabled === true,

                        s_reminder_mode:
                            normalizeNullableString(
                                registration.reminderMode
                            )
                    })
            }
        );

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
        throw new Error(
            "Rocket League profile save returned an invalid response."
        );
    }

    if (
        !result
        || typeof result !== "object"
        || Array.isArray(
            result
        )
    ) {
        throw new Error(
            "Rocket League profile save returned no result."
        );
    }

    return result;
}