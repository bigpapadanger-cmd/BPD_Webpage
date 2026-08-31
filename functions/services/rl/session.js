import { getStoredSession } from "../common_helpers/reload_sessions.js";

export async function handleRocketLeagueSession(request, env) {
    // Load the user's auth session from KV
    const session = await getStoredSession(request, env);

    // No session → user is logged out
    if (!session) {
        return new Response(
            JSON.stringify({
                authenticated: false,
                user: null
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );
    }

    // Valid session → return user info
    // Your frontend expects: { authenticated: true, user: {...} }
    const user = session.sessionData?.user || null;

    return new Response(
        JSON.stringify({
            authenticated: true,
            user
        }),
        {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }
    );
}
