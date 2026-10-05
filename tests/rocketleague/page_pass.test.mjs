import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { onRequest as networkRoute } from "../../functions/api/rocketleague/network-statistics.js";
import { onRequest as featuredRoute } from "../../functions/api/rocketleague/players/featured.js";
import { renderNetworkStatistics, initializeNetworkStatistics } from "../../public/Tabs/RocketLeague/Index/JS/networkStatistics.js";
import { createPlayerCard } from "../../public/Tabs/RocketLeague/FindPlayers/JS/view.js";
import { shopImage } from "../../public/Tabs/RocketLeague/Features/JS/shop.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.document = originalDocument; });
const env = { SUPABASE_URL: "https://supabase.test", SUPABASE_AUTH: "server-secret" };
const request = new Request("https://bpd-gaming-network.com/api/rocketleague/network-statistics");
const publicId = "38c395e6-cac4-4f27-86c0-f88f7304c618";
const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
function fakeNode(tag) {
    return { tagName: tag, children: [], dataset: {}, listeners: {}, attributes: {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        addEventListener(type, fn) { this.listeners[type] = fn; }
    };
}
const fakeDocument = { createElement: fakeNode };
const featured = player => ({ featuredDate: "2026-10-05", validUntil: "2026-10-06T00:00:00Z", player });

test("network statistics use the confirmed RPC with server credentials and a public allowlist", async () => {
    globalThis.fetch = async (url, init) => {
        assert.equal(new URL(url).pathname, "/rest/v1/rpc/get_rocketleague_network_statistics");
        assert.equal(init.headers["Content-Profile"], "api");
        assert.equal(init.headers.Authorization, "Bearer server-secret");
        assert.deepEqual(JSON.parse(init.body), {});
        return Response.json({ playersOnline: 0, registeredPlayers: 12, activeSeasons: null, upcomingEvents: null,
            matchesPlayed: 4, scoreboardsSubmitted: null, goalsRecorded: 9, generatedAt: "2026-10-05T00:00:00Z", account_id: "private" });
    };
    const result = await (await networkRoute({ request, env })).json();
    assert.equal(result.playersOnline, 0);
    assert.equal(result.registeredPlayers, 12);
    assert.equal(result.activeSeasons, null);
    assert.equal(result.account_id, undefined);
});

test("network rendering preserves zero and distinguishes null or invalid numbers", () => {
    const nodes = Object.fromEntries(["rocketLeaguePlayersOnline", "rocketLeagueRegisteredPlayers", "rocketLeagueSeasonCount"].map(id => [id, {}]));
    renderNetworkStatistics({ getElementById: id => nodes[id] }, { playersOnline: 0, registeredPlayers: 12, activeSeasons: null });
    assert.equal(nodes.rocketLeaguePlayersOnline.textContent, "0");
    assert.equal(nodes.rocketLeagueRegisteredPlayers.textContent, "12");
    assert.equal(nodes.rocketLeagueSeasonCount.textContent, "—");
    renderNetworkStatistics({ getElementById: id => nodes[id] }, { playersOnline: "0", registeredPlayers: -1 });
    assert.equal(nodes.rocketLeaguePlayersOnline.textContent, "—");
    assert.equal(nodes.rocketLeagueRegisteredPlayers.textContent, "—");
});

test("network failure clears old numbers without a provider call", async () => {
    const node = { textContent: "99" };
    globalThis.fetch = async url => { assert.equal(url, "/api/rocketleague/network-statistics"); throw new Error("offline"); };
    await initializeNetworkStatistics({ getElementById: () => node });
    assert.equal(node.textContent, "—");
});

test("homepage has one statistics block immediately after the MMR history panel", async () => {
    const html = await source("public/Tabs/RocketLeague/Index/HTML/index.html");
    assert.equal((html.match(/Rocket League by the Numbers/g) || []).length, 1);
    assert.match(html, /id="rocketLeagueMmrHistoryGraph"[^]*?<\/section>\s*<section\s+class="content-card rocket-league-statistics-card"/);
    assert.doesNotMatch(html, /until authoritative aggregate data is connected/);
});

test("read routes reject non-GET without calling Supabase", async () => {
    globalThis.fetch = async () => { throw new Error("must not call"); };
    for (const route of [networkRoute, featuredRoute]) {
        assert.equal((await route({ env, request: new Request(request.url, { method: "POST" }) })).status, 405);
    }
});

test("featured read uses only the daily RPC, masks presence and strips private data", async () => {
    globalThis.fetch = async url => {
        assert.equal(new URL(url).pathname, "/rest/v1/rpc/get_rl_featured_player");
        return Response.json(featured({ public_profile_id: publicId, display_name: "Pilot", presence_shared: false,
            presence_state: "online", account_id: "private", epic_account_id: "private-epic", aliases: ["private-name"],
            stats: { goals: 0 }, mmr: { twos_mmr: 1000 } }));
    };
    const response = await featuredRoute({ request, env });
    const result = await response.json();
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(result.player.display_name, "Pilot");
    assert.equal(result.player.presence_state, null);
    assert.equal(result.player.stats.goals, 0);
    assert.doesNotMatch(JSON.stringify(result), /private|aliases|account_id|server-secret/);
});

test("featured hidden or ineligible selection remains empty", async () => {
    for (const player of [null, { public_profile_id: publicId, find_profile_enabled: false }]) {
        globalThis.fetch = async () => Response.json(featured(player));
        assert.equal((await (await featuredRoute({ request, env })).json()).player, null);
    }
});

test("featured RPC failure and malformed envelope are sanitized", async () => {
    for (const payload of [{ error: "sensitive provider error" }, { player: [] }]) {
        globalThis.fetch = async () => Response.json(payload);
        const response = await featuredRoute({ request, env });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { success: false, error: "FEATURED_PLAYER_UNAVAILABLE" });
    }
});

