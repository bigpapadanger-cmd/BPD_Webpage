import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { onRequestGet } from "../../functions/api/rocketleague/shop.js";
import { getCurrentRocketLeagueShop } from "../../functions/services/supabase/rocketleague/current_shop.js";
import { isSnapshotStale, shopPages, initializePage, itemCard } from "../../public/Tabs/RocketLeague/Shop/JS/index.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_AUTH: "service-role-secret"
};

test("shop shows every active category on one carousel page without placeholders", () => {
    const items = Array.from({ length: 12 }, (_, id) => ({ id, title: `Item ${id}`, image_url: "https://images.test/item.png" }));
    const snapshot = { shops: [{ id: 7, name: "Featured", type: "Daily" }, { id: 8, title: "Bundles" }],
        catalogues: [{ shop_id: 7, items }, { shop_id: 8, items: [{ ...items[0], id: 20 }] }, { shop_id: 9, items: [] }] };
    const pages = shopPages(snapshot);
    assert.deepEqual(pages.map(page => page.items.length), [12, 1]);
    assert.deepEqual(pages.flatMap(page => page.items.map(item => item.id)), [...items.map(item => item.id), 20]);
    assert.equal(pages[0].shop.name, "Featured");
    assert.equal(pages[1].shop.title, "Bundles");
    assert.deepEqual(shopPages({ shops: [], catalogues: [] }), []);
});

test("shop excludes expired/future shops, technical names and inactive items, but keeps items without artwork", () => {
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
    assert.deepEqual(pages[0].items, [item, { ...item, image_url: null }, { ...item, image_url: "javascript:bad" }]);
});

test("cached shop reader preserves all 33 observed sections within its bounded limit", async () => {
    globalThis.fetch = async () => Response.json({
        available: true, snapshotId: 1, contentHash: "a".repeat(64), providerSchemaVersion: 1,
        capturedAt: "2026-10-05T12:00:00Z",
        shops: Array.from({ length: 35 }, (_, id) => ({ id, name: `Section ${id}` })),
        catalogues: Array.from({ length: 33 }, (_, id) => ({ shop_id: id, items: [] })), notifications: []
    });
    const snapshot = await getCurrentRocketLeagueShop(env);
    assert.equal(snapshot.shops.length, 35);
    assert.equal(snapshot.catalogues.length, 33);
});

test("item cards remain useful without artwork and show verified variant metadata", async () => {
    const originalDocument = globalThis.document;
    const createElement = tag => ({ tagName: tag, children: [], textContent: "", append(...items) { this.children.push(...items); }, addEventListener() {}, remove() {} });
    globalThis.document = { createElement };
    try {
        const card = itemCard({
            title: "Octane", image_url: null,
            costs: [{ prices: [{ amount: 700, currency_id: 13 }] }],
            products: [{ attributes: [{ key: "Paint", value: "Titanium White" }, { key: "Untrusted", value: "ignored" }] }]
        });
        const text = card.children.map(child => child.textContent).join(" ");
        assert.equal(card.children.some(child => child.tagName === "img"), false);
        assert.match(text, /Octane/);
        assert.match(text, /700 · Currency 13/);
        assert.match(text, /Paint: Titanium White/);
        assert.doesNotMatch(text, /Untrusted/);
    } finally { globalThis.document = originalDocument; }
});

test("multi-product bundles receive distinct cards without fabricated prices, artwork or discounts", () => {
    const savedDocument = globalThis.document;
    globalThis.document = { createElement: tag => ({ tagName: tag, className: "", children: [], textContent: "",
        classList: { add() {} }, append(...children) { this.children.push(...children); }, addEventListener() {} }) };
    try {
        const item = { title: "Verified offer", image_url: null, costs: [{ prices: [{ amount: 900, currency_id: 13 }] }],
            products: [{ product_id: 1, count: 1 }, { product_id: 2, count: 2 }] };
        const bundle = itemCard(item);
        const text = bundle.children.map(child => child.textContent).join(" ");
        assert.ok(bundle.children.some(child => child.className === "rl-shop-bundle-badge" && child.textContent === "Bundle"));
        assert.match(text, /3 items in the listed contents/);
        assert.match(text, /900 · Currency 13/);
        assert.doesNotMatch(text, /discount|saving|rarity|original|product 1/i);
        assert.equal(bundle.children.some(child => child.tagName === "img"), false);
        const ordinary = itemCard({ ...item, products: [item.products[0]] });
        assert.equal(ordinary.children.some(child => child.className === "rl-shop-bundle-badge"), false);
        const unknownCount = itemCard({ ...item, products: [{ product_id: 1 }, { product_id: 2 }] });
        assert.doesNotMatch(unknownCount.children.map(child => child.textContent).join(" "), /listed contents/);
    } finally { globalThis.document = savedDocument; }
});

