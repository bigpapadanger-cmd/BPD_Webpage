import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker, { CustomMatchSession } from "../src/index.js";

const account = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const matchCode = "CMabcdefgh", hostMember = "CMMabcdefgh", otherMember = "CMMijklmnop", roundCode = "CMRDabcdefgh", voteCode = "CMVabcdefgh";
const originalFetch = globalThis.fetch;
const originalResponse = globalThis.Response, originalWebSocketPair = globalThis.WebSocketPair;
afterEach(() => {
    globalThis.fetch = originalFetch; globalThis.Response = originalResponse;
    if (originalWebSocketPair === undefined) delete globalThis.WebSocketPair;
    else globalThis.WebSocketPair = originalWebSocketPair;
});

function state(sockets = []) {
    const data = new Map();
    const storage = {
        async get(key) { return data.get(key); }, async put(key, value) { data.set(key, value); }, async delete(key) { return data.delete(key); },
        async list({ prefix = "", limit = 100 } = {}) { return new Map([...data].filter(([key]) => key.startsWith(prefix)).slice(0, limit)); },
        async setAlarm() {}, async transaction(fn) { return fn(this); }
    };
    return {
        getWebSockets: () => [...sockets], storage,
        acceptWebSocket(socket) { assert.equal(sockets.includes(socket), false); sockets.push(socket); },
        async dispatchMessage(session, socket, message) {
            assert.ok(sockets.includes(socket), "Only DO-registered sockets receive hibernation messages");
            await session.webSocketMessage(socket, message);
        },
        dispatchClose(session, socket) {
            assert.ok(sockets.includes(socket), "Only DO-registered sockets receive hibernation close events");
            sockets.splice(sockets.indexOf(socket), 1); session.webSocketClose(socket);
        }
    };
}
const detail = { success: true, match: { matchCode, title: "Test", gameKey: "rocketleague", modeKey: "standard", modeVersion: 1, visibility: "public", joinPolicy: "open",
    teamACapacity: 2, teamBCapacity: 2, allowJoinAfterStart: false, state: "pregame", region: null, mapName: null, teamACount: 1, teamBCount: 1,
    spectatorCount: 0, playerCount: 2, openedAt: null, startedAt: null, lastActivityAt: "2026-10-06T12:00:00Z", roundBased: true,
    currentRoundNumber: null, roundCount: 1, teamAScore: null, teamBScore: null, winningTeam: null, resultSource: null, verificationStatus: null,
    version: 5, gameMode: null, hostDisplayName: "Host", createdAt: "2026-10-06T12:00:00Z", closedAt: null },
    actor: { isHost: true, isMember: true, memberCode: hostMember, team: "a", memberRole: "host", eligible: true, canJoin: false },
    members: [{ memberCode: hostMember, displayName: "Host", team: "a", memberRole: "host", joinedAt: "2026-10-06T12:00:00Z", joinedMatchState: "created", joinedRoundNumber: null },
        { memberCode: otherMember, displayName: "Guest", team: "b", memberRole: "player", joinedAt: "2026-10-06T12:00:00Z", joinedMatchState: "created", joinedRoundNumber: null }], capturedAt: "2026-10-06T12:00:00Z" };
const startBody = { expectedVersion: 5, idempotencyKey: "33333333-3333-4333-8333-333333333333" };

function installFetch({ actorId = account, roundsState = "voting" } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const rpc = String(url).split("/").at(-1), body = JSON.parse(init.body); calls.push({ rpc, body });
        if (rpc === "get_custom_match") return Response.json({ ...detail, actor: { ...detail.actor, isHost: actorId === account, isMember: true } });
        if (rpc === "list_custom_match_rounds") return Response.json({ success: true, matchCode, rounds: [{ roundCode, roundNumber: 1, state: roundsState, roundVersion: 2,
            startedAt: null, votingOpenedAt: null, votingClosedAt: null, endedAt: null, outcomeType: null, outcomeKey: null }] });
        if (rpc === "apply_custom_match_action") return Response.json({ success: true, matchCode, action: "start", previousVersion: 5, version: 6, memberCode: null, inviteCode: null, requestCode: null, capturedAt: "2026-10-06T12:00:00Z" });
        if (rpc === "cast_custom_match_vote") return Response.json({ success: true, matchCode, roundCode, hasVoted: true, voteCode, capturedAt: "2026-10-06T12:00:00Z" });
        throw new Error(`unexpected rpc ${rpc}`);
    };
    return calls;
}
const rpcEnv = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "test-service-role" };
const internalHeaders = { "X-Custom-Match-Internal": "1", "X-Custom-Match-Account": account };

