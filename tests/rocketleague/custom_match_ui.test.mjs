import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCustomMatchController, requestCustomMatch, errorMessage } from "../../public/Tabs/RocketLeague/CustomMatches/JS/client.js";
import { basicLifecycleActions, renderLobby, renderBrowse, renderCredentials, renderHostManagement, renderRounds } from "../../public/Tabs/RocketLeague/CustomMatches/JS/view.js";

const matchCode = "CMabcdefgh", memberCode = "CMMabcdefgh";
const limits = { success: true, maxTeamCapacity: 32, maxTotalParticipants: 64, modes: [{ modeKey: "standard", usesRounds: false, usesVoting: false }] };
const detail = version => ({ success: true, match: { matchCode, version, title: "Match", visibility: "public", state: "open", joinPolicy: "open", teamACapacity: 2, teamBCapacity: 2, teamACount: 1, teamBCount: 0, hostDisplayName: "Host" },
    actor: { isHost: true, isMember: true, memberCode, eligible: true, canJoin: false }, members: [{ memberCode, displayName: "Host", team: "a", memberRole: "host" }] });
function setup(overrides = {}) {
    const calls = []; let keyCount = 0;
    const controller = createCustomMatchController({ publish: () => {}, makeKey: () => `key-${++keyCount}`, call: async (path, init) => {
        calls.push({ path, init });
        if (init?.method === "POST") return overrides.mutate ? overrides.mutate(path, init) : { success: true, matchCode };
        if (path === "/access") return overrides.access ? overrides.access() : { success: true, allowed: true };
        if (path === "/limits") return limits;
        if (path.endsWith("/credentials")) return overrides.credentials ? overrides.credentials() : { success: true, matchCode, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" } };
        if (path.startsWith("?")) return { success: true, matches: [], page: Number(new URLSearchParams(path.slice(1)).get("page")), total: 0, hasMore: false };
        return overrides.detail ? overrides.detail() : detail(5);
    } });
    return { controller, calls, keys: () => keyCount };
}
test("access and limits gate mutations; failure settles and public browse remains usable", async () => {
    const { controller, calls } = setup({ access: () => { throw Object.assign(new Error(), { status: 403, code: "CUSTOM_MATCH_ACCESS_DENIED" }); } });
    assert.equal(controller.state.accessPending, true); await controller.access();
    assert.equal(controller.state.accessPending, false); assert.equal(controller.state.access, false);
    await controller.limits(); await controller.browse(); await controller.create({ title: "x", modeKey: "standard", teamACapacity: 1, teamBCapacity: 1 });
    assert.equal(controller.state.browsePending, false); assert.match(controller.state.browseMessage, /No public matches/);
    assert.ok(!calls.some(item => item.init?.method === "POST"));
});

test("successful create immediately uses protected credentials read, without trusting receipt secrets", async () => {
    const { controller, calls } = setup({ mutate: () => ({ success: true, match: { matchCode }, credentials: { lobbyName: "unsafe", lobbyPassword: "unsafe" } }) });
    await controller.access(); await controller.limits();
    await controller.create({ title: "Test", modeKey: "standard", teamACapacity: 1, teamBCapacity: 1 });
    assert.equal(calls.filter(item => item.path.endsWith("/credentials")).length, 1);
    assert.equal(controller.state.credentials.lobbyName, "abcdefgh12");
    controller.dispose(); assert.equal(controller.state.credentials, null);
});
test("version conflict refreshes authoritative version exactly once with no blind retry", async () => {
    let version = 5;
    const { controller, calls, keys } = setup({ detail: () => detail(version), mutate: () => { version = 6; throw Object.assign(new Error(), { code: "CUSTOM_MATCH_VERSION_CONFLICT", status: 409 }); } });
    await controller.access(); await controller.detail(matchCode); await controller.action("join", { team: "b" });
    assert.equal(controller.state.detail.match.version, 6); assert.equal(controller.state.busy, false); assert.equal(controller.state.retry, null);
    assert.match(controller.state.message, /current state has been refreshed/);
    const posts = calls.filter(item => item.init?.method === "POST"); assert.equal(posts.length, 1); assert.equal(posts[0].init.body.expectedVersion, 5); assert.equal(keys(), 1);
});
test("transport retry reuses exact request body, version and key; concurrent clicks are ignored", async () => {
    let fail = true, release;
    const { controller, calls, keys } = setup({ mutate: async () => { if (fail) { fail = false; throw Object.assign(new Error(), { status: 504 }); } await new Promise(resolve => { release = resolve; }); return { success: true, matchCode }; } });
    await controller.access(); await controller.detail(matchCode); await controller.action("leave");
    assert.equal(controller.state.busy, false); assert.ok(controller.state.retry);
    const retry = controller.retry(); await Promise.resolve(); assert.equal(controller.state.busy, true);
    await controller.action("leave"); release(); await retry;
    const posts = calls.filter(item => item.init?.method === "POST"); assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); assert.equal(keys(), 1);
    assert.equal(controller.state.retry, null); assert.equal(controller.state.busy, false);
});
test("malformed detail/refresh failure clears protected detail instead of leaving loading stuck", async () => {
    const { controller } = setup({ detail: () => ({ success: true, match: {} }) });
    await controller.access(); await controller.detail(matchCode);
    assert.equal(controller.state.detail, null); assert.equal(controller.state.detailPending, false); assert.match(controller.state.detailMessage, /unavailable/);
});
test("known permission failure does not become an uncertain retry and hides old detail", async () => {
    const { controller } = setup({ mutate: () => { throw Object.assign(new Error(), { status: 403, code: "CUSTOM_MATCH_ACCESS_DENIED" }); } });
    await controller.access(); await controller.detail(matchCode); await controller.action("leave");
    assert.equal(controller.state.access, false); assert.equal(controller.state.detail, null); assert.equal(controller.state.busy, false); assert.equal(controller.state.retry, null);
});
test("host permission change refreshes actor state without misclassifying successful authentication", async () => {
    let isHost = true;
    const { controller } = setup({ detail: () => { const value = detail(6); value.actor.isHost = isHost; return value; },
        mutate: () => { isHost = false; throw Object.assign(new Error(), { status: 403, code: "CUSTOM_MATCH_HOST_REQUIRED" }); } });
    await controller.access(); await controller.detail(matchCode); await controller.action("open");
    assert.equal(controller.state.access, true); assert.equal(controller.state.detail.actor.isHost, false); assert.equal(controller.state.busy, false);
});
test("browse has explicit pagination/filter and ignores stale response completion", async () => {
    const { controller, calls } = setup(); await controller.browse(2, "open");
    assert.equal(controller.state.page, 2); assert.match(calls[0].path, /page=2&pageSize=30&state=open/);
    const pending = []; const other = createCustomMatchController({ publish() {}, call: () => new Promise(resolve => pending.push(resolve)) });
    const first = other.browse(1); const second = other.browse(2);
    pending[1]({ success: true, matches: [], page: 2, total: 0, hasMore: false }); await second;
    pending[0]({ success: true, matches: [], page: 1, total: 0, hasMore: false }); await first;
    assert.equal(other.state.page, 2);
});
test("standard presets, asymmetric and large capacities accepted within configured limits", async () => {
    for (const [a, b] of [[1, 1], [2, 2], [3, 3], [4, 4], [1, 3], [1, 15]]) {
        const { controller, calls } = setup({ mutate: () => ({ success: true, match: { matchCode } }) });
        await controller.access(); await controller.limits(); await controller.create({ title: "Test", modeKey: "standard", teamACapacity: a, teamBCapacity: b });
        assert.ok(calls.some(item => item.init?.body.options?.teamBCapacity === b));
    }
    const { controller, calls } = setup(); await controller.access(); await controller.limits();
    await controller.create({ title: "Test", modeKey: "standard", teamACapacity: 33, teamBCapacity: 1 });
    assert.ok(!calls.some(item => item.init?.method === "POST"));
});

