import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { boundedJson } from "../../public/scripts/boundedRequest.js";
import { getPageMetadata, getRouteStyles, ROUTES } from "../../public/routes.js";
import { createCustomMatchController } from "../../public/Tabs/RocketLeague/CustomMatches/JS/client.js";
import { updateLobbyRuntime } from "../../public/Tabs/RocketLeague/CustomMatches/JS/view.js";
import { callCustomMatchRuntime } from "../../functions/services/rl/custom_matches/runtime_client.js";

test("complete request deadline covers headers and stalled body decode", async () => {
    for (const fetcher of [() => new Promise(() => {}), async () => ({ json: () => new Promise(() => {}) })]) {
        await assert.rejects(boundedJson("/api/test", {}, { fetcher, timeoutMs: 5 }), /timed out/);
    }
});
test("page cancellation reaches transport and private request options are preserved", async () => {
    const lifetime = new AbortController(); let signal;
    const request = boundedJson("/api/test", { signal: lifetime.signal, cache: "no-store", credentials: "same-origin" }, {
        fetcher: async (_url, init) => { signal = init.signal; assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin"); lifetime.abort(); return { json: async () => ({}) }; }
    });
    await assert.rejects(request, { name: "AbortError" }); assert.equal(signal.aborted, true);
});
test("protected metadata and personalized match URLs cannot become indexable", () => {
    for (const route of ["/Account", "/Settings", "/Admin", "/Admin/UserManagement", "/Login", "/Error", "/RocketLeague/MyProfile", "/RocketLeague/Player"]) {
        assert.match(getPageMetadata(route).robots, /noindex/);
    }
    assert.match(getPageMetadata("/RocketLeague/FindCustomMatches", "?match=CMabcdefgh").robots, /noindex/);
    assert.equal(getPageMetadata("/RocketLeague/FindCustomMatches").robots, "index, follow");
    assert.ok(!getPageMetadata("/RocketLeague/Player", "?id=secret").canonical.includes("secret"));
});
test("route styles exist and unrelated registration/custom styles are not loaded on RL home", () => {
    for (const route of Object.keys(ROUTES)) for (const style of getRouteStyles(route)) assert.ok(existsSync(new URL(`../../public${style}`, import.meta.url)), style);
    assert.deepEqual(getRouteStyles("/RocketLeague"), []);
    assert.deepEqual(getRouteStyles("/Settings"), ["/Global/Settings/CSS/settings-page.css"]);
});
test("Settings has unique IDs and fragments do not introduce nested main landmarks", () => {
    const source = readFileSync(new URL("../../public/Global/Settings/HTML/settings.html", import.meta.url), "utf8");
    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
    for (const path of ["Framework/Shell/HTML/Body/body.html", "Tabs/RocketLeague/PublicProfile/HTML/index.html", "Tabs/RocketLeague/Features/HTML/find-custom-matches.html", "Global/Suggestions/HTML/index.html", "Required/FAQ/HTML/index.html"]) {
        assert.doesNotMatch(readFileSync(new URL(`../../public/${path}`, import.meta.url), "utf8"), /<main\b/);
    }
});
test("authoritative detail reads coalesce and existing member socket survives refresh", async t => {
    const oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
    const sockets = [];
    globalThis.location = { protocol: "https:", host: "example.test" };
    globalThis.WebSocket = class { static OPEN = 1; readyState = 1; constructor() { sockets.push(this); } close() { this.readyState = 3; } send() {} };
    t.after(() => { globalThis.WebSocket = oldSocket; globalThis.location = oldLocation; });
    const code = "CMabcdefgh";
    const value = { success: true, match: { matchCode: code, version: 1, state: "open" }, actor: { isMember: true, isHost: false }, members: [] };
    let release, count = 0;
    const controller = createCustomMatchController({ publish() {}, call: async path => {
        if (path === "/access") return { allowed: true };
        if (path.endsWith("/rounds")) return { rounds: [] };
        count++; return new Promise(resolve => { release = resolve; });
    } });
    await controller.access();
    const first = controller.detail(code), second = controller.detail(code);
    assert.equal(count, 1); release(value); await Promise.all([first, second]); assert.equal(sockets.length, 1);
    const refresh = controller.detail(code); release(value); await refresh; assert.equal(sockets.length, 1);
    sockets[0].onclose({ code: 1008 }); assert.equal(controller.state.runtimeStatus, "unavailable");
    controller.dispose();
});
test("nonmembers do not establish runtime connections", async t => {
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = class { constructor() { throw new Error("must not connect"); } };
    t.after(() => { globalThis.WebSocket = previous; });
    const controller = createCustomMatchController({ publish() {}, call: async path => path === "/access" ? { allowed: true }
        : path.endsWith("/rounds") ? { rounds: [] } : { match: { matchCode: "CMabcdefgh", version: 1, state: "open" }, actor: { isMember: false }, members: [] } });
    await controller.access(); await controller.detail("CMabcdefgh"); assert.equal(controller.state.runtimeStatus, "offline"); controller.dispose();
});
test("runtime-only updates modify text/readiness without replacing children", () => {
    const member = { dataset: { runtimeMember: "CMMabcdefgh" } }, ready = { dataset: {} }, start = {}, status = {};
    const container = { querySelectorAll: () => [member], querySelector: key => ({ "#cmReady": ready, "[data-runtime-start]": start, "[data-runtime-status]": status })[key], replaceChildren() { assert.fail("must preserve forms"); } };
    const state = { runtimeStatus: "connected", detail: { actor: { memberCode: "CMMabcdefgh" } }, runtimeMembers: [
        { memberCode: "CMMabcdefgh", team: "a", connected: true, ready: true }, { memberCode: "CMMijklmnop", team: "b", connected: true, ready: true }] };
    updateLobbyRuntime(container, state, false); assert.equal(start.disabled, false); assert.equal(ready.textContent, "Mark not ready");
    updateLobbyRuntime(container, state, true); assert.equal(start.disabled, true); assert.equal(ready.disabled, true);
});
test("runtime caller bounds response size and returns sanitized unavailable", async () => {
    const response = await callCustomMatchRuntime({ CUSTOM_MATCH_RUNTIME_CALLER_SECRET: "x".repeat(64), CUSTOM_MATCH_RUNTIME: { fetch: async () => new Response("x", { headers: { "Content-Length": "9999999" } }) } }, "/refresh/CMabcdefgh", "server-derived", {});
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { success: false, code: "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
});
