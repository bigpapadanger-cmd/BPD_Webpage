"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE SAVE

Purpose:
    Saves the authenticated Epic user's Rocket League
    registration/profile data to Supabase.

Flow:
    Rocket League registration UI
        ↓
    /api/auth/rocketleague/profile
        ↓
    services/rl/profile.js
        ↓
    saveRocketLeagueProfile()
        ↓
    Supabase RPC:
        api.save_rocketleague_profile
        ↓
    Supabase validates and persists the profile data

Important:
    - The browser never calls Supabase directly.
    - The Supabase secret remains server-side in Cloudflare.
    - EpicUniqueId must come from the validated Epic/KV
      session, not from browser-submitted profile data.
    - This function maps JavaScript camelCase fields into
      the snake_case RPC arguments expected by Supabase.
    - Supabase remains authoritative for whether the profile
      is complete and whether Rocket League access is granted.
    - This function should NOT independently calculate
      profileComplete or rocketLeagueAccess.

Supabase RPC receives:
    epic_unique_id
    age_consent
    display_name
    current_rank
    show_online_status
    contact_method
    email_address
    phone_number
    preferred_mode
    other_mode
    display_timezone
    availability
    notifications_enabled
    reminder_mode

Supabase RPC returns:
    success
    profile_saved
    user_id
    rl_player_id
    role
    active
    profile_complete
    rocket_league_access
    registration_status

Failure behavior:
    - Missing Cloudflare Supabase configuration throws before
      attempting a request.
    - Missing EpicUniqueId throws before calling Supabase.
    - Supabase HTTP failures are logged server-side with the
      response body so database/RPC errors can be diagnosed.
    - The caller decides what response is returned to the
      browser after a save failure.
========================================================= */

export async function saveRocketLeagueProfile(
    env,
    EpicUniqueId,
    registration
) {
    /*
     * Validate server configuration before making an
     * outbound request.
     */
    if (!env.SUPABASE_URL) {
        throw new Error(
            "SUPABASE_URL is not configured."
        );
    }

    if (!env.SUPABASE_AUTH) {
        throw new Error(
            "SUPABASE_AUTH is not configured."
        );
    }

    /*
     * Epic identity must come from the authenticated
     * server-side session.
     */
    if (!EpicUniqueId) {
        throw new Error(
            "EpicUniqueId is required."
        );
    }

    /*
     * Convert the registration object's camelCase fields
     * into the exact snake_case argument names expected by
     * api.save_rocketleague_profile().
     */
    const payload = {
    s_epic_unique_id:
        EpicUniqueId,

    s_age_consent:
        registration.ageConsent,

    s_display_name:
        registration.displayName,

    s_current_rank:
        registration.currentRank,

    s_show_online_status:
        registration.showOnlineStatus,

    s_contact_method:
        registration.contactMethod,

    s_email_address:
        registration.email,

    s_phone_number:
        registration.phone,

    s_preferred_mode:
        registration.preferredMode,

    s_other_mode:
        registration.otherMode,

    s_display_timezone:
        registration.timezone,

    s_availability:
        registration.availability,

    s_notifications_enabled:
        registration.notificationsEnabled,

    s_reminder_mode:
        registration.reminderMode
    };

    /*
     * Call the private Supabase API-schema RPC.
     *
     * Content-Profile tells PostgREST that the function
     * belongs to the exposed "api" schema rather than
     * the default public schema.
     */
    const response =
        await fetch(
            `${env.SUPABASE_URL}rpc/save_rocketleague_profile`,
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
                    JSON.stringify(
                        payload
                    )
            }
        );

    /*
     * Read the response as text first so that both JSON and
     * non-JSON Supabase/PostgREST error responses can be
     * logged without consuming the body twice.
     */
    const responseText =
        await response.text();

    let responseData =
        null;

    if (responseText) {
        try {
            responseData =
                JSON.parse(
                    responseText
                );
        } catch {
            responseData =
                responseText;
        }
    }

    /*
     * Log the real Supabase response server-side.
     *
     * This is especially important because the public API
     * layer may intentionally return a generic error message
     * to the browser.
     */
    if (!response.ok) {
        console.error(
            "[ROCKET LEAGUE PROFILE] Supabase save failed:",
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
            `Supabase profile save failed: ${response.status}`
        );
    }

    /*
     * RPC functions normally return a single object, but
     * tolerate an array response defensively.
     */
    if (Array.isArray(responseData)) {
        return (
            responseData[0] ||
            {}
        );
    }

    return (
        responseData ||
        {}
    );
}