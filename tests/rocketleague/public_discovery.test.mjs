import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequestGet as searchRoute } from "../../functions/api/rocketleague/players/search.js";
import { onRequestGet as publicProfileRoute } from "../../functions/api/rocketleague/players/profile/[publicProfileId].js";
import {
    getPublicRocketLeagueProfile,
    getFeaturedRocketLeaguePlayer,
    searchPublicRocketLeaguePlayers
} from "../../functions/services/supabase/rocketleague/discovery.js";
import { getRocketLeagueProfileByAccountId } from "../../functions/services/supabase/rocketleague/rocketleague_profile.js";
import { saveRocketLeagueProfile } from "../../functions/services/supabase/rocketleague/save_profile.js";
import { getPublicPresenceLabel, getPublicProfilePageUrl } from "../../public/Tabs/RocketLeague/shared/profileView.js";
import { createPlayerCard, renderPlayers, renderSearchState } from "../../public/Tabs/RocketLeague/FindPlayers/JS/view.js";
import { formatRocketLeagueTimestamp, getRocketLeagueRankClass } from "../../public/Tabs/RocketLeague/shared/profilePresentation.js";
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
    let requestedUrl = "";
    await withFetch(async url => {
        requestedUrl = String(url);
        return response({
        account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
        rl_player_id: "eb08189f-d425-48a3-a6aa-e23d0ef478d2",
        find_profile_enabled: true,
        show_online_status: false
        });
    }, async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
        assert.equal(requestedUrl, "https://supabase.example.test/rpc/get_rocketleague_profile_v2");
        assert.equal(profile.findProfileEnabled, true);
        assert.equal(profile.showOnlineStatus, false);
        assert.equal(profile.settings.findProfileEnabled, true);
        assert.equal(profile.settings.showOnlineStatus, false);
        assert.equal(profile.settingsAvailability.findProfileEnabled, true);
        assert.equal(profile.settingsAvailability.showOnlineStatus, true);
        assert.equal(profile.settingsAvailability.email, false);
    });
});

test("private V2 profile maps platform and reminder channels without changing public privacy", async () => {
    await withFetch(async () => response({
        account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
        rl_player_id: "eb08189f-d425-48a3-a6aa-e23d0ef478d2",
        primary_platform: "steam",
        notifications_v2: {
            email: { enabled: true, reminders: [60, 60, 1440] },
            sms: { enabled: false, reminders: [15] },
            discord: { enabled: false, reminders: [] }
        },
        find_profile_enabled: false,
        show_online_status: true
    }), async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
        assert.equal(profile.primaryPlatform, "steam");
        assert.deepEqual(profile.notificationsV2.email, { enabled: true, reminders: [60, 60, 1440] });
        assert.deepEqual(profile.notificationsV2.sms, { enabled: false, reminders: [15] });
        assert.equal(profile.settingsAvailability.notificationsV2, true);
        assert.equal(profile.settingsAvailability.primaryPlatform, true);
        assert.equal(profile.settings.findProfileEnabled, false);
        assert.equal(profile.settings.showOnlineStatus, true);
    });
});

test("private profile getter maps nested settings.find_profile_enabled and marks it confirmed", async () => {
    await withFetch(async () => response({
        account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
        settings: {
            find_profile_enabled: false,
            show_online_status: true
        }
    }), async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
        assert.equal(profile.settings.findProfileEnabled, false);
        assert.equal(profile.findProfileEnabled, false);
        assert.equal(profile.settingsAvailability.findProfileEnabled, true);
        assert.equal(profile.settingsAvailability.showOnlineStatus, true);
    });
});

test("private profile getter falls back to the existing authenticated profile RPC for a missing Find Players boolean", async () => {
    const requested = [];
    await withFetch(async url => {
        requested.push(new URL(String(url)).pathname);
        if (requested.length === 1) return response({
            account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
            rl_player_id: "eb08189f-d425-48a3-a6aa-e23d0ef478d2",
            settings: { show_online_status: true }
        });
        return response({ find_profile_enabled: false });
    }, async () => {
        const profile = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35", { includeLegacyFindProfileFallback: true });
        assert.deepEqual(requested, [
            "/rpc/get_rocketleague_profile_v2",
            "/rpc/get_rocketleague_profile"
        ]);
        assert.equal(profile.settings.findProfileEnabled, false);
        assert.equal(profile.findProfileEnabled, false);
        assert.equal(profile.settingsAvailability.findProfileEnabled, true);
        assert.equal(profile.settings.showOnlineStatus, true);
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
            providerUpdatedAt: "2026-09-30T12:00:00Z",
            capturedAt: "2026-09-30T12:00:00Z",
            updatedAt: "2026-09-30T12:00:00Z"
        });
        assert.deepEqual(profile.careerStats, {
            wins: 100,
            goals: 200,
            assists: 30,
            saves: 40,
            shots: 500,
            mvps: 8,
            capturedAt: "2026-09-29T12:00:00Z",
            updatedAt: "2026-09-29T12:00:00Z"
        });
        assert.equal("level" in profile.provider, false);
        assert.equal("xp" in profile.provider, false);
        assert.equal("creator_code" in profile.provider, false);
    });
});

