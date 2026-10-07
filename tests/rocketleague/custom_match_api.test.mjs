import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { onRequest as index } from "../../functions/api/rocketleague/custom-matches/index.js";
import { onRequest as limitsRoute } from "../../functions/api/rocketleague/custom-matches/limits.js";
import { onRequest as detailRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode].js";
import { onRequest as actionsRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/actions.js";
import { onRequest as accessRoute } from "../../functions/api/rocketleague/custom-matches/access.js";
import { onRequest as credentialsRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/credentials.js";
import { onRequest as roundsRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds.js";
import { onRequest as beginRoundRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds/begin.js";
import { onRequest as resultsRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/results.js";
import { onRequest as submitResultRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/results/submit.js";
import { onRequest as openVoteRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/open-vote.js";
import { onRequest as voteRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/vote.js";
import { onRequest as resolveVoteRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/resolve.js";
import { onRequest as voteResultRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/result.js";
import { onRequest as confirmResultRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/results/[resultCode]/confirm.js";
import { onRequest as invitesRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/invites.js";
import { onRequest as requestsRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/join-requests.js";
import { onRequest as historyRoute } from "../../functions/api/rocketleague/custom-matches/[matchCode]/member-history.js";

const accountId = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222";
const code = "CMabcdefgh", member = "CMMabcdefgh", at = "2026-10-06T12:00:00Z";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const hostReadFixtures = [
    [invitesRoute, "invites", "list_custom_match_invites", "invites", { inviteCode: "CMIabcdefghijkl", targetDisplayName: null, intendedTeam: null,
        maxUses: null, useCount: 0, remainingUses: null, expiresAt: null, createdAt: at }],
    [requestsRoute, "join-requests", "list_custom_match_join_requests", "requests", { requestCode: "CMJabcdefghij", displayName: null,
        requestedTeam: null, status: "pending", requestedAt: at }],
    [historyRoute, "member-history", "list_custom_match_member_history", "members", { memberCode: member, displayName: null, team: null,
        memberRole: "player", joinedAt: at, leftAt: at, joinedMatchState: "open", joinedRoundNumber: null, departureReason: "kicked",
        kickedByDisplayName: null, canAllowRejoin: true }]
];

test("Phase C host reads use exact RPCs, derive the actor, preserve nulls and strip internal identities", async () => {
    for (const [route, path, rpc, field, row] of hostReadFixtures) {
        const calls = install({ custom: { [rpc]: () => Response.json({ success: true, matchCode: code, [field]: [{ ...row,
            account_id: accountId, player_id: key, targetAccountId: accountId, internal_id: key }], capturedAt: at }) } });
        const response = await route({ request: request(`/${code}/${path}`), env: environment(), params: { matchCode: code } });
        assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
        const value = await response.json(); assert.deepEqual(value[field], [row]);
        assert.doesNotMatch(JSON.stringify(value), new RegExp(`${accountId}|${key}|service-role-test`));
        assert.deepEqual(calls.find(item => item.rpc === rpc).body, { p_actor_account_id: accountId, p_match_code: code });
    }
});

test("Phase C reads fail closed for nonhosts, unauthenticated callers, malformed rows and browser identity overrides", async () => {
    for (const [route, path, rpc, field, row] of hostReadFixtures) {
        const denied = install({ custom: { [rpc]: () => Response.json({ success: false, code: "CUSTOM_MATCH_HOST_REQUIRED" }) } });
        assert.equal((await route({ request: request(`/${code}/${path}`), env: environment(), params: { matchCode: code } })).status, 403);
        assert.ok(denied.some(item => item.rpc === rpc));
        const calls = install();
        assert.equal((await route({ request: request(`/${code}/${path}`, undefined, { cookie: false }), env: environment(), params: { matchCode: code } })).status, 401);
        assert.equal((await route({ request: request(`/${code}/${path}?actorAccountId=${accountId}`), env: environment(), params: { matchCode: code } })).status, 400);
        assert.equal((await route({ request: request(`/${code}/${path}`, {}), env: environment(), params: { matchCode: code } })).status, 405);
        assert.equal(calls.length, 0);
        install({ custom: { [rpc]: () => Response.json({ success: true, matchCode: code, [field]: [{ ...row, ...(field === "members" ? { leftAt: null } : field === "requests" ? { status: "approved" } : { useCount: "0" }) }], capturedAt: at }) } });
        assert.equal((await route({ request: request(`/${code}/${path}`), env: environment(), params: { matchCode: code } })).status, 502);
    }
});

test("Phase C mutations preserve server actor, external codes, versions and logical idempotency keys", async () => {
    for (const [action, payload] of [["create_invite", {}], ["revoke_invite", { inviteCode: "CMIabcdefghijkl" }],
        ["request_join", { team: "b" }], ["approve_join", { requestCode: "CMJabcdefghij", team: "a" }],
        ["reject_join", { requestCode: "CMJabcdefghij" }], ["allow_rejoin", { memberCode: member }], ["join_with_invite", { inviteCode: "CMIabcdefghijkl" }]]) {
        const calls = install();
        const response = await actionsRoute({ request: request(`/${code}/actions`, { action, payload, expectedVersion: 5, idempotencyKey: key }), env: environment(), params: { matchCode: code } });
        assert.equal(response.status, 200, action);
        const args = calls.find(item => item.rpc === "apply_custom_match_action").body;
        assert.equal(args.p_actor_account_id, accountId); assert.equal(args.p_expected_version, 5); assert.equal(args.p_idempotency_key, key);
        assert.deepEqual(args.p_payload, payload);
    }
    const calls = install();
    assert.equal((await actionsRoute({ request: request(`/${code}/actions`, { action: "create_invite", payload: { targetAccountId: accountId }, expectedVersion: 5, idempotencyKey: key }), env: environment(), params: { matchCode: code } })).status, 400);
    assert.equal(calls.length, 0);
});

test("explicit credentials reauthorize server-derived actor and never cache secrets", async () => {
    const calls = install({ custom: { get_custom_match_credentials: () => Response.json({ success: true, matchCode: code, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" }, capturedAt: at }) } });
    const response = await credentialsRoute({ request: request(`/${code}/credentials`), env: environment(), params: { matchCode: code } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).credentials.lobbyName, "abcdefgh12");
    assert.equal(calls.find(item => item.rpc === "get_custom_match_credentials").body.p_actor_account_id, accountId);
    install({ allowed: false });
    assert.equal((await credentialsRoute({ request: request(`/${code}/credentials`), env: environment(), params: { matchCode: code } })).status, 403);
});

test("host transfer and kick retain durable authorization and opaque member targets", async () => {
    for (const action of ["kick_member", "transfer_host"]) {
        const calls = install();
        const response = await actionsRoute({ request: request(`/${code}/actions`, { action, payload: { memberCode: member }, idempotencyKey: key, expectedVersion: 5 }), env: environment({ runtime: action === "kick_member" }), params: { matchCode: code } });
        assert.equal(response.status, 200, JSON.stringify({ response: await response.clone().json(), calls: calls.map(item => item.rpc) }));
        assert.deepEqual(calls.find(item => item.rpc === "apply_custom_match_action").body.p_payload, { memberCode: member });
        install({ custom: { apply_custom_match_action: () => Response.json({ success: false, code: "CUSTOM_MATCH_HOST_REQUIRED" }) } });
        assert.equal((await actionsRoute({ request: request(`/${code}/actions`, { action, payload: { memberCode: member }, idempotencyKey: key, expectedVersion: 5 }), env: environment({ runtime: action === "kick_member" }), params: { matchCode: code } })).status, 403);
    }
});
const limits = { success: true, gameKey: "rocketleague", maxTeamCapacity: 32, defaultTeamCapacity: 2, maxTotalParticipants: 64, defaultAllowJoinAfterStart: false,
    modes: [{ modeKey: "standard", displayName: "Standard", modeVersion: 1, usesTeams: true, usesRounds: false, usesVoting: false, defaultTeamACapacity: 2, defaultTeamBCapacity: 2, maxRounds: null }] };
const basic = { matchCode: code, title: "Test", gameKey: "rocketleague", modeKey: "standard", modeVersion: 1, visibility: "public", joinPolicy: "open",
    teamACapacity: 2, teamBCapacity: 2, allowJoinAfterStart: false, state: "open", region: null, mapName: null };
const listing = { ...basic, teamACount: 1, teamBCount: 0, spectatorCount: 0, playerCount: 1, openedAt: at, startedAt: null, lastActivityAt: at, roundBased: false,
    currentRoundNumber: null, roundCount: 0, gameMode: null, totalCapacity: 4, acceptingMembers: true, hostDisplayName: "Host", lobbyPassword: "shouldnotleak" };
const detail = { success: true, match: { ...listing, version: 5, teamAScore: null, teamBScore: null, winningTeam: null, resultSource: null, verificationStatus: null, createdAt: at, closedAt: null },
    actor: { isHost: true, isMember: true, memberCode: member, team: "a", memberRole: "host", eligible: true, canJoin: false },
    members: [{ memberCode: member, displayName: "Host", team: "a", memberRole: "host", joinedAt: at, joinedMatchState: "created", joinedRoundNumber: null }], capturedAt: at };
function environment({ runtime = false, runtimeFetch } = {}) {
    const now = Date.now();
    return { SUPABASE_URL: "https://db.example", SUPABASE_AUTH: "server-auth", SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
        ...(runtime ? { CUSTOM_MATCH_RUNTIME_CALLER_SECRET: "runtime-caller-secret-".padEnd(64, "x"), CUSTOM_MATCH_RUNTIME: { async fetch(request) {
            return runtimeFetch ? runtimeFetch(request) : Response.json({ success: true });
        } } } : {}),
        AUTH_SESSIONS: { async get(name) {
            if (name === "session:test-session") return { UserId: accountId, Active: true, Role: "player", LastSeenAt: now, AbsoluteExpiresAt: now + 60000, Providers: { epic: { AccountId: "canonical", Linked: true } } };
            return null;
        }, async put() {} } };
}
function request(path = "", body, { method = body === undefined ? "GET" : "POST", origin = "https://site.example", cookie = true, contentType = "application/json" } = {}) {
    return new Request(`https://site.example/api/rocketleague/custom-matches${path}`, { method, headers: { Origin: origin, "Content-Type": contentType, ...(cookie ? { Cookie: "bpd_session=test-session" } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function install({ allowed = true, active = true, custom = {}, profileMismatch = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const rpc = String(url).split("/").at(-1); const body = JSON.parse(init.body); calls.push({ rpc, body });
        if (rpc === "get_account_access_state") return Response.json({ exists: true, state: active ? "active" : "banned", accountActive: active, suspended: false, suspendedUntil: null, banned: !active, removed: false, rocketLeague: { exists: true, active: true } });
        if (rpc === "can_account_perform") return Response.json(allowed && active);
        if (rpc === "verify_account_provider_identity") return Response.json([{ account_id: accountId, provider: "epic", provider_subject: "canonical", active: true }]);
        if (rpc === "get_rocketleague_profile_v2") return Response.json({ account_id: profileMismatch ? key : accountId, rl_player_id: key, active: true, registration_status: "complete", profile_complete: false, find_profile_enabled: false });
        if (custom[rpc]) return custom[rpc](body, init);
        if (rpc === "get_custom_match_limits") return Response.json(limits);
        if (rpc === "list_custom_matches") return Response.json({ success: true, page: 1, pageSize: 30, total: 1, hasMore: false, matches: [listing] });
        if (rpc === "get_custom_match") return Response.json(detail);
        if (rpc === "list_custom_match_invites") return Response.json({ success: true, matchCode: code, invites: [], capturedAt: at });
        if (rpc === "list_custom_match_join_requests") return Response.json({ success: true, matchCode: code, requests: [], capturedAt: at });
        if (rpc === "list_custom_match_member_history") return Response.json({ success: true, matchCode: code, members: [], capturedAt: at });
        if (rpc === "list_custom_match_rounds") return Response.json({ success: true, matchCode: code, rounds: [] });
        if (rpc === "begin_custom_match_round") return Response.json({ success: true, matchCode: code, roundCode: "CMRDabcdefgh", roundNumber: 1, roundState: "active", matchVersion: 6, roundVersion: 1, startedAt: at });
        if (rpc === "get_custom_match_player_results") return Response.json({ success: true, matchCode: code, state: "results", teamAScore: null, teamBScore: null, winningTeam: null, resultSource: null, verificationStatus: null, players: [], capturedAt: at });
        if (rpc === "submit_custom_match_result") return Response.json({ success: true, matchCode: code, resultCode: "CMRabcdefgh", status: "submitted", submittedForTeam: "a", teamAScore: 2, teamBScore: 1, winningTeam: "a", verificationStatus: "pending", version: 6, capturedAt: at });
        if (rpc === "confirm_custom_match_result") return Response.json({ success: true, matchCode: code, resultCode: "CMRabcdefgh", confirmationComplete: true,
            confirmedByTeamA: true, confirmedByTeamB: true, status: "confirmed", teamAScore: 2, teamBScore: 1, winningTeam: "a", resultSource: "user_confirmed", verificationStatus: "verified", version: 7, capturedAt: at });
        if (rpc === "get_custom_match_vote_result") return Response.json({ success: true, resolved: false, roundCode: "CMRDabcdefgh", roundState: "voting" });
        if (rpc === "create_custom_match") return Response.json({ success: true, match: { ...basic, state: "created", version: 1, roundBased: false, usesVoting: false, hostMemberCode: member },
            credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" }, capturedAt: at });
        if (rpc === "apply_custom_match_action") return Response.json({ success: true, matchCode: code, action: body.p_action, previousVersion: body.p_expected_version, version: body.p_expected_version + 1,
            memberCode: ["join", "join_with_invite", "approve_join"].includes(body.p_action) ? member : null,
            inviteCode: body.p_action === "create_invite" ? "CMIabcdefghijkl" : null, requestCode: body.p_action === "request_join" ? "CMJabcdefghij" : null, capturedAt: at });
        throw new Error(`Unexpected ${rpc}`);
    };
    return calls;
}
test("public browse and limits do not require account identity and never expose credentials", async () => {
    const calls = install();
    const ctx = { request: request("", undefined, { cookie: false }), env: environment() };
    const response = await index(ctx); const payload = await response.json();
    assert.equal(response.status, 200); assert.equal(payload.matches.length, 1);
    assert.doesNotMatch(JSON.stringify(payload), /shouldnotleak|lobbyPassword|accountId|service-role-test/);
    assert.deepEqual(calls.map(item => item.rpc), ["list_custom_matches"]);
    assert.deepEqual(calls[0].body, { p_game_key: "rocketleague", p_state: null, p_page: 1, p_page_size: 30 });
    assert.equal((await limitsRoute({ ...ctx, request: request("/limits") })).status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("private listing leakage fails closed and private detail not-found stays indistinguishable", async () => {
    install({ custom: { list_custom_matches: () => Response.json({ success: true, page: 1, pageSize: 30, total: 1, hasMore: false, matches: [{ ...listing, visibility: "private" }] }),
        get_custom_match: () => Response.json({ success: false, code: "CUSTOM_MATCH_NOT_FOUND" }) } });
    assert.equal((await index({ request: request(), env: environment() })).status, 502);
    const response = await detailRoute({ request: request(`/${code}`), env: environment(), params: { matchCode: code } });
    assert.deepEqual(await response.json(), { success: false, code: "CUSTOM_MATCH_NOT_FOUND" });
});
test("method, query, CSRF, body type and deferred actions reject before privileged work", async () => {
    const calls = install(); const env = environment();
    for (const url of ["?page=1&page=2", "?accountId=x", "?page=1x", "?pageSize=101"]) assert.equal((await index({ request: request(url), env })).status, 400);
    assert.equal((await index({ request: request("", undefined, { method: "DELETE" }), env })).status, 405);
    assert.equal((await index({ request: request("", { options: { title: "x" }, idempotencyKey: key }, { origin: "https://evil.example" }), env })).status, 403);
    assert.equal((await index({ request: request("", {}, { contentType: "text/plain" }), env })).status, 415);
    for (const [action, expected] of [["cancel_join_request", 400], ["approve_join", 400], ["castVote", 400], ["record_custom_match_provider_match", 400]]) {
        const response = await actionsRoute({ request: request(`/${code}/actions`, { action, payload: {}, idempotencyKey: key, expectedVersion: 5 }), env, params: { matchCode: code } });
        assert.equal(response.status, expected, action);
    }
    assert.equal(calls.length, 0);
    assert.equal((await actionsRoute({ request: request(`/${code}/actions`, { action: "start", payload: {}, idempotencyKey: key, expectedVersion: 5 }), env, params: { matchCode: code } })).status, 503);
});
test("create derives actor and strips credential response; stale Epic and optional profile incompleteness do not block", async () => {
    const calls = install();
    const response = await index({ request: request("", { idempotencyKey: key, options: { title: "Test", teamACapacity: 1, teamBCapacity: 15 } }), env: environment() });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const payload = await response.json(); assert.equal(payload.match.matchCode, code); assert.equal(payload.credentials, undefined);
    const mutation = calls.find(item => item.rpc === "create_custom_match"); assert.equal(mutation.body.p_actor_account_id, accountId); assert.equal(mutation.body.p_idempotency_key, key);
    assert.ok(calls.some(item => item.rpc === "can_account_perform" && item.body.p_action === "create_private_match"));
});
test("every protected endpoint checks current account and profile before mutation", async () => {
    for (const options of [{ active: false }, { allowed: false }, { profileMismatch: true }]) {
        const calls = install(options);
        const response = await actionsRoute({ request: request(`/${code}/actions`, { action: "join", payload: { team: "a" }, expectedVersion: 5, idempotencyKey: key }), env: environment(), params: { matchCode: code } });
        assert.ok(response.status >= 400, JSON.stringify({ options, calls })); assert.ok(!calls.some(item => item.rpc === "apply_custom_match_action"));
        assert.doesNotMatch(JSON.stringify(await response.json()), new RegExp(accountId));
    }
    install();
    const response = await detailRoute({ request: request(`/${code}`, undefined, { cookie: false }), env: environment(), params: { matchCode: code } });
    assert.equal(response.status, 401);
});
test("access check returns boolean only, and unknown browser actor/patch inputs are rejected", async () => {
    const calls = install(); const env = environment();
    const response = await accessRoute({ request: request("/access"), env });
    assert.deepEqual(await response.json(), { success: true, allowed: true });
    const before = calls.length;
    const bad = await actionsRoute({ request: request(`/${code}/actions`, { action: "join", payload: { team: "a" }, expectedVersion: 5, idempotencyKey: key, actorAccountId: accountId }), env, params: { matchCode: code } });
    assert.equal(bad.status, 400); assert.equal(calls.length, before);
});
test("join maps permission, leave and team assignment preserve server version/key; conflict never auto-retries", async () => {
    for (const [action, payload] of [["join", { team: "a" }], ["leave", {}], ["assign_team", { memberCode: member, team: "b" }]]) {
        const calls = install();
        const response = await actionsRoute({ request: request(`/${code}/actions`, { action, payload, expectedVersion: 5, idempotencyKey: key }), env: environment({ runtime: action === "leave" }), params: { matchCode: code } });
        assert.equal(response.status, 200);
        const sent = calls.find(item => item.rpc === "apply_custom_match_action").body;
        assert.equal(sent.p_actor_account_id, accountId); assert.equal(sent.p_expected_version, 5); assert.equal(sent.p_idempotency_key, key);
        if (action === "join") assert.ok(calls.some(item => item.rpc === "can_account_perform" && item.body.p_action === "join_private_match"));
    }
    const calls = install({ custom: { apply_custom_match_action: () => Response.json({ success: false, code: "CUSTOM_MATCH_VERSION_CONFLICT", expectedVersion: 5, currentVersion: 6 }) } });
    const response = await actionsRoute({ request: request(`/${code}/actions`, { action: "open", payload: {}, expectedVersion: 5, idempotencyKey: key }), env: environment(), params: { matchCode: code } });
    assert.equal(response.status, 409); assert.equal(calls.filter(item => item.rpc === "apply_custom_match_action").length, 1);
});
test("capacity safety rejects oversized combinations without hard-capping 4v4", async () => {
    const calls = install();
    const response = await index({ request: request("", { idempotencyKey: key, options: { title: "Test", teamACapacity: 33, teamBCapacity: 1 } }), env: environment() });
    assert.equal(response.status, 400); assert.ok(!calls.some(item => item.rpc === "create_custom_match"));
});
test("oversized/malformed browser bodies fail before authorization, and stalled reads are cancelled", async () => {
    const calls = install(); const env = environment();
    const make = body => new Request("https://site.example/api/rocketleague/custom-matches", { method: "POST", headers: { Origin: "https://site.example", "Content-Type": "application/json" }, body, ...(typeof body === "string" ? {} : { duplex: "half" }) });
    assert.equal((await index({ request: make("not json"), env })).status, 400);
    assert.equal((await index({ request: make(JSON.stringify({ x: "x".repeat(9000) })), env })).status, 413);
    let cancelled = false;
    const stream = new ReadableStream({ start() {}, cancel() { cancelled = true; } });
    assert.equal((await index({ request: make(stream), env })).status, 408);
    assert.equal(cancelled, true); assert.equal(calls.length, 0);
});
test("a forged host assertion cannot bypass durable host authorization", async () => {
    const calls = install({ custom: { apply_custom_match_action: () => Response.json({ message: "CUSTOM_MATCH_HOST_REQUIRED" }, { status: 400 }) } });
    const response = await actionsRoute({ request: request(`/${code}/actions`, { action: "assign_team", payload: { memberCode: member, team: "b" }, expectedVersion: 5, idempotencyKey: key }), env: environment(), params: { matchCode: code } });
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { success: false, code: "CUSTOM_MATCH_HOST_REQUIRED" });
    assert.equal(calls.filter(item => item.rpc === "apply_custom_match_action").length, 1);
});

test("Phase E round/result reads and mutations use fixed server RPCs and server-derived account", async () => {
    const calls = install(), env = environment();
    const rounds = await roundsRoute({ request: request(`/${code}/rounds`), env, params: { matchCode: code } });
    assert.equal(rounds.status, 200); assert.deepEqual((await rounds.json()).rounds, []);
    const begin = await beginRoundRoute({ request: request(`/${code}/rounds/begin`, { expectedVersion: 5, idempotencyKey: key }), env, params: { matchCode: code } });
    assert.equal(begin.status, 200);
    const beginCall = calls.find(item => item.rpc === "begin_custom_match_round"); assert.equal(beginCall.body.p_actor_account_id, accountId); assert.equal(beginCall.body.p_expected_match_version, 5);
    const read = await resultsRoute({ request: request(`/${code}/results`), env, params: { matchCode: code } }); assert.equal(read.status, 200);
    const submit = await submitResultRoute({ request: request(`/${code}/results/submit`, { expectedVersion: 5, idempotencyKey: key, teamAScore: 2, teamBScore: 1 }), env, params: { matchCode: code } });
    assert.equal(submit.status, 200); assert.ok(calls.some(item => item.rpc === "submit_custom_match_result"));
    const bad = await submitResultRoute({ request: request(`/${code}/results/submit`, { matchCode: code, expectedVersion: 5, idempotencyKey: key, teamAScore: 2, teamBScore: 1 }), env, params: { matchCode: code } });
    assert.equal(bad.status, 400);
});

test("voting and confirmation use the private runtime/fixed RPCs with no browser account identity", async () => {
    const calls = install(), runtimeRequests = [];
    const env = environment({ runtime: true, runtimeFetch: async request => {
        runtimeRequests.push({ url: new URL(request.url).pathname, account: request.headers.get("X-Custom-Match-Account"), body: await request.json() });
        return Response.json({ success: true });
    } });
    const roundCode = "CMRDabcdefgh", resultCode = "CMRabcdefgh";
    const post = (path, body, params) => request(path, body);
    assert.equal((await openVoteRoute({ request: post(`/${code}/rounds/${roundCode}/open-vote`, { expectedVersion: 5, expectedRoundVersion: 2, idempotencyKey: key }), env, params: { matchCode: code, roundCode } })).status, 200);
    assert.equal((await voteRoute({ request: post(`/${code}/rounds/${roundCode}/vote`, { idempotencyKey: key, vote: { voteType: "skip" } }), env, params: { matchCode: code, roundCode } })).status, 200);
    assert.equal((await resolveVoteRoute({ request: post(`/${code}/rounds/${roundCode}/resolve`, { expectedVersion: 5, expectedRoundVersion: 2, idempotencyKey: key }), env, params: { matchCode: code, roundCode } })).status, 200);
    assert.equal((await voteResultRoute({ request: request(`/${code}/rounds/${roundCode}/result`), env, params: { matchCode: code, roundCode } })).status, 200);
    const confirmed = await confirmResultRoute({ request: post(`/${code}/results/${resultCode}/confirm`, { expectedVersion: 5, idempotencyKey: key }), env, params: { matchCode: code, resultCode } });
    assert.equal(confirmed.status, 200, JSON.stringify({ response: await confirmed.clone().json(), calls: calls.map(item => item.rpc) }));
    assert.deepEqual(runtimeRequests.map(item => item.url), [`/round-open/${code}`, `/vote/${code}`, `/resolve-vote/${code}`]);
    assert.ok(runtimeRequests.every(item => item.account === accountId));
    assert.ok(runtimeRequests.every(item => !JSON.stringify(item.body).includes(accountId)));
    assert.ok(calls.some(item => item.rpc === "get_custom_match_vote_result"));
    assert.ok(calls.some(item => item.rpc === "confirm_custom_match_result" && item.body.p_result_code === resultCode));
});
