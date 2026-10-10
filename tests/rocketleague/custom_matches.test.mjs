import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { validateCustomMatchRequest as validate, toCustomMatchRpcParameters as parameters, sanitizeCustomMatchResponse as sanitize, customMatchDomainError, OPERATIONS } from "../../functions/services/rl/custom_matches/contracts.js";
import { callCustomMatchRpc } from "../../functions/services/supabase/rocketleague/custom_matches.js";
import { executeCustomMatchOperation } from "../../functions/services/rl/custom_matches/service.js";

const account = "11111111-1111-4111-8111-111111111111", nonce = "22222222-2222-4222-8222-222222222222";
const matchCode = "CMabcdefgh", memberCode = "CMMabcdefgh", roundCode = "CMRDabcdefgh";
const at = "2026-10-06T12:00:00Z";
const versioned = { matchCode, expectedVersion: 5, idempotencyKey: nonce };
const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });
const env = { SUPABASE_URL: "https://db.example/rest/v1/", SUPABASE_SERVICE_ROLE_KEY: "test-service-only" };

test("spectator requests preserve independent settings and reject invalid capacities", () => {
    for (const capacity of [1, 4, 8]) assert.equal(validate("create", { idempotencyKey: nonce, options: { title: "Test", allowSpectators: true, spectatorCapacity: capacity } }).options.spectatorCapacity, capacity);
    for (const capacity of [0, 9, 1.5, "4"]) assert.throws(() => validate("create", { idempotencyKey: nonce, options: { title: "Test", spectatorCapacity: capacity } }));
    for (const action of ["join", "request_join", "approve_join", "join_with_invite"]) {
        const payload = { team: "spectator", ...(action === "approve_join" ? { requestCode: "CMJabcdefghij" } : {}), ...(action === "join_with_invite" ? { inviteCode: "CMIabcdefghijkl" } : {}) };
        assert.equal(validate("action", { ...versioned, action, payload }).payload.team, "spectator");
    }
    assert.deepEqual(validate("action", { ...versioned, action: "set_spectator_settings", payload: { allowSpectators: false, spectatorCapacity: 4 } }).payload, { allowSpectators: false, spectatorCapacity: 4 });
});

test("unsupported voting never reaches resolver and Admin recovery has strict public input", () => {
    for (const voteType of ["yes_no", "option"]) assert.throws(() => validate("castVote", { matchCode, roundCode, idempotencyKey: nonce, vote: { voteType, choiceKey: "yes" } }));
    const input = validate("adminTransferHost", { ...versioned, targetMemberCode: memberCode, reason: " Host abandoned match " });
    assert.deepEqual(parameters("adminTransferHost", input, account), { p_admin_account_id: account, p_match_code: matchCode, p_idempotency_key: nonce, p_target_member_code: memberCode, p_expected_version: 5, p_reason: "Host abandoned match" });
    assert.throws(() => validate("adminTransferHost", { ...input, reason: " " }));
    assert.throws(() => validate("adminTransferHost", { ...input, role: "admin" }));
    assert.deepEqual(sanitize("adminTransferHost", { success: true, matchCode, version: 6, accountId: account }), { success: true, matchCode, version: 6 });
});

test("strict create supports asymmetric capacities and leaves defaults to database", () => {
    assert.deepEqual(validate("create", { idempotencyKey: nonce, options: { title: " Test ", teamACapacity: 1, teamBCapacity: 15 } }),
        { idempotencyKey: nonce, options: { title: "Test", teamACapacity: 1, teamBCapacity: 15 } });
    for (const options of [{ title: "" }, { title: "x", teamACapacity: "1" }, { title: "x", actorAccountId: account }, { title: "x", allowJoinAfterStart: null }, { title: "x", visibility: "hidden" }]) {
        assert.throws(() => validate("create", { idempotencyKey: nonce, options }), { code: "CUSTOM_MATCH_INPUT_INVALID" });
    }
});

