//import {future} from "../../../api_vars";
export async function handleRocketLeagueSignin(
    env,
    sessionData
) {
    return callSupabaseSignin(
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
}
//.ENV variables are stored in SUPABASE, if any can be public
//import them from /functions/api_vars.js
export async function callSupabaseSignin(
    env,
    epicData
) {
    const response =
        await fetch(
            `${env.SUPABASE_URL}/rest/v1/rpc/rocketleague_signin`,
            {
                method:
                    "POST",
                headers: {
                    "apikey":
                        env.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization":
                        `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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