test("private health authenticates disabled and enabled states without selecting a match instance", async () => {
    const trap = () => { assert.fail("Health must not select a Durable Object"); };
    const env = { ...rpcEnv, CUSTOM_MATCH_RUNTIME_CALLER_SECRET: "h".repeat(64), CUSTOM_MATCH_SESSIONS: { idFromName: trap, get: trap } };
    const request = secret => new Request("https://runtime/internal/health", { headers: { "X-Custom-Match-Caller": secret } });
    assert.equal((await worker.fetch(request("wrong"), env)).status, 503);
    for (const [flag, expected] of [[undefined, "unknown"], ["invalid", "unknown"], ["false", "disabled"], ["true", "healthy"]]) {
        env.CUSTOM_MATCH_RUNTIME_ENABLED = flag;
        const response = await worker.fetch(request(env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET), env), body = await response.json();
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(body.status, expected); assert.equal(body.instanceChecked, false);
        assert.doesNotMatch(JSON.stringify(body), /test-service-role|hhhhhhhh|db\.example/);
    }
    delete env.SUPABASE_SERVICE_ROLE_KEY; env.SUPABASE_AUTH = "legacy-key";
    assert.equal((await (await worker.fetch(request(env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET), env)).json()).status, "degraded");
    env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role"; env.SUPABASE_URL = "http://db.example";
    assert.equal((await (await worker.fetch(request(env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET), env)).json()).status, "degraded");
});

function installWebSocketPair() {
    const pairs = [];
    globalThis.WebSocketPair = class {
        constructor() {
            let attachment;
            this[0] = {};
            this[1] = {
                frames: [],
                accept() { assert.fail("Hibernation sockets must use state.acceptWebSocket()"); },
                serializeAttachment(value) { attachment = structuredClone(value); },
                deserializeAttachment() { return structuredClone(attachment); },
                send(value) { this.frames.push(JSON.parse(value)); }, close() {}
            };
            pairs.push(this);
        }
    };
    // Node's Response rejects 101; emulate only the Workers upgrade response.
    globalThis.Response = class extends originalResponse {
        constructor(body, init) {
            super(body, init?.status === 101 ? { ...init, status: 200 } : init);
            if (init?.status === 101) {
                Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket;
            }
        }
    };
    return pairs;
}

test("connect registers a hibernation socket before fanout and dispatches ready, resync, restart and close", async () => {
    const calls = installFetch(), pairs = installWebSocketPair(), doState = state();
    const session = new CustomMatchSession(doState, rpcEnv);
    const connect = () => session.fetch(new Request(`https://session/${matchCode}/connect`, {
        headers: { ...internalHeaders, Upgrade: "websocket" }
    }));
    const upgrade = await connect(), socket = pairs[0][1];
    assert.equal(upgrade.status, 101); assert.equal(upgrade.webSocket, pairs[0][0]);
    assert.deepEqual(doState.getWebSockets(), [socket]);
    assert.deepEqual(socket.deserializeAttachment(), { memberCode: hostMember, accountId: account, matchCode, team: "a" });
    assert.ok(socket.frames.some(frame => frame.type === "snapshot" && frame.members[0].connected));
    assert.doesNotMatch(JSON.stringify(socket.frames), /accountId|service-role|credentials|discord|epic/i);
    await doState.dispatchMessage(session, socket, JSON.stringify({ type: "ready", ready: true }));
    assert.equal(session.ready.get(hostMember), true);
    await doState.dispatchMessage(session, socket, JSON.stringify({ type: "resync" }));
    assert.equal(socket.frames.at(-1).type, "snapshot");
    assert.equal(socket.frames.at(-1).members[0].ready, true);
    const restored = new CustomMatchSession(doState, rpcEnv);
    assert.equal(restored.members.get(hostMember).has(socket), true);
    assert.equal(restored.ready.get(hostMember), false);
    await doState.dispatchMessage(restored, socket, JSON.stringify({ type: "resync" }));
    assert.ok(socket.frames.some(frame => frame.type === "readiness_reset"));
    assert.equal(socket.frames.at(-1).members[0].ready, false);
    const callsBeforeClose = calls.length;
    doState.dispatchClose(restored, socket);
    assert.equal(doState.getWebSockets().length, 0);
    assert.equal(restored.members.has(hostMember), false);
    assert.equal(restored.ready.get(hostMember), false);
    assert.equal(calls.length, callsBeforeClose);
    for (let i = 0; i < 256; i++) doState.acceptWebSocket({});
    assert.equal((await connect()).status, 429);
    assert.equal(pairs.length, 1);
});

