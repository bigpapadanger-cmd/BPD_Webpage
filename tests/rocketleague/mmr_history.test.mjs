import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getRocketLeagueMmrHistory, getRocketLeagueMmrHistorySafely, normalizeMmrHistory } from "../../functions/services/supabase/rocketleague/get_mmr_history.js";
import { normalizeMmrHistoryForChart, renderMmrHistory } from "../../public/Tabs/RocketLeague/Index/JS/mmr_dashboard.js";

function snapshot(index, overrides = {}) {
    return {
        captured_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        ones_mmr: index,
        ones_tier: "Gold",
        twos_mmr: index + 100,
        twos_tier: "Platinum",
        threes_mmr: index + 200,
        threes_tier: "Diamond",
        ...overrides
    };
}

function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function withFetch(fetchImpl, callback) {
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try { return await callback(); } finally { globalThis.fetch = original; }
}

test("MMR history normalizes empty, one, and partial-playlist records", () => {
    assert.deepEqual(normalizeMmrHistory([]), []);
    const one = normalizeMmrHistory([snapshot(0, { twos_mmr: null, twos_tier: null })]);
    assert.equal(one.length, 1);
    assert.deepEqual(one[0].twos, { mmr: null, tier: null });
    const chartRows = normalizeMmrHistoryForChart(one);
    assert.equal(chartRows.length, 1);
    assert.equal(chartRows[0].twos.mmr, null);
});

test("MMR history returns only the newest 90 captures in ascending time order", () => {
    const input = Array.from({ length: 100 }, (_, index) => snapshot(index)).reverse();
    const normalized = normalizeMmrHistory(input);
    assert.equal(normalized.length, 90);
    assert.equal(normalized[0].capturedAt, snapshot(10).captured_at);
    assert.equal(normalized.at(-1).capturedAt, snapshot(99).captured_at);
});

test("MMR history preserves short histories and exactly 90 captures", () => {
    assert.equal(normalizeMmrHistory([snapshot(2), snapshot(0), snapshot(1)]).length, 3);
    assert.equal(normalizeMmrHistory(Array.from({ length: 90 }, (_, index) => snapshot(index))).length, 90);
});

test("public chart limits to 30 days and averages multiple captures independently by UTC day and playlist", () => {
    const rows = [
        { capturedAt: "2026-10-04T09:00:00Z", ones: { mmr: 100, tier: "Gold" }, twos: { mmr: null, tier: null }, threes: { mmr: 800, tier: "Diamond" } },
        { capturedAt: "2026-10-04T20:00:00Z", ones: { mmr: 102, tier: "Gold" }, twos: { mmr: 500, tier: "Silver" }, threes: { mmr: null, tier: null } },
        { capturedAt: "2026-10-05T12:00:00Z", ones: { mmr: 110, tier: "Platinum" }, twos: { mmr: 510, tier: "Silver" }, threes: { mmr: 820, tier: "Diamond" } },
        { capturedAt: "2026-09-01T12:00:00Z", ones: { mmr: 20, tier: "Bronze" }, twos: { mmr: 20, tier: "Bronze" }, threes: { mmr: 20, tier: "Bronze" } }
    ];
    const averaged = normalizeMmrHistoryForChart(rows, {
        days: 30, averageByUtcDay: true, now: Date.parse("2026-10-06T00:00:00Z")
    });
    assert.equal(averaged.length, 2);
    assert.equal(averaged[0].capturedAt, "2026-10-04T00:00:00.000Z");
    assert.equal(averaged[0].ones.mmr, 101);
    assert.equal(averaged[0].ones.captureCount, 2);
    assert.equal(averaged[0].twos.mmr, 500);
    assert.equal(averaged[0].threes.mmr, 800);
    assert.equal(averaged[1].ones.mmr, 110);
});

