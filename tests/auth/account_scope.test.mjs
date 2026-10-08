import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAccountScope, normalizeAccountScope, migrateRegistrationDraft } from "../../public/scripts/accountScope.js";

const account = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const prefix = "bpdRocketLeagueRegistrationDraft";
function storage(entries) {
    const values = new Map(entries);
    return { values, get length() { return values.size; }, key: index => [...values.keys()][index],
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key) };
}
test("versioned account scope is deterministic, normalized and distinct from canonical identity", async () => {
    const scope = await createAccountScope(account);
    assert.equal(await createAccountScope(` ${account.toUpperCase()} `), scope);
    assert.notEqual(await createAccountScope(other), scope);
    assert.equal(normalizeAccountScope(scope), scope);
    assert.equal(normalizeAccountScope(account), "");
    assert.equal(scope.includes(account), false);
    await assert.rejects(createAccountScope(""));
});
test("draft migration matches only current owner and excludes consent/location", async () => {
    const scope = await createAccountScope(account);
    const legacy = `${prefix}:${account}`;
    const unrelated = `${prefix}:${other}`;
    const store = storage([[legacy, JSON.stringify({ email: "owner@example.test", ageConsent: true, policyConsent: true, location: "private", timezone: "private", availability: [] })],
        [unrelated, "other-private-draft"], [prefix, "unowned-private-draft"]]);
    assert.equal(await migrateRegistrationDraft(store, prefix, scope), true);
    assert.deepEqual(JSON.parse(store.getItem(`${prefix}:${scope}`)), { email: "owner@example.test", availability: [] });
    assert.equal(store.getItem(legacy), null);
    assert.equal(store.getItem(unrelated), "other-private-draft");
    assert.equal(store.getItem(prefix), "unowned-private-draft");
});
test("existing scoped draft wins, malformed drafts and storage failures preserve originals", async () => {
    const scope = await createAccountScope(account), key = `${prefix}:${account}`;
    for (const raw of ["invalid-json", "null", "[]"]) {
        const store = storage([[key, raw]]);
        assert.equal(await migrateRegistrationDraft(store, prefix, scope), false);
        assert.equal(store.getItem(key), raw);
    }
    const existing = storage([[key, "{}"], [`${prefix}:${scope}`, "existing"]]);
    assert.equal(await migrateRegistrationDraft(existing, prefix, scope), false);
    assert.equal(existing.getItem(`${prefix}:${scope}`), "existing");
    assert.equal(existing.getItem(key), "{}");
    const failed = storage([[key, "{}"]]);
    failed.setItem = () => { throw Error("quota"); };
    assert.equal(await migrateRegistrationDraft(failed, prefix, scope), false);
    assert.equal(failed.getItem(key), "{}");
});
test("account switching during hash migration performs no storage mutation", async () => {
    const scope = await createAccountScope(account), key = `${prefix}:${account}`;
    const store = storage([[key, "{}"]]);
    const pending = migrateRegistrationDraft(store, prefix, scope, () => current);
    let current = false;
    assert.equal(await pending, false);
    assert.equal(store.values.size, 1);
    assert.equal(store.getItem(key), "{}");
});
test("registration invalidates draft ownership on the actual nested auth-state event", async () => {
    const scope = await createAccountScope(account);
    let source = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/gu, "")
        .replace("export async function initializePage", "async function initializePage");
    const listeners = {};
    const context = { normalizeAccountScope, document: { addEventListener(name, fn) { listeners[name] = fn; } } };
    vm.runInNewContext(source + `\nregistrationDraftAccountScope = ${JSON.stringify(scope)}; this.readScope = () => registrationDraftAccountScope;`, context);
    listeners["bpd:auth-state-changed"]({ detail: { state: { authenticated: true, accountScope: scope } } });
    assert.equal(context.readScope(), scope);
    listeners["bpd:auth-state-changed"]({ detail: { state: { authenticated: false } } });
    assert.equal(context.readScope(), "");
});