test("connect rejects missing internal authorization and nonmembers before socket registration", async () => {
    const pairs = installWebSocketPair(), doState = state(), session = new CustomMatchSession(doState, rpcEnv);
    assert.equal((await session.fetch(new Request(`https://session/${matchCode}/connect`, {
        headers: { "X-Custom-Match-Account": account, Upgrade: "websocket" }
    }))).status, 403);
    session.detail = async () => ({ ...detail, actor: { isMember: false } });
    assert.equal((await session.fetch(new Request(`https://session/${matchCode}/connect`, {
        headers: { ...internalHeaders, Upgrade: "websocket" }
    }))).status, 403);
    assert.equal(pairs.length, 0); assert.equal(doState.getWebSockets().length, 0);
});

test("runtime stays unavailable until explicitly enabled and authenticates the Pages caller", async () => {
    const disabled = await worker.fetch(new Request(`https://runtime/start/${matchCode}`, { method: "POST" }), { CUSTOM_MATCH_RUNTIME_ENABLED: "false" });
    assert.equal(disabled.status, 503);
    const env = { CUSTOM_MATCH_RUNTIME_ENABLED: "true", CUSTOM_MATCH_RUNTIME_CALLER_SECRET: "s".repeat(64), CUSTOM_MATCH_SESSIONS: { idFromName: () => matchCode, get: () => ({ fetch: async () => Response.json({ success: true }) }) } };
    assert.equal((await worker.fetch(new Request(`https://runtime/start/${matchCode}`, { method: "POST", headers: { "X-Custom-Match-Caller": "x".repeat(64) } }), env)).status, 503);
    const response = await worker.fetch(new Request(`https://runtime/start/${matchCode}`, { method: "POST", headers: { "X-Custom-Match-Caller": "s".repeat(64) } }), env);
    assert.equal(response.status, 200);
});

test("Start is blocked until both teams are connected and ready, then calls Supabase once", async () => {
    const calls = installFetch(); const doState = state(); const session = new CustomMatchSession(doState, rpcEnv);
    session.members.set(hostMember, new Set([{ send() {} }])); session.members.set(otherMember, new Set([{ send() {} }]));
    const request = () => session.fetch(new Request(`https://session/${matchCode}/start`, { method: "POST", headers: internalHeaders, body: JSON.stringify(startBody) }));
    assert.equal((await request()).status, 409); assert.equal(calls.some(item => item.rpc === "apply_custom_match_action"), false);
    session.ready.set(hostMember, true); session.ready.set(otherMember, true);
    const response = await request(); assert.equal(response.status, 200);
    assert.equal(calls.filter(item => item.rpc === "apply_custom_match_action").length, 1);
    assert.equal(session.ready.size, 0);
});

