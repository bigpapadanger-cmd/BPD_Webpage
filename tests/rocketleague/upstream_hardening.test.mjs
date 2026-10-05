import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { withUpstreamDeadline, fetchBoundedResponse, UPSTREAM_MAX_BYTES } from "../../functions/services/http/upstream.js";
import { verifyAccountProviderIdentity } from "../../functions/services/auth/providers/provider_identity.js";
import { getRocketLeagueProfileByAccountId } from "../../functions/services/supabase/rocketleague/rocketleague_profile.js";
import { getLatestRocketLeagueMmrSnapshot } from "../../functions/services/supabase/rocketleague/get_latest_mmr.js";
import { callAdminTaskRpc, ADMIN_TASK_RPCS } from "../../functions/services/supabase/admin/tasks/rpc.js";
import { handleOAuthCallback } from "../../functions/services/auth/oauth/callback.js";
import { handleEpicCallback } from "../../functions/services/auth/providers/epic/callback.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const env = { SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "private-test-secret", SUPABASE_SERVICE_ROLE_KEY: "private-test-secret", SB_PUB_KEY: "public-key",
    EPIC_CLIENT_ID: "test-client", EPIC_CLIENT_SECRET: "private-test-secret", EPIC_REDIRECT_URI: "https://example.test/api/auth/epic/callback",
    AUTH_SESSIONS: { get: async () => null } };
const paths = {
    identity: () => verifyAccountProviderIdentity(env, "canonical-account", "discord"),
    profile: () => getRocketLeagueProfileByAccountId(env, "canonical-account"),
    mmr: () => getLatestRocketLeagueMmrSnapshot(env, "canonical-account"),
    taskboard: () => callAdminTaskRpc(env, ADMIN_TASK_RPCS.SUMMARY)
};

for (const [name, run] of Object.entries(paths)) {
    for (const phase of ["headers", "body"]) {
        test(`${name} timeout during ${phase} is unavailable, never an authorization rejection`, async t => {
            t.mock.timers.enable({ apis: ["setTimeout"] });
            let signal;
            let cancelCalled = false;
            let started;
            const ready = new Promise(resolve => { started = resolve; });
            globalThis.fetch = async (_url, init) => {
                signal = init.signal;
                started();
                return phase === "headers" ? new Promise(() => {})
                    : new Response(new ReadableStream({ cancel() { cancelCalled = true; } }));
            };
            const checked = assert.rejects(run(), error => {
                assert.equal(error.status, 503);
                assert.doesNotMatch(error.message, /private-test-secret|canonical-account/);
                assert.equal(error.code, name === "taskboard" ? "ADMIN_TASK_RPC_TIMEOUT" : "UPSTREAM_TIMEOUT");
                return true;
            });
            await ready;
            await new Promise(resolve => setImmediate(resolve));
            t.mock.timers.tick(20_000);
            await checked;
            assert.equal(signal.aborted, true);
            if (phase === "body") assert.equal(cancelCalled, true);
        });
    }
    test(`${name} rejects oversized streamed body without leaking it`, async () => {
        globalThis.fetch = async () => new Response("private-test-secret".repeat(Math.ceil(UPSTREAM_MAX_BYTES / 19) + 1));
        await assert.rejects(run(), error => {
            assert.equal(error.status, 503);
            assert.doesNotMatch(error.message, /private-test-secret/);
            return true;
        });
    });
}

test("Content-Length oversize is rejected and stream cancelled before decode", async () => {
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        headers: { "Content-Length": "999999999" }
    });
    await assert.rejects(withUpstreamDeadline(signal => fetchBoundedResponse("https://provider.invalid", { signal }, 64)), { code: "UPSTREAM_RESPONSE_TOO_LARGE", status: 503 });
    assert.equal(cancelled, true);
});

test("bounded helper deadline includes parsing and asynchronous validation", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = async () => Response.json({ success: true });
    let validated;
    const ready = new Promise(resolve => { validated = resolve; });
    const checked = assert.rejects(withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse("https://provider.invalid", { signal });
        assert.equal((await response.json()).success, true);
        validated();
        await new Promise(() => {});
    }), { code: "UPSTREAM_TIMEOUT", status: 503 });
    await ready;
    t.mock.timers.tick(10_000);
    await checked;
});

for (const provider of ["supabase", "epic"]) {
    for (const phase of ["headers", "body", "oversize"]) {
        test(`${provider} OAuth ${phase} failure returns sanitized recovery, not logout`, async t => {
            t.mock.timers.enable({ apis: ["setTimeout"] });
            let started;
            const ready = new Promise(resolve => { started = resolve; });
            globalThis.fetch = async () => {
                started();
                if (phase === "headers") return new Promise(() => {});
                if (phase === "body") return new Response(new ReadableStream());
                return new Response("private-test-secret".repeat(20_000));
            };
            const request = provider === "supabase"
                ? new Request("https://example.test/api/auth/_oauth/callback?code=fresh-code", {
                    headers: { cookie: "bpd_oauth_mode=login; bpd_oauth_provider=discord; bpd_oauth_pkce=verifier" }
                }) : new Request("https://example.test/api/auth/epic/callback?code=fresh-code&state=state", {
                    headers: { cookie: "bpd_oauth_mode=login; bpd_epic_state=state" }
                });
            const pending = provider === "supabase" ? handleOAuthCallback(request, env) : handleEpicCallback(request, env);
            await ready;
            await new Promise(resolve => setImmediate(resolve));
            if (phase !== "oversize") t.mock.timers.tick(10_000);
            const response = await pending;
            assert.equal(response.status, 302);
            assert.match(response.headers.get("Location"), /AUTH_SERVICE_UNAVAILABLE/);
            assert.doesNotMatch(response.headers.get("Location"), /private-test-secret|fresh-code/);
            assert.doesNotMatch(response.headers.get("Set-Cookie") || "", /bpd_session=/);
        });
    }
}
