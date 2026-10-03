"use strict";

import {
    getCurrentRocketLeagueShop,
    RocketLeagueShopReadError
} from "../../services/supabase/rocketleague/current_shop.js";

function json(body, status = 200, cacheable = false) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": cacheable ? "public, max-age=60, s-maxage=300" : "no-store",
            "X-Content-Type-Options": "nosniff"
        }
    });
}

export async function onRequestGet({ env }) {
    try {
        const snapshot = await getCurrentRocketLeagueShop(env);
        return json({ success: true, ...snapshot }, 200, true);
    } catch (error) {
        const status = error instanceof RocketLeagueShopReadError ? error.status : 503;
        return json({ success: false, error: "SHOP_UNAVAILABLE" }, status);
    }
}
