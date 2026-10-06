import assert from "node:assert/strict";
import test from "node:test";

import { getCanonicalAccount, handleAuthSession } from "../../functions/services/auth/account/get_session.js";
import { handleAccountMutation } from "../../functions/services/auth/account/mutations.js";
import { validateDisplayNameAppropriateness } from "../../functions/services/auth/account/display_name_validation.js";

const safeNames = ["PlayerOne", "mIxEd Case", "member_name", "member-name", "José", "abc", "A".repeat(32)];

for (const name of safeNames) {
    test(`display-name validator allows safe input (${name.length} chars)`, () => {
        assert.deepEqual(validateDisplayNameAppropriateness(name), { valid: true, displayName: name });
    });
}

test("display-name validator rejects exact, case-folded, separated, repeated, and leetspeak unsafe variants", () => {
    for (const name of ["motherfucker", "MOTHERFUCKER", "mother-fucker", "m o t h e r f u c k e r", "motherrrrfuckerrr", "m0th3rfuck3r"]) {
        assert.equal(validateDisplayNameAppropriateness(name).code, "DISPLAY_NAME_INAPPROPRIATE");
    }
});

test("long unsafe terms use only a one-character fuzzy allowance", () => {
    assert.equal(validateDisplayNameAppropriateness("motherfuker").code, "DISPLAY_NAME_INAPPROPRIATE");
});

test("short coincidental text and short near-matches are not fuzzily rejected", () => {
    for (const name of ["classy", "passage", "grape", "bitchy?", "ship", "shat"]) {
        assert.equal(validateDisplayNameAppropriateness(name).valid, true, name);
    }
});

test("reserved BPD and system impersonation variants receive the reserved-name code", () => {
    for (const name of ["BPD_Admin", "B.P.D Support", "BPD-Moderator", "System_Admin", "BPD-0fficial"]) {
        assert.equal(validateDisplayNameAppropriateness(name).code, "DISPLAY_NAME_RESERVED", name);
    }
});

test("server validator keeps required, length, and invalid-character checks", () => {
    assert.equal(validateDisplayNameAppropriateness("  ").code, "DISPLAY_NAME_REQUIRED");
    assert.equal(validateDisplayNameAppropriateness("ab").code, "DISPLAY_NAME_TOO_SHORT");
    assert.equal(validateDisplayNameAppropriateness("A".repeat(33)).code, "DISPLAY_NAME_TOO_LONG");
    assert.equal(validateDisplayNameAppropriateness("a\nb").code, "DISPLAY_NAME_INVALID");
});

