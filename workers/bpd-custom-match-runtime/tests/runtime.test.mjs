import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker, { CustomMatchSession } from "../src/index.js";

const account = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const matchCode = "CMabcdefgh", hostMember = "CMMabcdefgh", otherMember = "CMMijklmnop", roundCode = "CMRDabcdefgh", voteCode = "CMVabcdefgh";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function state(sockets = []) {
    const data = new Map();
    const storage = {
        async get(key) { return data.get(key); }, async put(key, value) { data.set(key, value); }, async delete(key) { return data.delete(key); },
        async list({ prefix = "", limit = 100 } = {}) { return new Map([...data].filter(([key]) => key.startsWith(prefix)).slice(0, limit)); },
        async setAlarm() {}, async transaction(fn) { return fn(this); }
    };
    return { getWebSockets: () => sockets, storage };
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

test("one vote type is fixed for a voting window and changed vote category is rejected", async () => {
    const calls = installFetch(); const session = new CustomMatchSession(state(), rpcEnv);
    const send = vote => session.fetch(new Request(`https://session/${matchCode}/vote`, { method: "POST", headers: internalHeaders,
        body: JSON.stringify({ roundCode, idempotencyKey: "44444444-4444-4444-8444-444444444444", vote }) }));
    assert.equal((await send({ voteType: "yes_no", choiceKey: "yes" })).status, 200);
    assert.equal((await send({ voteType: "skip" })).status, 409);
    assert.equal(calls.filter(item => item.rpc === "cast_custom_match_vote").length, 1);
});

test("ambiguous vote provider failure keeps the round's vote type fail-closed", async () => {
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
    assert.equal((await vote({ roundCode, idempotencyKey: key, vote: { voteType: "yes_no", choiceKey: "yes" } })).status, 503);
    assert.equal((await vote({ roundCode, idempotencyKey: key, vote: { voteType: "skip" } })).status, 409);
    assert.equal(calls.filter(rpc => rpc === "cast_custom_match_vote").length, 1);
});
