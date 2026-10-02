import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequestGet as searchRoute } from "../../functions/api/rocketleague/players/search.js";
import { onRequestGet as publicProfileRoute } from "../../functions/api/rocketleague/players/profile/[publicProfileId].js";
import {
    getPublicRocketLeagueProfile,
    searchPublicRocketLeaguePlayers
} from "../../functions/services/supabase/rocketleague/discovery.js";
import { getRocketLeagueProfileByAccountId } from "../../functions/services/supabase/rocketleague/rocketleague_profile.js";
import { saveRocketLeagueProfile } from "../../functions/services/supabase/rocketleague/save_profile.js";
import { getPublicPresenceLabel, getPublicProfilePageUrl } from "../../public/Tabs/RocketLeague/shared/profileView.js";
import { ROUTES } from "../../public/routes.js";

const ENV = {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_AUTH: "test-only-server-key"
};
const PROFILE_ID = "38c395e6-cac4-4f27-86c0-f88f7304c618";

function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

async function withFetch(fetchImplementation, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImplementation;
    try {
        return await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test("profile load exposes find_profile_enabled as a boolean", async () => {
    await withFetch(async () => response({
        account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
        rl_player_id: "eb08189f-d425-48a3-a6aa-e23d0ef478d2",
        find_profile_enabled: true,
        show_online_status: false
    }), async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
        assert.equal(profile.findProfileEnabled, true);
        assert.equal(profile.showOnlineStatus, false);
        assert.equal(profile.settings.findProfileEnabled, true);
        assert.equal(profile.settings.showOnlineStatus, false);
    });
});

test("private profile getter maps persisted provider name and career totals regardless of public privacy flags", async () => {
    await withFetch(async () => response({
        account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
        rl_player_id: "eb08189f-d425-48a3-a6aa-e23d0ef478d2",
        find_profile_enabled: false,
        show_online_status: false,
        provider: {
            display_username: "InGamePilot",
            level: 70,
            xp: 1200,
            creator_code: "example",
            provider_updated_at: "2026-09-30T12:00:00Z",
            captured_at: "2026-09-30T12:00:00Z",
            updated_at: "2026-09-30T12:00:00Z"
        },
        stats: {
            wins: "100",
            goals: "200",
            assists: "30",
            saves: "40",
            shots: "500",
            mvps: "8",
            captured_at: "2026-09-29T12:00:00Z",
            updated_at: "2026-09-29T12:00:00Z"
        }
    }), async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
        assert.equal(profile.findProfileEnabled, false);
        assert.equal(profile.showOnlineStatus, false);
        assert.equal(profile.settings.findProfileEnabled, false);
        assert.equal(profile.settings.showOnlineStatus, false);
        assert.deepEqual(profile.provider, {
            displayUsername: "InGamePilot",
            providerUpdatedAt: "2026-09-30T12:00:00Z"
        });
        assert.deepEqual(profile.careerStats, {
            wins: 100,
            goals: 200,
            assists: 30,
            saves: 40,
            shots: 500,
            mvps: 8,
            capturedAt: "2026-09-29T12:00:00Z"
        });
        assert.equal("level" in profile.provider, false);
        assert.equal("xp" in profile.provider, false);
        assert.equal("creator_code" in profile.provider, false);
    });
});

test("profile save sends the new 17th discovery argument and preserves existing fields", async () => {
    let rpcPayload;
    await withFetch(async (_url, options) => {
        rpcPayload = JSON.parse(options.body);
        return response({ saved: true });
    }, async () => {
        await saveRocketLeagueProfile(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35", {
            ageConsent: true,
            policyConsent: true,
            findProfileEnabled: true,
            showOnlineStatus: false,
            availability: [],
            notificationsEnabled: false
        });
    });
    assert.equal(rpcPayload.s_find_profile_enabled, true);
    assert.equal(rpcPayload.s_show_online_status, false);
    assert.equal(rpcPayload.s_notifications_enabled, false);
    assert.equal(Object.keys(rpcPayload).length, 17);
});

