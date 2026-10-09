import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const session = scope => ({ success: true, authenticated: true,
    user: { accountScope: scope, displayName: "Fixture", active: true, role: "admin" }, providers: {} });
const staff = { success: true, authorized: true, taskboard: { member: true, roles: ["ui"] }, admin: { staff: true, permissions: [] } };

async function fixture(callback) {
    const saved = { fetch: globalThis.fetch, document: globalThis.document, CustomEvent: globalThis.CustomEvent };
    globalThis.document = new EventTarget();
    globalThis.CustomEvent ||= class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
    const text = (await readFile(new URL("../../public/Framework/Auth/auth.js", import.meta.url), "utf8"))
        .replace('"/scripts/apiRoutes.js"', JSON.stringify(new URL("../../public/scripts/apiRoutes.js", import.meta.url).href));
    const auth = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}#${Math.random()}`);
    try { await callback(auth); }
    finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}

test("session readiness does not request optional admin access, and deferred callers share one check", async () => fixture(async auth => {
    const calls = [];
    let release;
    globalThis.fetch = async url => {
        calls.push(url);
        if (url.endsWith("/session")) return Response.json(session("account-a"));
        if (url.endsWith("/admin/access")) return new Promise(resolve => { release = () => resolve(Response.json(staff)); });
        return Response.json({ success: true });
    };
    const state = await auth.getAuthState({ includeAdmin: false });
    assert.equal(state.authenticated, true);
    assert.equal(state.admin.checked, false);
    assert.equal(calls.some(url => url.endsWith("/admin/access")), false);
    const first = auth.loadDeferredAdminAccess();
    const second = auth.loadDeferredAdminAccess();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(url => url.endsWith("/admin/access")).length, 1);
    assert.equal(auth.hasAdminAccess(auth.peekAuthState()), false);
    release();
    assert.equal(auth.hasAdminAccess(await first), true);
    assert.equal(auth.hasAdminAccess(await second), true);
}));

test("admin result cannot apply to a newer account session", async () => fixture(async auth => {
    let scope = "account-a";
    let release;
    globalThis.fetch = async url => {
        if (url.endsWith("/session")) return Response.json(session(scope));
        if (url.endsWith("/admin/access")) return new Promise(resolve => { release = () => resolve(Response.json(staff)); });
        return Response.json({ success: true });
    };
    await auth.getAuthState({ includeAdmin: false });
    const pending = auth.loadDeferredAdminAccess();
    await new Promise(resolve => setImmediate(resolve));
    scope = "account-b";
    await auth.refreshAuthState({ force: true });
    release();
    const result = await pending;
    assert.equal(result.accountScope, "account-b");
    assert.equal(auth.hasAdminAccess(result), false);
}));

test("explicit admin consumers wait for access; rejection leaves the session active", async () => fixture(async auth => {
    globalThis.fetch = async url => url.endsWith("/session") ? Response.json(session("account-a"))
        : url.endsWith("/admin/access") ? Response.json({ success: false }, { status: 403 }) : Response.json({ success: true });
    const state = await auth.getAuthState({ includeAdmin: true });
    assert.equal(state.admin.checked, true);
    assert.equal(auth.hasAdminAccess(state), false);
    assert.equal(state.authenticated, true);
    assert.equal(state.active, true);
}));
