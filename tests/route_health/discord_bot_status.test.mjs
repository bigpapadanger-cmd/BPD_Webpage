import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getSystemStatus, performSystemStatusAction } from "../../functions/services/admin/system_status.js";
import { onRequestGet, onRequestPost } from "../../functions/api/admin/system-status.js";
import runtime from "../../workers/bpd-provider-runtime/src/index.js";

const guildId = "111111111111111111";
const userId = "222222222222222222";
function fixture() {
    const values = new Map();
    const runtimeEnv = { PROVIDER_RUNTIME_CALLER_SECRET: "c".repeat(64), DISCORD_MATCHBOT_TOKEN: "private-match-token" };
    return {
        PROVIDER_RUNTIME_CALLER_SECRET: runtimeEnv.PROVIDER_RUNTIME_CALLER_SECRET,
        PROVIDER_RUNTIME: { fetch: request => runtime.fetch(request, runtimeEnv) },
        DISCORD_AUTHZ_BOT_TOKEN: "private-authz-token", DISCORD_AUTHZ_GUILD_ID: guildId,
        RL_STATS_CACHE: {
            async get(key) { return values.has(key) ? JSON.parse(values.get(key)) : null; },
            async put(key, value) { values.set(key, value); }, async delete(key) { values.delete(key); }
        }
    };
}
async function withFetch(fetcher, callback) {
    const previous = globalThis.fetch;
    globalThis.fetch = fetcher;
    try { await callback(); } finally { globalThis.fetch = previous; }
}
function noSecrets(value) {
    const text = JSON.stringify(value);
    for (const forbidden of [guildId, userId, "private-match-token", "private-authz-token", "provider-private-error", "c".repeat(64)]) assert.equal(text.includes(forbidden), false);
}

test("Admin cards start unverified and page reads never contact Discord", async () => {
    const env = fixture();
    await withFetch(() => { throw new Error("unexpected provider call"); }, async () => {
        const response = await getSystemStatus(env, { force: true });
        for (const id of ["discord-matchbot", "discord-authz-bot"]) {
            const bot = response.services.find(service => service.id === id);
            assert.equal(bot.status, "unknown");
            assert.deepEqual(bot.actions, ["recheck"]);
        }
    });
});

test("MatchBot connection uses private runtime and token never reaches Admin response", async () => {
    const env = fixture();
    let calls = 0;
    await withFetch(async (url, init) => {
        calls++;
        assert.equal(url, "https://discord.com/api/v10/users/@me");
        assert.equal(init.headers.Authorization, "Bot private-match-token");
        assert.equal(init.redirect, "manual");
        return Response.json({ id: userId, bot: true, username: "PrivateBot", email: "private@example.test" });
    }, async () => {
        const result = await performSystemStatusAction(env, "discord-matchbot", "recheck");
        assert.equal(result.result.status, "healthy");
        noSecrets(result);
        const stored = (await getSystemStatus(env, { force: true })).services.find(service => service.id === "discord-matchbot");
        assert.equal(stored.status, "healthy");
        assert.ok(stored.lastSuccessfulAt);
        noSecrets(stored);
        assert.equal(calls, 1);
        await assert.rejects(performSystemStatusAction(env, "discord-matchbot", "recheck"), { code: "SERVICE_ACTION_COOLDOWN" });
    });
});

test("Authorization bot validates bot identity and configured guild with read-only requests", async () => {
    const env = fixture();
    const paths = [];
    await withFetch(async (url, init) => {
        paths.push(new URL(url).pathname);
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers.Authorization, "Bot private-authz-token");
        return Response.json(url.endsWith("/users/@me") ? { id: userId, bot: true } : { id: guildId, name: "private-guild" });
    }, async () => {
        const response = await performSystemStatusAction(env, "discord-authz-bot", "recheck");
        assert.equal(response.result.status, "healthy");
        assert.deepEqual(paths, ["/api/v10/users/@me", `/api/v10/guilds/${guildId}`]);
        noSecrets(response);
    });
});

