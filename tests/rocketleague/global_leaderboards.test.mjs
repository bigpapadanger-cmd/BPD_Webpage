import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequestGet } from "../../functions/api/rocketleague/leaderboards.js";
import { getGlobalRocketLeagueLeaderboard, getGlobalLeaderboardPreference, saveGlobalLeaderboardPreference } from "../../functions/services/supabase/rocketleague/global_leaderboards.js";
import { refreshGlobalRocketLeagueLeaderboards } from "../../workers/rl-presence-monitor/src/rl_global_leaderboards.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const providerId = "Epic|private-provider-id|0";
const publicBoard = {
    success: true, playlistId: 10, gameMode: "1v1", status: "ready", snapshotDate: "2026-10-05",
    capturedAt: "2026-10-05T00:15:00Z", stale: false, availableDepth: 500, totalEntries: 2,
    page: 1, pageSize: 50, membersOnly: false,
    rows: [{ globalRank: 1, playerName: "Visible Player", platform: "Epic", mmr: 1200, isBpdMember: true, tier: null, division: null, matchesPlayed: null }]
};

test("leaderboard service returns safe rows and adds the signed-in player's private position", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        calls.push({ rpc, body: JSON.parse(init.body) });
        return Response.json(rpc === "get_rl_global_leaderboard" ? publicBoard : {
            globalRank: 38, playerName: "My Private Name", platform: "Epic", mmr: 1012,
            snapshotDate: "2026-10-05", capturedAt: "2026-10-05T00:15:00Z"
        });
    };
    const result = await getGlobalRocketLeagueLeaderboard({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, {
        playlistId: 10, page: 1, pageSize: 50, membersOnly: false, query: null, accountId
    });
    assert.deepEqual(calls.map(call => call.rpc), ["get_rl_global_leaderboard", "get_rl_global_leaderboard_position"]);
    assert.deepEqual(calls[0].body, {
        p_playlist_id: 10, p_page: 1, p_page_size: 50, p_members_only: false,
        p_query: null, p_min_rank: null, p_max_rank: null
    });
    assert.deepEqual(calls[1].body, { p_account_id: accountId, p_playlist_id: 10 });
    assert.equal(result.yourPosition.globalRank, 38);
    assert.equal(result.yourPosition.wins, null);
    assert.equal(JSON.stringify(result).includes(providerId), false);
    assert.equal(JSON.stringify(result).includes(accountId), false);
});

test("leaderboard reader accepts JSON-null position and missing optional enrichment fields", async () => {
    globalThis.fetch = async url => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        if (rpc === "get_rl_global_leaderboard_position") return Response.json(null);
        return Response.json({
            ...publicBoard,
            rows: [{ globalRank: 1, playerName: "Player", platform: "Epic", mmr: 76.7507 }]
        });
    };
    const result = await getGlobalRocketLeagueLeaderboard({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, {
        playlistId: 10, page: 1, pageSize: 50, membersOnly: false, accountId
    });
    assert.equal(result.yourPosition, null);
    assert.deepEqual(result.rows[0], {
        globalRank: 1, playerName: "Player", platform: "Epic", mmr: 76.7507,
        isBpdMember: false, tier: null, division: null, matchesPlayed: null, wins: null
    });
});

test("leaderboard reader preserves optional provider enrichment when present", async () => {
    globalThis.fetch = async () => Response.json({
        ...publicBoard,
        rows: [{ ...publicBoard.rows[0], mmr: 54.321, tier: 18, division: 2, matchesPlayed: 40, wins: 21 }]
    });
    const result = await getGlobalRocketLeagueLeaderboard({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, {
        playlistId: 10, page: 1, pageSize: 50, membersOnly: false
    });
    assert.deepEqual(result.rows[0], {
        globalRank: 1, playerName: "Visible Player", platform: "Epic", mmr: 54.321,
        isBpdMember: true, tier: 18, division: 2, matchesPlayed: 40, wins: 21
    });
});

test("leaderboard service restricts playlists, page sizes, and response identity fields", async () => {
    await assert.rejects(() => getGlobalRocketLeagueLeaderboard({}, { playlistId: 12 }), error => error.code === "INVALID_LEADERBOARD_QUERY");
    await assert.rejects(() => getGlobalRocketLeagueLeaderboard({}, { playlistId: 10, pageSize: 500 }), error => error.code === "INVALID_LEADERBOARD_QUERY");
    globalThis.fetch = async () => Response.json({ ...publicBoard, rows: [{ ...publicBoard.rows[0], mmr: null }] });
    await assert.rejects(() => getGlobalRocketLeagueLeaderboard({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, {
        playlistId: 10, page: 1, pageSize: 50, membersOnly: false
    }), error => error.code === "RL_LEADERBOARD_RESPONSE_INVALID");
});

test("leaderboard RPC diagnostics identify the failed boundary without logging private error details", async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    globalThis.fetch = async () => Response.json({ message: "private database detail", hint: "secret body" }, { status: 503 });
    try {
        await assert.rejects(() => getGlobalRocketLeagueLeaderboard({
            SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "private-service-key"
        }, { playlistId: 10 }), error => error.code === "RL_LEADERBOARD_UNAVAILABLE");
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], {
        rpc: "get_rl_global_leaderboard",
        code: "RL_LEADERBOARD_UNAVAILABLE",
        upstreamStatus: 503
    });
    assert.doesNotMatch(JSON.stringify(warnings), /private database detail|secret body|private-service-key/);
});

