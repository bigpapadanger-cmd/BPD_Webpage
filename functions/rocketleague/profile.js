import { json } from "../responses.js";
import { getStoredSession } from "../auth/sessions.js";
import { fetchProfile, fetchSessions } from "trn-rocket-league";

export async function handleRocketLeagueProfile(request, env) {
    const storedSession = await getStoredSession(request, env);
    if (!storedSession) {
        return json({ success: false, authenticated: false, message: "Login is required to load Rocket League ranks." }, 401);
    }
    const sessionData = storedSession.sessionData;
    const username = String(sessionData.rocketLeagueLookup?.username || sessionData.displayName || "").trim();
    if (!username || username.length < 2) {
        return json({ success: false, authenticated: true, message: "Invalid Rocket League username in session." }, 400);
    }
    const platform = String(sessionData.rocketLeagueLookup?.platform || "epic").trim().toLowerCase();
    const allowedPlatforms = ["psn", "xbl", "steam", "epic", "switch"];
    if (!allowedPlatforms.includes(platform)) {
        return json({ success: false, authenticated: true, message: "Invalid Rocket League platform in session." }, 400);
    }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const profile = await fetchProfile(username, platform, { signal: controller.signal });
        const sessions = await fetchSessions(username, platform, { signal: controller.signal });
        clearTimeout(timeout);
        if (!profile || typeof profile !== "object") {
            return json({ success: false, authenticated: true, message: "Profile data missing or malformed." }, 502);
        }
        return json({ success: true, profile, sessions: sessions || [] });
    } catch (err) {
        const safeMessage = err.name === "AbortError" ? "Rocket League API timed out." : "Rocket League profile lookup failed.";
        return json({ success: false, authenticated: true, message: safeMessage, error: err.message.slice(0, 200) }, 500);
    }
}
