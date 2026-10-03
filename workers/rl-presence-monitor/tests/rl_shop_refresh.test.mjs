import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { runRocketLeagueShopRefresh } from "../src/rl_shop_refresh.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
    MMR_API_URL: "https://mmr.example.test",
    MMR_API_KEY: "worker-secret",
    SUPABASE_URL: "https://supabase.example.test/rest/v1",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret"
};

test("Shop refresh normalizes provider response, hashes content, saves, and checkpoints unchanged content", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        calls.push({ host: parsed.hostname, path: parsed.pathname, body: init.body ? JSON.parse(init.body) : null });
        if (parsed.hostname === "mmr.example.test") {
            assert.equal(parsed.pathname, "/get-shop-data");
            assert.equal(init.headers.Authorization, "Bearer worker-secret");
            return Response.json({ success: true, shops: [{ id: 7 }], catalogues: [{ shop_id: 7, items: [] }] });
        }
        if (parsed.pathname.endsWith("/save_rl_shop_snapshot")) return Response.json({ saved: false, snapshot_id: 21 });
        if (parsed.pathname.endsWith("/record_rl_global_refresh_result")) return Response.json({ success: true });
        throw new Error("Unexpected request");
    };

    const result = await runRocketLeagueShopRefresh(env);
    assert.equal(result.success, true);
    assert.equal(result.changed, false);
    assert.deepEqual(calls.map(call => call.path.split("/").at(-1)), [
        "get-shop-data", "save_rl_shop_snapshot", "record_rl_global_refresh_result"
    ]);
    const save = calls.find(call => call.path.endsWith("/save_rl_shop_snapshot")).body;
    assert.match(save.p_content_hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(save.p_shops, [{ id: 7 }]);
    assert.deepEqual(save.p_catalogues, [{ shop_id: 7, items: [] }]);
    assert.deepEqual(save.p_notifications, []);
    assert.equal(save.p_provider_schema_version, 1);
    assert.ok(Number.isFinite(Date.parse(save.p_captured_at)));
    assert.deepEqual(calls.at(-1).body, {
        p_refresh_key: "shop", p_success: true, p_changed: false, p_error_code: null
    });
    assert.equal(JSON.stringify(result).includes("service-secret"), false);
});

test("Shop provider failure preserves the last saved snapshot and records a sanitized global failure", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        calls.push(parsed.pathname.split("/").at(-1));
        if (parsed.hostname === "mmr.example.test") {
            return Response.json({ code: "EOS_REAUTHORIZATION_REQUIRED", error: "private upstream detail" }, { status: 503 });
        }
        return Response.json({ success: true });
    };
    const result = await runRocketLeagueShopRefresh(env);
    assert.deepEqual(result, { success: false, changed: false, errorCode: "EOS_REAUTHORIZATION_REQUIRED" });
    assert.deepEqual(calls, ["get-shop-data", "record_rl_global_refresh_result"]);
});

test("invalid Shop payload is not persisted and provider-controlled error text is not returned", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        calls.push(parsed.pathname.split("/").at(-1));
        if (parsed.hostname === "mmr.example.test") return Response.json({ success: true, shops: "invalid", catalogues: [] });
        return Response.json({ success: true });
    };
    const result = await runRocketLeagueShopRefresh(env);
    assert.deepEqual(result, { success: false, changed: false, errorCode: "RL_SHOP_PROVIDER_RESPONSE_INVALID" });
    assert.deepEqual(calls, ["get-shop-data", "record_rl_global_refresh_result"]);
});

test("empty Shop catalogue cannot replace the last known snapshot", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        calls.push(parsed.pathname.split("/").at(-1));
        if (parsed.hostname === "mmr.example.test") return Response.json({ success: true, shops: [], catalogues: [] });
        return Response.json({ success: true });
    };
    const result = await runRocketLeagueShopRefresh(env);
    assert.deepEqual(result, { success: false, changed: false, errorCode: "RL_SHOP_PROVIDER_RESPONSE_INVALID" });
    assert.deepEqual(calls, ["get-shop-data", "record_rl_global_refresh_result"]);
});
