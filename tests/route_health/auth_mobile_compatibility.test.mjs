import assert from "node:assert/strict";
import test from "node:test";

import { createCookie, createSessionCookie } from "../../functions/services/auth/sessions/session.js";
import { completeOAuthCallback } from "../../functions/services/auth/oauth/callback_response.js";

test("OAuth callbacks keep generic errors while preserving a safe correlation ID", async () => {
    const debugId = "0d8671c0-f568-45ea-9d10-9dc2a6936ad1";
    const request = new Request("https://bpd-gaming-network.com/api/auth/_oauth/callback?code=do-not-forward-this-code");
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args);

    try {
        const response = await completeOAuthCallback(request, {}, async () => new Response(JSON.stringify({
            success: false,
            code: "OAUTH_CODE_EXCHANGE_FAILED",
            debugId,
            message: "Do not expose upstream details"
        }), { status: 502, headers: { "Content-Type": "application/json" } }));
        const location = new URL(response.headers.get("Location"), request.url);

        // Session resolution is unavailable in this isolated test environment,
        // so the callback conservatively routes to Account for recovery.
        assert.equal(location.pathname, "/Account");
        assert.equal(location.searchParams.get("error"), "AUTH_SERVICE_UNAVAILABLE");
        assert.equal(location.searchParams.get("debugId"), debugId);
        assert.equal(location.href.includes("do-not-forward-this-code"), false);
        assert.equal(location.href.includes("upstream"), false);
        assert.equal(logs[0][1].stage, "supabase_code_exchange");
        assert.equal(logs[0][1].debugId, debugId);
        assert.equal(JSON.stringify(logs).includes("do-not-forward-this-code"), false);
        assert.equal(JSON.stringify(logs).includes("Do not expose upstream details"), false);
    } finally {
        console.error = originalError;
    }
});

test("invalid callback debug IDs are not reflected into browser redirects", async () => {
    const request = new Request("https://bpd-gaming-network.com/api/auth/_oauth/callback");
    const response = await completeOAuthCallback(request, {}, async () => new Response(JSON.stringify({
        code: "OAUTH_CALLBACK_FAILED",
        debugId: "https://attacker.invalid/?token=secret"
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const location = new URL(response.headers.get("Location"), request.url);

    assert.match(location.searchParams.get("debugId"), /^[0-9a-f-]{36}$/iu);
    assert.notEqual(location.searchParams.get("debugId"), "https://attacker.invalid/?token=secret");
    assert.equal(location.href.includes("attacker"), false);
    assert.equal(location.href.includes("secret"), false);
});

test("OAuth/session cookies are Secure, HttpOnly, Lax, and host-only on HTTPS", () => {
    const request = new Request("https://bpd-gaming-network.com/Login");
    const oauthCookie = createCookie(request, "bpd_oauth_state", "state-value", 300);
    const sessionCookie = createSessionCookie(request, "opaque-session-id");

    for (const cookie of [oauthCookie, sessionCookie]) {
        assert.match(cookie, /; Secure(?:;|$)/);
        assert.match(cookie, /; HttpOnly(?:;|$)/);
        assert.match(cookie, /; SameSite=Lax(?:;|$)/);
        assert.match(cookie, /; Path=\//);
        assert.doesNotMatch(cookie, /; Domain=/i);
    }
});

test("login and account consume safe callback reference IDs and remove them from the URL", async () => {
    const source = await import("../../public/Framework/Auth/oauthErrors.js");
    const originalWindow = globalThis.window;
    let cleanedUrl = "";
    globalThis.window = {
        location: { href: "https://bpd-gaming-network.com/Account?error=AUTH_SERVICE_UNAVAILABLE&debugId=0d8671c0-f568-45ea-9d10-9dc2a6936ad1" },
        history: { state: null, replaceState(_state, _title, url) { cleanedUrl = url; } }
    };

    try {
        const message = source.consumeOAuthError();
        assert.match(message, /Reference ID: 0d8671c0-f568-45ea-9d10-9dc2a6936ad1/);
        assert.equal(cleanedUrl.includes("debugId"), false);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
