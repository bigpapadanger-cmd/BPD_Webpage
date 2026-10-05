import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startLinkedRolesVerification, completeLinkedRolesVerification } from "../../functions/services/auth/providers/discord/linked_roles.js";
import { nonceRuntimeFixture } from "../helpers/discord_nonce_fixture.mjs";

const nonce = "x".repeat(43);
const request = new Request("https://example.test/api/auth/_oauth/callback", {
    headers: { Cookie: `bpd_discord_verification=${nonce}` }
});

test("fallback rejects unsupported methods and cross-origin confirmation", async () => {
    assert.equal((await startLinkedRolesVerification(new Request("https://example.test/verify", { method: "PUT" }), {})).status, 405);
    assert.equal((await startLinkedRolesVerification(new Request("https://example.test/verify", {
        method: "POST", headers: { Origin: "https://attacker.test" }
    }), {})).status, 403);
});

test("fallback requires an authenticated BPD account", async () => {
    const response = await startLinkedRolesVerification(new Request("https://example.test/verify"), {});
    assert.notEqual(response.status, 200);
    assert.notEqual(response.status, 302);
});

for (const invalid of ["account", "identity", "expired", "stage", "missing"]) {
    test(`OAuth success cannot grant eligibility with ${invalid} verification state`, async () => {
        let providerCalls = 0;
        const old = globalThis.fetch;
        globalThis.fetch = async () => { providerCalls++; throw new Error("Must not call provider"); };
        try {
            const f = await nonceRuntimeFixture({ accountId: invalid === "account" ? "other" : "canonical",
                discordId: invalid === "identity" ? "900000000000000002" : "900000000000000001",
                stage: invalid === "missing" ? "missing" : invalid === "stage" ? "created" : "begun", expired: invalid === "expired" });
            const result = await completeLinkedRolesVerification(request, {
                PROVIDER_RUNTIME: f.binding, PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64)
            }, "canonical", { providerSubject: "900000000000000001" });
            assert.equal(result.location, "/RocketLeague/MyProfile?discordVerification=failed");
            assert.equal(providerCalls, 0);
        } finally { globalThis.fetch = old; }
    });
}

test("valid callback forces shared-guild verification; provider failure grants nothing and consumes state", async () => {
    const f = await nonceRuntimeFixture();
    const env = { PROVIDER_RUNTIME: f.binding, PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64) };
    const first = await completeLinkedRolesVerification(request, env, "canonical", { providerSubject: "900000000000000001" });
    assert.equal(first.location, "/RocketLeague/MyProfile?discordVerification=unavailable");
    assert.equal((await f.storage.get("transaction")).stage, "consumed");
    const second = await completeLinkedRolesVerification(request, env, "canonical", { providerSubject: "900000000000000001" });
    assert.equal(second.location, "/RocketLeague/MyProfile?discordVerification=failed");
    assert.doesNotMatch(JSON.stringify(first), /900000000000000001|canonical/);
});

test("fallback completes only after existing OAuth canonical identity verification", async () => {
    const callback = await readFile(new URL("../../functions/services/auth/oauth/callback.js", import.meta.url), "utf8");
    assert.ok(callback.indexOf("await verifyReauthorizationIdentity(") < callback.indexOf("await completeLinkedRolesVerification(request"));
    const config = await readFile(new URL("../../workers/bpd-provider-runtime/wrangler.jsonc", import.meta.url), "utf8");
    assert.match(config, /"workers_dev": false/);
    assert.match(config, /"preview_urls": false/);
});

for (const shared of [true, false]) {
    test(`confirmed fallback uses shared-guild result, shared=${shared}`, async () => {
        const accountId = "canonical";
        const discordId = "900000000000000001";
        const guildId = "900000000000000002";
        const nonceFixture = await nonceRuntimeFixture({ accountId, discordId });
        let state = { profileExists: true, eligible: false, sharedGuildCount: 0, checkedAt: null };
        let synced = false;
        const env = {
            SUPABASE_URL: "https://db.invalid", SUPABASE_AUTH: "private-secret",
            PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64),
            PROVIDER_RUNTIME: { fetch: async req => new URL(req.url).pathname.includes("/linked-roles/nonce/")
                ? nonceFixture.binding.fetch(req) : new URL(req.url).pathname.endsWith("guild-inventory")
                ? Response.json({ success: true, complete: true, count: 1, guilds: [{ id: guildId, name: "BPD" }], capturedAt: new Date().toISOString() })
                : Response.json({ success: true, countComplete: true, eligible: shared, sharedGuildIds: shared ? [guildId] : [], mutualGuildCount: shared ? 1 : 0, checkedAt: new Date().toISOString() }) }
        };
        const old = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const name = new URL(url).pathname.split("/").at(-1);
            if (name === "get_rl_discord_notification_state") return Response.json(state);
            if (name === "verify_account_provider_identity") return Response.json([{ account_id: accountId, provider: "discord", provider_subject: discordId, active: true }]);
            if (name === "sync_discord_bot_guilds") return Response.json({ success: true });
            if (name === "sync_account_discord_guilds") {
                assert.deepEqual(JSON.parse(init.body).p_guild_ids, shared ? [guildId] : []);
                synced = true;
                state = { ...state, eligible: shared, sharedGuildCount: shared ? 1 : 0, checkedAt: new Date().toISOString() };
                return Response.json({ success: true, ...state });
            }
            throw new Error("Unexpected mocked RPC");
        };
        try {
            const result = await completeLinkedRolesVerification(request, env, accountId, { providerSubject: discordId });
            assert.equal(synced, true);
            assert.equal(result.location, `/RocketLeague/MyProfile?discordVerification=${shared ? "eligible" : "ineligible"}`);
            assert.doesNotMatch(JSON.stringify(result), /90000000000000000|canonical|private-secret/);
        } finally { globalThis.fetch = old; }
    });
}