test("profile save uses the confirmed V2 RPC contract and preserves independent privacy settings", async () => {
    let rpcPayload;
    const requestedUrls = [];
    await withFetch(async (url, options) => {
        requestedUrls.push(String(url));
        if (options.body) rpcPayload = JSON.parse(options.body);
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
    assert.equal(rpcPayload.p_find_profile_enabled, true);
    assert.equal(rpcPayload.p_show_online_status, false);
    assert.equal(rpcPayload.p_primary_platform, null);
    assert.equal(rpcPayload.p_notifications.email.enabled, false);
    assert.equal(rpcPayload.p_notifications.sms.enabled, false);
    assert.equal(rpcPayload.p_notifications.discord.enabled, false);
    assert.equal(Object.keys(rpcPayload).length, 16);
    assert.equal(requestedUrls.at(-1), "https://supabase.example.test/rpc/save_rocketleague_profile_v2");
});

test("Find Players visibility true and false persist through the V2 save RPC and reload", async () => {
    for (const findProfileEnabled of [true, false]) {
        let persistedValue;
        await withFetch(async (url, options) => {
            const path = new URL(String(url)).pathname;
            if (path.endsWith("/save_rocketleague_profile_v2")) {
                persistedValue = JSON.parse(options.body).p_find_profile_enabled;
                return response({ saved: true });
            }
            return response({
                account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
                rl_player_id: PROFILE_ID,
                find_profile_enabled: persistedValue
            });
        }, async () => {
            await saveRocketLeagueProfile(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35", {
                ageConsent: true,
                policyConsent: true,
                findProfileEnabled,
                showOnlineStatus: false,
                availability: [],
                notificationsEnabled: false
            });
            const reloaded = await getRocketLeagueProfileByAccountId(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35");
            assert.equal(reloaded.settings.findProfileEnabled, findProfileEnabled);
            assert.equal(reloaded.settingsAvailability.findProfileEnabled, true);
        });
        assert.equal(persistedValue, findProfileEnabled);
    }
});

test("profile save preserves already-confirmed V2 platform and channels when an older client omits them", async () => {
    let savedPayload;
    await withFetch(async (url, options) => {
        if (String(url).endsWith("get_rocketleague_profile_v2")) {
            return response({
                account_id: "f6332c75-771a-46bc-ae09-ef5d886a4c35",
                rl_player_id: PROFILE_ID,
                primary_platform: "playstation",
                notifications_v2: {
                    email: { enabled: true, reminders: [60, 60] },
                    sms: { enabled: false, reminders: [1440] },
                    discord: { enabled: false, reminders: [] }
                }
            });
        }
        savedPayload = JSON.parse(options.body);
        return response({ saved: true });
    }, async () => {
        await saveRocketLeagueProfile(ENV, "f6332c75-771a-46bc-ae09-ef5d886a4c35", {
            ageConsent: true,
            policyConsent: true,
            availability: [],
            notificationsEnabled: false,
            notificationMethod: null,
            reminderMode: null
        });
    });
    assert.equal(savedPayload.p_primary_platform, "playstation");
    assert.deepEqual(savedPayload.p_notifications.email, { enabled: true, reminders: [60, 60] });
    assert.deepEqual(savedPayload.p_notifications.sms, { enabled: false, reminders: [1440] });
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

test("search accepts the server-filtered public projection and rejects contradictory legacy visibility", async () => {
    let requestBody;
    let rpcName;
    const rows = [
        {
            public_profile_id: PROFILE_ID,
            display_name: "Visible Player",
            epic_display_name: "VisibleEpic",
            rl_platform: "Epic",
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
        { public_profile_id: "invalid" }
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
        for (const key of ["find_profile_enabled", "account_id", "rl_player_id", "user_id", "epic_account_id", "email", "phone"]) {
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
        return response({ code: "P0002", message: "PUBLIC_RL_PROFILE_NOT_FOUND" }, 404);
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

    assert.equal(calls[0].path.endsWith("/get_public_rl_player_summary"), true);
    assert.deepEqual(calls[0].body, { p_public_profile_id: PROFILE_ID });
});

test("public-profile RPC sanitization omits aliases and never returns hidden presence", async () => {
    await withFetch(async () => response({
        public_profile_id: PROFILE_ID,
        display_name: "Player",
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

test("public profile accepts the live server-filtered shape without exposing preferences", async () => {
    await withFetch(async (url, options) => {
        assert.equal(new URL(url).pathname.endsWith("/get_public_rocketleague_profile"), true);
        assert.equal(options.headers["Content-Profile"], "api");
        assert.equal(options.headers.Authorization, `Bearer ${ENV.SUPABASE_AUTH}`);
        return response({ public_profile_id: PROFILE_ID, display_name: "Public player", presence_shared: false });
    }, async () => {
        const profile = await getPublicRocketLeagueProfile(ENV, PROFILE_ID);
        assert.equal(profile.display_name, "Public player");
        assert.equal("find_profile_enabled" in profile, false);
        assert.equal(profile.presence_state, null);
    });
});

test("private V2 top-level findProfileEnabled maps true and false to confirmed MyProfile settings", async () => {
    for (const saved of [true, false]) {
        let calls = 0;
        await withFetch(async url => {
            calls++;
            assert.equal(new URL(url).pathname.endsWith("/get_rocketleague_profile_v2"), true);
            return response({ rl_player_id: "player", findProfileEnabled: saved });
        }, async () => {
            const profile = await getRocketLeagueProfileByAccountId(ENV, "account", { includeLegacyFindProfileFallback: true });
            assert.equal(profile.settings.findProfileEnabled, saved);
            assert.equal(profile.settingsAvailability.findProfileEnabled, true);
            assert.equal(calls, 1);
        });
    }
});

test("fresh public presence is visible while stale or unknown presence is neutral", async () => {
    const fresh = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const records = [
        { public_profile_id: PROFILE_ID, find_profile_enabled: true, presence_shared: true, presence_state: "online", presence_checked_at: fresh },
        { public_profile_id: PROFILE_ID, find_profile_enabled: true, presence_shared: true, presence_state: "online", presence_checked_at: stale },
        { public_profile_id: PROFILE_ID, find_profile_enabled: true, presence_shared: true, presence_state: "unknown", presence_checked_at: fresh }
    ];

    for (const [index, expectedState] of [[0, "online"], [1, null], [2, "unknown"]]) {
        await withFetch(async () => response(records[index]), async () => {
            const profile = await getPublicRocketLeagueProfile(ENV, PROFILE_ID);
            assert.equal(profile.presence_state, expectedState);
            assert.equal(profile.presence_checked_at, index === 1 ? null : fresh);
        });
    }
});

test("search, public profile and featured share the same 30-minute consent/freshness mask", async () => {
    const originalNow = Date.now;
    const now = Date.parse("2026-10-05T12:00:00Z");
    Date.now = () => now;
    try {
        for (const sample of [
            { shared: true, age: 0, state: "Online", expected: "online" },
            { shared: true, age: 30 * 60 * 1000, state: "Offline", expected: "offline" },
            { shared: true, age: 30 * 60 * 1000 + 1, state: "online", expected: null },
            { shared: true, age: -1, state: "online", expected: null },
            { shared: false, age: 0, state: "online", expected: null },
            { shared: true, age: 0, state: "invalid", expected: null }
        ]) {
            const row = { public_profile_id: PROFILE_ID, presence_shared: sample.shared,
                presence_state: sample.state, presence_checked_at: new Date(now - sample.age).toISOString() };
            await withFetch(async url => response(String(url).endsWith("search_rocketleague_players") ? [row]
                : String(url).endsWith("get_rl_featured_player") ? {
                    featuredDate: "2026-10-05", validUntil: "2026-10-06T00:00:00Z", player: row
                } : row), async () => {
                const results = [await getPublicRocketLeagueProfile(ENV, PROFILE_ID),
                    ...(await searchPublicRocketLeaguePlayers(ENV, "Pilot")),
                    (await getFeaturedRocketLeaguePlayer(ENV)).player];
                for (const result of results) {
                    assert.equal(result.presence_state, sample.expected);
                    assert.equal(result.presence_checked_at, sample.expected === null ? null : row.presence_checked_at);
                }
            });
        }
    } finally { Date.now = originalNow; }
});

test("registration and MyProfile describe Rocket League polling consent consistently", async () => {
    for (const page of ["Registration", "MyProfile"]) {
        const html = await readFile(new URL(`../../public/Tabs/RocketLeague/${page}/HTML/index.html`, import.meta.url), "utf8");
        assert.match(html, /Share Rocket League Online Presence/);
        assert.match(html, /check your Rocket League online status/);
        assert.match(html, /online-player counter and player discovery/);
    }
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
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/FindPlayers/JS/view.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /player\.stats\?|player\.provider\?/);
    assert.match(source, /getPublicPresenceLabel/);
    assert.match(source, /getPublicProfilePageUrl/);
    assert.match(source, /player\.mmr\?/);
});

test("public profile UI exposes supported career fields and uses available MMR freshness", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/PublicProfile/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /profile\.currentMmr\?\.capturedAt/);
    assert.doesNotMatch(source, /profile\.provider\?\.(?:level|xp|creator_code)/);
    assert.match(source, /Number\.isSafeInteger\(value\) && value >= 0/);
    assert.doesNotMatch(source, /Last checked/);
});

test("public Find Players and Player views use the same rank-color mapping", async () => {
    assert.equal(getRocketLeagueRankClass("Diamond III"), "rank-diamond");
    assert.equal(getRocketLeagueRankClass("Grand Champion II"), "rank-grand-champion");
    assert.equal(getRocketLeagueRankClass("Supersonic Legend"), "rank-supersonic-legend");
    const renderer = await readFile(new URL("../../public/Tabs/RocketLeague/Index/JS/ranks.js", import.meta.url), "utf8");
    const search = await readFile(new URL("../../public/Tabs/RocketLeague/FindPlayers/JS/view.js", import.meta.url), "utf8");
    const profile = await readFile(new URL("../../public/Tabs/RocketLeague/PublicProfile/JS/index.js", import.meta.url), "utf8");
    assert.match(renderer, /getRocketLeagueRankClass/);
    assert.match(renderer, /element\.classList\.add\(\s*getRocketLeagueRankClass\(\s*resolved\.rank/s);
    assert.doesNotMatch(renderer, /\bgetRankClass\s*\(/);
    assert.match(search, /getRocketLeagueRankClass\(tier\)/);
    assert.match(profile, /getRocketLeagueRankClass\(tier\)/);
});

test("signed-in Rocket League card renders only present safe totals and keeps privacy settings independent", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Index/JS/profile.js", import.meta.url), "utf8");
    assert.match(source, /profile\?\.stats\?\.career\?\.\[key\]/);
    assert.match(source, /Number\.isSafeInteger\(value\) \|\| value < 0/);
    assert.match(source, /profile\?\.provider\?\.displayUsername/);
    assert.match(source, /profile\?\.provider\?\.providerUpdatedAt/);
    assert.match(source, /profile\?\.stats\?\.career\?\.capturedAt/);
    assert.match(source, /renderCareerStats\(\{\}\)/);
    assert.match(source, /formatRocketLeagueTimestamp\(currentRanked\?\.capturedAt\)/);
    assert.match(source, /shared\/profilePresentation\.js/);
    assert.match(source, /MMR last updated/);
    assert.doesNotMatch(source, /profile\?\.provider\?\.(?:level|xp|creatorCode)/);
});

test("MMR timestamp formatter shows weekday/date and 24-hour time, without inventing a missing value", () => {
    const formatted = formatRocketLeagueTimestamp("2026-10-02T08:05:00Z");
    assert.match(formatted, /\d{1,2}:\d{2}/);
    assert.match(formatted, /[A-Za-z]{3}/);
    assert.equal(formatRocketLeagueTimestamp(null), "");
    assert.equal(formatRocketLeagueTimestamp("not-a-date"), "");
});

test("private My Profile is standalone, read-only provider data stays safe, and unknown totals are not zero", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/HTML/index.html", import.meta.url), "utf8");
    assert.match(html, /myProfileSettingsForm/);
    assert.match(source, /buildSettingsPayload/);
    assert.match(source, /getSettingsConfirmationState/);
    assert.doesNotMatch(html, /rocketLeagueMmrProgression|rocketLeagueMmrHistoryGraph/);
    assert.doesNotMatch(source, /provider\.(?:level|xp|creatorCode)|includeMmr(?:Progression|History)/);
    assert.doesNotMatch(source, /SUPABASE_(?:AUTH|URL)/);
});

test("private My Profile settings preserve persisted values and fail closed for unknown privacy preferences", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const settingsView = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/settings_view.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/HTML/index.html", import.meta.url), "utf8");
    assert.match(source, /getSettingsConfirmationState\(profile\)/);
    assert.match(source, /isSettingConfirmed\(profile, key\)/);
    assert.match(source, /const availability = DAYS\.flatMap/);
    assert.match(settingsView, /notificationsV2: values\.notificationsV2/);
    assert.match(source, /renderNotificationsV2\(settings, profile\)/);
    assert.match(source, /autoDetectRegion: document\.getElementById\("autoDetectRegion"\)\.checked/);
    assert.match(source, /form\.hidden = false/);
    assert.match(source, /Could not confirm:/);
    for (const id of ["preferredMode", "myProfileAvailability", "profileEmail", "profilePhone", "notificationsV2Fieldset", "notificationsV2Channels"]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(source, /method,\s*credentials: "same-origin"/);
});

test("contradictory legacy private visibility is rejected even on a public RPC result", async () => {
    for (const flag of [false, null, "true"]) {
        await withFetch(async () => response({
            public_profile_id: PROFILE_ID,
            find_profile_enabled: flag
        }), async () => {
            assert.equal(await getPublicRocketLeagueProfile(ENV, PROFILE_ID), null);
        });
    }
});

test("public presence renders the explicit private label, not Offline", () => {
    assert.equal(getPublicPresenceLabel({ presence_shared: false, presence_state: "Offline" }), "Presence not shared.");
    assert.equal(getPublicPresenceLabel({ presence_shared: true, presence_state: "Online" }), "Online");
    assert.equal(getPublicPresenceLabel({ presence_shared: true, presence_state: "online" }), "Online");
    assert.equal(getPublicPresenceLabel({ presence_shared: true, presence_state: "unknown" }), "Status unavailable");
    assert.equal(getPublicPresenceLabel({ presence_shared: true, presence_state: "in-match" }), "Status unavailable");
    assert.equal(getPublicProfilePageUrl(PROFILE_ID), `/RocketLeague/Player?id=${PROFILE_ID}`);
});

test("Find Players cards stay compact and use three, two, then one responsive columns", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/FindPlayers/JS/view.js", import.meta.url), "utf8");
    const css = await readFile(new URL("../../public/Tabs/RocketLeague/FindPlayers/CSS/index.css", import.meta.url), "utf8");
    assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 620px\)[\s\S]*?minmax\(0, 1fr\)/);
    assert.match(source, /\["ones_tier", "ones_mmr", "1v1"\]/);
    assert.match(source, /\["twos_tier", "twos_mmr", "2v2"\]/);
    assert.match(source, /\["threes_tier", "threes_mmr", "3v3"\]/);
    assert.doesNotMatch(source, /aliases|accountId|rlPlayerId/i);
    assert.match(source, /featured \? player.stats/);
});

function fakeDocument() {
    return {
        createElement(tag) {
            return {
                tagName: tag,
                children: [],
                dataset: {},
                attributes: {},
                append(...nodes) { this.children.push(...nodes); },
                setAttribute(key, value) { this.attributes[key] = value; }
            };
        }
    };
}

test("Find Players card has three compact ranks, safe presence, and only public profile links", () => {
    const documentRef = fakeDocument();
    const card = createPlayerCard(documentRef, {
        public_profile_id: PROFILE_ID,
        display_name: "BPD Pilot",
        epic_display_name: "Epic Pilot",
        rl_platform: "Epic",
        presence_shared: true,
        presence_state: "in-match",
        mmr: { ones_tier: "Gold", ones_mmr: 0, twos_tier: null, twos_mmr: null, threes_tier: "Diamond", threes_mmr: 900 }
    });
    const flattened = [];
    const visit = node => { flattened.push(node); node.children?.forEach(visit); };
    visit(card);
    const text = flattened.map(node => node.textContent || "").join(" ");
    assert.match(text, /Status unavailable/);
    assert.match(text, /0 MMR/);
    assert.match(text, /MMR unavailable/);
    assert.doesNotMatch(text, /in-match/);
    const links = flattened.filter(node => node.tagName === "a");
    assert.equal(links.length, 1);
    assert.equal(links[0].href, `/RocketLeague/Player?id=${PROFILE_ID}`);
});

test("Find Players result and search states replace stale content and use text only", () => {
    const documentRef = fakeDocument();
    const container = { children: [], append(node) { this.children.push(node); }, replaceChildren(...nodes) { this.children = nodes; } };
    renderPlayers(documentRef, container, []);
    assert.match(container.children[0].textContent, /No public players found/);
    renderSearchState(documentRef, container, "error", "Search failed safely");
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].textContent, "Search failed safely");
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
