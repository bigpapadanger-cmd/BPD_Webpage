"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";

const REQUEST_TIMEOUT_MS = 5000;
// Provider diagnostic confirmed 35 shops and 33 catalogues in one current
// response. Keep bounded parsing while preserving that complete inventory.
const MAX_SECTIONS = 40;
const MAX_ITEMS_PER_SECTION = 80;
const MAX_NOTIFICATIONS = 20;

export class RocketLeagueShopReadError extends Error {
    constructor(status = 503) {
        super("ROCKET_LEAGUE_SHOP_UNAVAILABLE");
        this.name = "RocketLeagueShopReadError";
        this.status = status;
    }
}

function cleanText(value, max = 300) {
    return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function cleanId(value) {
    if (typeof value === "string" && value.trim().length <= 120) return value.trim() || null;
    if (Number.isSafeInteger(value) && value >= 0) return value;
    return null;
}

function cleanTimestamp(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
    return value;
}

function cleanImageUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

function cleanPrice(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const currencyId = cleanId(value.currency_id);
    const amount = value.amount;
    if (currencyId === null || !Number.isSafeInteger(amount) || amount < 0) return null;
    return { currency_id: currencyId, amount };
}

function cleanProduct(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const productId = cleanId(value.product_id);
    if (productId === null) return null;
    const count = Number.isSafeInteger(value.count) && value.count >= 0 ? value.count : null;
    const attributes = Array.isArray(value.attributes)
        ? value.attributes.slice(0, 20).flatMap(attribute => {
            if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) return [];
            const key = cleanText(attribute.key, 80);
            const text = cleanText(attribute.value, 160);
            return key && text ? [{ key, value: text }] : [];
        })
        : [];
    return { product_id: productId, count, attributes };
}

function cleanItem(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = cleanId(value.id);
    if (id === null) return null;
    const costs = Array.isArray(value.costs) ? value.costs.slice(0, 8).flatMap(cost => {
        if (!cost || typeof cost !== "object" || Array.isArray(cost)) return [];
        const prices = Array.isArray(cost.prices) ? cost.prices.map(cleanPrice).filter(Boolean) : [];
        return [{
            starts_at: cleanTimestamp(cost.starts_at),
            ends_at: cleanTimestamp(cost.ends_at),
            reset_at: cleanTimestamp(cost.reset_at),
            prices
        }];
    }) : [];
    const products = Array.isArray(value.products) ? value.products.map(cleanProduct).filter(Boolean).slice(0, 12) : [];
    return {
        id,
        title: cleanText(value.title, 160),
        description: cleanText(value.description, 1000),
        starts_at: cleanTimestamp(value.starts_at),
        ends_at: cleanTimestamp(value.ends_at),
        image_url: cleanImageUrl(value.image_url),
        costs,
        products
    };
}

function cleanShop(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = cleanId(value.id);
    if (id === null) return null;
    return {
        id,
        type: cleanText(value.type, 80),
        name: cleanText(value.name, 120),
        title: cleanText(value.title, 160),
        starts_at: cleanTimestamp(value.starts_at),
        ends_at: cleanTimestamp(value.ends_at),
        logo_url: cleanImageUrl(value.logo_url)
    };
}

function cleanCatalogue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const shopId = cleanId(value.shop_id);
    if (shopId === null) return null;
    return {
        shop_id: shopId,
        items: Array.isArray(value.items)
            ? value.items.slice(0, MAX_ITEMS_PER_SECTION).map(cleanItem).filter(Boolean)
            : []
    };
}

function cleanSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || typeof value.available !== "boolean"
        || !(value.snapshotId === null || Number.isSafeInteger(value.snapshotId))
        || !(value.contentHash === null || typeof value.contentHash === "string")
        || !(value.providerSchemaVersion === null || Number.isSafeInteger(value.providerSchemaVersion))
        || !(value.capturedAt === null || cleanTimestamp(value.capturedAt))) {
        throw new RocketLeagueShopReadError(502);
    }
    if (!Array.isArray(value.shops) || !Array.isArray(value.catalogues) || !Array.isArray(value.notifications)) {
        throw new RocketLeagueShopReadError(502);
    }
    return {
        available: value.available,
        snapshotId: value.snapshotId,
        contentHash: typeof value.contentHash === "string" && /^[a-f0-9]{64}$/i.test(value.contentHash) ? value.contentHash : null,
        providerSchemaVersion: value.providerSchemaVersion,
        capturedAt: cleanTimestamp(value.capturedAt),
        shops: value.shops.slice(0, MAX_SECTIONS).map(cleanShop).filter(Boolean),
        catalogues: value.catalogues.slice(0, MAX_SECTIONS).map(cleanCatalogue).filter(Boolean),
        notifications: value.notifications.slice(0, MAX_NOTIFICATIONS).map(cleanItem).filter(Boolean)
    };
}

export async function getCurrentRocketLeagueShop(env) {
    const base = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim().replace(/\/+$/, "") : "";
    const key = typeof env?.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "";
    let root;
    try {
        const parsed = new URL(base);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !key) throw new Error("configuration");
        root = /\/rest\/v1$/i.test(parsed.href) ? `${parsed.href}/` : `${parsed.href.replace(/\/$/, "")}/rest/v1/`;
    } catch {
        throw new RocketLeagueShopReadError();
    }

    try {
        return await withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(new URL("rpc/get_rl_current_shop", root), {
            method: "POST",
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: "{}",
            signal
        }, 2 * 1024 * 1024);
        if (!response.ok) throw new RocketLeagueShopReadError();
        let payload;
        try { payload = await response.json(); } catch { throw new RocketLeagueShopReadError(502); }
        return cleanSnapshot(payload);
        }, REQUEST_TIMEOUT_MS);
    } catch (error) {
        if (error instanceof RocketLeagueShopReadError) throw error;
        throw new RocketLeagueShopReadError(error?.name === "AbortError" || error?.code === "UPSTREAM_TIMEOUT" ? 504 : 503);
    }
}