test("carousel cycles full shop categories, pauses its countdown, honors preferences and cleans up", async () => {
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
        const countdown = slots.get("[data-shop-countdown]");
        assert.equal(items.children.length, 4);
        tick(); assert.equal(countdown.textContent, "7s");
        for (let i = 0; i < 7; i++) tick(); assert.equal(items.children.length, 1);
        slots.get("[data-shop-next]").handlers.click();
        assert.equal(slots.get("[data-shop-section-title]").textContent, "Featured");
        assert.equal(items.children.length, 4);
        slots.get("[data-shop-next]").handlers.click();
        assert.equal(items.children.length, 1);
        slots.get("[data-shop-pause]").handlers.click();
        const pausedAt = countdown.textContent;
        tick(); assert.equal(items.children.length, 1); assert.equal(countdown.textContent, pausedAt);
        slots.get("[data-shop-pause]").handlers.click();
        document.body.dataset.animations = "off"; tick(); assert.equal(items.children.length, 1);
        document.body.dataset.animations = "on"; reduced = true; tick(); assert.equal(items.children.length, 1);
        reduced = false; root.handlers.pointerenter(); tick(); assert.equal(items.children.length, 1);
        root.handlers.pointerleave(); document.hidden = true; tick(); assert.equal(items.children.length, 1);
        document.hidden = false; for (let i = 0; i < 8; i++) tick(); assert.equal(items.children.length, 4);
        assert.equal(requests, 1);
        root.isConnected = false; tick(); assert.equal(cleared, true);
        root.isConnected = true;
        const expires = Date.now() - 1000;
        globalThis.fetch = async () => Response.json({ success: true, available: true, capturedAt: new Date().toISOString(), shops: [{ id: 1, name: "Only section", ends_at: new Date(expires + 100000).toISOString() }], catalogues: [{ shop_id: 1, items: [{ title: "Only item" }] }] });
        await initializePage();
        const originalNow = Date.now;
        try {
            Date.now = () => expires + 100001;
            tick(); assert.equal(slots.get("[data-shop-panel]").hidden, true);
            assert.equal(slots.get("[data-shop-status]").textContent, "No active shop items available");
        } finally { Date.now = originalNow; }
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

for (const stage of ["fetch", "body"]) test(`Shop deadline includes stalled ${stage}, with sanitized no-store failure`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let began;
    const started = new Promise(resolve => { began = resolve; });
    globalThis.fetch = async () => {
        began();
        return stage === "fetch" ? new Promise(() => {}) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }));
    };
    const pending = onRequestGet({ env }); await started; await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(5000);
    const response = await pending;
    assert.equal(response.status, 504); assert.equal(response.headers.get("Cache-Control"), "no-store");
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
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Shop/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /boundedJson\("\/api\/rocketleague\/shop"/);
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

test("Shop can show an active last-saved snapshot when the latest refresh is unavailable", async () => {
    const { canShowLastSavedShop } = await import("../../public/Tabs/RocketLeague/Shop/JS/index.js");
    const snapshot = {
        available: false,
        snapshotId: 42,
        capturedAt: "2026-10-05T09:00:00Z",
        shops: [{ id: 7, title: "Featured", starts_at: "2026-10-05T00:00:00Z", ends_at: "2026-10-06T00:00:00Z" }],
        catalogues: [{ shop_id: 7, items: [{ id: 9, title: "Octane", starts_at: "2026-10-05T00:00:00Z", ends_at: "2026-10-06T00:00:00Z" }] }]
    };
    assert.equal(canShowLastSavedShop(snapshot, Date.parse("2026-10-05T12:00:00Z")), true);
    assert.equal(canShowLastSavedShop({ ...snapshot, snapshotId: null }, Date.parse("2026-10-05T12:00:00Z")), false);
    assert.equal(canShowLastSavedShop({ ...snapshot, shops: [{ ...snapshot.shops[0], ends_at: "2026-10-05T10:00:00Z" }] }, Date.parse("2026-10-05T12:00:00Z")), false);
});

test("Shop page gives a dated stale notice, per-item timing and a paused cycling countdown", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Shop/JS/index.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/Shop/HTML/index.html", import.meta.url), "utf8");
    assert.match(source, /Rotation flagged out of date on/);
    assert.doesNotMatch(source, /Saved shop rotation may be out of date/);
    assert.match(html, /data-shop-countdown/);
    assert.match(html, /data-shop-position/);
    assert.match(source, /items\.classList\.add\("rl-shop-items--cycling"\)/);
    assert.match(source, /timingLabel\(shop\?\.starts_at, shop\?\.ends_at\)/);
    assert.match(source, /Available \$\{start\} – \$\{end\}/);
    assert.match(html, /data-shop-section-timing/);
});
