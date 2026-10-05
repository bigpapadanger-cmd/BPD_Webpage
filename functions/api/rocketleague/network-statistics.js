import { getRocketLeagueNetworkStatistics } from "../../services/supabase/rocketleague/discovery.js";

export async function onRequest({ request, env }) {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
    try {
        const statistics = await getRocketLeagueNetworkStatistics(env);
        return Response.json({ success: true, ...statistics }, { headers: { ...headers, "Cache-Control": "public, max-age=60, s-maxage=60" } });
    } catch {
        return Response.json({ success: false, error: "NETWORK_STATISTICS_UNAVAILABLE" }, { status: 503, headers });
    }
}
