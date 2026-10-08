import { authorizeRocketLeagueRequest } from "../../../../services/rl/authorization.js";
import { isCustomMatchRuntimeCallerConfigured } from "../../../../services/rl/custom_matches/runtime_client.js";

export async function onRequest(context) {
    const { request, env, params } = context;
    if (request.method !== "GET") return Response.json({ success: false, code: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || new URL(request.url).search) {
        return Response.json({ success: false, code: "CUSTOM_MATCH_INPUT_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (request.headers.get("Origin") !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
        return Response.json({ success: false, code: "CUSTOM_MATCH_ORIGIN_FORBIDDEN" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    try {
        const matchCode = params?.matchCode;
        if (typeof matchCode !== "string" || !/^CM[A-Za-z0-9]{8}$/.test(matchCode)) return Response.json({ success: false, code: "CUSTOM_MATCH_INPUT_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
        const authorization = await authorizeRocketLeagueRequest(request, env, "rocket_league");
        if (env?.CUSTOM_MATCH_RUNTIME_ENABLED === "false") return Response.json({ success: false, code: "CUSTOM_MATCH_RUNTIME_DISABLED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
        if (!isCustomMatchRuntimeCallerConfigured(env) || typeof env.CUSTOM_MATCH_RUNTIME?.fetch !== "function") {
            return Response.json({ success: false, code: "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        return await env.CUSTOM_MATCH_RUNTIME.fetch(new Request(`https://custom-match-runtime.internal/connect/${matchCode}`, {
            headers: { Upgrade: "websocket", "X-Custom-Match-Caller": env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET,
                "X-Custom-Match-Account": authorization.accountId }
        }));
    } catch (error) {
        const status = error?.status === 401 || error?.status === 403 ? error.status : 503;
        return Response.json({ success: false, code: status === 401 ? "CUSTOM_MATCH_SIGN_IN_REQUIRED" : status === 403 ? "CUSTOM_MATCH_ACCESS_DENIED" : "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" }, { status, headers: { "Cache-Control": "no-store" } });
    }
}