test("DO restart retains live sockets but resets readiness and broadcasts reset", () => {
    const frames = [];
    const socket = { deserializeAttachment: () => ({ memberCode: hostMember, accountId: account, matchCode, team: "a" }), send: value => frames.push(JSON.parse(value)) };
    const session = new CustomMatchSession(state([socket]), rpcEnv);
    assert.equal(session.ready.get(hostMember), false);
    assert.equal(session.members.get(hostMember).size, 1);
    return session.fetch(new Request(`https://session/${matchCode}/revoke`, { method: "POST", headers: internalHeaders, body: JSON.stringify({ memberCode: hostMember, accountId: null }) }))
        .then(() => assert.ok(frames.some(frame => frame.type === "readiness_reset")));
});

test("host socket disconnect clears lobby presence without changing durable host ownership", () => {
    const calls = installFetch(); const frames = [];
    const socket = { deserializeAttachment: () => ({ memberCode: hostMember, accountId: account, matchCode, team: "a" }),
        send: value => frames.push(JSON.parse(value)), close() {} };
    const peer = { deserializeAttachment: () => ({ memberCode: otherMember, accountId: other, matchCode, team: "b" }),
        send: value => frames.push(JSON.parse(value)), close() {} };
    const session = new CustomMatchSession(state(), rpcEnv);
    session.matchCode = matchCode; session.memberTeams = new Map([[hostMember, "a"]]);
    session.members.set(hostMember, new Set([socket])); session.members.set(otherMember, new Set([peer])); session.ready.set(hostMember, true);
    session.webSocketClose(socket);
    assert.equal(session.members.has(hostMember), false);
    assert.equal(session.ready.get(hostMember), false);
    assert.equal(calls.length, 0);
    assert.ok(frames.some(frame => frame.type === "presence" && frame.memberCode === hostMember && frame.connected === false));
});

test("fanout exposes only safe member presence fields and revoke closes kicked sessions", async () => {
    const frames = []; let closed = false;
    const socket = { deserializeAttachment: () => ({ memberCode: otherMember, accountId: other, matchCode, team: "b" }),
        send: value => frames.push(JSON.parse(value)), close: () => { closed = true; } };
    const session = new CustomMatchSession(state([socket]), rpcEnv);
    const snapshot = await session.snapshot(detail);
    assert.deepEqual(Object.keys(snapshot).sort(), ["matchCode", "matchVersion", "members", "state", "type", "voteTypes"].sort());
    assert.doesNotMatch(JSON.stringify(snapshot), /accountId|memberRole|service-role|credentials|discord|epic/i);
    const result = await session.fetch(new Request(`https://session/${matchCode}/revoke`, { method: "POST", headers: internalHeaders,
        body: JSON.stringify({ memberCode: otherMember, accountId: null }) }));
    assert.equal(result.status, 200); assert.equal(closed, true); assert.ok(frames.some(frame => frame.type === "revoked"));
});

test("an existing socket is revoked before sending lobby events after durable membership is removed", async () => {
    const frames = []; let closed = false;
    let attachment = { memberCode: otherMember, accountId: other, matchCode, team: "b" };
    const socket = { deserializeAttachment: () => attachment, serializeAttachment: value => { attachment = value; },
        send: value => frames.push(JSON.parse(value)), close: () => { closed = true; } };
    globalThis.fetch = async (url) => {
        assert.equal(String(url).split("/").at(-1), "get_custom_match");
        return Response.json({ ...detail, actor: { ...detail.actor, isHost: false, isMember: false, memberCode: null, team: null, memberRole: null },
            members: detail.members.filter(member => member.memberCode !== otherMember) });
    };
    const session = new CustomMatchSession(state([socket]), rpcEnv);
    await session.webSocketMessage(socket, JSON.stringify({ type: "ready", ready: true }));
    assert.equal(closed, true);
    assert.ok(frames.some(frame => frame.type === "revoked"));
    assert.equal(session.ready.get(otherMember), false);
});

test("Start conflicts on stale match version and never changes durable state", async () => {
    const calls = installFetch(); const session = new CustomMatchSession(state(), rpcEnv);
    session.members.set(hostMember, new Set([{ send() {} }])); session.members.set(otherMember, new Set([{ send() {} }]));
    session.ready.set(hostMember, true); session.ready.set(otherMember, true);
    const response = await session.fetch(new Request(`https://session/${matchCode}/start`, { method: "POST", headers: internalHeaders,
        body: JSON.stringify({ ...startBody, expectedVersion: 4 }) }));
    assert.equal(response.status, 409);
    assert.equal(calls.some(item => item.rpc === "apply_custom_match_action"), false);
});