test("search rejects short, long, duplicate, and unbounded queries before Supabase", async () => {
    let calls = 0;
    const fakeFetch = async () => {
        calls += 1;
        return response([]);
    };
    for (const query of ["a", "x".repeat(81)]) {
        const result = await withFetch(fakeFetch, () => searchRoute({
            request: new Request(`https://bpd-gaming-network.com/api/rocketleague/players/search?q=${encodeURIComponent(query)}`),
            env: ENV
        }));
        assert.equal(result.status, 400);
    }
    const duplicateQuery = await withFetch(fakeFetch, () => searchRoute({
        request: new Request("https://bpd-gaming-network.com/api/rocketleague/players/search?q=one&q=two"),
        env: ENV
    }));
    assert.equal(duplicateQuery.status, 400);
    const oversizedLimit = await withFetch(fakeFetch, () => searchRoute({
        request: new Request("https://bpd-gaming-network.com/api/rocketleague/players/search?q=player&limit=21"),
        env: ENV
    }));
    assert.equal(oversizedLimit.status, 400);
    assert.equal(calls, 0);
});

test("search includes only explicitly opted-in rows and strips aliases and internal identifiers", async () => {
    let requestBody;
    let rpcName;
    const rows = [
        {
            public_profile_id: PROFILE_ID,
            display_name: "Visible Player",
            epic_display_name: "VisibleEpic",
            rl_platform: "Epic",
            find_profile_enabled: true,
            presence_shared: false,
            presence_state: "Online",
            aliases: ["FormerName"],
            account_id: "private-account-id",
            rl_player_id: "private-player-id",
            email: "hidden@example.test",
            mmr: { ones_mmr: 900, ones_tier: "Gold" },
            provider: { display_username: "ProviderName" },
            stats: { wins: 100 }
        },
        { public_profile_id: "c803fe50-fc91-4b2b-8ccb-26496d3e7482", find_profile_enabled: false },
        { public_profile_id: "581e27d0-39d5-4d9d-bcbf-a4b1ca9b7c0a" }
    ];

    await withFetch(async (url, options) => {
        rpcName = new URL(url).pathname.split("/").at(-1);
        requestBody = JSON.parse(options.body);
        return response(rows);
    }, async () => {
        const result = await searchRoute({
            request: new Request("https://bpd-gaming-network.com/api/rocketleague/players/search?q=visible&limit=20"),
            env: ENV
        });
        assert.equal(result.status, 200);
        const payload = await result.json();
        assert.equal(payload.players.length, 1);
        assert.equal(payload.players[0].display_name, "Visible Player");
        assert.equal(payload.players[0].presence_state, null);
        assert.equal(payload.players[0].mmr.ones_mmr, 900);
        assert.equal("aliases" in payload.players[0], false);
        assert.equal("provider" in payload.players[0], false);
        assert.equal("stats" in payload.players[0], false);
        for (const key of ["account_id", "rl_player_id", "user_id", "epic_account_id", "email", "phone"]) {
            assert.equal(key in payload.players[0], false);
        }
    });

    assert.equal(rpcName, "search_rocketleague_players");
    assert.deepEqual(requestBody, { p_query: "visible", p_limit: 20 });
});

test("public-profile routing uses public_profile_id and hidden/missing profiles are indistinguishable", async () => {
    const calls = [];
    await withFetch(async (url, options) => {
        calls.push({
            path: new URL(url).pathname,
            body: JSON.parse(options.body)
        });
        return response(null);
    }, async () => {
        const hidden = await publicProfileRoute({
            request: new Request(`https://bpd-gaming-network.com/api/rocketleague/players/profile/${PROFILE_ID}`),
            params: { publicProfileId: PROFILE_ID },
            env: ENV
        });
        const missingId = "581e27d0-39d5-4d9d-bcbf-a4b1ca9b7c0a";
        const missing = await publicProfileRoute({
            request: new Request(`https://bpd-gaming-network.com/api/rocketleague/players/profile/${missingId}`),
            params: { publicProfileId: missingId },
            env: ENV
        });
        assert.equal(hidden.status, 404);
        assert.equal(missing.status, 404);
        assert.deepEqual(await hidden.json(), await missing.json());
    });

    assert.equal(calls[0].path.endsWith("/get_public_rocketleague_profile"), true);
    assert.deepEqual(calls[0].body, { p_public_profile_id: PROFILE_ID });
});

test("public-profile RPC sanitization omits aliases and never returns hidden presence", async () => {
    await withFetch(async () => response({
        public_profile_id: PROFILE_ID,
        display_name: "Player",
        find_profile_enabled: true,
        aliases: ["PreviousTag"],
        presence_shared: false,
        presence_state: "Online",
        presence_checked_at: "2026-09-30T12:00:00Z",
        account_id: "private-account-id"
    }), async () => {
        const profile = await getPublicRocketLeagueProfile(ENV, PROFILE_ID);
        assert.equal(profile.presence_shared, false);
        assert.equal(profile.presence_state, null);
        assert.equal(profile.presence_checked_at, null);
        assert.equal("aliases" in profile, false);
        assert.equal("account_id" in profile, false);
    });
});

