//import {future} from "../../../api_vars";
export async function handleRocketLeagueSignin(
    env,
    sessionData
) {
    try {
        const profile =
            await callSupabaseSignin(
                env,
                {
                    EpicUniqueId:
                        sessionData.EpicUniqueId,

                    EpicDisplayName:
                        sessionData.EpicDisplayName,

                    EpicPreferredUsername:
                        sessionData.EpicPreferredUsername
                }
            );

        return {
            success:
                true,

            profileLoaded:
                true,

            profile:
                profile,

            warning:
                null
        };

    } catch (
        error
    ) {
        console.error(
            "[ROCKET LEAGUE PROFILE] Supabase signin failed:",
            error
        );

        return {
            success:
                true,

            profileLoaded:
                false,

            profile:
                null,

            warning:
                "Your Epic account is authenticated, but your BPD Gaming Network profile could not be loaded."
        };
    }
}
//.ENV variables are stored in SUPABASE, if any can be public
//import them from /functions/api_vars.js
export async function callSupabaseSignin(
    env,
    epicData
) {
    if (
        !env.SUPABASE_URL
    ) {
        throw new Error(
            "SUPABASE_URL is not configured."
        );
    }

    if (
        !env.SUPA2CLOUDFLARE_AUTH
    ) {
        throw new Error(
            "SUPA2CLOUDFLARE_AUTH is not configured."
        );
    }
    const response =
    
        await fetch(
            `${env.SUPABASE_URL}rpc/rocketleague_signin`,
            {
                method:
                    "POST",
                headers: {
                    "apikey":
                        env.SUPA2CLOUDFLARE_AUTH,
                    "Authorization":
                        `Bearer ${env.SUPA2CLOUDFLARE_AUTH}`,
                    "Content-Type":
                        "application/json"
                },
                body:
                    JSON.stringify({
                        epic_unique_id:
                            epicData.EpicUniqueId,
                        epic_display_name:
                            epicData.EpicDisplayName,
                        epic_preferred_username:
                            epicData.EpicPreferredUsername
                    })
            }
        );

    if (!response.ok) {
        throw new Error(
            `Supabase signin failed: ${response.status}`
        );
    }

    return response.json();
}