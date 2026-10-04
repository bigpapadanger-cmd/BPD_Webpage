import test from "node:test";
import assert from "node:assert/strict";
import providerRuntime from "../src/index.js";

const SECRET = "p".repeat(64);
const USER_ID = "123456789012345678";
const env = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET, DISCORD_MATCHBOT_TOKEN: "test-discord-token", DISCORD_LARGE_BOT_SHARDING: "false" };

function request(path, body = {}, options = {}) {
    const method = options.method || "POST";
    return new Request(`https://service.internal${path}`, {
        method,
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(options.headers || {}) },
        ...(method === "GET" ? {} : { body: options.rawBody ?? JSON.stringify(body) })
    });
}

function guild(id) { return { id, name: `Guild ${id}` }; }
function memberResponse(id = USER_ID) { return Response.json({ user: { id }, roles: [] }); }

async function withFetch(mock, fn) {
    const previous = globalThis.fetch;
    globalThis.fetch = mock;
    try { return await fn(); } finally { globalThis.fetch = previous; }
}

test("guild inventory returns a validated single page and uses Bot authentication", async () => {
    await withFetch(async (url, init) => {
        assert.match(String(url), /\/users\/@me\/guilds\?limit=200$/);
        assert.equal(init.headers.Authorization, `Bot ${env.DISCORD_MATCHBOT_TOKEN}`);
        return Response.json([guild("123456789012345678")]);
    }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.complete, true);
        assert.deepEqual(result.guilds, [{ id: "123456789012345678", name: "Guild 123456789012345678" }]);
    });
});

test("guild inventory paginates full pages and stops only on a short page", async () => {
    const urls = [];
    await withFetch(async url => {
        const parsed = new URL(url);
        urls.push(parsed);
        if (urls.length === 1) return Response.json(Array.from({ length: 200 }, (_, index) => guild(String(100000000000000000n + BigInt(index)))));
        return Response.json([guild("100000000000000999")]);
    }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
        const result = await response.json();
        assert.equal(result.count, 201);
        assert.equal(urls.length, 2);
        assert.equal(urls[1].searchParams.get("after"), "100000000000000199");
    });
});

test("malformed guild snowflakes and incomplete pagination fail closed", async t => {
    await t.test("malformed ID is rejected", async () => {
        await withFetch(async () => Response.json([guild("not-a-snowflake")]), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_GUILD_INVENTORY_INVALID");
        });
    });
    await t.test("full page with no advancing cursor is unavailable", async () => {
        await withFetch(async () => Response.json(Array.from({ length: 200 }, () => guild("123456789012345678"))), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_GUILD_INVENTORY_INCOMPLETE");
        });
    });
});

test("large-bot shard mode enumerates each shard from the bot session-start limit", async () => {
    const paths = [];
    const shardedEnv = { ...env, DISCORD_LARGE_BOT_SHARDING: "true" };
    await withFetch(async url => {
        const parsed = new URL(url);
        paths.push(parsed.pathname + parsed.search);
        if (parsed.pathname.endsWith("/gateway/bot")) return Response.json({ session_start_limit: { max_concurrency: 2 } });
        return Response.json([guild(`12345678901234567${parsed.searchParams.get("shard")}`)]);
    }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), shardedEnv);
        const result = await response.json();
        assert.equal(result.count, 2);
        assert.ok(paths.some(path => path.endsWith("/gateway/bot")));
        assert.ok(paths.some(path => path.includes("shard=0")));
        assert.ok(paths.some(path => path.includes("shard=1")));
    });
});

test("explicit false shard mode is accepted without sharding requests", async () => {
    await withFetch(async url => {
        assert.match(String(url), /\/users\/@me\/guilds\?limit=200$/);
        return Response.json([]);
    }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).complete, true);
    });
});

test("missing sharding evidence is unavailable rather than assumed", async () => {
    await withFetch(async () => { throw new Error("must not call Discord without explicit mode"); }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), { ...env, DISCORD_LARGE_BOT_SHARDING: undefined });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "DISCORD_SHARDING_CONFIGURATION_REQUIRED");
    });
});

test("invalid sharding values fail closed before provider access", async () => {
    await withFetch(async () => { throw new Error("invalid shard config must not call Discord"); }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), { ...env, DISCORD_LARGE_BOT_SHARDING: "yes" });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "DISCORD_SHARDING_CONFIGURATION_REQUIRED");
    });
});

test("large-bot mode fails closed when the authenticated shard count is invalid", async () => {
    await withFetch(async () => Response.json({ session_start_limit: { max_concurrency: 0 } }), async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), { ...env, DISCORD_LARGE_BOT_SHARDING: "true" });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "DISCORD_SHARDING_CONFIGURATION_REQUIRED");
    });
});

test("membership 200 is eligible and provider results contain no identifiers", async () => {
    await withFetch(async url => String(url).includes("/members/") ? memberResponse() : null, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
        const result = await response.json();
        assert.equal(result.eligible, true);
        assert.equal(result.mutualGuildCount, 1);
        assert.deepEqual(result.sharedGuildIds, ["123456789012345679"]);
        assert.equal(result.countComplete, true);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(`${USER_ID}|test-discord-token`));
    });
});

test("member 404 means nonmembership, while unknown guild 404 is unavailable", async t => {
    await t.test("unknown member", async () => {
        await withFetch(async () => Response.json({ message: "Unknown Member", code: 10007 }, { status: 404 }), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
            const result = await response.json();
            assert.equal(result.status, "available");
            assert.equal(result.eligible, false);
            assert.equal(result.mutualGuildCount, 0);
        });
    });
    await t.test("unknown guild", async () => {
        await withFetch(async () => Response.json({ message: "Unknown Guild", code: 10004 }, { status: 404 }), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_GUILD_UNAVAILABLE");
        });
    });
});