test("public profile does not expose provider/stat freshness timestamps absent from its contract", async () => {
    await withFetch(async () => response({
        public_profile_id: PROFILE_ID,
        find_profile_enabled: true,
        provider: {
            display_username: "Pilot",
            provider_updated_at: "2026-09-30T12:00:00Z"
        },
        stats: {
            wins: 12,
            goals: 34,
            captured_at: "2026-09-29T12:00:00Z"
        }
    }), async () => {
        const profile = await getPublicRocketLeagueProfile(ENV, PROFILE_ID);
        assert.equal(profile.provider.display_username, "Pilot");
        assert.deepEqual(Object.keys(profile.provider).sort(), ["display_username"]);
        assert.equal(profile.stats.wins, 12);
        assert.equal(profile.stats.goals, 34);
        assert.equal("captured_at" in profile.stats, false);
    });
});

test("Find Players cards stay lightweight and do not render career or unsupported provider fields", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/FindPlayers/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /player\.stats\?|player\.provider\?/);
    assert.match(source, /getPublicPresenceLabel/);
    assert.match(source, /getPublicProfilePageUrl/);
    assert.match(source, /player\.mmr\?/);
});

test("public profile UI exposes supported career fields and uses available MMR freshness", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/PublicProfile/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /profile\.mmr\?\.captured_at/);
    assert.doesNotMatch(source, /profile\.provider\?\.(?:level|xp|creator_code)/);
    assert.match(source, /Number\.isSafeInteger\(value\) && value >= 0/);
});

test("signed-in Rocket League card renders only present safe totals and keeps privacy settings independent", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Index/JS/profile.js", import.meta.url), "utf8");
    assert.match(source, /profile\?\.stats\?\.career\?\.\[key\]/);
    assert.match(source, /Number\.isSafeInteger\(value\) \|\| value < 0/);
    assert.match(source, /profile\?\.provider\?\.displayUsername/);
    assert.match(source, /profile\?\.provider\?\.providerUpdatedAt/);
    assert.match(source, /profile\?\.stats\?\.career\?\.capturedAt/);
    assert.match(source, /renderCareerStats\(\{\}\)/);
    assert.match(source, /formatMmrTimestamp\(currentRanked\?\.capturedAt\)/);
    assert.match(source, /weekday: "short"[\s\S]*hourCycle: "h23"/);
    assert.match(source, /MMR last updated/);
    assert.doesNotMatch(source, /profile\?\.provider\?\.(?:level|xp|creatorCode)/);
});

test("public profile is unavailable unless Find Profile is explicitly enabled", async () => {
    await withFetch(async () => response({
        public_profile_id: PROFILE_ID,
        display_name: "Legacy response without opt-in field"
    }), async () => {
        assert.equal(await getPublicRocketLeagueProfile(ENV, PROFILE_ID), null);
    });
});

test("public presence renders the explicit private label, not Offline", () => {
    assert.equal(getPublicPresenceLabel({ presence_shared: false, presence_state: "Offline" }), "Presence not shared");
    assert.equal(getPublicPresenceLabel({ presence_shared: true, presence_state: "Online" }), "Online");
    assert.equal(getPublicProfilePageUrl(PROFILE_ID), `/RocketLeague/Player?id=${PROFILE_ID}`);
});

test("public browser modules do not receive Supabase credentials", async () => {
    const files = [
        "../../public/Tabs/RocketLeague/FindPlayers/JS/index.js",
        "../../public/Tabs/RocketLeague/PublicProfile/JS/index.js"
    ];
    for (const file of files) {
        const source = await readFile(new URL(file, import.meta.url), "utf8");
        assert.doesNotMatch(source, /SUPABASE_(?:AUTH|URL)/);
    }
});

test("Find Players and public profile are routed, while leaderboard visibility remains independent", () => {
    assert.equal(ROUTES["/RocketLeague/FindPlayers"].requiresAuth, undefined);
    assert.equal(ROUTES["/RocketLeague/Player"].sitemap, false);
    assert.equal(ROUTES["/RocketLeague/Leaderboards"].requiresAuth, undefined);
    assert.equal(ROUTES["/RocketLeague/Leaderboards"].auth?.required, undefined);
});
