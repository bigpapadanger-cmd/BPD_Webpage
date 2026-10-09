import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/notifications/index.js";
import { onRequestPost as acknowledge } from "../../functions/api/notifications/[publicCode]/acknowledge.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const PUBLIC_CODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "server-only-notification-credential";

function envFor(accountId = ACCOUNT_A, authRecords = {}) {
    const now = Date.now();
    return {
        SUPABASE_URL: "https://database.example",
        SUPABASE_SERVICE_ROLE_KEY: SECRET,
        SUPABASE_AUTH: "fallback-credential-must-not-be-used",
        AUTH_SESSIONS: { async get(key) {
            if (key === "session:valid-session") return { UserId: accountId, Active: true, Role: "user", LastSeenAt: now, AbsoluteExpiresAt: now + 60_000 };
            return authRecords[key] || null;
        }, async put() {} }
    };
}

function accessState() {
    return Response.json({ exists: true, state: "active", accountActive: true, suspended: false, suspendedUntil: null,
        banned: false, removed: false, rocketLeague: { exists: false, active: false } });
}

function inMemoryFetch(rows = [], { tableFailure = false,
    enforcementResult = { success: true, active: false, enforcement: null, capturedAt: new Date().toISOString() },
    enforcementResponse = null, profile = null, identity = [], eventRows = [] } = {}) {
    const writes = [];
    const rpcCalls = [];
    const fetcher = async (input, init) => {
        const url = new URL(input);
        if (url.pathname.includes("/rpc/")) rpcCalls.push({ url, init });
        if (url.pathname.endsWith("/get_account_access_state")) return accessState();
        if (url.pathname.endsWith("/can_account_perform")) return Response.json(true);
        if (url.pathname.endsWith("/get_account_enforcement_state")) return enforcementResponse || Response.json(enforcementResult);
        if (url.pathname.endsWith("/get_rocketleague_profile_v2")) return Response.json(profile);
        if (url.pathname.endsWith("/verify_account_provider_identity")) return Response.json(identity);
        const rpc = url.pathname.split("/").at(-1);
        if (!rpc || !["get_notification_state", "reconcile_notification_state", "acknowledge_notification_state",
            "list_notification_states", "list_ocr_notification_events"].includes(rpc)) {
            throw new Error(`Unexpected upstream path: ${url.pathname}`);
        }
        const params = JSON.parse(init.body);
        if (rpc === "list_ocr_notification_events") return Response.json(eventRows.filter(row => row.account_id === params.p_account_id));
        if (tableFailure) return new Response(JSON.stringify({ code: SECRET, message: SECRET }), { status: 500 });
        if (rpc === "reconcile_notification_state") {
            writes.push({ rpc, url, init, params });
            let row = rows.find(item => item.account_id === params.p_account_id && item.dedupe_key === params.p_dedupe_key);
            if (!row) {
                row = { public_code: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", account_id: params.p_account_id,
                    dedupe_key: params.p_dedupe_key, acknowledged_at: null, suppress_until: null,
                    first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                rows.push(row);
            }
            row.last_seen_at = params.p_last_seen_at;
            return Response.json(row);
        }
        if (rpc === "get_notification_state") {
            return Response.json(rows.find(item => item.account_id === params.p_account_id && item.dedupe_key === params.p_dedupe_key) ?? null);
        }
        if (rpc === "acknowledge_notification_state") {
            writes.push({ rpc, url, init, params });
            const row = rows.find(item => item.account_id === params.p_account_id && item.public_code === params.p_public_code);
            if (row) Object.assign(row, { acknowledged_at: params.p_acknowledged_at, suppress_until: params.p_suppress_until, updated_at: params.p_acknowledged_at });
            return Response.json(row ?? null);
        }
        if (rpc === "list_notification_states") return Response.json(rows.filter(item => item.account_id === params.p_account_id));
    };
    return { fetcher, writes, rpcCalls };
}

async function withGlobalFetch(fetcher, callback) {
    const previous = globalThis.fetch;
    globalThis.fetch = fetcher;
    try { return await callback(); }
    finally { globalThis.fetch = previous; }
}

test("logged-out notification list is rejected and remains no-store", async () => {
    const { fetcher } = inMemoryFetch();
    const result = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications"), env: envFor()
    }));
    assert.equal(result.status, 401);
    assert.equal(result.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal((await result.json()).error, "AUTHENTICATION_REQUIRED");
});