test("public route validates filters and never accepts caller-supplied player identity", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ rpc: new URL(url).pathname.split("/").at(-1), body });
        return Response.json({ ...publicBoard, playlistId: body.p_playlist_id, gameMode: "2v2" });
    };
    const env = { SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" };
    const invalid = await onRequestGet({ request: new Request("https://site.test/api/rocketleague/leaderboards?playlist=12&accountId=other"), env });
    assert.equal(invalid.status, 400);
    const badRange = await onRequestGet({ request: new Request("https://site.test/api/rocketleague/leaderboards?minRank=20&maxRank=10"), env });
    assert.equal(badRange.status, 400);
    const response = await onRequestGet({ request: new Request("https://site.test/api/rocketleague/leaderboards?playlist=11&pageSize=250&minRank=251&maxRank=500"), env });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.yourPosition, null);
    assert.deepEqual(calls[0].body, { p_playlist_id: 11, p_page: 1, p_page_size: 250, p_members_only: false, p_query: null, p_min_rank: 251, p_max_rank: 500 });
});

test("leaderboard preference preserves explicit false and saves only the server-resolved account", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const rpc = new URL(url).pathname.split("/").at(-1);
        calls.push({ rpc, body: JSON.parse(init.body) });
        return Response.json(rpc === "get_rl_global_leaderboard_preference"
            ? { available: true, globalLeaderboardVisible: false }
            : { available: true, globalLeaderboardVisible: true });
    };
    const env = { SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" };
    assert.deepEqual(await getGlobalLeaderboardPreference(env, accountId), { available: true, globalLeaderboardVisible: false });
    assert.deepEqual(await saveGlobalLeaderboardPreference(env, accountId, true), { available: true, globalLeaderboardVisible: true });
    assert.deepEqual(calls[1].body, { p_account_id: accountId, p_enabled: true });
    const route = await readFile(new URL("../../functions/api/auth/rocketleague/global-leaderboard-preference.js", import.meta.url), "utf8");
    assert.match(route, /authorization\.accountId/);
    assert.doesNotMatch(route, /body\.accountId|body\.playerId|p_account_id/);
});

test("preference save preserves the documented no-profile and invalid-preference error codes", async () => {
    globalThis.fetch = async () => Response.json({ message: "RL_PROFILE_REQUIRED" }, { status: 400 });
    await assert.rejects(() => saveGlobalLeaderboardPreference({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, accountId, true),
        error => error.code === "RL_PROFILE_REQUIRED" && error.status === 404);
    globalThis.fetch = async () => Response.json({ message: "RL_LEADERBOARD_PREFERENCE_INVALID" }, { status: 400 });
    await assert.rejects(() => saveGlobalLeaderboardPreference({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret" }, accountId, true),
        error => error.code === "RL_LEADERBOARD_PREFERENCE_INVALID" && error.status === 400);
});

test("daily refresher publishes each supported playlist and keeps provider IDs within the server boundary", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname === "mmr.example.test") {
            calls.push({ type: "provider", playlist: Number(parsed.searchParams.get("playlistId")) });
            return Response.json({ success: true, playlistId: Number(parsed.searchParams.get("playlistId")), entries: [
                { providerAccountId: providerId, platform: "Epic", displayName: "Player", mmr: 1000, providerValue: 4 }
            ] });
        }
        const rpc = parsed.pathname.split("/").at(-1);
        const payload = JSON.parse(init.body);
        calls.push({ type: "rpc", rpc, payload });
        if (rpc === "begin_rl_global_leaderboard_snapshot") return Response.json({ started: true, snapshotId: `00000000-0000-4000-8000-00000000000${calls.filter(call => call.rpc === rpc).length}` });
        if (rpc === "complete_rl_global_leaderboard_snapshot") return Response.json({ success: true, entryCount: payload.p_source_entry_count });
        if (rpc === "fail_rl_global_leaderboard_snapshot") return Response.json({ success: true });
        throw new Error(`Unexpected RPC ${rpc}`);
    };
    const result = await refreshGlobalRocketLeagueLeaderboards({
        SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-secret",
        MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "server-worker-secret"
    });
    assert.deepEqual([result.success, result.playlistCount, result.succeeded, result.failed], [true, 3, 3, 0]);
    assert.deepEqual(calls.filter(call => call.type === "provider").map(call => call.playlist), [10, 11, 13]);
    const writes = calls.filter(call => call.rpc === "complete_rl_global_leaderboard_snapshot");
    assert.equal(writes.length, 3);
    assert.equal(writes[0].payload.p_entries[0].provider_account_id, providerId);
});

