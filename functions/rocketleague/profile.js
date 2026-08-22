import { json } from "../responses.js";
import { getStoredSession } from "../auth/sessions.js";
import { fetchProfile, fetchSessions } from "trn-rocket-league";

export async function handleRocketLeagueProfile(request, env) {
    const storedSession = await getStoredSession(request, env);
    if (!storedSession) {
        return json({
            success: false,
            authenticated: false,
            message: "Login is required to load Rocket League ranks."
        }, 401);
    }

    const sessionData = storedSession.sessionData;

    const username = String(
        sessionData.rocketLeagueLookup?.username ||
        sessionData.displayName ||
        ""
    ).trim();

    const platform = "epic"; // always epic for your login flow

    try {
        // Fetch profile using the library
        const profile = await fetchProfile(username, platform);

        // Fetch recent sessions (optional)
        const sessions = await fetchSessions(username, platform);

        return json({
            success: true,
            profile,
            sessions
        });

    } catch (err) {
        return json({
            success: false,
            message: "Rocket League profile lookup failed.",
            error: err.message
        }, 500);
    }
}