test("authenticated GET derives identity from session, emits only condition notices and hides source identifiers", async () => {
    const { fetcher, writes } = inMemoryFetch();
    const result = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.match(result.headers.get("X-Debug-ID"), /^[0-9a-f-]{36}$/i);
    assert.equal(body.success, true);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].reviewAction, "profile.complete");
    assert.equal(body.notifications[0].publicCode, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${ACCOUNT_A}|profile:incomplete`));
    assert.ok(writes.some(write => write.rpc === "reconcile_notification_state"), "condition state is reconciled through the api RPC");
});

test("authenticated GET maps durable OCR review events to a safe owner-checked job handoff", async () => {
    const jobId = "ABCD1234EFGH5678";
    const eventRows = [{ account_id: ACCOUNT_A, source: "ocr", event_type: "review_required",
        dedupe_key: `ocr:review_required:${"a".repeat(64)}`, source_public_code: jobId,
        occurred_at: new Date().toISOString(), resolved_at: null, expires_at: null }];
    const { fetcher } = inMemoryFetch([], { eventRows,
        profile: { account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true } });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].source, "ocr");
    assert.equal(body.notifications[0].reviewCode, jobId);
    assert.equal(body.notifications[0].actionRequired, true);
    assert.match(body.notifications[0].publicCode, /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${ACCOUNT_A}|${SECRET}|${eventRows[0].dedupe_key}`));
});

test("notification session path evaluates producers without a second account-access gate", async () => {
    const calls = [];
    const { fetcher } = inMemoryFetch();
    const response = await withGlobalFetch(async (input, init) => { calls.push(new URL(input).pathname); return fetcher(input, init); }, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor(ACCOUNT_B)
    }));
    assert.equal(response.status, 200);
    assert.ok(calls.includes("/rest/v1/rpc/get_account_enforcement_state"));
    assert.ok(!calls.includes("/rest/v1/rpc/get_account_access_state"));
});