test("spectators have presence but cannot vote or satisfy player Start requirements", async () => {
    const calls = installFetch(); const session = new CustomMatchSession(state(), rpcEnv);
    session.detail = async () => ({ ...detail, actor: { ...detail.actor, team: "spectator", memberRole: "spectator" }, members: [...detail.members, { memberCode: "CMMqrstuvwx", displayName: "Viewer", team: "spectator", memberRole: "spectator" }] });
    const response = await session.fetch(new Request(`https://session/${matchCode}/vote`, { method: "POST", headers: internalHeaders, body: JSON.stringify({ roundCode, idempotencyKey: "44444444-4444-4444-8444-444444444444", vote: { voteType: "skip" } }) }));
    assert.equal(response.status, 403); assert.equal(calls.some(item => item.rpc === "cast_custom_match_vote"), false);
    const snapshot = await session.snapshot(await session.detail());
    assert.equal(snapshot.members.at(-1).team, "spectator"); assert.equal(snapshot.members.at(-1).ready, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /accountId|playerId|credentials/);
    const spectator = snapshot.members.at(-1);
    session.detail = async () => ({ ...detail, members: [...detail.members, { ...spectator, memberRole: "spectator" }] });
    for (const member of detail.members) { session.members.set(member.memberCode, new Set([{ send() {} }])); session.ready.set(member.memberCode, true); }
    const started = await session.fetch(new Request(`https://session/${matchCode}/start`, { method: "POST", headers: internalHeaders, body: JSON.stringify({ expectedVersion: detail.match.version, idempotencyKey: "44444444-4444-4444-8444-444444444444" }) }));
    assert.equal(started.status, 200);
});

test("player voting permits target and skip ballots without a window category lock", async () => {
    const calls = installFetch(); const session = new CustomMatchSession(state(), rpcEnv);
    const send = vote => session.fetch(new Request(`https://session/${matchCode}/vote`, { method: "POST", headers: internalHeaders,
        body: JSON.stringify({ roundCode, idempotencyKey: "44444444-4444-4444-8444-444444444444", vote }) }));
    assert.equal((await send({ voteType: "player_target", targetMemberCode: otherMember })).status, 200);
    assert.equal((await send({ voteType: "skip" })).status, 200);
    assert.equal(calls.filter(item => item.rpc === "cast_custom_match_vote").length, 2);
});

test("ambiguous ballot failure permits safe database-authorized retry", async () => {
    const calls = [];
    globalThis.fetch = async url => {
        const rpc = String(url).split("/").at(-1); calls.push(rpc);
        if (rpc === "get_custom_match") return Response.json(detail);
        if (rpc === "list_custom_match_rounds") return Response.json({ success: true, matchCode, rounds: [{ roundCode, roundNumber: 1, state: "voting", roundVersion: 2,
            startedAt: null, votingOpenedAt: null, votingClosedAt: null, endedAt: null, outcomeType: null, outcomeKey: null }] });
        if (rpc === "cast_custom_match_vote") return Response.json({ success: false, code: "TEMPORARY_FAILURE" }, { status: 503 });
        throw new Error(`unexpected rpc ${rpc}`);
    };
    const session = new CustomMatchSession(state(), rpcEnv);
    const vote = body => session.fetch(new Request(`https://session/${matchCode}/vote`, { method: "POST", headers: internalHeaders, body: JSON.stringify(body) }));
    const key = "44444444-4444-4444-8444-444444444444";
    assert.equal((await vote({ roundCode, idempotencyKey: key, vote: { voteType: "player_target", targetMemberCode: otherMember } })).status, 503);
    assert.equal((await vote({ roundCode, idempotencyKey: key, vote: { voteType: "skip" } })).status, 503);
    assert.equal(calls.filter(rpc => rpc === "cast_custom_match_vote").length, 2);
});