test("one playlist provider failure marks only its in-progress snapshot failed and keeps later modes running", async () => {
    const failed = [];
    let sequence = 0;
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.hostname === "mmr.example.test") {
            const playlist = Number(parsed.searchParams.get("playlistId"));
            if (playlist === 11) return Response.json({ error: "private provider body" }, { status: 503 });
            return Response.json({ success: true, playlistId: playlist, entries: [{ providerAccountId: "Epic|ok|0", platform: "Epic", displayName: "ok", mmr: 10 }] });
        }
        const rpc = parsed.pathname.split("/").at(-1);
        if (rpc === "begin_rl_global_leaderboard_snapshot") return Response.json({ started: true, snapshotId: `00000000-0000-4000-8000-00000000000${++sequence}` });
        if (rpc === "fail_rl_global_leaderboard_snapshot") { failed.push(JSON.parse(init.body)); return Response.json({ success: true }); }
        return Response.json({ success: true, entryCount: 1 });
    };
    const result = await refreshGlobalRocketLeagueLeaderboards({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "secret", MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "key" });
    assert.equal(result.success, false);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.results.map(item => item.success), [true, false, true]);
    assert.deepEqual(failed, [{ p_snapshot_id: "00000000-0000-4000-8000-000000000002", p_error_code: "PROVIDER_LEADERBOARD_UNAVAILABLE" }]);
});

test("completed daily snapshots skip provider calls on duplicate scheduled or manual runs", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        const rpc = parsed.pathname.split("/").at(-1);
        if (parsed.hostname === "mmr.example.test") {
            calls.push({ type: "provider", url: parsed.href });
            throw new Error("already-complete playlist must not call provider");
        }
        const payload = JSON.parse(init.body);
        calls.push({ type: "rpc", rpc, payload });
        return Response.json({ started: false, reason: "ALREADY_COMPLETE" });
    };
    const result = await refreshGlobalRocketLeagueLeaderboards({
        SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-secret",
        MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "worker-secret"
    });
    assert.equal(result.success, true);
    assert.equal(result.results.filter(item => item.skipped).length, 3);
    assert.equal(calls.filter(call => call.type === "rpc" && call.rpc === "begin_rl_global_leaderboard_snapshot").length, 3);
    assert.equal(calls.some(call => call.type === "provider"), false);
});

test("page and profile expose only the intended cached leaderboard path", async () => {
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/Features/HTML/leaderboards.html", import.meta.url), "utf8");
    const client = await readFile(new URL("../../public/Tabs/RocketLeague/Features/JS/leaderboards.js", import.meta.url), "utf8");
    const myProfile = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/HTML/index.html", import.meta.url), "utf8");
    const architecture = await readFile(new URL("../../_structure_details/rocketleague-leaderboards.md", import.meta.url), "utf8");
    assert.match(page, /data-rl-leaderboards/);
    assert.match(page, /value="250" selected/);
    assert.match(page, /name="minRank"/);
    assert.match(page, /name="maxRank"/);
    assert.match(client, /\/api\/rocketleague\/leaderboards/);
    assert.doesNotMatch(client, /SUPABASE_AUTH|providerAccountId|\/get-global-leaderboard/);
    assert.match(myProfile, /globalLeaderboardVisible/);
    assert.match(myProfile, /Off by default/);
    assert.match(architecture, /one snapshot per playlist per UTC day/i);
    assert.match(architecture, /90-day retention/i);
    assert.match(architecture, /stale after 30 hours/i);
});