test("30-day chart normalization retains more than the homepage 90-capture limit", () => {
    const rows = Array.from({ length: 120 }, (_, index) => {
        const day = Math.floor(index / 4);
        const hour = (index % 4) * 6;
        const date = new Date(Date.UTC(2026, 9, 1 + day, hour));
        return { capturedAt: date.toISOString(),
            ones: { mmr: 1000 + index, tier: "Champion" },
            twos: { mmr: null, tier: null },
            threes: { mmr: 2000 + index, tier: "Grand Champion" } };
    });
    const averaged = normalizeMmrHistoryForChart(rows, {
        days: 30, averageByUtcDay: true, now: Date.parse("2026-10-31T00:00:00Z")
    });
    assert.equal(averaged.length, 30);
    assert.equal(averaged[0].ones.captureCount, 4);
    assert.equal(averaged[29].ones.captureCount, 4);
});

test("public profile server flow uses the privacy-filtered daily summary without private history lookup", async () => {
    const { getPublicRocketLeaguePlayerSummary } = await import("../../functions/services/supabase/rocketleague/discovery.js");
    const calls = [];
    const accountId = "f6332c75-771a-46bc-ae09-ef5d886a4c35";
    const result = await withFetch(async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, init });
        if (parsed.pathname.endsWith("get_public_rl_player_summary")) {
            assert.deepEqual(JSON.parse(init.body), { p_public_profile_id: "38c395e6-cac4-4f27-86c0-f88f7304c618" });
            return response({ success: true, capturedAt: new Date().toISOString(), player: {
                displayName: "Public pilot", account_id: accountId,
                currentMmr: { ones: { mmr: 10, tier: "Gold" }, twos: { mmr: null, tier: null }, threes: { mmr: null, tier: null } },
                mmrHistory: [{ date: new Date().toISOString().slice(0, 10), ones: 10, twos: null, threes: null }]
            } });
        }
        throw new Error(`unexpected ${parsed.pathname}`);
    }, () => getPublicRocketLeaguePlayerSummary({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "38c395e6-cac4-4f27-86c0-f88f7304c618"));
    assert.equal(calls.length, 1);
    assert.equal(result.player.displayName, "Public pilot");
    assert.equal(result.player.mmrHistory.length, 1);
    assert.equal("account_id" in result, false);
    assert.equal("player_id" in result, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accountId));
});

test("MMR history rejects malformed payloads and snapshots", () => {
    assert.throws(() => normalizeMmrHistory({ rows: [] }), error => error.code === "MMR_HISTORY_INVALID");
    assert.throws(() => normalizeMmrHistory([snapshot(1, { ones_mmr: -1 })]), error => error.code === "MMR_HISTORY_INVALID");
    assert.throws(() => normalizeMmrHistory([snapshot(1, { threes_tier: 9 })]), error => error.code === "MMR_HISTORY_INVALID");
    assert.throws(() => normalizeMmrHistory([snapshot(1, { captured_at: "bad" })]), error => error.code === "MMR_HISTORY_INVALID");
});

