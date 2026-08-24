import { json, redirect } from "../../responses/responses.js";
import { createCookie } from "../session.js";
import {
    EPIC_AUTHORIZE_URL,
    AUTH_STATE_COOKIE,
    AUTH_STATE_MAX_AGE_SECONDS
} from "../api.js"; // your constants module
import { createRandomState, getMissingAuthConfiguration } from "./utils.js";

export async function handleEpicLogin(request, env) {
    const missing = getMissingAuthConfiguration(env);
    if (Array.isArray(missing) && missing.length > 0) {
        return json({ success: false, missing }, 503);
    }

    const clientId = typeof env.EPIC_CLIENT_ID === "string"
        ? env.EPIC_CLIENT_ID.trim()
        : "";

    const redirectUri = typeof env.EPIC_REDIRECT_URI === "string"
        ? env.EPIC_REDIRECT_URI.trim()
        : "";

    if (!clientId || !redirectUri) {
        return json({ success: false, message: "Epic OAuth configuration invalid." }, 500);
    }

    const state = createRandomState();
    if (!state || typeof state !== "string") {
        return json({ success: false, message: "Failed to generate OAuth state." }, 500);
    }

    // Build Epic OAuth URL using imported constant
    const url = new URL(EPIC_AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "basic_profile presence");
    url.searchParams.set("state", state);

    // Use imported cookie name + max age
    const cookie = createCookie(
        request,
        AUTH_STATE_COOKIE,
        state,
        AUTH_STATE_MAX_AGE_SECONDS
    );

    return redirect(url.toString(), [cookie]);
}