function makeAuthenticatedSession() {
    const session = {
        SessionId: "session-1",
        AbsoluteExpiresAt: Date.now() + 60_000,
        LastSeenAt: Date.now(),
        UserId: "server-account-id",
        Active: true,
        Role: "user",
        Providers: { epic: { AccountId: "epic-subject", Linked: true, Authenticated: true } }
    };
    return {
        SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key",
        AUTH_SESSIONS: { async get(key) {
            if (key === "session:session-1") return session;
            if (key === "provider_auth_id:server-account-id:epic") return { accountId: "server-account-id", provider: "epic",
                connectedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
            if (key === "account_login_status:server-account-id") return { accountId: "server-account-id", lastLoginAt: new Date().toISOString(), providerReauthAfter: null };
            return null;
        }, async put() {} }
    };
}

function profileRequest(displayName, { authenticated = true } = {}) {
    return new Request("https://bpd-gaming-network.com/api/auth/account/profile", {
        method: "POST",
        headers: {
            origin: "https://bpd-gaming-network.com",
            "content-type": "application/json",
            ...(authenticated ? { cookie: "bpd_session=session-1" } : {})
        },
        body: JSON.stringify({ displayName })
    });
}

test("unauthenticated callers cannot use appropriateness validation as a name oracle", async () => {
    const originalFetch = globalThis.fetch;
    let mutationCalls = 0;
    globalThis.fetch = async url => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: false, active: false } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        if (String(url).endsWith("verify_account_provider_identity")) return Response.json([{ account_id: "server-account-id", provider: "epic", provider_subject: "epic-subject", active: true }]);
        if (String(url).endsWith("update_account_display_name")) mutationCalls += 1;
        throw new Error("unexpected fetch");
    };
    try {
        const response = await handleAccountMutation(profileRequest("mother-fucker", { authenticated: false }), makeAuthenticatedSession(), "profile");
        const body = await response.json();
        assert.equal(response.status, 401);
        assert.notEqual(body.code, "DISPLAY_NAME_INAPPROPRIATE");
        assert.equal(mutationCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("authenticated unsafe-name rejection happens before the Supabase mutation", async () => {
    const originalFetch = globalThis.fetch;
    let mutationCalls = 0;
    globalThis.fetch = async url => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: false, active: false } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        if (String(url).endsWith("verify_account_provider_identity")) return Response.json([{ account_id: "server-account-id", provider: "epic", provider_subject: "epic-subject", active: true }]);
        mutationCalls++;
        throw new Error("unexpected mutation");
    };
    try {
        const response = await handleAccountMutation(profileRequest("m0ther.fucker"), makeAuthenticatedSession(), "profile");
        const body = await response.json();
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(body.code, "DISPLAY_NAME_INAPPROPRIATE");
        assert.equal(body.message, "That display name isn't allowed. Please choose another name.");
        assert.equal(JSON.stringify(body).includes("motherfucker"), false);
        assert.equal(mutationCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("display-name mutation returns authoritative timestamps and derives account identity from session", async () => {
    const originalFetch = globalThis.fetch;
    const captured = {};
    const changedAt = "2026-10-02T16:00:00Z";
    const availableAt = "2026-11-01T16:00:00Z";
    globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: false, active: false } });
        if (String(url).endsWith("can_account_perform")) return Response.json(true);
        if (String(url).endsWith("verify_account_provider_identity")) return Response.json([{ account_id: "server-account-id", provider: "epic", provider_subject: "epic-subject", active: true }]);
        captured.url = String(url);
        captured.body = JSON.parse(options.body);
        return Response.json({ accountId: "server-account-id", displayName: "Player Name", displayNameChangedAt: changedAt, displayNameChangeAvailableAt: availableAt });
    };
    try {
        const response = await handleAccountMutation(profileRequest("Player Name"), {
            ...makeAuthenticatedSession()
        }, "profile");
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.displayNameChangedAt, changedAt);
        assert.equal(body.displayNameChangeAvailableAt, availableAt);
        assert.equal(captured.url, "https://supabase.example/rest/v1/rpc/update_account_display_name");
        assert.deepEqual(captured.body, { p_account_id: "server-account-id", p_display_name: "Player Name" });
        assert.equal(Object.hasOwn(captured.body, "accountId"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("malformed mutation cooldown metadata is not returned as a successful no-cooldown response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
        accountId: "server-account-id", displayName: "Player Name",
        displayNameChangedAt: "1", displayNameChangeAvailableAt: "not-a-timestamp"
    });
    try {
        const response = await handleAccountMutation(profileRequest("Player Name"), {
            ...makeAuthenticatedSession(), SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key"
        }, "profile");
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.code, "AUTH_SERVICE_UNAVAILABLE");
        assert.equal(Object.hasOwn(body, "displayNameChangeAvailableAt"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("private session account normalizes authoritative cooldown fields and preserves explicit null", async () => {
    const originalFetch = globalThis.fetch;
    const changedAt = "2026-10-02T16:00:00Z";
    globalThis.fetch = async () => Response.json([{
        id: "account-1", display_name: "Player", role: "user", active: true,
        display_name_changed_at: changedAt, display_name_change_available_at: null,
        private_email: "must-not-escape"
    }]);
    try {
        const account = await getCanonicalAccount({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key" }, "account-1");
        assert.deepEqual(account, {
            userId: "account-1", displayName: "Player", displayNameChangedAt: Date.parse(changedAt),
            displayNameChangeAvailableAt: null, role: "user", active: true
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("private session mapping omits unknown cooldown fields instead of inventing timestamps", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json([{ id: "account-1", display_name: "Player", role: "user", active: true }]);
    try {
        const account = await getCanonicalAccount({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key" }, "account-1");
        assert.equal(Object.hasOwn(account, "displayNameChangedAt"), false);
        assert.equal(Object.hasOwn(account, "displayNameChangeAvailableAt"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("private session mapping omits malformed timestamps rather than turning them into an explicit no-cooldown value", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json([{
        id: "account-1", display_name: "Player", role: "user", active: true,
        display_name_changed_at: "1", display_name_change_available_at: "not-a-timestamp"
    }]);
    try {
        const account = await getCanonicalAccount({ SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key" }, "account-1");
        assert.equal(Object.hasOwn(account, "displayNameChangedAt"), false);
        assert.equal(Object.hasOwn(account, "displayNameChangeAvailableAt"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("authenticated session endpoint carries only the normalized display-name cooldown fields", async () => {
    const originalFetch = globalThis.fetch;
    const changedAt = "2026-10-02T16:00:00Z";
    const availableAt = "2026-11-01T16:00:00Z";
    globalThis.fetch = async url => String(url).includes("rpc/get_account_session_identity")
        ? Response.json([{ id: "server-account-id", display_name: "Player", role: "user", active: true,
            display_name_changed_at: changedAt, display_name_change_available_at: availableAt }])
        : String(url).endsWith("get_account_access_state")
            ? Response.json({ exists: true, state: "active", accountActive: true, suspended: false, suspendedUntil: null,
                banned: false, removed: false, rocketLeague: { exists: false, active: false } })
            : String(url).endsWith("can_account_perform") ? Response.json(true)
        : Response.json([]);
    try {
        const response = await handleAuthSession(new Request("https://bpd-gaming-network.com/api/auth/session", {
            headers: { cookie: "bpd_session=session-1" }
        }), {
            ...makeAuthenticatedSession(), SUPABASE_URL: "https://supabase.example", SUPABASE_AUTH: "server-key"
        });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.user.displayName, "Player");
        assert.equal(body.user.displayNameChangedAt, Date.parse(changedAt));
        assert.equal(body.user.displayNameChangeAvailableAt, Date.parse(availableAt));
        assert.deepEqual(Object.keys(body.user).sort(), ["active", "access", "displayName", "displayNameChangeAvailableAt", "displayNameChangedAt", "role", "userId"].sort());
        assert.equal(body.user.access.state, "active");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
