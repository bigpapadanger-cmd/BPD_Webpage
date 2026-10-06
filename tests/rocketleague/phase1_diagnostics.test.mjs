import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { checkDataReadiness } from "../../scripts/debug-data-readiness.mjs";
import { getPlatformDisplayName } from "../../public/Tabs/RocketLeague/shared/profileView.js";
import { normalizeMmrHistoryForChart } from "../../public/Tabs/RocketLeague/Index/JS/mmr_dashboard.js";
import { refreshStatsWithGate } from "../../functions/services/rl/stats/refresh_with_gate.js";
import { getLatestMmr } from "../../functions/services/rl/stats/latest_mmr.js";
import { getMmrRankReferences } from "../../public/Tabs/RocketLeague/shared/mmrRankReferences.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("rank reference configuration is playlist-specific, overridable and rejects malformed values", () => {
    assert.equal(getMmrRankReferences("ones").find(row => row.rank === "Gold I").mmr, 440);
    assert.equal(getMmrRankReferences("twos").find(row => row.rank === "Gold I").mmr, 475);
    assert.equal(getMmrRankReferences("threes").find(row => row.rank === "Gold I").mmr, 460);
    assert.deepEqual(getMmrRankReferences("twos", { twos: [{ rank: "Gold I", mmr: 480 }] }), [{ rank: "Gold I", mmr: 480 }]);
    assert.deepEqual(getMmrRankReferences("twos", { twos: [{ rank: "Gold I", mmr: "480" }] }), []);
});

test("normal activity does not collect MMR or consult old daily gates", async () => {
    globalThis.fetch = () => { throw new Error("no provider or database call"); };
    const result = await refreshStatsWithGate({}, "server-account");
    assert.equal(result.scheduled, true);
    assert.equal(result.refreshed, false);
    assert.equal(result.reason, "HOURLY_SCHEDULER_OWNS_REFRESH");
});

test("latest MMR checks Supabase despite fresh KV and preserves fallback on outage", async () => {
    const cached = { verifiedAt: new Date().toISOString(), capturedAt: "2026-10-05T00:00:00Z",
        ones: { mmr: 800 }, twos: { mmr: 1200 }, threes: { mmr: 1100 } };
    let writes = 0, requests = 0;
    const env = { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "test-secret",
        RL_STATS_CACHE: { get: async () => cached, put: async () => { writes++; } } };
    globalThis.fetch = async url => {
        requests++;
        assert.ok(String(url).endsWith("/rpc/get_latest_rl_player_mmr_snapshot"));
        return Response.json({ account_id: "test-account", captured_at: "2026-10-06T00:00:00Z",
            ones_mmr: 810, twos_mmr: 1220, threes_mmr: 1110 });
    };
    const latest = await getLatestMmr(env, "test-account");
    assert.equal(latest.twos.mmr, 1220);
    assert.equal(latest.source, "supabase");
    assert.equal(requests, 1);
    assert.equal(writes, 1);
    globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status: 503 });
    const fallback = await getLatestMmr(env, "test-account");
    assert.equal(fallback.twos.mmr, 1200);
    assert.equal(fallback.stale, true);
    assert.equal(fallback.source, "kv-cache");
    assert.equal(writes, 1);
});

test("platform normalization affects display only", () => {
    for (const [input, expected] of [["epic", "Epic"], ["steam", "Steam"], ["xbox", "Xbox"], ["playstation", "PlayStation"]]) {
        assert.equal(getPlatformDisplayName(input), expected);
    }
    assert.equal(getPlatformDisplayName(null), "Platform not listed");
    assert.equal(getPlatformDisplayName("futurePlatform"), "futurePlatform");
});

test("daily graph spans today plus 13 UTC days, with null gaps and no browser averaging", () => {
    const now = Date.parse("2026-10-06T23:00:00Z");
    const point = { capturedAt: "2026-10-05T00:00:00Z", ones: { mmr: 800 }, twos: { mmr: null }, threes: { mmr: 1100 } };
    const points = normalizeMmrHistoryForChart([point], { days: 14, dailyAverages: true, now });
    assert.equal(points.length, 14);
    assert.equal(points[0].capturedAt, "2026-09-23T00:00:00.000Z");
    assert.equal(points.at(-1).capturedAt, "2026-10-06T00:00:00.000Z");
    assert.equal(points.at(-1).ones.mmr, null);
    assert.equal(points.at(-2).ones.mmr, 800);
    assert.equal(points.at(-2).twos.mmr, null);
});

test("shared SVG rules apply outside the homepage, with no polygon fill and readable legend", async () => {
    const css = await readFile(new URL("../../public/Tabs/RocketLeague/Index/CSS/index.css", import.meta.url), "utf8");
    assert.match(css, /\n\.rl-mmr-chart-line \{ fill: none/);
    assert.match(css, /\.rl-mmr-chart-axis-label \{ fill: var\(--rl-text-muted, #b9c7db\)/);
    assert.match(css, /\n\.rl-mmr-chart-legend \{\s*display: flex/);
});

test("readiness caller tests both configured credentials using fixed read-only RPCs and redacts provider errors", async () => {
    const calls = [];
    const results = await checkDataReadiness({ SUPABASE_URL: "https://db.example/rest/v1/", SUPABASE_AUTH: "secret-a", SUPABASE_SERVICE_ROLE_KEY: "secret-b" },
        async (url, init) => {
            calls.push({ url, init });
            return Response.json({ code: "42501", message: "secret SQL/account-id", hint: "secret-a" }, { status: 403 });
        });
    assert.equal(calls.length, 4);
    assert.equal(results.every(result => result.code === "42501"), true);
    assert.equal(calls.every(call => /\/(list_published_faqs|get_rl_global_leaderboard)$/.test(call.url)), true);
    assert.doesNotMatch(JSON.stringify(results), /secret-a|secret-b|secret SQL|account-id/);
});

test("readiness caller recognizes an expected public contract without exposing records", async () => {
    const results = await checkDataReadiness({ SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "secret-a" }, async url =>
        Response.json(url.endsWith("list_published_faqs") ? { success: true, faqs: [] } : { success: true, rows: [{ playerName: "private-test-name" }] }));
    assert.equal(results.filter(result => result.contractValid === true).length, 2);
    assert.doesNotMatch(JSON.stringify(results), /private-test-name/);
});
