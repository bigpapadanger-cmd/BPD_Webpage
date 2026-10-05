import { getFeaturedRocketLeaguePlayer } from "../../../services/supabase/rocketleague/discovery.js";

export async function onRequest({ request, env }) {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
    try {
        // No public cache: the RPC rechecks the selected player's privacy on every read.
        return Response.json({ success: true, ...await getFeaturedRocketLeaguePlayer(env) }, { headers });
    } catch {
        return Response.json({ success: false, error: "FEATURED_PLAYER_UNAVAILABLE" }, { status: 503, headers });
    }
}
