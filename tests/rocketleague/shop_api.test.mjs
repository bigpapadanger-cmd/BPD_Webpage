import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { onRequestGet } from "../../functions/api/rocketleague/shop.js";
import { getCurrentRocketLeagueShop } from "../../functions/services/supabase/rocketleague/current_shop.js";
import { isSnapshotStale, shopPages, initializePage } from "../../public/Tabs/RocketLeague/Features/JS/shop.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_AUTH: "service-role-secret"
};

test("shop pages finish each active category in three-item groups without placeholders", () => {
    const items = Array.from({ length: 12 }, (_, id) => ({ id, title: `Item ${id}`, image_url: "https://images.test/item.png" }));
    const snapshot = { shops: [{ id: 7, name: "Featured", type: "Daily" }, { id: 8, title: "Bundles" }],
        catalogues: [{ shop_id: 7, items }, { shop_id: 8, items: [{ ...items[0], id: 20 }] }, { shop_id: 9, items: [] }] };
    const pages = shopPages(snapshot);
    assert.deepEqual(pages.map(page => page.items.length), [3, 3, 3, 3, 1]);
    assert.deepEqual(pages.flatMap(page => page.items.map(item => item.id)), [...items.map(item => item.id), 20]);
    assert.equal(pages[0].shop.name, "Featured");
    assert.equal(pages[4].shop.title, "Bundles");
    assert.deepEqual(shopPages({ shops: [], catalogues: [] }), []);
});

test("shop excludes expired/future shops, technical names, missing artwork and inactive items", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const item = { title: "Real item", image_url: "https://images.test/item.png" };
    const shops = [{ id: 1, title: "Region:NA", name: "Featured" }, { id: 2, title: "Region:NA" },
        { id: 3, name: "Expired", ends_at: "2026-10-05T12:00:00Z" },
        { id: 4, name: "Future", starts_at: "2026-10-05T13:00:00Z" }];
    const pages = shopPages({ shops, catalogues: shops.map(shop => ({ shop_id: shop.id, items: [item,
        { ...item, image_url: null }, { ...item, image_url: "javascript:bad" }, { ...item, title: null },
        { ...item, ends_at: "2026-10-05T11:59:59Z" }] })) }, now);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].shopId, "1");
    assert.deepEqual(pages[0].items, [item]);
});

