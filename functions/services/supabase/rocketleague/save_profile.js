export async function saveRocketLeagueProfile(
    env,
    EpicUniqueId,
    registration
) {
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

    if (!EpicUniqueId) {
        throw new Error(
            "EpicUniqueId is required."
        );
    }

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
                    JSON.stringify({
                        epic_unique_id:
                            EpicUniqueId,

                        age_consent:
                            registration.ageConsent,

                        display_name:
                            registration.displayName,

                        current_rank:
                            registration.currentRank,

                        show_online_status:
                            registration.showOnlineStatus,

                        contact_method:
                            registration.contactMethod,

                        email_address:
                            registration.email ||
                            null,

                        phone_number:
                            registration.phone ||
                            null,

                        preferred_mode:
                            registration.preferredMode,

                        other_mode:
                            registration.otherMode ||
                            null,

                        display_timezone:
                            registration.timezone,

                        availability:
                            registration.availability,

                        notifications_enabled:
                            registration.notificationsEnabled,

                        reminder_mode:
                            registration.reminderMode
                    })
            }
        );

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
            `Supabase profile save failed: ${response.status}`
        );
    }

    if (Array.isArray(responseData)) {
        return responseData[0] || {};
    }

    return responseData || {};
}