import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as secure } from "../../functions/_middleware.js";
import { onRequestGet, onRequestPost } from "../../functions/api/auth/logout.js";
import { handleUnlinkProvider } from "../../functions/services/auth/account/unlink_provider.js";
import { handleRocketLeagueProfile, projectProfileResponse } from "../../functions/services/rl/profile.js";

const request = (method, headers = {}) => new Request("https://bpd.example/api/auth/logout", { method, headers });

test("logout rejects GET and missing/foreign origins without touching session storage", async () => {
    const env = { AUTH_SESSIONS: { delete() { throw Error("must not delete"); } } };
    const get = onRequestGet({ request: request("GET"), env });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("Allow"), "POST");
    assert.equal(get.headers.get("Cache-Control"), "no-store");
    for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "https://bpd.example", "Sec-Fetch-Site": "cross-site" }]) {
        const response = await onRequestPost({ request: request("POST", { Cookie: "bpd_session=test-session", ...headers }), env });
        assert.equal(response.status, 403);
        assert.equal(response.headers.has("Set-Cookie"), false);
    }
});

test("same-origin logout deletes the session and expires all OAuth/session cookies", async () => {
    const deleted = [];
    const response = await onRequestPost({ request: request("POST", { Origin: "https://bpd.example", Cookie: "bpd_session=test-session" }), env: { AUTH_SESSIONS: { async delete(key) { deleted.push(key); } } } });
    assert.deepEqual(deleted, ["session:test-session"]);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "/");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 6);
    for (const cookie of cookies) for (const flag of ["Max-Age=0", "HttpOnly", "Secure", "SameSite=Lax"]) assert.ok(cookie.includes(flag));
});

test("session storage failure never logs arbitrary secret-bearing errors", async () => {
    const secret = "token email@example.test 11111111-1111-4111-8111-111111111111";
    const logs = []; const warn = console.warn;
    console.warn = (...args) => logs.push(args);
    try {
        const response = await onRequestPost({ request: request("POST", { Origin: "https://bpd.example", Cookie: "bpd_session=test-session" }), env: { AUTH_SESSIONS: { async delete() { throw Error(secret); } } } });
        assert.equal(response.status, 302); // Existing best-effort cookie clearing remains.
        assert.ok(logs.length > 0);
        assert.equal(JSON.stringify(logs).includes(secret), false);
        assert.equal(JSON.stringify(logs).includes("email@example.test"), false);
    } finally { console.warn = warn; }
});

test("profile HTTP projection removes internal identifiers at every depth without changing capabilities", () => {
    const source = { accountId: "account", userId: "account", profileExists: true, profile: { rlPlayerId: "player", account_id: "account", settings: { findProfileEnabled: false }, provider: { EpicDisplayName: "Player" } }, user: { user_id: "account", active: true }, rows: [{ rl_player_id: "player", mmr: 1200 }] };
    assert.deepEqual(projectProfileResponse(source), { profileExists: true, profile: { settings: { findProfileEnabled: false }, provider: { EpicDisplayName: "Player" } }, user: { active: true }, rows: [{ mmr: 1200 }] });
    assert.equal(source.profile.rlPlayerId, "player");
});

test("Pages security wrapper preserves response, cookies and redirect while preventing API caching", async () => {
    const headers = new Headers({ Location: "/", "Cache-Control": "public, max-age=600" });
    headers.append("Set-Cookie", "one=; Max-Age=0"); headers.append("Set-Cookie", "two=; Max-Age=0");
    const response = await secure({ request: request("POST"), next: async () => new Response(null, { status: 302, headers }) });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "/");
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(response.headers.get("Permissions-Policy"), "camera=(), microphone=()");
});

test("Pages wrapper preserves static caching and the exact WebSocket upgrade object", async () => {
    const response = await secure({ request: new Request("https://bpd.example/Assets/icon.svg"), next: async () => new Response("svg", { headers: { "Cache-Control": "public, max-age=3600" } }) });
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
    assert.equal(await response.text(), "svg");
    const upgrade = { status: 101, webSocket: {} };
    assert.equal(await secure({ request: request("GET"), next: async () => upgrade }), upgrade);
});

test("profile writes and unlink reject cross-site requests before authorization or upstream calls", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw Error("must not call upstream"); };
    try {
        for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "https://bpd.example", "Sec-Fetch-Site": "cross-site" }]) {
            for (const method of ["POST", "PATCH"]) {
                assert.equal((await handleRocketLeagueProfile(request(method, headers), {})).status, 403);
            }
            assert.equal((await handleUnlinkProvider(request("POST", headers), {})).status, 403);
        }
        assert.equal((await handleUnlinkProvider(request("GET"), {})).status, 405);
    } finally { globalThis.fetch = originalFetch; }
});

test("Admin middleware rejects foreign/missing write origins before dispatch and allows same-origin dispatch", async () => {
    for (const path of ["/api/admin/user-management/target/actions", "/api/auth/admin/tasks", "/api/%61uth/%61dmin/tasks"]) {
        for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "https://bpd.example", "Sec-Fetch-Site": "cross-site" }]) {
            const response = await secure({ request: new Request(`https://bpd.example${path}`, { method: "POST", headers }), next: () => { throw Error("must not dispatch"); } });
            assert.equal(response.status, 403);
            assert.equal(response.headers.get("Cache-Control"), "no-store");
        }
        let called = false;
        const response = await secure({ request: new Request(`https://bpd.example${path}`, { method: "POST", headers: { Origin: "https://bpd.example" } }), next: async () => { called = true; return Response.json({ success: false }, { status: 401 }); } });
        assert.ok(called); // Route authorization remains authoritative.
        assert.equal(response.status, 401);
    }
    const internal = await secure({ request: new Request("https://bpd.example/api/internal/discord/task-summary", { method: "POST" }), next: async () => Response.json({ signed: true }) });
    assert.equal(internal.status, 200); // Signed service ingress retains its own trust boundary.
});
