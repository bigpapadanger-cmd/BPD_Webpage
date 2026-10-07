import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { getPublicRocketLeaguePlayerSummary } from "../../functions/services/supabase/rocketleague/discovery.js";
import { onRequest, onRequestGet } from "../../functions/api/rocketleague/players/profile/[publicProfileId].js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const id = "38c395e6-cac4-4f27-86c0-f88f7304c618";
const env = { SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" };
function day(offset = 0) {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
}
function payload() {
    return { success: true, capturedAt: new Date().toISOString(), player: {
        displayName: "Pilot", epicDisplayName: "Epic Pilot", primaryPlatform: "epic",
        currentMmr: { capturedAt: null, ones: { mmr: 10, tier: "Gold" },
            twos: { mmr: null, tier: null }, threes: { mmr: 0, tier: null } },
        stats: { wins: 0, goals: 10, assists: 3, saves: 1, shots: 20, mvps: 2, capturedAt: null },
        mmrHistory: Array.from({ length: 14 }, (_, index) => ({ date: day(index - 13), ones: 10 + index, twos: null, threes: 0 }))
    } };
}
function context(query = "", method = "GET") {
    return { env, params: { publicProfileId: id }, request: new Request(`https://site.test/api/rocketleague/players/profile/${id}${query}`, { method }) };
}

test("public summary makes one service-role RPC and projects only the approved fields", async () => {
    const upstream = payload();
    Object.assign(upstream.player, { account_id: "private-account", player_id: "private-player", email: "private-email",
        phone: "private-phone", provider_subject: "private-subject", presence: "online", preferences: {}, moderation: {} });
    upstream.player.currentMmr.ones.accountId = "private-account";
    upstream.player.mmrHistory[0].snapshots = [{ account_id: "private-account" }];
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json(upstream); };
    const response = await onRequestGet(context());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ["capturedAt", "player", "success"]);
    assert.deepEqual(Object.keys(result.player).sort(), ["currentMmr", "displayName", "epicDisplayName", "mmrHistory", "primaryPlatform", "stats"]);
    assert.equal(result.player.mmrHistory.length, 14);
    assert.deepEqual(result.player.mmrHistory.map(point => point.date), payload().player.mmrHistory.map(point => point.date));
    assert.equal(result.player.mmrHistory[0].twos, null);
    assert.equal(result.player.currentMmr.threes.mmr, 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/rpc/get_public_rl_player_summary"));
    assert.deepEqual(JSON.parse(calls[0].init.body), { p_public_profile_id: id });
    assert.equal(calls[0].init.headers.Authorization, "Bearer server-only");
    assert.doesNotMatch(JSON.stringify(result), /private-|account_id|player_id|provider_subject|preferences|moderation|presence|snapshots|server-only/);
});

for (const kind of ["too-many", "unordered", "duplicate", "old", "future", "bad-number", "missing-history"]) {
    test(`public daily contract rejects ${kind} history`, async () => {
        const value = payload();
        if (kind === "too-many") value.player.mmrHistory.push({ date: day(), ones: 1, twos: 1, threes: 1 });
        if (kind === "unordered") value.player.mmrHistory.reverse();
        if (kind === "duplicate") value.player.mmrHistory[1].date = value.player.mmrHistory[0].date;
        if (kind === "old") value.player.mmrHistory[0].date = day(-14);
        if (kind === "future") value.player.mmrHistory.at(-1).date = day(1);
        if (kind === "bad-number") value.player.mmrHistory[0].ones = "10";
        if (kind === "missing-history") delete value.player.mmrHistory;
        globalThis.fetch = async () => Response.json(value);
        await assert.rejects(getPublicRocketLeaguePlayerSummary(env, id), { status: 502 });
    });
}

test("empty daily history remains valid without inventing points", async () => {
    const value = payload(); value.player.mmrHistory = [];
    globalThis.fetch = async () => Response.json(value);
    assert.deepEqual((await getPublicRocketLeaguePlayerSummary(env, id)).player.mmrHistory, []);
});

test("unavailable/private profiles return the same sanitized 404", async () => {
    globalThis.fetch = async () => Response.json({ code: "P0002", message: "PUBLIC_RL_PROFILE_NOT_FOUND", details: "private" }, { status: 404 });
    const response = await onRequestGet(context());
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, error: "PROFILE_UNAVAILABLE" });
});