test("authentication, provider failure, retry delay, and malformed member responses fail safely", async t => {
    await t.test("caller must authenticate", async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory", {}, { headers: { Authorization: "Bearer wrong" } }), env);
        assert.equal(response.status, 401);
    });
    for (const status of [401, 403, 500, 502]) {
        await t.test(`HTTP ${status} remains unavailable`, async () => {
            await withFetch(async () => Response.json({ message: "sensitive" }, { status }), async () => {
                const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
                assert.equal(response.status, 503);
                assert.equal((await response.json()).status, "unavailable");
            });
        });
    }
    await t.test("429 exposes only a bounded retry delay", async () => {
        await withFetch(async () => Response.json({ message: "private provider text", retry_after: 1.2 }, { status: 429, headers: { "Retry-After": "2.4" } }), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
            const result = await response.json();
            assert.equal(result.code, "DISCORD_RATE_LIMITED");
            assert.equal(result.retryAfterSeconds, 3);
            assert.doesNotMatch(JSON.stringify(result), /private provider text|userId|guildId/iu);
        });
    });
    await t.test("malformed 200 response is unavailable", async () => {
        await withFetch(async () => Response.json({ user: { id: "different-user" }, roles: [] }), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: ["123456789012345679"] }), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_RESPONSE_INVALID");
        });
    });
});

test("timeout and invalid request fields do not become false eligibility", async t => {
    await t.test("timeout", async () => {
        await withFetch(async () => { const error = new Error(); error.name = "AbortError"; throw error; }, async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_REQUEST_TIMEOUT");
        });
    });
    await t.test("unknown JSON field", async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/check-membership", { discordUserId: USER_ID, guildIds: [], accountId: "private" }), env);
        assert.equal(response.status, 400);
    });
    await t.test("malformed JSON body from Discord is unavailable", async () => {
        await withFetch(async () => new Response("{", { status: 200 }), async () => {
            const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            assert.equal(response.status, 503);
            assert.equal((await response.json()).code, "DISCORD_RESPONSE_INVALID");
        });
    });
});

test("Discord request timeout before headers remains unavailable", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        let started;
        const requestStarted = new Promise(resolve => { started = resolve; });
        await withFetch(async (_url, init) => new Promise((_, reject) => {
            started();
            init.signal.addEventListener("abort", () => { const error = new Error(); error.name = "AbortError"; reject(error); }, { once: true });
        }), async () => {
            const pending = providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            await requestStarted;
            t.mock.timers.tick(10000);
            const response = await pending;
            assert.equal(response.status, 503);
            const result = await response.json();
            assert.equal(result.code, "DISCORD_REQUEST_TIMEOUT");
            assert.equal(result.status, "unavailable");
            assert.equal("eligible" in result, false);
        });
    } finally { t.mock.timers.reset(); }
});

test("Discord timeout while reading body remains unavailable, not ineligible", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        let started;
        const requestStarted = new Promise(resolve => { started = resolve; });
        await withFetch(async () => {
            started();
            return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("[")); } }));
        }, async () => {
            const pending = providerRuntime.fetch(request("/internal/discord/guild-inventory"), env);
            await requestStarted;
            await new Promise(resolve => setImmediate(resolve));
            t.mock.timers.tick(10000);
            const response = await pending;
            assert.equal(response.status, 503);
            const result = await response.json();
            assert.equal(result.code, "DISCORD_REQUEST_TIMEOUT");
            assert.equal(result.status, "unavailable");
            assert.equal("eligible" in result, false);
        });
    } finally { t.mock.timers.reset(); }
});

test("caller secret length and formatting fail closed", async t => {
    const route = "/internal/health";
    for (const [name, value] of [
        ["too short", "x".repeat(63)],
        ["over maximum", "x".repeat(257)],
        ["surrounding whitespace", `${"x".repeat(64)} `]
    ]) {
        await t.test(name, async () => {
            const response = await providerRuntime.fetch(request(route, {}, { method: "GET", headers: { Authorization: `Bearer ${value}` } }), { PROVIDER_RUNTIME_CALLER_SECRET: value });
            assert.equal(response.status, 503);
            assert.deepEqual(await response.json(), { success: false, status: "unavailable", code: "PROVIDER_RUNTIME_CALLER_SECRET_INVALID", retryAfterSeconds: null });
        });
    }
    for (const [name, value] of [["minimum", "x".repeat(64)], ["base64-sized", "x".repeat(88)], ["maximum", "x".repeat(256)]]) {
        await t.test(name, async () => {
            const response = await providerRuntime.fetch(request(route, {}, { method: "GET", headers: { Authorization: `Bearer ${value}` } }), { PROVIDER_RUNTIME_CALLER_SECRET: value });
            assert.equal(response.status, 200);
        });
    }
    const incorrect = await providerRuntime.fetch(request(route, {}, { method: "GET", headers: { Authorization: `Bearer ${"y".repeat(64)}` } }), { PROVIDER_RUNTIME_CALLER_SECRET: "x".repeat(64) });
    assert.equal(incorrect.status, 401);
});

test("Worker contains no Supabase access and does not expose tokens or provider IDs", async () => {
    const source = await (await import("node:fs/promises")).readFile(new URL("../src/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /SUPABASE|apikey|service_role/iu);
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/u);
});

test("missing caller secret fails closed without touching Discord", async () => {
    await withFetch(async () => { throw new Error("unauthenticated request must not call Discord"); }, async () => {
        const response = await providerRuntime.fetch(request("/internal/discord/guild-inventory"), { DISCORD_MATCHBOT_TOKEN: env.DISCORD_MATCHBOT_TOKEN });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "PROVIDER_RUNTIME_CALLER_SECRET_INVALID");
    });
});
