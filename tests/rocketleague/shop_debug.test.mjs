import assert from "node:assert/strict";
import test from "node:test";
import { callShopDebug, summarizeShop } from "../../scripts/debug-rl-shop.mjs";

const snapshot = { success: true, shops: [{ id: 52, name: "Featured Shop", token: "SECRET" }],
    catalogues: [{ shop_id: 52, items: [{ id: 1, title: null, image_url: null, products: [{ product_id: 4770 }] },
        { id: 2, title: "Real item", image_url: "https://images.test/item.png?token=SECRET", costs: [{ prices: [{ amount: 700, currency_id: 13 }] }], account_id: "SECRET" }] }], PsyToken: "SECRET" };

test("catalog diagnostic makes one fixed read and strips private fields and image query", async () => {
    let calls = 0;
    const result = await callShopDebug("catalog", { MMR_API_URL: "https://worker.test", MMR_API_KEY: "secret" }, null, async (url, init) => {
        calls++;
        assert.equal(url.pathname, "/get-mtx-catalog");
        assert.equal(url.search, "");
        assert.equal(init.headers.Authorization, "Bearer secret");
        return Response.json({ success: true, category: "StarterPack", account: "PRIVATE", products: [
            { id: 139, title: "Pack", imageUrl: "https://cdn.test/pack.png?token=PRIVATE", imageStatus: "usable", productIds: [4284], IsOwned: true }
        ] });
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.products[0], { id: 139, title: "Pack", imageUrl: "https://cdn.test/pack.png", imageStatus: "usable", productIds: [4284] });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|IsOwned/);
    await assert.rejects(callShopDebug("catalog", {}, 52), { code: "SHOP_DEBUG_ARGUMENTS_INVALID" });
    await assert.rejects(callShopDebug("catalog", { MMR_API_URL: "https://worker.test", MMR_API_KEY: "secret" }, null,
        async () => Response.json({ success: true, category: "Other", products: [] })), { code: "SHOP_DEBUG_RESPONSE_INVALID" });
});

test("debug summary exposes useful missing fields/product IDs but no raw credentials or image query strings", () => {
    const result = summarizeShop(snapshot, 52);
    assert.equal(result.categories[0].missingImages, 1);
    assert.equal(result.categories[0].missingTitles, 1);
    assert.deepEqual(result.selectedItems[0].productIds, [4770]);
    assert.equal(result.selectedItems[1].imageUrl, "https://images.test/item.png");
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("debug worker caller makes exactly one fixed authenticated GET and never persists", async () => {
    let calls = 0;
    await callShopDebug("worker", { MMR_API_URL: "https://worker.test", MMR_API_KEY: "secret" }, 52, async (url, init) => {
        calls++;
        assert.equal(url.href, "https://worker.test/get-shop-data");
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers.Authorization, "Bearer secret");
        assert.ok(init.signal);
        return Response.json(snapshot);
    });
    assert.equal(calls, 1);
});

test("cache debug caller never sends MMR credentials and preserves complete inventory", async () => {
    const result = await callShopDebug("cached", { MMR_API_KEY: "secret", BPD_SITE_URL: "http://localhost:8788" }, null, async (url, init) => {
        assert.equal(url.href, "http://localhost:8788/api/rocketleague/shop");
        assert.equal(init.headers.Authorization, undefined);
        return Response.json(snapshot);
    });
    assert.equal(result.catalogueCount, 1);
    assert.deepEqual(result.selectedItems, []);
});

test("debug errors are bounded and never expose provider error bodies", async () => {
    await assert.rejects(callShopDebug("worker", { MMR_API_URL: "https://worker.test" }), { code: "SHOP_DEBUG_KEY_MISSING" });
    await assert.rejects(callShopDebug("worker", { MMR_API_URL: "http://worker.test", MMR_API_KEY: "secret" }), { code: "SHOP_DEBUG_URL_INVALID" });
    await assert.rejects(callShopDebug("cached", {}, null, async () => Response.json({ error: "SECRET" }, { status: 401 })), { code: "SHOP_DEBUG_HTTP_401" });
    await assert.rejects(callShopDebug("cached", {}, null, async () => new Response("SECRET", { headers: { "Content-Length": String(3 * 1024 * 1024) } })), { code: "UPSTREAM_RESPONSE_TOO_LARGE" });
    assert.throws(() => summarizeShop({ success: true }), { code: "SHOP_DEBUG_RESPONSE_INVALID" });
});
