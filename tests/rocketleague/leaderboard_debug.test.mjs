import test from "node:test";
import assert from "node:assert/strict";
import { callLeaderboardDiagnostic } from "../../scripts/debug-rl-leaderboard.mjs";

const env = { MMR_API_URL: "https://worker.test", MMR_API_KEY: "secret" };
const board = playlist => ({ playlist, leaderboardId: `Skill${playlist}`, totalEntries: 1, positionSemanticsVerified: false,
    paginationParametersDocumented: false, platforms: [{ platform: "Epic", entryCount: 1, mmrDescending: true,
        samples: [{ name: "Player", mmr: 81.5, providerValue: 22, PlayerID: "PRIVATE", token: "SECRET" }] }] });
const payload = { success: true, skills: [10, 11, 13].map(board),
    skillValueCheck: { valueForUserMatchesLeaderboard: true, rankForUsersValueMatchesLeaderboard: true },
    stats: { stat: "Wins", leaderboardId: "Wins", totalEntries: 1,
        platforms: [{ platform: "Epic", entryCount: 1, rankFieldPresent: true, rankAscending: true,
            samples: [{ name: "Player", value: 42, providerRank: 1 }] }],
        userCheck: { valueForUserMatchesLeaderboard: true } },
    requestShape: { skillLeaderboardPaginationFields: [], statsLeaderboardPaginationFields: [], resultLimit: "Not established" },
    rawId: "PRIVATE" };

test("leaderboard manual caller uses one fixed protected read and strips IDs/tokens", async () => {
    let calls = 0;
    const result = await callLeaderboardDiagnostic(env, async (url, init) => {
        calls++;
        assert.equal(url.href, "https://worker.test/get-leaderboard-diagnostic");
        assert.equal(init.headers.Authorization, "Bearer secret");
        assert.equal(init.redirect, "manual");
        assert.equal(init.method, "GET");
        assert.ok(init.signal);
        return Response.json(payload);
    });
    assert.equal(calls, 1);
    assert.equal(result.skills.length, 3);
    assert.equal(result.skillValueCheck.valueForUserMatchesLeaderboard, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|PlayerID|token/);
});

test("leaderboard diagnostic rejects missing key, malformed output and oversized output", async () => {
    await assert.rejects(callLeaderboardDiagnostic({ MMR_API_URL: env.MMR_API_URL }), { code: "LEADERBOARD_DEBUG_KEY_MISSING" });
    await assert.rejects(callLeaderboardDiagnostic({ ...env, MMR_API_URL: "http://worker.test" }), { code: "LEADERBOARD_DEBUG_URL_INVALID" });
    await assert.rejects(callLeaderboardDiagnostic(env, async () => Response.json({ ...payload, skills: [board(10)] })), { code: "LEADERBOARD_DEBUG_RESPONSE_INVALID" });
    await assert.rejects(callLeaderboardDiagnostic(env, async () => new Response("SECRET", { status: 401 })), { code: "LEADERBOARD_DEBUG_HTTP_401" });
    await assert.rejects(callLeaderboardDiagnostic(env, async () => new Response("SECRET", { headers: { "Content-Length": "200000" } })), { code: "UPSTREAM_RESPONSE_TOO_LARGE" });
});
