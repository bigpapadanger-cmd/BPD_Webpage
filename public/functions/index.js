
import { handleEpicLogin } from "./auth/epic/login.js";
import { handleEpicCallback } from "./auth/epic/epic_callback.js";
import { handleAuthSession, handleAuthLogout } from "./auth/session.js";
import { handleRocketLeagueProfile } from "./rocketleague/profile.js";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path === "/api/auth/login") return handleEpicLogin(request, env);
    if (path === "/api/auth/callback") return handleEpicCallback(request, env);
    if (path === "/api/auth/session") return handleAuthSession(request, env);
    if (path === "/api/auth/logout") return handleAuthLogout(request, env);
    if (path === "/api/rl/profile") return handleRocketLeagueProfile(request, env);
}
