import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { onRequestGet } from "../../functions/api/rocketleague/shop.js";
import { getCurrentRocketLeagueShop } from "../../functions/services/supabase/rocketleague/current_shop.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_AUTH: "service-role-secret"
};

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
            shops: [{ id: 7, name: "Daily", isOwned: true }],
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
    assert.deepEqual(result.shops, [{ id: 7, type: null, name: "Daily", title: null, starts_at: null, ends_at: null, logo_url: null }]);
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
    assert.doesNotMatch(source, /MMR_API_URL|SUPABASE_AUTH|\/get-shop-data|Shops\/Get/);
});