const payloads = { open: {}, join: { team: "a" }, leave: {}, kick_member: { memberCode, reason: "test" }, transfer_host: { memberCode }, assign_team: { memberCode, team: "spectator" },
    resize: { teamACapacity: 1, teamBCapacity: 15 }, set_join_policy: { joinPolicy: "approval" }, set_allow_join_after_start: { allowJoinAfterStart: true }, begin_pregame: {}, start: {}, cancel: {}, close: {}, archive: {},
    create_invite: { maxUses: 100, expiresAt: "2099-10-06T12:00:00Z", team: "b" }, revoke_invite: { inviteCode: "CMIabcdefghijkl" }, join_with_invite: { inviteCode: "CMIabcdefghijkl", team: "b" },
    request_join: {}, cancel_join_request: { requestCode: "CMJabcdefghij" }, approve_join: { requestCode: "CMJabcdefghij", team: "a" }, reject_join: { requestCode: "CMJabcdefghij" }, allow_rejoin: { memberCode } };
for (const [action, payload] of Object.entries(payloads)) {
    test(`action ${action} has strict payload schema`, () => {
        assert.equal(validate("action", { ...versioned, action, payload }).action, action);
        assert.throws(() => validate("action", { ...versioned, action, payload: { ...payload, accountId: account } }));
    });
}
test("reject targeted UUID, unknown action, expired invite, wrong external IDs and versions", () => {
    for (const input of [{ ...versioned, action: "create_invite", payload: { targetAccountId: account } }, { ...versioned, action: "create_invite", payload: { expiresAt: at } },
        { ...versioned, action: "patch", payload: {} }, { ...versioned, matchCode: "CM-abcdefgh", action: "open", payload: {} }, { ...versioned, expectedVersion: 0, action: "open", payload: {} }]) {
        assert.throws(() => validate("action", input));
    }
});
test("vote schemas reject weights and mixed type fields", () => {
    for (const vote of [{ voteType: "player_target", targetMemberCode: memberCode }, { voteType: "skip" }]) {
        assert.ok(validate("castVote", { matchCode, roundCode, idempotencyKey: nonce, vote }));
        assert.throws(() => validate("castVote", { matchCode, roundCode, idempotencyKey: nonce, vote: { ...vote, weight: 99 } }));
    }
    assert.throws(() => validate("castVote", { matchCode, roundCode, idempotencyKey: nonce, vote: { voteType: "skip", targetMemberCode: memberCode } }));
});
test("server actor, exact version parameter and idempotency key preserved", () => {
    const input = validate("action", { ...versioned, action: "join", payload: { team: "a" } });
    assert.deepEqual(parameters("action", input, account), { p_actor_account_id: account, p_match_code: matchCode, p_idempotency_key: nonce, p_expected_version: 5, p_action: "join", p_payload: { team: "a" } });
    assert.throws(() => validate("action", { ...input, actorAccountId: account }));
    assert.equal(parameters("beginRound", versioned, account).p_expected_match_version, 5);
    assert.ok(!Object.values(OPERATIONS).some(name => name.startsWith("record_")));
});