test("carousel cycles cached three-item groups, pauses, honors preferences and cleans up on navigation", async () => {
    const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
    const node = () => ({ children: [], handlers: {}, attributes: {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(key, handler) { this.handlers[key] = handler; } });
    const slots = new Map();
    const root = { ...node(), isConnected: true, contains: () => false,
        querySelector(selector) { if (!slots.has(selector)) slots.set(selector, node()); return slots.get(selector); } };
    let tick, cleared = false, requests = 0, reduced = false;
    globalThis.document = { createElement: node, querySelector: () => root, body: { dataset: {} }, hidden: false };
    globalThis.window = { matchMedia: () => ({ matches: reduced }) };
    globalThis.setInterval = fn => { tick = fn; return 1; };
    globalThis.clearInterval = () => { cleared = true; };
    globalThis.fetch = async () => { requests++; return Response.json({ success: true, available: true,
        capturedAt: new Date().toISOString(), shops: [{ id: 1, name: "Featured" }, { id: 2, name: "Bundles" }],
        catalogues: [{ shop_id: 1, items: Array.from({ length: 4 }, (_, id) => ({ title: `Item ${id}`, image_url: "https://images.test/item.png", costs: [] })) },
            { shop_id: 2, items: [{ title: "Bundle", image_url: "https://images.test/item.png", costs: [] }] }] }); };
    try {
        await initializePage();
        const items = slots.get("[data-shop-items]");
        assert.equal(items.children.length, 3);
        tick(); assert.equal(items.children.length, 1);
        slots.get("[data-shop-next]").handlers.click();
        assert.equal(slots.get("[data-shop-section-title]").textContent, "Bundles");
        slots.get("[data-shop-next]").handlers.click();
        assert.equal(items.children.length, 3);
        slots.get("[data-shop-pause]").handlers.click(); tick(); assert.equal(items.children.length, 3);
        slots.get("[data-shop-pause]").handlers.click();
        document.body.dataset.animations = "off"; tick(); assert.equal(items.children.length, 3);
        document.body.dataset.animations = "on"; reduced = true; tick(); assert.equal(items.children.length, 3);
        reduced = false; root.handlers.pointerenter(); tick(); assert.equal(items.children.length, 3);
        root.handlers.pointerleave(); document.hidden = true; tick(); assert.equal(items.children.length, 3);
        document.hidden = false; tick(); assert.equal(items.children.length, 1);
        assert.equal(requests, 1);
        root.isConnected = false; tick(); assert.equal(cleared, true);
    } finally { Object.assign(globalThis, saved); }
});

test("public Shop endpoint reads only the cached RPC and returns its safe projection", async () => {
    let request;
    globalThis.fetch = async (url, init) => {
        request = { url: new URL(url), init };
        return Response.json({
            available: true,
            snapshotId: 123,
            contentHash: "a".repeat(64),
            providerSchemaVersion: 1,
            capturedAt: "2026-10-03T16:00:00Z",
            shops: [{ id: 7, name: "Daily", logo_url: "https://assets.example.test/logo.png", isOwned: true }],
            catalogues: [{ shop_id: 7, items: [{ id: 9, title: "Car", image_url: "https://assets.example.test/car.png", costs: [{ prices: [{ currency_id: 13, amount: 700 }] }], account_id: "private" }] }],
            notifications: [],
            sessionToken: "must-not-leak"
        });
    };

    const response = await onRequestGet({ env });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60, s-maxage=300");
    assert.equal(request.url.pathname, "/rest/v1/rpc/get_rl_current_shop");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), {});
    assert.equal(request.init.headers["Accept-Profile"], "api");
    assert.equal(request.init.headers.Authorization, "Bearer service-role-secret");
    assert.deepEqual(result.shops, [{ id: 7, type: null, name: "Daily", title: null, starts_at: null, ends_at: null, logo_url: "https://assets.example.test/logo.png" }]);
    assert.equal(result.catalogues[0].items[0].image_url, "https://assets.example.test/car.png");
    assert.equal(result.catalogues[0].items[0].account_id, undefined);
    assert.equal(result.sessionToken, undefined);
    assert.equal(JSON.stringify(result).includes("service-role-secret"), false);
    assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("unavailable snapshot remains a clean public response", async () => {
    globalThis.fetch = async () => Response.json({
        available: false,
        snapshotId: null,
        contentHash: null,
        providerSchemaVersion: null,
        capturedAt: null,
        shops: [],
        catalogues: [],
        notifications: []
    });
    const result = await (await onRequestGet({ env })).json();
    assert.equal(result.available, false);
    assert.deepEqual(result.shops, []);
});

test("bad RPC response is not exposed or cached", async () => {
    globalThis.fetch = async () => Response.json({ error: "private database diagnostic" }, { status: 500 });
    const response = await onRequestGet({ env });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { success: false, error: "SHOP_UNAVAILABLE" });
});

test("missing configuration is rejected without making a request", async () => {
    let requested = false;
    globalThis.fetch = async () => { requested = true; throw new Error("unexpected"); };
    await assert.rejects(() => getCurrentRocketLeagueShop({}), { name: "RocketLeagueShopReadError" });
    assert.equal(requested, false);
});

test("Shop browser module reads the DomainData cache endpoint only", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Features/JS/shop.js", import.meta.url), "utf8");
    assert.match(source, /fetch\("\/api\/rocketleague\/shop"/);
    assert.match(source, /export async function initializePage\(\)/);
    assert.doesNotMatch(source, /^loadShop\(\);/m);
    assert.doesNotMatch(source, /MMR_API_URL|SUPABASE_AUTH|\/get-shop-data|Shops\/Get/);
});

test("Shop freshness becomes stale after one missed hourly refresh or an expired section", () => {
    const now = Date.parse("2026-10-03T18:00:00Z");
    const base = {
        capturedAt: "2026-10-03T17:00:00Z",
        shops: [{ id: 7, ends_at: "2026-10-03T19:00:00Z" }],
        catalogues: [{ shop_id: 7, items: [{ id: 9 }] }]
    };
    assert.equal(isSnapshotStale(base, now), false);
    assert.equal(isSnapshotStale({ ...base, capturedAt: "2026-10-03T15:59:59Z" }, now), true);
    assert.equal(isSnapshotStale({ ...base, shops: [{ id: 7, ends_at: "2026-10-03T17:59:59Z" }] }, now), true);
    assert.equal(isSnapshotStale({ ...base, capturedAt: null }, now), true);
});

test("Shop page exposes section and item start/end timing with an explicit stale label", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Features/JS/shop.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/Features/HTML/shop.html", import.meta.url), "utf8");
    assert.match(source, /Saved shop rotation may be out of date/);
    assert.match(source, /timingLabel\(shop\?\.starts_at, shop\?\.ends_at\)/);
    assert.match(source, /Available \$\{start\} – \$\{end\}/);
    assert.match(html, /data-shop-section-timing/);
});
