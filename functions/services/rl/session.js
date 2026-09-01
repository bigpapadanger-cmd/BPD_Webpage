import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";


export async function handleRocketLeagueSession(request, env) {
    const session = await getStoredSession(request, env);

    if (!session) {
        return new Response(
            JSON.stringify({
                authenticated: false,
                user: null
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }

    const sessionData = session.sessionData || {};

    const user = {
        EpicUniqueId:
            sessionData.EpicUniqueId || null,

        EpicDisplayName:
            sessionData.EpicDisplayName || null,

        EpicPreferredUsername:
            sessionData.EpicPreferredUsername || null
    };

    return new Response(
        JSON.stringify({
            authenticated: true,
            user
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}