import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleRocketLeagueProfileDelete } from "../../functions/services/rl/delete_profile.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const CONFIRMATION = "DELETE_ROCKETLEAGUE_PROFILE";

function makeEnv({ authenticated = true, active = true } = {}) {
    const session = {
        AbsoluteExpiresAt: Date.now() + 60_000,
        LastSeenAt: Date.now(),
        UserId: ACCOUNT_ID,
        Active: active,
        Role: "user"
    };
    return {
        SUPABASE_URL: "https://supabase.example",
        SUPABASE_AUTH: "server-only-key",
        AUTH_SESSIONS: {
            async get(key) {
                assert.equal(key, "session:session-1");
                return authenticated ? session : null;
            }
        }
    };
}

function deleteRequest(body = { confirmation: CONFIRMATION }, options = {}) {
    return new Request("https://bpd-gaming-network.com/api/auth/rocketleague/profile", {
        method: options.method || "DELETE",
        headers: {
            origin: options.origin || "https://bpd-gaming-network.com",
            "content-type": "application/json",
            cookie: options.cookie === false ? "" : "bpd_session=session-1",
            ...(options.fetchSite ? { "sec-fetch-site": options.fetchSite } : {})
        },
        body: JSON.stringify(body)
    });
}

test("delete uses only the authenticated account and returns a safe normalized result", async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        captured = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
        return Response.json({ success: true, playerId: PLAYER_ID, epicIdentitiesRemoved: 1 });
    };
    try {
        const response = await handleRocketLeagueProfileDelete(deleteRequest(), makeEnv());
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(captured.body, { p_account_id: ACCOUNT_ID });
        assert.equal(captured.url, "https://supabase.example/rest/v1/rpc/delete_rocketleague_profile");
        assert.equal(captured.headers.Authorization, "Bearer server-only-key");
        assert.deepEqual(body, { success: true, profileDeleted: true, epicLinkRemoved: true });
        assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
        assert.equal(JSON.stringify(body).includes(PLAYER_ID), false);
        assert.equal(response.headers.has("set-cookie"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("arbitrary browser account targets are rejected before Supabase is called", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async url => {
        fetchCalls += 1;
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        throw new Error("unexpected RPC");
    };
    try {
        const response = await handleRocketLeagueProfileDelete(deleteRequest({
            confirmation: CONFIRMATION,
            accountId: "attacker-account"
        }), makeEnv());
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "CONFIRMATION_REQUIRED");
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("missing confirmation, cross-site requests, and unauthenticated callers cannot delete", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async url => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        fetchCalls += 1;
        throw new Error("unexpected RPC");
    };
    try {
        const missingConfirmation = await handleRocketLeagueProfileDelete(deleteRequest({}), makeEnv());
        assert.equal(missingConfirmation.status, 400);
        assert.equal((await missingConfirmation.json()).code, "CONFIRMATION_REQUIRED");

        const crossSite = await handleRocketLeagueProfileDelete(deleteRequest(undefined, { fetchSite: "cross-site" }), makeEnv());
        assert.equal(crossSite.status, 403);

        const signedOut = await handleRocketLeagueProfileDelete(deleteRequest(undefined, { cookie: false }), makeEnv({ authenticated: false }));
        assert.equal(signedOut.status, 401);
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("inactive accounts and wrong origins fail closed", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "inactive", accountActive: false,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(false);
        fetchCalls += 1;
        throw new Error("unexpected RPC");
    };
    try {
        const inactive = await handleRocketLeagueProfileDelete(deleteRequest(), makeEnv({ active: false }));
        assert.equal(inactive.status, 403);
        assert.equal((await inactive.json()).code, "ACCOUNT_ACCESS_RESTRICTED");

        const wrongOrigin = await handleRocketLeagueProfileDelete(deleteRequest(undefined, { origin: "https://attacker.example" }), makeEnv());
        assert.equal(wrongOrigin.status, 403);
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("known deletion errors are sanitized and unknown database details stay private", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        return Response.json({
        code: "P0001",
        message: "ROCKET_LEAGUE_PLAYER_NOT_FOUND",
        details: "private table detail"
    }, { status: 400 });
    };
    try {
        const known = await handleRocketLeagueProfileDelete(deleteRequest(), makeEnv());
        const knownBody = await known.json();
        assert.equal(known.status, 404);
        assert.equal(knownBody.code, "ROCKET_LEAGUE_PLAYER_NOT_FOUND");
        assert.equal(JSON.stringify(knownBody).includes("private table detail"), false);

        globalThis.fetch = async url => {
            if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
                suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
            if (String(url).endsWith("can_account_perform")) return Response.json(true);
            return Response.json({ message: "private database details" }, { status: 500 });
        };
        const unknown = await handleRocketLeagueProfileDelete(deleteRequest(), makeEnv());
        const unknownBody = await unknown.json();
        assert.equal(unknown.status, 503);
        assert.equal(unknownBody.code, "AUTH_SERVICE_UNAVAILABLE");
        assert.equal(JSON.stringify(unknownBody).includes("private database details"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("MyProfile warns about the destructive scope and enforces an acknowledged hold before recovery navigation", async () => {
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/HTML/index.html", import.meta.url), "utf8");
    const client = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const service = await readFile(new URL("../../functions/services/rl/delete_profile.js", import.meta.url), "utf8");
    const providerLink = await readFile(new URL("../../functions/services/auth/account/link_provider.js", import.meta.url), "utf8");
    const epicCallback = await readFile(new URL("../../functions/services/auth/providers/epic/callback.js", import.meta.url), "utf8");
    const { API_ROUTE_INVENTORY } = await import("../../functions/services/admin/generatedApiRouteInventory.js");
    assert.match(html, /Rocket League competition participation and notification\/alert records/);
    assert.match(html, /main BPD account and current sign-in remain/);
    assert.match(html, /If Epic is your only sign-in method/);
    assert.match(html, /Epic identity/);
    assert.match(client, /DELETE_HOLD_DURATION_MS = 3000/);
    assert.match(client, /method: "DELETE"/);
    assert.match(client, /refreshAuthState\(\{ force: true \}\)/);
    assert.match(client, /navigate\("\/RocketLeague", \{ replace: true \}\)/);
    assert.match(service, /Object\.keys\(input\)\.length !== 1/);
    assert.match(service, /JSON\.stringify\(\{ p_account_id: authorization\.accountId \}\)/);
    assert.equal(client.includes("accountId:", client.indexOf("async function deleteRocketLeagueProfile")), false);
    assert.match(providerLink, /existingProviderIdentity\s*\?\s*OAUTH_MODE_REAUTHORIZE\s*:\s*OAUTH_MODE_LINK/);
    assert.match(epicCallback, /"link_epic_identity"/);
    assert.ok(API_ROUTE_INVENTORY.find(route => route.path === "/api/auth/rocketleague/profile")?.methods.includes("DELETE"));
});
