import test from "node:test";
import assert from "node:assert/strict";
import { nonceRuntimeFixture } from "../../../tests/helpers/discord_nonce_fixture.mjs";

for (const operation of ["begin", "consume"]) {
    test(`transactional ${operation} admits exactly one concurrent duplicate`, async () => {
        const f = await nonceRuntimeFixture({ stage: operation === "begin" ? "created" : "begun" });
        const results = await Promise.all(Array.from({ length: 20 }, () => f.call(operation, f.body)));
        assert.equal(results.filter(result => result.status === 200).length, 1);
        assert.equal(results.filter(result => result.status === 409).length, 19);
        assert.equal((await f.call(operation, f.body)).status, 409);
    });
}

for (const field of ["accountBinding", "discordBinding", "action", "nonce"]) {
    test(`wrong ${field} is rejected without consuming the correct binding`, async () => {
        const f = await nonceRuntimeFixture();
        const value = field === "action" ? "other-action" : field === "nonce" ? "z".repeat(43) : "f".repeat(64);
        assert.notEqual((await f.call("consume", { ...f.body, [field]: value })).status, 200);
        assert.equal((await f.call("consume", f.body)).status, 200);
    });
}

test("expired nonces reject consumption and cleanup removes short-lived state", async () => {
    const f = await nonceRuntimeFixture({ expired: true });
    assert.equal((await f.call("consume", f.body)).status, 409);
    await f.object.alarm();
    assert.equal(await f.storage.get("transaction"), undefined);
    assert.equal(f.storage.alarm, null);
});

test("nonce authority is internal, authenticated and strictly schema-scoped", async () => {
    const f = await nonceRuntimeFixture();
    const response = await f.binding.fetch(new Request("https://provider-runtime.internal/internal/discord/linked-roles/nonce/consume", {
        method: "POST", body: JSON.stringify(f.body)
    }));
    assert.equal(response.status, 401);
    assert.equal((await f.call("consume", { ...f.body, accountId: "browser-authoritative" })).status, 400);
    const saved = JSON.stringify(await f.storage.get("transaction"));
    assert.doesNotMatch(saved, /canonical|900000000000000001|SUPABASE|RL_SESSION|refresh_token/);
    assert.equal((await f.call("create", { ...f.body, expiresAt: Date.now() + 60_000 })).status, 409);
});