for (const [name, response, expected] of [
    ["invalid token", () => Response.json({ message: "provider-private-error" }, { status: 401 }), "DISCORD_BOT_UNAUTHORIZED"],
    ["rate limit", () => Response.json({ retry_after: 120, message: "provider-private-error" }, { status: 429, headers: { "Retry-After": "120" } }), "DISCORD_BOT_RATE_LIMITED"],
    ["human identity", () => Response.json({ id: userId, bot: false }), "DISCORD_BOT_RESPONSE_INVALID"],
    ["malformed identity", () => Response.json({ id: "invalid", bot: true }), "DISCORD_BOT_RESPONSE_INVALID"],
    ["oversized response", () => new Response("x".repeat(256 * 1024 + 1)), "DISCORD_BOT_UNAVAILABLE"]
]) test(`Authorization bot ${name} is sanitized and not healthy`, async () => {
    const env = fixture();
    await withFetch(response, async () => {
        const result = await performSystemStatusAction(env, "discord-authz-bot", "recheck");
        assert.equal(result.result.status, "degraded");
        assert.equal(result.result.errorCode, expected);
        noSecrets(result);
        if (name === "rate limit") {
            assert.equal(result.result.retryAfterSeconds, 120);
            await assert.rejects(performSystemStatusAction(env, "discord-authz-bot", "recheck"), error => error.code === "SERVICE_ACTION_COOLDOWN" && error.retryAfterSeconds > 60);
        }
    });
});

test("Authorization bot unavailable guild cannot be reported healthy", async () => {
    await withFetch(async url => url.endsWith("/users/@me") ? Response.json({ id: userId, bot: true })
        : Response.json({ code: 10004, message: "provider-private-error" }, { status: 404 }), async () => {
        const result = await performSystemStatusAction(fixture(), "discord-authz-bot", "recheck");
        assert.equal(result.result.errorCode, "DISCORD_BOT_GUILD_UNAVAILABLE");
        noSecrets(result);
    });
});

for (const body of [false, true]) test(`Authorization bot timeout includes ${body ? "body reading" : "headers"}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let begin;
    const started = new Promise(resolve => { begin = resolve; });
    try {
        await withFetch(async () => {
            begin();
            return body ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } })) : new Promise(() => {});
        }, async () => {
            const pending = performSystemStatusAction(fixture(), "discord-authz-bot", "recheck");
            await started;
            await new Promise(resolve => setImmediate(resolve));
            t.mock.timers.tick(15000);
            const result = await pending;
            assert.equal(result.result.errorCode, "DISCORD_BOT_TIMEOUT");
            noSecrets(result);
        });
    } finally { t.mock.timers.reset(); }
});

test("MatchBot internal check rejects unauthorized, wrong method and caller-supplied parameters", async () => {
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: "c".repeat(64) };
    await withFetch(() => { throw new Error("unexpected provider call"); }, async () => {
        const url = "https://runtime.internal/internal/discord/bot-health";
        assert.equal((await runtime.fetch(new Request(url), env)).status, 401);
        assert.equal((await runtime.fetch(new Request(url, { method: "POST" }), env)).status, 405);
        assert.equal((await runtime.fetch(new Request(`${url}?userId=${userId}`, { headers: { Authorization: `Bearer ${env.PROVIDER_RUNTIME_CALLER_SECRET}` } }), env)).status, 400);
    });
});

test("Admin status and connection actions fail closed without authorization configuration", async () => {
    const url = "https://site.test/api/admin/system-status";
    await withFetch(() => { throw new Error("unauthorized provider call"); }, async () => {
        // The existing authorization contract reports missing configuration as 503.
        for (const response of [
            await onRequestGet({ request: new Request(url), env: {} }),
            await onRequestPost({ request: new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: "discord-matchbot", action: "recheck" }) }), env: {} })
        ]) {
            assert.equal(response.status, 503);
            const payload = await response.json();
            assert.equal(payload.success, false);
            assert.equal("services" in payload, false);
        }
    });
    const source = await readFile("public/Global/Admin/WorkerStatus/JS/index.js", "utf8");
    assert.match(source, /Check connection/);
    assert.doesNotMatch(source, /DISCORD_.*BOT_TOKEN|discord\.com\/api/);
});

test("MatchBot rate limit stays sanitized and prevents an immediate second check", async () => {
    const env = fixture();
    let calls = 0;
    await withFetch(() => {
        calls++;
        return Response.json({ retry_after: 120, message: "provider-private-error" }, { status: 429 });
    }, async () => {
        const result = await performSystemStatusAction(env, "discord-matchbot", "recheck");
        assert.equal(result.result.errorCode, "DISCORD_BOT_RATE_LIMITED");
        noSecrets(result);
        await assert.rejects(performSystemStatusAction(env, "discord-matchbot", "recheck"), error => error.code === "SERVICE_ACTION_COOLDOWN" && error.retryAfterSeconds > 60);
        assert.equal(calls, 1);
    });
});
