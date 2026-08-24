import { json, redirect } from "../../responses/responses.js";
import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE,
    AUTH_SESSION_COOKIE,
    EPIC_REDIRECT_URI
} from "../api.js";
import { getCookie, createCookie, SESSION_TTL } from "../session.js";

export async function handleEpicCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
        return json({ success: false, message: "Missing OAuth parameters." }, 400);
    }

    const storedState = getCookie(request, AUTH_STATE_COOKIE);
    if (!storedState || storedState !== state) {
        return json({ success: false, message: "Invalid OAuth state." }, 400);
    }

    const tokenResponse = await fetch(EPIC_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${env.EPIC_CLIENT_ID}:${env.EPIC_CLIENT_SECRET}`)
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: EPIC_REDIRECT_URI
        })
    });

    if (!tokenResponse.ok) {
        return json({ success: false, message: "Token exchange failed." }, 500);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const profileResponse = await fetch(EPIC_USER_INFO_URL, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json"
        }
    });

    if (!profileResponse.ok) {
        return json({ success: false, message: "Failed to fetch Epic profile." }, 500);
    }

    const profile = await profileResponse.json();

    const sessionId = crypto.randomUUID();
    const sessionKey = `session:${sessionId}`;

    const sessionData = {
        epicAccountId: profile.id || "",
        displayName: profile.displayName || "Epic Player",
        createdAt: Date.now()
    };

    await env.AUTH_SESSIONS.put(sessionKey, JSON.stringify(sessionData), {
        expirationTtl: SESSION_TTL
    });

    const cookie = createCookie(request, AUTH_SESSION_COOKIE, sessionId, SESSION_TTL);

    return redirect("/", [cookie]);
}

export async function onRequest(context) {
    return handleEpicCallback(context.request, context.env);
}