test("active moderation uses only safe fields and hides the source enforcement code", async () => {
    const sourceCode = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const enforcement = { publicCode: sourceCode, type: "suspension", startsAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(), userMessage: "Please contact support.", createdAt: new Date().toISOString(),
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", account_id: ACCOUNT_A, reason: SECRET, internal_note: SECRET, created_by: ACCOUNT_A, lifted_by: ACCOUNT_B };
    const rows = [];
    const { fetcher, writes, rpcCalls } = inMemoryFetch(rows, { enforcementResult: {
        success: true, active: true, enforcement, capturedAt: new Date().toISOString()
    }, profile: {
        account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true
    } });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.notifications.length, 1);
    assert.deepEqual({ source: body.notifications[0].source, action: body.notifications[0].reviewAction,
        title: body.notifications[0].title, message: body.notifications[0].message },
    { source: "account", action: "account.status", title: "Account suspended", message: "Please contact support." });
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${sourceCode}|${ACCOUNT_A}|${ACCOUNT_B}|${SECRET}|internal_note|created_by|lifted_by`));
    const rpc = rpcCalls.find(write => write.url.pathname.endsWith("get_account_enforcement_state"));
    assert.equal(JSON.parse(rpc.init.body).p_account_id, ACCOUNT_A);
    assert.equal(rows[0].dedupe_key.startsWith("account:moderation:"), true);
    assert.doesNotMatch(rows[0].dedupe_key, /[0-9a-f]{8}-[0-9a-f]{4}/i);
});

test("active=false with enforcement=null emits no moderation notification", async () => {
    const rows = [];
    const { fetcher } = inMemoryFetch(rows, {
        enforcementResult: { success: true, active: false, enforcement: null, capturedAt: new Date().toISOString() },
        profile: { account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true }
    });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    assert.deepEqual((await response.json()).notifications, []);
    assert.equal(rows.length, 0, "no active enforcement creates no moderation notification state");
});

test("an expired enforcement returned by the RPC is not emitted", async () => {
    const rows = [];
    const { fetcher } = inMemoryFetch(rows, {
        enforcementResult: { success: true, active: true, enforcement: { publicCode: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            type: "ban", startsAt: new Date(Date.now() - 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(),
            userMessage: null, createdAt: new Date(Date.now() - 86_400_000).toISOString() }, capturedAt: new Date().toISOString() },
        profile: { account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true }
    });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    assert.deepEqual((await response.json()).notifications, []);
    assert.equal(rows.length, 0);
});

test("malformed moderation JSONB envelopes fail safely instead of hiding an enforcement", async t => {
    const active = { publicCode: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", type: "removal",
        startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: null, userMessage: null, createdAt: new Date().toISOString() };
    const cases = [
        ["active true with null enforcement", { success: true, active: true, enforcement: null, capturedAt: new Date().toISOString() }],
        ["inactive with enforcement object", { success: true, active: false, enforcement: active, capturedAt: new Date().toISOString() }],
        ["missing success flag", { active: false, enforcement: null, capturedAt: new Date().toISOString() }],
        ["row array instead of object", [{ success: true, active: false, enforcement: null, capturedAt: new Date().toISOString() }]]
    ];
    for (const [name, enforcementResult] of cases) await t.test(name, async () => {
        const { fetcher } = inMemoryFetch([], { enforcementResult, profile: {
            account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true
        } });
        const response = await withGlobalFetch(fetcher, () => onRequestGet({
            request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
        }));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { success: false, error: "NOTIFICATIONS_UNAVAILABLE" });
    });
    await t.test("malformed JSON body", async () => {
        const { fetcher } = inMemoryFetch([], { enforcementResponse: new Response("{", { status: 200 }), profile: {
            account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true
        } });
        const response = await withGlobalFetch(fetcher, () => onRequestGet({
            request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
        }));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { success: false, error: "NOTIFICATIONS_UNAVAILABLE" });
    });
});

test("linked Epic identity with stale authorization produces Reauthorize semantics only", async () => {
    const { fetcher } = inMemoryFetch([], { profile: {
        account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true
    }, identity: [{ account_id: ACCOUNT_A, provider: "epic", provider_subject: "private-provider-subject", active: true }] });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor()
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].reviewAction, "provider.reauthorize");
    assert.match(body.notifications[0].message, /still linked.*Reauthorize/i);
    assert.doesNotMatch(JSON.stringify(body), /Connect Epic|private-provider-subject|provider_subject/i);
});

test("fresh authorization for a permanently linked Epic account produces no reauthorization notice", async () => {
    const now = Date.now();
    const authRecords = {
        [`provider_auth_id:${ACCOUNT_A}:epic`]: { accountId: ACCOUNT_A, provider: "epic",
            connectedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString() },
        [`account_login_status:${ACCOUNT_A}`]: { accountId: ACCOUNT_A, lastLoginAt: new Date(now - 30_000).toISOString(), providerReauthAfter: null }
    };
    const { fetcher } = inMemoryFetch([], { profile: {
        account_id: ACCOUNT_A, rl_player_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registration_status: "complete", active: true
    }, identity: [{ account_id: ACCOUNT_A, provider: "epic", provider_subject: "private-provider-subject", active: true }] });
    const response = await withGlobalFetch(fetcher, () => onRequestGet({
        request: new Request("https://bpd.example/api/notifications", { headers: { Cookie: "bpd_session=valid-session" } }), env: envFor(ACCOUNT_A, authRecords)
    }));
    assert.deepEqual((await response.json()).notifications, []);
});

test("acknowledgement ignores browser account targeting and scopes update to session account + public code", async () => {
    const row = { public_code: PUBLIC_CODE, account_id: ACCOUNT_A, dedupe_key: "profile:incomplete", acknowledged_at: null,
        suppress_until: null, first_seen_at: "2026-10-08T12:00:00Z", last_seen_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z" };
    const { fetcher, writes } = inMemoryFetch([row]);
    const response = await withGlobalFetch(fetcher, () => acknowledge({
        request: new Request(`https://bpd.example/api/notifications/${PUBLIC_CODE}/acknowledge?account_id=${ACCOUNT_B}`, {
            method: "POST", headers: { Cookie: "bpd_session=valid-session", Origin: "https://bpd.example", "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: ACCOUNT_B, userId: ACCOUNT_B })
        }), env: envFor(), params: { publicCode: PUBLIC_CODE }
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, acknowledged: true });
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].rpc, "acknowledge_notification_state");
    assert.equal(writes[0].params.p_account_id, ACCOUNT_A);
    assert.equal(writes[0].params.p_public_code, PUBLIC_CODE);
    assert.equal(Date.parse(row.suppress_until) - Date.parse(row.acknowledged_at), 60 * 60 * 1000);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${ACCOUNT_A}|${ACCOUNT_B}|${SECRET}`));
});

test("public code owned by another account returns not found without revealing ownership", async () => {
    const row = { public_code: PUBLIC_CODE, account_id: ACCOUNT_A, dedupe_key: "profile:incomplete", acknowledged_at: null,
        suppress_until: null, first_seen_at: "2026-10-08T12:00:00Z", last_seen_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z" };
    const { fetcher, writes } = inMemoryFetch([row]);
    const response = await withGlobalFetch(fetcher, () => acknowledge({
        request: new Request(`https://bpd.example/api/notifications/${PUBLIC_CODE}/acknowledge`, {
            method: "POST", headers: { Cookie: "bpd_session=valid-session", Origin: "https://bpd.example" }
        }), env: envFor(ACCOUNT_B), params: { publicCode: PUBLIC_CODE }
    }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, error: "NOTIFICATION_NOT_FOUND" });
    assert.equal(writes[0].params.p_account_id, ACCOUNT_B);
    assert.equal(row.acknowledged_at, null);
});

