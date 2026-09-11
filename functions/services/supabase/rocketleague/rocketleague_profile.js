"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE LOOKUP

Purpose:
    Loads the authenticated Epic user's Rocket League profile
    data from Supabase.

Flow:
    Cloudflare Rocket League profile/session service
        ↓
    getRocketLeagueProfileByEpicId()
        ↓
    Supabase RPC:
        api.get_rocketleague_profile
        ↓
    Supabase returns the authoritative profile state
        ↓
    This function normalizes the database field names into
    the JavaScript field names used by the rest of the site.

Important:
    - The browser does NOT call Supabase directly.
    - The Supabase secret remains server-side in Cloudflare.
    - EpicUniqueId comes from the validated Epic/KV session.
    - This function does NOT determine authentication.
    - This function does NOT create or update the profile.
    - This function only reads the current persisted profile.
    - Rocket League access is returned by Supabase and should
      not be independently recalculated here.

Supabase RPC return fields include:
    user_id
    rl_player_id
    epic_account_id
    epic_display_name
    display_name
    email
    phone
    role
    active
    rl_platform
    display_timezone
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

Failure behavior:
    - Invalid/missing Epic ID throws before calling Supabase.
    - Supabase HTTP failures are logged server-side.
    - The caller decides how to handle an unavailable profile.
========================================================= */
export async function getRocketLeagueProfileByEpicId(
    env,
    EpicUniqueId
) {
    const epicUniqueId =
        String(
            EpicUniqueId ||
            ""
        ).trim();

    if (!epicUniqueId) {
        throw new Error(
            "EpicUniqueId is required."
        );
    }

    const response =
        await fetch(
            `${env.SUPABASE_URL}rpc/get_rocketleague_profile`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        env.SUPABASE_AUTH,

                    "Content-Type":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        epic_unique_id:
                            epicUniqueId
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
    } catch {
        responseData =
            responseText;
    }

    if (!response.ok) {
        console.error(
            "ROCKET LEAGUE PROFILE GET: Supabase rejected request.",
            {
                status:
                    response.status,

                statusText:
                    response.statusText,

                response:
                    responseData
            }
        );

        throw new Error(
            responseData?.message ||
            responseData?.error ||
            "Supabase profile request failed."
        );
    }

    if (
        !responseData ||
        typeof responseData !==
            "object"
    ) {
        return null;
    }
    /*
     * Normalize Supabase snake_case fields into the
     * camelCase structure expected by the Rocket League
     * session/profile services and registration UI.
     */
    return {
        userId:
            responseData.user_id ||
            null,

        rlPlayerId:
            responseData.rl_player_id ||
            null,

        epicAccountId:
            responseData.epic_account_id ||
            null,

        epicDisplayName:
            responseData.epic_display_name ||
            null,

        displayName:
            responseData.display_name ||
            responseData.epic_display_name ||
            null,

        email:
            responseData.email ||
            "",

        phone:
            responseData.phone ||
            "",

        role:
            responseData.role ||
            "user",

        active:
            responseData.active ===
            true,

        rlPlatform:
            responseData.rl_platform ||
            null,

        displayTimezone:
            responseData.display_timezone ||
            null,

        contactMethod:
            responseData.contact_method ||
            "email",

        preferredMode:
            responseData.preferred_mode ||
            null,

        otherMode:
            responseData.other_mode ||
            "",

        showOnlineStatus:
            responseData.show_online_status ===
            true,

        ageConsent:
            responseData.age_consent ===
            true,

        registrationStatus:
            responseData.registration_status ||
            "incomplete",

        profileComplete:
            responseData.profile_complete ===
            true,

        rocketLeagueAccess:
            responseData.rocket_league_access ===
            true,

        notificationsEnabled:
            responseData.notifications_enabled ===
            true,

        reminderMode:
            responseData.reminder_mode ||
            "24-hours",

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
            responseData.ranked &&
            typeof responseData.ranked ===
                "object"
                ? responseData.ranked
                : {
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
                }
    };
}