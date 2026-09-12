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
    - Keeps the global BPD display name separate from the
      linked Epic provider display name.
    - Normalizes Supabase snake_case fields into the
      camelCase structure used by Rocket League services.
    - Performs read-only profile retrieval.
    - Never determines authentication itself.

Flow:
    Cloudflare Rocket League profile/session service
        ↓
    getRocketLeagueProfileByAccountId()
        ↓
    Supabase RPC:
        api.get_rocketleague_profile
        ↓
    Supabase returns authoritative Rocket League state
        ↓
    Normalize response for application services

Identity Model:
    accountId
        = identity.accounts.id

    core.rl_players.account_id
        = identity.accounts.id

Display Name Model:
    bpdDisplayName
        = identity.accounts.display_name

    epicDisplayName
        = identity.account_identities.display_username
          where provider = 'epic'

Important:
    - The browser does NOT call Supabase directly.
    - The Supabase secret remains server-side.
    - accountId must come from the authenticated BPD session.
    - Epic account ID is provider/domain metadata only.
    - There is no separate user-selected Rocket League
      display name.
    - This function does NOT create or update profiles.
    - Rocket League access is returned by Supabase and is not
      independently recalculated here.

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
    current_rank
    contact_method
    preferred_mode
    other_mode
    show_online_status
    age_consent
    registration_status
    profile_complete
    rocket_league_access
    notifications_enabled
    reminder_mode
    specific_reminder_times
    availability
    ranked
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
DEFAULT RANKED STATE
========================================================= */

function createDefaultRankedState() {
    return {
        duel: {
            tier:
                "Unranked",

            division:
                "",

            mmr:
                null
        },

        double: {
            tier:
                "Unranked",

            division:
                "",

            mmr:
                null
        },

        standard: {
            tier:
                "Unranked",

            division:
                "",

            mmr:
                null
        }
    };
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
                && typeof responseData === "object"
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
                && typeof responseData === "object"
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

    if (
        !responseData
        || typeof responseData !== "object"
        || Array.isArray(
            responseData
        )
    ) {
        return null;
    }

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

    /*
     * Normalize Supabase snake_case fields into the
     * camelCase structure expected by Rocket League
     * session/profile services and registration UI.
     */

    return {
        accountId:
            returnedAccountId
            || normalizedAccountId,

        /*
         * Temporary compatibility alias.
         *
         * userId and accountId both represent:
         * identity.accounts.id
         */
        userId:
            returnedAccountId
            || normalizedAccountId,

        rlPlayerId:
            normalizeNullableString(
                responseData.rl_player_id
            ),

        /* -------------------------------------------------
        DISPLAY NAMES

        bpdDisplayName:
            Global BPD account name.

        epicDisplayName:
            Current Epic provider name.

        There is intentionally no generic RL displayName.
        ------------------------------------------------- */

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
            responseData.active === true,

        rlPlatform:
            normalizeNullableString(
                responseData.rl_platform
            ),

        displayTimezone:
            normalizeNullableString(
                responseData.display_timezone
            ),

        currentRank:
            normalizeString(
                responseData.current_rank
            ),

        contactMethod:
            normalizeString(
                responseData.contact_method
            )
            || "email",

        preferredMode:
            normalizeNullableString(
                responseData.preferred_mode
            ),

        otherMode:
            normalizeString(
                responseData.other_mode
            ),

        showOnlineStatus:
            responseData.show_online_status === true,

        ageConsent:
            responseData.age_consent === true,

        registrationStatus:
            normalizeString(
                responseData.registration_status
            )
            || "incomplete",

        profileComplete:
            responseData.profile_complete === true,

        rocketLeagueAccess:
            responseData.rocket_league_access === true,

        notificationsEnabled:
            responseData.notifications_enabled === true,

        reminderMode:
            normalizeString(
                responseData.reminder_mode
            )
            || "24-hours",

        specificReminderTimes:
            Array.isArray(
                responseData.specific_reminder_times
            )
                ? responseData.specific_reminder_times
                : [],

        availability:
            Array.isArray(
                responseData.availability
            )
                ? responseData.availability
                : [],

        ranked:
            (
                responseData.ranked
                && typeof responseData.ranked === "object"
                && !Array.isArray(
                    responseData.ranked
                )
            )
                ? responseData.ranked
                : createDefaultRankedState()
    };
}