test("MMR history RPC is server-only, bounded to the account argument, and does not invoke a provider", async () => {
    const calls = [];
    const rows = [snapshot(2), snapshot(1)];
    const result = await withFetch(async (url, init) => {
        calls.push({ url: new URL(url), init });
        return response(rows);
    }, () => getRocketLeagueMmrHistory({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "account-1"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/rest/v1/rpc/get_rl_player_mmr_history");
    assert.equal(calls[0].init.headers.Authorization, "Bearer server-only");
    assert.deepEqual(JSON.parse(calls[0].init.body), { p_account_id: "account-1" });
    assert.deepEqual(result.map(row => row.capturedAt), [snapshot(1).captured_at, snapshot(2).captured_at]);
});

test("MMR history RPC failure is a safe unavailable result", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const result = await withFetch(async () => response({ message: "private upstream failure" }, 503), () =>
            getRocketLeagueMmrHistorySafely({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "account-1"));
        assert.equal(result, null);
    } finally {
        console.error = originalError;
    }
});

test("home requests progression/history only for authenticated private display and normal reads remain provider-free", async () => {
    const service = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    const getHandler = service.slice(service.indexOf("async function handleProfileGet"), service.indexOf("async function handleProfilePost"));
    assert.match(getHandler, /includeMmrHistory && rocketLeagueAccess/);
    assert.match(getHandler, /getRocketLeagueMmrHistorySafely/);
    assert.match(getHandler, /mmrHistory,/);
    assert.doesNotMatch(getHandler, /refreshProviderDataWithGate\(/);
    const home = await readFile(new URL("../../public/Tabs/RocketLeague/Index/JS/profile.js", import.meta.url), "utf8");
    assert.match(home, /includeMmrHistory=true/);
    assert.doesNotMatch(home, /MMR_API_URL|get-player-data|fetchProviderCapabilities/);
});

function fakeElement(tagName) {
    return {
        tagName, children: [], attributes: {}, dataset: {}, textContent: "", className: "",
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, callback) { this[name] = callback; }
    };
}

test("chart renders a single capture, preserves null gaps, and has safe unavailable states", () => {
    const graph = fakeElement("div");
    const status = fakeElement("p");
    const documentRef = {
        getElementById(id) { return id === "rocketLeagueMmrHistoryGraph" ? graph : status; },
        createElement: tag => fakeElement(tag),
        createElementNS: (_namespace, tag) => fakeElement(tag)
    };
    renderMmrHistory([{
        capturedAt: "2026-01-01T00:00:00.000Z",
        ones: { mmr: 0, tier: "Gold" }, twos: { mmr: null, tier: null }, threes: { mmr: 200, tier: "Diamond" }
    }], documentRef);
    assert.equal(graph.children.length, 4);
    assert.equal(graph.children[0].tagName, "svg");
    assert.match(status.textContent, /1 saved capture/);
    renderMmrHistory([{ capturedAt: "bad" }], documentRef);
    assert.match(status.textContent, /temporarily unavailable/);
    renderMmrHistory(null, documentRef);
    assert.match(status.textContent, /temporarily unavailable/);
});

test("chart displays no more than the newest 90 captures", () => {
    const graph = fakeElement("div");
    const status = fakeElement("p");
    const documentRef = {
        getElementById(id) { return id === "rocketLeagueMmrHistoryGraph" ? graph : status; },
        createElement: tag => fakeElement(tag),
        createElementNS: (_namespace, tag) => fakeElement(tag)
    };
    renderMmrHistory(Array.from({ length: 100 }, (_, index) => {
        const row = snapshot(index);
        return {
            capturedAt: row.captured_at,
            ones: { mmr: row.ones_mmr, tier: row.ones_tier },
            twos: { mmr: row.twos_mmr, tier: row.twos_tier },
            threes: { mmr: row.threes_mmr, tier: row.threes_tier }
        };
    }), documentRef);
    assert.match(status.textContent, /^90 saved captures/);
    assert.equal(graph.children[0].children.filter(node => node.tagName === "circle").length, 270);
    assert.match(graph.children[0].children.find(node => node.tagName === "title").textContent, /history/i);
});

test("rank guides default to doubles, switch without losing series and retain selection on refresh", () => {
    const graph = fakeElement("div"), status = fakeElement("p");
    const documentRef = { getElementById: id => id === "rocketLeagueMmrHistoryGraph" ? graph : status,
        createElement: fakeElement, createElementNS: (_ns, tag) => fakeElement(tag) };
    const history = [{ capturedAt: "2026-10-06T00:00:00Z", ones: { mmr: 850 }, twos: { mmr: 1200 }, threes: { mmr: 1100 } }];
    const labels = () => graph.children[0].children.filter(node => node.attributes.class === "rl-mmr-chart-rank-label").map(node => node.textContent);
    renderMmrHistory(history, documentRef);
    assert.equal(graph.dataset.rankReferencePlaylist, "twos");
    assert.ok(labels().includes("Champion I · 1075"));
    const controls = graph.children[2];
    assert.equal(controls.children[2].attributes["aria-pressed"], "true");
    controls.children[1].click();
    assert.equal(graph.dataset.rankReferencePlaylist, "ones");
    assert.ok(labels().includes("Champion I · 995"));
    assert.equal(graph.children[0].children.filter(node => node.tagName === "circle").length, 3);
    renderMmrHistory(history, documentRef);
    assert.equal(graph.dataset.rankReferencePlaylist, "ones");
    graph.children[2].children[3].click();
    assert.equal(graph.dataset.rankReferencePlaylist, "threes");
    assert.ok(labels().includes("Diamond III · 980"));
});