test("response projection strips UUIDs, arbitrary fields and raw diagnostics", () => {
    const raw = { success: true, matchCode, action: "open", previousVersion: 5, version: 6, memberCode: null, inviteCode: null, requestCode: null, capturedAt: at, accountId: account, password: "secret" };
    const output = sanitize("action", raw);
    assert.ok(!Object.hasOwn(output, "accountId"));
    assert.ok(!Object.hasOwn(output, "password"));
    assert.equal(output.version, 6);
    assert.throws(() => sanitize("action", { ...raw, version: "6" }), { code: "CUSTOM_MATCH_RESPONSE_INVALID" });
    assert.throws(() => sanitize("action", { ...raw, inviteCode: "CMIabcdefghijkl" }), { code: "CUSTOM_MATCH_RESPONSE_INVALID" });
});
test("credentials validated and malformed authoritative rows reject entire response", () => {
    assert.deepEqual(sanitize("credentials", { success: true, matchCode, credentials: { lobbyName: "abcdefgh12", lobbyPassword: "1234567890", accountId: account }, capturedAt: at }).credentials,
        { lobbyName: "abcdefgh12", lobbyPassword: "1234567890" });
    assert.throws(() => sanitize("credentials", { success: true, matchCode, credentials: { lobbyName: "bad", lobbyPassword: "1234567890" }, capturedAt: at }));
    assert.throws(() => sanitize("rounds", { success: true, matchCode, rounds: [{ roundCode: "bad" }] }));
});
test("unknown mode result cannot leak hidden roles or ballots", () => {
    assert.throws(() => sanitize("voteResult", { success: true, resolved: true, roundCode, roundNumber: 1, result: { modeResult: { hiddenRoles: [account] } } }));
});
test("safe domain errors preserve conflicts without private version diagnostics", () => {
    for (const [code, status] of [["CUSTOM_MATCH_NOT_FOUND", 404], ["CUSTOM_MATCH_VERSION_CONFLICT", 409], ["CUSTOM_MATCH_CREDENTIALS_FORBIDDEN", 403]]) {
        const error = customMatchDomainError({ code, currentVersion: 99, details: account });
        assert.equal(error.status, status); assert.equal(error.code, code); assert.equal(error.currentVersion, undefined);
    }
    assert.equal(customMatchDomainError({ message: "secret SQL token" }).message, "CUSTOM_MATCH_UNAVAILABLE");
});
test("fixed transport uses service role and no redirect; never retries failed mutations", async () => {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls++; assert.equal(url, "https://db.example/rest/v1/rpc/apply_custom_match_action"); assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(init.redirect, "error"); assert.equal(init.headers["Content-Profile"], "api");
        assert.equal(init.headers["User-Agent"], "BPD-Server-Diagnostic/1.0");
        return Response.json({ success: false, code: "CUSTOM_MATCH_VERSION_CONFLICT", currentVersion: 99 });
    };
    await assert.rejects(callCustomMatchRpc(env, "action", {}), { code: "CUSTOM_MATCH_VERSION_CONFLICT" });
    assert.equal(calls, 1);
    await assert.rejects(callCustomMatchRpc(env, "record_custom_match_provider_match", {}), { code: "CUSTOM_MATCH_INPUT_INVALID" });
});
test("new Supabase secret API keys use apikey only; legacy service-role JWT keeps bearer auth", async () => {
    const headersSeen = [];
    globalThis.fetch = async (_url, init) => {
        headersSeen.push(init.headers);
        return Response.json({ success: true, gameKey: "rocketleague", maxTeamCapacity: 16, defaultTeamCapacity: 4,
            maxTotalParticipants: 32, defaultAllowJoinAfterStart: false, maxSpectatorCapacity: 8,
            defaultAllowSpectators: false, defaultSpectatorCapacity: 4, modes: [] });
    };
    await callCustomMatchRpc({ ...env, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example_key" }, "limits", { p_game_key: "rocketleague" });
    await callCustomMatchRpc({ ...env, SUPABASE_SERVICE_ROLE_KEY: "eyJlegacy-service-role-jwt" }, "limits", { p_game_key: "rocketleague" });
    assert.equal(headersSeen[0].apikey, "sb_secret_example_key");
    assert.equal(headersSeen[0].Authorization, undefined);
    assert.equal(headersSeen[1].apikey, "eyJlegacy-service-role-jwt");
    assert.equal(headersSeen[1].Authorization, "Bearer eyJlegacy-service-role-jwt");
});
test("missing service role, provider failures, oversized and malformed body fail closed", async () => {
    await assert.rejects(callCustomMatchRpc({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }, "detail", {}));
    for (const response of [Response.json({ message: "private" }, { status: 403 }), new Response("not json"), new Response("x", { headers: { "Content-Length": "999999" } })]) {
        globalThis.fetch = async () => response;
        await assert.rejects(callCustomMatchRpc(env, "detail", {}), error => !/private|test-service/.test(error.message));
    }
});
test("Supabase failure diagnostics are bounded and never include credentials or payloads", async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    globalThis.fetch = async () => Response.json({ message: "raw-provider-secret-marker" }, { status: 401 });
    try {
        await assert.rejects(callCustomMatchRpc({
            SUPABASE_URL: env.SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: "test-build-secret-marker"
        }, "limits", { playerId: "private-player-marker" }));
        globalThis.fetch = async () => { throw new Error("network detail must stay private"); };
        await assert.rejects(callCustomMatchRpc(env, "limits", { playerId: "private-player-marker" }));
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(warnings.length, 2);
    const diagnostics = warnings.map(warning => JSON.stringify(warning));
    assert.match(diagnostics[0], /custom_match_supabase_rpc_failure/);
    assert.match(diagnostics[0], /upstream_response/);
    assert.match(diagnostics[0], /401/);
    assert.match(diagnostics[1], /UPSTREAM_UNAVAILABLE/);
    assert.match(diagnostics[1], /request/);
    assert.doesNotMatch(diagnostics.join(" "), /test-build-secret-marker|private-player-marker|raw-provider-secret-marker|network detail must stay private|db\.example|SUPABASE_SERVICE_ROLE_KEY/);
});
test("start and voting unavailable until their security authorities exist", async () => {
    globalThis.fetch = () => { throw new Error("must not fetch"); };
    await assert.rejects(executeCustomMatchOperation(new Request("https://site.example"), env, "action", { ...versioned, action: "start", payload: {} }), { code: "CUSTOM_MATCH_RUNTIME_REQUIRED" });
    await assert.rejects(executeCustomMatchOperation(new Request("https://site.example"), env, "castVote", { matchCode, roundCode, idempotencyKey: nonce, vote: { voteType: "skip" } }), { code: "CUSTOM_MATCH_VOTING_NOT_AVAILABLE" });
});
test("service uses current RL authorization without browser context or fresh Epic gate", async () => {
    const service = await readFile(new URL("../../functions/services/rl/custom_matches/service.js", import.meta.url), "utf8");
    assert.match(service, /authorizeRocketLeagueRequest\(request, env, action\)/);
    assert.match(service, /authorization\.accountId/);
    assert.doesNotMatch(service, /refresh_rl_stats|identity\.account_identities|localStorage|console\./);
});

test("player results preserve unknown stats as null and reject missing authoritative fields", () => {
    const stats = Object.fromEntries(["teamScore", "opponentScore", "placement", "roundsPlayed", "roundsWon", "roundsLost", "survivedRounds", "eliminations", "votesCast", "votesReceived", "correctVotes", "incorrectVotes", "timesVotedOut", "score", "goals", "assists", "saves", "shots", "demolishes", "ownGoals", "secondsPlayed"].map(key => [key, null]));
    const player = { playerResultCode: "CMPabcdefgh", memberCode, displayName: "Test", team: "a", outcome: "win", ...stats, providerVerified: null, mvp: null, createdAt: at, accountId: account };
    const raw = { success: true, matchCode, state: "results", teamAScore: 1, teamBScore: 0, winningTeam: "a", resultSource: "user_confirmed", verificationStatus: "pending", players: [player], capturedAt: at };
    const result = sanitize("playerResults", raw);
    assert.equal(result.players[0].providerVerified, null); assert.equal(result.players[0].goals, null);
    assert.equal(result.players[0].accountId, undefined);
    delete player.goals;
    assert.throws(() => sanitize("playerResults", raw), { code: "CUSTOM_MATCH_RESPONSE_INVALID" });
});
test("limits contract keeps backend safety maxima and mode flags", () => {
    const raw = { success: true, gameKey: "rocketleague", maxTeamCapacity: 32, defaultTeamCapacity: 2, maxTotalParticipants: 64, defaultAllowJoinAfterStart: false,
        modes: [{ modeKey: "standard", displayName: "Standard", modeVersion: 1, usesTeams: true, usesRounds: false, usesVoting: false, defaultTeamACapacity: 2, defaultTeamBCapacity: 2, maxRounds: null }] };
    assert.deepEqual(sanitize("limits", raw), raw);
    assert.throws(() => sanitize("limits", { ...raw, modes: [...raw.modes, {}] }));
});
test("result input cannot declare winner or trusted provider verification", () => {
    assert.deepEqual(validate("submitResult", { ...versioned, teamAScore: 2, teamBScore: 2 }), { ...versioned, teamAScore: 2, teamBScore: 2 });
    for (const extra of [{ winningTeam: "a" }, { providerVerified: true }, { playerId: account }]) {
        assert.throws(() => validate("submitResult", { ...versioned, teamAScore: 2, teamBScore: 2, ...extra }));
    }
    assert.equal(parameters("confirmResult", { ...versioned, resultCode: "CMRabcdefgh" }, account).p_expected_match_version, 5);
});

for (const stage of ["headers", "body"]) {
    test(`end-to-end deadline bounds stalled ${stage}`, async () => {
        globalThis.fetch = stage === "headers" ? () => new Promise(() => {})
            : async () => new Response(new ReadableStream({ start() {} }));
        await assert.rejects(callCustomMatchRpc(env, "detail", {}), { code: "CUSTOM_MATCH_TIMEOUT", status: 504 });
    });
}
