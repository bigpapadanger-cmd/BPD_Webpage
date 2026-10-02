import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDiscordMatchBotEligibility } from "../../functions/services/auth/providers/discord_matchbot/eligibility.js";

test("linked Discord eligibility is scoped unavailable until a current-guild registry exists", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("eligibility must not make an unsupported Discord request"); };
    try {
        const result = await getDiscordMatchBotEligibility({ DISCORD_MATCHBOT_TOKEN: "never-used" }, "900000000000000001");
        assert.equal(result.eligible, false);
        assert.equal(result.status, "unavailable");
        assert.equal(result.reason, "MATCHBOT_GUILD_REGISTRY_UNAVAILABLE");
        assert.equal(result.mutualGuildCount, null);
        assert.equal(result.countComplete, false);
        assert.equal(result.eligibilityLost, false);
        assert.doesNotMatch(JSON.stringify(result), /900000000000000001|never-used/);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test("unlinked Discord state is distinct from unavailable guild eligibility", async () => {
    const result = await getDiscordMatchBotEligibility({}, null);
    assert.equal(result.status, "not_linked");
    assert.equal(result.reason, "DISCORD_USER_ID_REQUIRED");
    assert.equal(result.mutualGuildCount, 0);
    assert.equal(result.countComplete, true);
});

test("eligibility source and registration UI contain no static guild dependency or Set.filter crash", async () => {
    const [service, registration] = await Promise.all([
        readFile(new URL("../../functions/services/auth/providers/discord_matchbot/eligibility.js", import.meta.url), "utf8"),
        readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8")
    ]);
    assert.doesNotMatch(service, /DISCORD_GUILD_IDS?/);
    assert.doesNotMatch(service, /getDiscordMatchBotGuilds|discordMatchBotGet/);
    assert.match(service, /MATCHBOT_GUILD_REGISTRY_UNAVAILABLE/);
    assert.doesNotMatch(registration, /\.filter\([^)]*\)\.filter\(/s);
    assert.match(registration, /Promise\.allSettled\(\[\s*loadRocketLeagueProfile\(\)/);
    assert.match(registration, /status === "unavailable"/);
});
