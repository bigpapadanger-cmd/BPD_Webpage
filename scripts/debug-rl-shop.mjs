import { pathToFileURL } from "node:url";
import { withUpstreamDeadline, fetchBoundedResponse } from "../functions/services/http/upstream.js";

const MAX_BYTES = 2 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const text = value => typeof value === "string" ? value.slice(0, 500) : null;
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function image(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        // Report asset location without query credentials or fragments.
        return `${url.origin}${url.pathname}`;
    } catch { return null; }
}

export function summarizeShop(payload, shopId = null) {
    if (payload?.success !== true || !Array.isArray(payload.shops) || !Array.isArray(payload.catalogues)) {
        throw fail("SHOP_DEBUG_RESPONSE_INVALID");
    }
    const shops = new Map(payload.shops.map(shop => [String(shop.id), shop]));
    const categories = payload.catalogues.map(catalogue => {
        if (!Array.isArray(catalogue.items)) throw fail("SHOP_DEBUG_RESPONSE_INVALID");
        const shop = shops.get(String(catalogue.shop_id));
        return { shopId: number(catalogue.shop_id), name: text(shop?.name), title: text(shop?.title),
            type: text(shop?.type), logoUrl: image(shop?.logo_url),
            startsAt: text(shop?.starts_at), endsAt: text(shop?.ends_at),
            itemCount: catalogue.items.length,
            missingTitles: catalogue.items.filter(item => !item.title).length,
            missingImages: catalogue.items.filter(item => !image(item.image_url)).length,
            namedWithArtwork: catalogue.items.filter(item => item.title && image(item.image_url)).length };
    });
    const selected = shopId === null ? [] : payload.catalogues.filter(row => row.shop_id === shopId)
        .flatMap(row => row.items).map(item => ({
            itemId: number(item.id), title: text(item.title), description: text(item.description),
            imageUrl: image(item.image_url), startsAt: text(item.starts_at), endsAt: text(item.ends_at),
            prices: (Array.isArray(item.costs) ? item.costs : []).flatMap(cost =>
                (Array.isArray(cost.prices) ? cost.prices : []).map(price => ({
                    currencyId: number(price.currency_id), amount: number(price.amount)
                }))),
            productIds: (Array.isArray(item.products) ? item.products : []).map(product => number(product.product_id)).filter(id => id !== null)
        }));
    return { available: typeof payload.available === "boolean" ? payload.available : true, capturedAt: text(payload.capturedAt),
        shopCount: payload.shops.length, catalogueCount: payload.catalogues.length,
        categories, selectedShop: shopId, selectedItems: selected };
}

export async function callShopDebug(mode, env, shopId = null, fetcher = fetch) {
    if (!["worker", "cached", "catalog"].includes(mode)) throw fail("SHOP_DEBUG_MODE_INVALID");
    if (mode === "catalog" && shopId !== null) throw fail("SHOP_DEBUG_ARGUMENTS_INVALID");
    let base;
    try {
        base = new URL(mode !== "cached" ? env.MMR_API_URL : env.BPD_SITE_URL || "https://bpd-gaming-network.com");
        const local = mode === "cached" && ["localhost", "127.0.0.1"].includes(base.hostname);
        if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) || base.username || base.password
            || base.search || base.hash || base.pathname !== "/") throw new Error();
    } catch { throw fail("SHOP_DEBUG_URL_INVALID"); }
    const headers = { Accept: "application/json" };
    if (mode !== "cached") {
        if (typeof env.MMR_API_KEY !== "string" || !env.MMR_API_KEY.trim()) throw fail("SHOP_DEBUG_KEY_MISSING");
        headers.Authorization = `Bearer ${env.MMR_API_KEY.trim()}`;
    }
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(new URL(mode === "catalog" ? "/get-mtx-catalog" : mode === "worker" ? "/get-shop-data" : "/api/rocketleague/shop", base),
            { method: "GET", redirect: "manual", headers, signal }, MAX_BYTES, fetcher);
        if (!response.ok) throw fail(`SHOP_DEBUG_HTTP_${response.status}`);
        let payload;
        try { payload = await response.json(); } catch { throw fail("SHOP_DEBUG_RESPONSE_INVALID"); }
        if (mode === "catalog") {
            if (shopId !== null || payload?.success !== true || payload.category !== "StarterPack" || !Array.isArray(payload.products) || payload.products.length > 200) throw fail("SHOP_DEBUG_RESPONSE_INVALID");
            return { category: "StarterPack", productCount: payload.products.length, products: payload.products.map(row => ({
                id: number(row.id), title: text(row.title), imageUrl: image(row.imageUrl),
                productIds: (Array.isArray(row.productIds) ? row.productIds : []).map(number).filter(id => id !== null)
            })) };
        }
        return summarizeShop(payload, shopId);
    }, 40000);
}

export async function main(args, env = process.env) {
    if (!args.length || args[0] === "--help" || args[0] === "plan") {
        console.log(`Local Rocket League shop debugger (no writes or purchases).
Usage:
  node scripts/debug-rl-shop.mjs cached [--shop 52]
  node --env-file=.dev.vars scripts/debug-rl-shop.mjs worker [--shop 52]
  node --env-file=.dev.vars scripts/debug-rl-shop.mjs catalog

cached: one public DomainData cache read. BPD_SITE_URL overrides site (localhost allowed).
catalog: one protected /get-mtx-catalog read for documented StarterPack category.
         Requires the local Worker change to be deployed separately before live use.
worker: one protected MMR_API_URL/get-shop-data request using MMR_API_KEY from environment.
        This manually makes two PsyNet reads; do not run repeatedly.

Current provider sequence (already implemented by MMR Worker):
  Shops/GetStandardShops v1: {}
  Shops/GetShopCatalogue v2: { ShopIDs: IDs returned by GetStandardShops }

Compare worker and cached counts/fields to locate truncation or mapping loss.
Missing titles/images at worker output still require upstream-vs-normalizer investigation.
Product IDs alone do not resolve artwork. No verified metadata call is assumed.
No wallet, purchase or notification-image requests are made.`);
        return;
    }
    if (!([1, 3].includes(args.length)) || (args.length === 3 && (args[1] !== "--shop" || !/^\d{1,9}$/.test(args[2])))) {
        throw fail("SHOP_DEBUG_ARGUMENTS_INVALID");
    }
    console.log(JSON.stringify(await callShopDebug(args[0], env, args.length === 3 ? Number(args[2]) : null), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch(error => {
        // Never print request headers, configuration, raw response, stack or provider message.
        const code = /^(SHOP_DEBUG_[A-Z0-9_]+|UPSTREAM_[A-Z_]+)$/.test(error?.code || "") ? error.code : "SHOP_DEBUG_FAILED";
        console.error(code);
        process.exitCode = 1;
    });
}