test("invalid public code is safely rejected without a state write", async () => {
    const { fetcher, writes } = inMemoryFetch();
    const response = await withGlobalFetch(fetcher, () => acknowledge({
        request: new Request("https://bpd.example/api/notifications/not-a-code/acknowledge", {
            method: "POST", headers: { Cookie: "bpd_session=valid-session", Origin: "https://bpd.example" }
        }), env: envFor(), params: { publicCode: "not-a-code" }
    }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, error: "NOTIFICATION_NOT_FOUND" });
    assert.equal(writes.length, 0);
});

test("cross-site acknowledgement is rejected before authentication or persistence", async () => {
    const { fetcher, writes } = inMemoryFetch();
    const response = await withGlobalFetch(fetcher, () => acknowledge({
        request: new Request(`https://bpd.example/api/notifications/${PUBLIC_CODE}/acknowledge`, {
            method: "POST", headers: { Cookie: "bpd_session=valid-session", Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }
        }), env: envFor(), params: { publicCode: PUBLIC_CODE }
    }));
    assert.equal(response.status, 403);
    assert.equal(writes.length, 0);
});

test("persistence error returns sanitized no-store response and sanitized correlated logs", async () => {
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args);
    try {
        const { fetcher } = inMemoryFetch([], { tableFailure: true });
        const response = await withGlobalFetch(fetcher, () => acknowledge({
            request: new Request(`https://bpd.example/api/notifications/${PUBLIC_CODE}/acknowledge`, {
                method: "POST", headers: { Cookie: "bpd_session=valid-session", Origin: "https://bpd.example" }
            }), env: envFor(), params: { publicCode: PUBLIC_CODE }
        }));
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
        assert.deepEqual(body, { success: false, error: "NOTIFICATIONS_UNAVAILABLE" });
        assert.match(response.headers.get("X-Debug-ID"), /^[0-9a-f-]{36}$/i);
        assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${ACCOUNT_A}|${SECRET}|fallback-credential-must-not-be-used`));
    } finally { console.info = originalInfo; }
});