test("public lookup rejects internal ID query parameters and unsupported methods", async () => {
    globalThis.fetch = () => { throw new Error("must not fetch"); };
    assert.equal((await onRequestGet(context("?accountId=arbitrary"))).status, 400);
    assert.equal((await onRequest(context("", "POST"))).status, 405);
});

function node(tagName = "div") {
    return { tagName, children: [], attributes: {}, dataset: {}, textContent: "", hidden: false, isConnected: true,
        append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
        setAttribute(key, value) { this.attributes[key] = value; }, addEventListener() {}, closest() { return { parentNode: {} }; } };
}

test("Player lifecycle renders daily graph, polls without overlap, skips hidden tabs, preserves data on failure and cleans up", async () => {
    const keys = ["document", "window", "MutationObserver", "setInterval", "clearInterval", "__publicPlayerFetch"];
    const saved = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
    const slots = new Map();
    const events = new Map();
    let interval, activeIntervals = 0, observed, requests = 0, rejectNext = false, release;
    const listen = (name, handler, options) => {
        events.set(name, handler);
        options?.signal?.addEventListener("abort", () => { if (events.get(name) === handler) events.delete(name); }, { once: true });
    };
    const doc = { hidden: false, body: node(), createElement: node, createElementNS: (_ns, tag) => node(tag),
        getElementById(name) { if (!slots.has(name)) slots.set(name, node()); return slots.get(name); }, addEventListener: listen };
    globalThis.document = doc;
    globalThis.window = { location: { search: `?id=${id}` }, addEventListener: listen };
    globalThis.MutationObserver = class { constructor(callback) { observed = callback; } observe() {} disconnect() {} };
    globalThis.setInterval = callback => { interval = callback; activeIntervals++; return activeIntervals; };
    globalThis.clearInterval = () => { activeIntervals--; };
    globalThis.__publicPlayerFetch = async () => {
        requests++;
        if (release) await new Promise(resolve => { release = resolve; });
        if (rejectNext) throw new Error("network");
        return Response.json(payload());
    };
    let page;
    try {
        const sourceUrl = new URL("../../public/Tabs/RocketLeague/PublicProfile/JS/index.js", import.meta.url);
        let source = await readFile(sourceUrl, "utf8");
        source = source.replace('import { apiFetch } from "/scripts/apiConnection.js";', 'const apiFetch = (...args) => globalThis.__publicPlayerFetch(...args);')
            .replace('import { getRocketLeaguePublicProfileUrl } from "/scripts/apiRoutes.js";', 'const getRocketLeaguePublicProfileUrl = id => `/api/rocketleague/players/profile/${id}`;')
            .replace(/from "(\.\.[^"]+)"/g, (_match, path) => `from "${new URL(path, sourceUrl).href}"`);
        page = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
        await page.initializePage();
        assert.equal(requests, 1); assert.equal(activeIntervals, 1);
        assert.equal(slots.get("publicProfileName").textContent, "Pilot");
        assert.equal(slots.get("publicProfileRanks").children.length, 3);
        assert.equal(slots.get("publicProfileStats").children.length, 6);
        assert.equal(slots.get("publicMmrHistoryGraph").children.filter(child => child.tagName === "svg").length, 1);
        assert.match(slots.get("publicMmrHistoryStatus").textContent, /14 UTC daily averages/);
        doc.hidden = true; await interval(); assert.equal(requests, 1);
        doc.hidden = false; await interval(); assert.equal(requests, 2);
        rejectNext = true; await interval();
        assert.equal(slots.get("publicProfileContent").hidden, false);
        assert.match(slots.get("publicProfileStatus").textContent, /last loaded/);
        rejectNext = false;
        release = () => {};
        const pending = interval(); const before = requests;
        await interval(); assert.equal(requests, before);
        release(); release = null; await pending;
        await page.initializePage(); assert.equal(activeIntervals, 1);
        slots.get("publicProfileStatus").isConnected = false;
        observed(); assert.equal(activeIntervals, 0);
        assert.equal(events.has("visibilitychange"), false);
    } finally {
        events.get("pagehide")?.();
        Object.assign(globalThis, saved);
    }
});
