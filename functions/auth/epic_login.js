import { redirect } from "../responses.js";
import { createCookie } from "./session.js";
import { createRandomState, getMissingAuthConfiguration } from "./utils.js";

export async function handleEpicLogin(request, env) {
    const missing = getMissingAuthConfiguration(env);
    if (missing.length) {
        return json({ success: false, missing }, 503);
    }

    const state = createRandomState();
    const url = new URL("https://www.epicgames.com/id/authorize");

    url.searchParams.set("client_id", env.EPIC_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", env.EPIC_REDIRECT_URI);
    url.searchParams.set("scope", "basic_profile presence");
    url.searchParams.set("state", state);

    return redirect(url.toString(), [
        createCookie(request, "bpd_epic_state", state, 600)
    ]);
}