class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.textContent = ""; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this[name] = value; }
}
const doc = { createElement: tag => new Node(tag) };

test("player voting has accessible choices and a real submit control; spectators get no ballot form", () => {
    const value = detail(5); value.actor.team = "a";
    const state = { detail: value, rounds: [{ roundCode: "CMRDabcdefgh", roundNumber: 1, state: "voting", roundVersion: 1 }], voteResults: {}, voteTypes: {} };
    const container = new Node("section"); renderRounds(doc, container, state);
    const nodes = flatten(container), form = nodes.find(node => node.tagName === "form");
    assert.ok(form); assert.equal(nodes.find(node => node.dataset.cmVoteSubmit).type, "submit");
    assert.deepEqual(nodes.find(node => node.dataset.voteType).children.map(node => node.value), ["player_target", "skip"]);
    assert.ok(nodes.find(node => node.dataset.voteType)["aria-label"]);
    value.actor.team = "spectator"; renderRounds(doc, container, state);
    assert.equal(flatten(container).some(node => node.tagName === "form"), false);
});
const flatten = node => [node, ...node.children.flatMap(flatten)];

test("Phase C host lists refresh after mutations and clear credentials; one failed list does not discard the others", async () => {
    const calls = []; let failInvites = false;
    const controller = createCustomMatchController({ publish() {}, makeKey: () => "22222222-2222-4222-8222-222222222222", call: async (path, init) => {
        calls.push({ path, init });
        if (path === "/access") return { success: true, allowed: true };
        if (init?.method === "POST") return { success: true, matchCode };
        if (path.endsWith("/credentials")) return { success: true, matchCode, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" } };
        if (path.endsWith("/invites")) { if (failInvites) throw Object.assign(new Error(), { status: 503 }); return { success: true, matchCode, invites: [{ inviteCode: "CMIabcdefghijkl" }] }; }
        if (path.endsWith("/join-requests")) return { success: true, matchCode, requests: [{ requestCode: "CMJabcdefghij" }] };
        if (path.endsWith("/member-history")) return { success: true, matchCode, members: [{ memberCode, canAllowRejoin: true }] };
        return detail(5);
    } });
    await controller.access(); await controller.detail(matchCode);
    assert.equal(controller.state.invites.length, 1); assert.equal(controller.state.joinRequests.length, 1);
    await controller.credentials(); assert.ok(controller.state.credentials);
    failInvites = true; await controller.loadHostLists();
    assert.equal(controller.state.credentials, null); assert.equal(controller.state.hostListsPending, false);
    assert.deepEqual(controller.state.invites, []); assert.equal(controller.state.memberHistory.length, 1);
    assert.match(controller.state.hostListMessages.invites, /unavailable/); assert.equal(controller.state.access, true);
    failInvites = false; await controller.action("revoke_invite", { inviteCode: "CMIabcdefghijkl" });
    assert.equal(calls.filter(item => item.path.endsWith("/invites")).length, 3);
    assert.equal(controller.state.busy, false); controller.dispose();
});

test("Phase C pending host reads cannot repopulate data after host permission is lost", async () => {
    let host = true; const pending = [];
    const controller = createCustomMatchController({ publish() {}, call: async path => {
        if (path === "/access") return { success: true, allowed: true };
        if (["invites", "join-requests", "member-history"].some(suffix => path.endsWith(`/${suffix}`))) return new Promise(resolve => pending.push(resolve));
        const value = detail(5); value.actor.isHost = host; return value;
    } });
    await controller.access(); const first = controller.detail(matchCode);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(pending.length, 3);
    host = false; await controller.detail(matchCode);
    for (const resolve of pending) resolve({ success: true, matchCode, invites: [{ inviteCode: "CMIabcdefghijkl" }], requests: [], members: [] });
    await first;
    assert.equal(controller.state.detail.actor.isHost, false); assert.deepEqual(controller.state.invites, []);
    assert.equal(controller.state.hostListsPending, false); controller.dispose();
});

test("Phase C host-only RPC denial clears host controls without invalidating successful account access", async () => {
    const controller = createCustomMatchController({ publish() {}, call: async path => {
        if (path === "/access") return { success: true, allowed: true };
        if (path.endsWith("/invites")) throw Object.assign(new Error(), { code: "CUSTOM_MATCH_HOST_REQUIRED", status: 403 });
        if (path.endsWith("/join-requests")) return { success: true, matchCode, requests: [] };
        if (path.endsWith("/member-history")) return { success: true, matchCode, members: [] };
        return detail(5);
    } });
    await controller.access(); await controller.detail(matchCode);
    assert.equal(controller.state.access, true); assert.equal(controller.state.detail.actor.isHost, false);
    assert.equal(controller.state.hostListsPending, false); assert.deepEqual(controller.state.invites, []);
    assert.match(controller.state.message, /Host access changed/); controller.dispose();
});

test("Phase C host presentation uses external action codes and authoritative rejoin permission", () => {
    const state = { access: true, accessPending: false, detail: detail(5), hostListsPending: false, hostListMessages: {},
        invites: [{ inviteCode: "CMIabcdefghijkl", targetDisplayName: null, intendedTeam: null, useCount: 0, remainingUses: null, expiresAt: null }],
        joinRequests: [{ requestCode: "CMJabcdefghij", displayName: "<img onerror=evil()>", requestedTeam: null, requestedAt: "2026-10-06T12:00:00Z" }],
        memberHistory: [{ memberCode, displayName: null, team: null, memberRole: "player", joinedAt: "2026-10-06T12:00:00Z", leftAt: "2026-10-06T12:00:00Z",
            departureReason: "kicked", kickedByDisplayName: null, canAllowRejoin: false }] };
    const container = new Node("div"); renderHostManagement(doc, container, state);
    const rows = flatten(container);
    assert.ok(rows.some(node => node.textContent === "Outstanding invites (1)"));
    assert.ok(rows.some(node => node.textContent === state.joinRequests[0].displayName));
    assert.equal(rows.find(node => node.dataset.cmAction === "allow_rejoin").disabled, true);
    assert.deepEqual(JSON.parse(rows.find(node => node.dataset.cmAction === "revoke_invite").dataset.cmPayload), { inviteCode: "CMIabcdefghijkl" });
    state.memberHistory[0].canAllowRejoin = true; renderHostManagement(doc, container, state, { locked: true });
    assert.ok(flatten(container).filter(node => node.dataset.protected).every(node => node.disabled));
    state.detail.actor.isHost = false; renderHostManagement(doc, container, state); assert.equal(container.children.length, 0);
});
test("credentials require explicit action and erase on expiry, refresh and disposal", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { controller, calls } = setup();
    await controller.access(); await controller.detail(matchCode);
    assert.ok(!calls.some(item => item.path.endsWith("/credentials")));
    await controller.credentials(); assert.ok(controller.state.credentials);
    t.mock.timers.tick(10000); assert.equal(controller.state.credentials, null);
    await controller.credentials(); await controller.refreshDetail(); assert.equal(controller.state.credentials, null);
    await controller.credentials(); controller.dispose(); assert.equal(controller.state.credentials, null);
});
test("credential failure settles and stale credential completion cannot restore secrets", async () => {
    let release;
    const { controller } = setup({ credentials: () => new Promise(resolve => { release = resolve; }) });
    await controller.access(); await controller.detail(matchCode);
    const pending = controller.credentials(); controller.clearCredentials();
    release({ matchCode, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" } }); await pending;
    assert.equal(controller.state.credentials, null); assert.equal(controller.state.credentialsPending, false);
    const denied = setup({ credentials: () => { throw { code: "CUSTOM_MATCH_CREDENTIALS_FORBIDDEN", status: 403 }; } }).controller;
    await denied.access(); await denied.detail(matchCode); await denied.credentials();
    assert.equal(denied.state.credentialsPending, false); assert.match(denied.state.credentialsMessage, /not available/);
});
test("credential panel is member-only and terminal states hide it; transfer excludes self and spectators", () => {
    const container = new Node("div"), value = detail(5);
    const state = { detail: value, access: true, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" } };
    renderCredentials(doc, container, state); assert.ok(flatten(container).some(node => node.textContent.includes("1234567890")));
    value.match.state = "results"; renderCredentials(doc, container, state); assert.equal(container.children.length, 0);
    value.match.state = "open"; value.actor.isHost = false; value.actor.isMember = false;
    renderCredentials(doc, container, state); assert.equal(container.children.length, 0);
    value.actor.isHost = true; value.members.push({ memberCode: "CMMijklmnop", displayName: "Guest", team: "spectator" });
    renderLobby(doc, container, value); assert.equal(flatten(container).filter(node => node.dataset.cmAction === "transfer_host").length, 0);
    assert.equal(flatten(container).filter(node => node.dataset.cmAction === "kick_member").length, 1);
});
test("lifecycle controls are host-only and Start stays locked until runtime readiness", () => {
    for (const [state, actions] of [["created", ["open", "cancel"]], ["open", ["begin_pregame", "cancel"]], ["active", ["close"]], ["results", ["archive"]], ["archived", []]]) {
        const value = detail(5); value.match.state = state;
        assert.deepEqual(basicLifecycleActions(value).map(item => item[0]), actions);
        value.actor.isHost = false; assert.deepEqual(basicLifecycleActions(value), []);
    }
    const container = new Node("div"); renderLobby(doc, container, detail(5));
    const start = flatten(container).find(node => node.textContent === "Start match"); assert.equal(start.disabled, true); assert.equal(start.dataset.cmAction, "start");
});
test("locked host controls and leave-transfer protection; membership controls are separate from public links", () => {
    const value = detail(5); value.members.push({ memberCode: "CMMijklmnop", displayName: "Other", team: "b", memberRole: "player" });
    const container = new Node("div"); renderLobby(doc, container, value, { locked: true, limits });
    assert.ok(flatten(container).filter(node => node.dataset.protected).every(node => node.disabled));
    assert.equal(flatten(container).find(node => node.dataset.cmAction === "leave").disabled, true);
    assert.ok(flatten(container).some(node => node.tagName === "a" && !node.disabled));
});
test("open join/full/late-join gates, spectator assignment and safe text rendering", () => {
    const value = detail(5); value.actor = { isHost: false, isMember: false, eligible: true, canJoin: true }; value.match.teamACount = 2;
    value.match.title = "<img onerror=evil()>";
    const container = new Node("div"); renderLobby(doc, container, value);
    assert.equal(flatten(container).find(node => node.dataset.cmAction === "join" && JSON.parse(node.dataset.cmPayload).team === "a").disabled, true);
    assert.equal(flatten(container).find(node => node.dataset.cmAction === "join" && JSON.parse(node.dataset.cmPayload).team === "b").disabled, false);
    assert.ok(flatten(container).some(node => node.textContent === value.match.title));
    value.match.state = "active"; value.match.allowJoinAfterStart = false; renderLobby(doc, container, value);
    assert.ok(flatten(container).filter(node => node.dataset.cmAction === "join").every(node => node.disabled));
    renderBrowse(doc, container, [{ ...value.match, hostDisplayName: "Host" }]); assert.ok(flatten(container).some(node => node.dataset.cmOpen === matchCode));
});
test("request timeout includes body decoding and normalizes errors without raw messages", async () => {
    for (const fetcher of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
        await assert.rejects(requestCustomMatch("/limits", { fetcher, timeoutMs: 10 }), { code: "CUSTOM_MATCH_TIMEOUT" });
    }
    assert.doesNotMatch(errorMessage({ code: "PRIVATE_TOKEN", message: "SECRET" }), /SECRET|PRIVATE_TOKEN/);
});
test("reinitialization aborts listeners/requests; scoped CSS supplies responsive layout; no future APIs or polling", async () => {
    const js = await readFile(new URL("../../public/Tabs/RocketLeague/CustomMatches/JS/index.js", import.meta.url), "utf8");
    assert.match(js, /root\[disposeKey\]\?\.\(\)/); assert.match(js, /signal: lifetime\.signal/); assert.match(js, /controller\.dispose\(\)/);
    assert.match(js, /observer\.disconnect\(\)/);
    assert.doesNotMatch(js, /setInterval|\/credentials|\/votes|\/rounds|\/results|localStorage|sessionStorage/);
    const css = await readFile(new URL("../../public/Tabs/RocketLeague/CustomMatches/CSS/index.css", import.meta.url), "utf8");
    assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /focus-visible/);
});