test("Find Players grid gives the input the flexible column and stacks on mobile", async () => {
    const css = await source("public/Tabs/RocketLeague/FindPlayers/CSS/index.css");
    assert.match(css, /grid-template-columns: minmax\(0, 1fr\) auto/);
    assert.match(css, /controls button \{ flex: 0 0 auto; width: auto/);
    assert.match(css, /@media \(max-width: 620px\)[^]*?controls \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test("Find Players loads featured before submission, hides on search and restores on clearing", async () => {
    const js = await source("public/Tabs/RocketLeague/FindPlayers/JS/index.js");
    assert.ok(js.indexOf('/api/rocketleague/players/featured') < js.indexOf('form.addEventListener("submit"'));
    assert.match(js, /featured.hidden = true/);
    assert.match(js, /queryInput.addEventListener\("input"[^]*?featured.hidden = false/);
    assert.match(js, /form.addEventListener\("submit"/);
    assert.match(js, /query.length < 2 \|\| query.length > 80/);
});

test("featured card shows authoritative career totals while regular search cards stay compact", () => {
    const player = { public_profile_id: publicId, display_name: "Pilot", stats: { goals: 0, wins: null } };
    const featuredCard = createPlayerCard(fakeDocument, player, { featured: true });
    assert.ok(featuredCard.children.some(node => node.textContent === "0 goals"));
    const regularCard = createPlayerCard(fakeDocument, player);
    assert.equal(regularCard.children.some(node => node.className === "rl-player-career"), false);
});

test("shop images use HTTPS only and never substitute placeholder artwork", () => {
    globalThis.document = fakeDocument;
    for (const url of [null, "javascript:alert(1)", "data:image/png;base64,bad", "http://image.test/x", "https://user:pass@image.test/x"]) {
        assert.equal(shopImage(url, "Item", "image"), null);
    }
    const image = shopImage("https://image.test/item.png", "Item", "image");
    assert.equal(image.src, "https://image.test/item.png");
    let removed = false;
    image.closest = () => null;
    image.remove = () => { removed = true; };
    image.listeners.error();
    assert.equal(removed, true);
});

test("shop renders section logos without any browser provider request", async () => {
    const js = await source("public/Tabs/RocketLeague/Features/JS/shop.js");
    assert.match(js, /shopImage\(shop\?\.logo_url/);
    assert.match(js, /shopImage\(item.image_url/);
    assert.doesNotMatch(js, /get-shop-data|Shops\/Get|SUPABASE_AUTH/);
});
