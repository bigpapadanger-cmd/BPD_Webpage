export async function handleRocketLeagueSignin(
    env,
    sessionData
) {
    try {
        const result =
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
            success: true,

            profileLoaded: true,

            userId:
                result.user_id ||
                null,

            rlPlayerId:
                result.rl_player_id ||
                null,

            role:
                result.role ||
                "user",

            active:
                result.active === true,

            profileComplete:
                result.profile_complete === true,

            rocketLeagueAccess:
                result.rocket_league_access === true,

            profile:
                result,

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
            success: true,

            profileLoaded: false,

            userId:
                null,

            rlPlayerId:
                null,

            role:
                null,

            active:
                null,

            profileComplete:
                false,

            rocketLeagueAccess:
                false,

            profile:
                null,

            warning:
                "Your Epic account is authenticated, but your BPD Gaming Network profile could not be loaded."
        };
    }
}

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
        !env.SUPABASE_AUTH
    ) {
        throw new Error(
            "SUPABASE_AUTH is not configured."
        );
    }

    if (
        !epicData?.EpicUniqueId
    ) {
        throw new Error(
            "EpicUniqueId is required."
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
                            epicData.EpicUniqueId,

                        epic_display_name:
                            epicData.EpicDisplayName ||
                            null,

                        epic_preferred_username:
                            epicData.EpicPreferredUsername ||
                            null
                    })
            }
        );

    const responseText =
        await response.text();

    let responseData =
        null;

    if (
        responseText
    ) {
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

    if (
        !response.ok
    ) {
        console.error(
            "[ROCKET LEAGUE PROFILE] Supabase RPC error:",
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
            `Supabase signin failed: ${response.status}`
        );
    }

    if (
        Array.isArray(
            responseData
        )
    ) {
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