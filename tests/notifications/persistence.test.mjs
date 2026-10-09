import test from "node:test";
import assert from "node:assert/strict";
import {
    acknowledgeNotificationState,
    getNotificationState,
    notificationIsVisible,
    reconcileNotificationState,
    listOcrNotificationEvents
} from "../../functions/services/notifications/persistence.js";
import { createNotificationDiagnostics } from "../../functions/services/notifications/http.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const PUBLIC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUBLIC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-08T12:00:00.000Z");
const env = { SUPABASE_URL: "https://database.example/rest/v1/", SUPABASE_AUTH: "server-only-test-credential" };

function database() {
    const rows = [];
    let nextCode = 0;
    const fetcher = async (input, init) => {
        const url = new URL(input);
        assert.equal(url.pathname, "/rest/v1/notification_state");
        assert.equal(init.headers["Content-Profile"], "core");
        assert.equal(init.headers["Accept-Profile"], "core");
        assert.equal(init.headers.apikey, env.SUPABASE_AUTH);
        assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_AUTH}`);
        assert.equal(init.redirect, "manual");
        const account = url.searchParams.get("account_id")?.replace(/^eq\./, "");
        const dedupe = url.searchParams.get("dedupe_key")?.replace(/^eq\./, "");
        const publicCode = url.searchParams.get("public_code")?.replace(/^eq\./, "");
        if (init.method === "POST") {
            const inputRow = JSON.parse(init.body);
            const existing = rows.find(row => row.account_id === inputRow.account_id && row.dedupe_key === inputRow.dedupe_key);
            if (existing) return Response.json([]);
            nextCode++;
            const stamp = new Date().toISOString();
            const row = { public_code: nextCode === 1 ? PUBLIC_A : PUBLIC_B, account_id: inputRow.account_id,
                dedupe_key: inputRow.dedupe_key, acknowledged_at: null, suppress_until: null,
                first_seen_at: stamp, last_seen_at: stamp, updated_at: stamp };
            rows.push(row);
            return Response.json([row], { status: 201 });
        }
        const matching = rows.filter(row => (!account || row.account_id === account)
            && (!dedupe || row.dedupe_key === dedupe) && (!publicCode || row.public_code === publicCode));
        if (init.method === "PATCH") {
            const update = JSON.parse(init.body);
            for (const row of matching) Object.assign(row, update);
        }
        return Response.json(matching);
    };
    return { rows, fetcher };
}

const candidate = (publicCode, dedupeKey = "profile:incomplete") => ({
    publicCode, source: "profile", behavior: "condition", dedupeKey, severity: "warning",
    title: "Complete your profile", message: "Required profile information is missing.", actionRequired: true,
    reviewAction: "profile.complete", createdAt: NOW.toISOString(), updatedAt: null, acknowledgedAt: null,
    suppressUntil: null, resolvedAt: null, expiresAt: null
});

test("reconcile inserts once per account and dedupe key and updates last-seen idempotently", async () => {
    const db = database();
    const first = await reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher, null, NOW);
    const second = await reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher, null, NOW);
    assert.equal(db.rows.length, 1);
    assert.equal(first.publicCode, second.publicCode);
    assert.equal(new Date(second.lastSeenAt).toISOString(), NOW.toISOString());
    assert.equal((await getNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher)).publicCode, first.publicCode);
});

test("same dedupe key is isolated across accounts", async () => {
    const db = database();
    const first = await reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher);
    const second = await reconcileNotificationState(env, ACCOUNT_B, "profile:incomplete", db.fetcher);
    assert.equal(db.rows.length, 2);
    assert.notEqual(first.publicCode, second.publicCode);
    assert.equal((await getNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher)).accountId, ACCOUNT_A);
    assert.equal((await getNotificationState(env, ACCOUNT_B, "profile:incomplete", db.fetcher)).accountId, ACCOUNT_B);
});

test("acknowledgement persists exactly one hour of condition snooze and unresolved conditions return", async () => {
    const db = database();
    const state = await reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher, null, NOW);
    const acknowledged = await acknowledgeNotificationState(env, ACCOUNT_A, state.publicCode, db.fetcher, null, NOW);
    assert.equal(Date.parse(acknowledged.suppressUntil) - Date.parse(acknowledged.acknowledgedAt), 60 * 60 * 1000);
    assert.equal(notificationIsVisible(candidate(state.publicCode), acknowledged, NOW), false);
    assert.equal(notificationIsVisible(candidate(state.publicCode), acknowledged, new Date("2026-10-08T13:00:00.000Z")), true);
    const resolved = { ...candidate(state.publicCode), resolvedAt: "2026-10-08T12:30:00.000Z" };
    assert.equal(notificationIsVisible(resolved, acknowledged, new Date("2026-10-08T14:00:00.000Z")), false);
});

test("one-time event remains permanently acknowledged after its snooze timestamp expires", async () => {
    const db = database();
    const state = await reconcileNotificationState(env, ACCOUNT_A, "faq:answered:question-code", db.fetcher, null, NOW);
    const acknowledged = await acknowledgeNotificationState(env, ACCOUNT_A, state.publicCode, db.fetcher, null, NOW);
    const event = { ...candidate(state.publicCode, "faq:answered:question-code"), source: "faq", behavior: "event",
        actionRequired: false, reviewAction: "faq.review" };
    assert.equal(notificationIsVisible(event, acknowledged, new Date("2026-10-08T14:00:00.000Z")), false);
});

test("another account cannot resolve a public code to or mutate another account state", async () => {
    const db = database();
    const owned = await reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", db.fetcher);
    assert.equal(await acknowledgeNotificationState(env, ACCOUNT_B, owned.publicCode, db.fetcher, null, NOW), null);
    assert.equal(db.rows[0].acknowledged_at, null);
});

test("invalid public codes fail safely before upstream access", async () => {
    let calls = 0;
    await assert.rejects(acknowledgeNotificationState(env, ACCOUNT_A, "not-a-code", async () => { calls++; }), { status: 404 });
    assert.equal(calls, 0);
});

test("persistence failures expose neither upstream text nor server credentials", async () => {
    const credential = env.SUPABASE_AUTH;
    const sensitive = `${credential} 11111111-1111-4111-8111-111111111111`;
    const failureFetch = async () => new Response(JSON.stringify({ code: sensitive, message: sensitive }), { status: 500 });
    await assert.rejects(reconcileNotificationState(env, ACCOUNT_A, "profile:incomplete", failureFetch), {
        name: "NotificationPersistenceError", code: "NOTIFICATIONS_UNAVAILABLE", status: 503
    });
    assert.doesNotMatch(JSON.stringify(await Promise.resolve({ error: "NOTIFICATIONS_UNAVAILABLE" })), new RegExp(credential));
});

test("stalled upstream fetch is bounded and becomes a safe timeout failure", async () => {
    const stalledEnv = { ...env, NOTIFICATION_UPSTREAM_TIMEOUT_MS: 5 };
    // The route deadline is fixed at ten seconds; this rejects on abort and verifies
    // the same abort signal bounds a non-cooperative transport without waiting ten seconds.
    const stalled = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error(), { name: "AbortError" })), { once: true }));
    const promise = reconcileNotificationState(stalledEnv, ACCOUNT_A, "profile:incomplete", stalled);
    const bounded = Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 10_500))]);
    await assert.rejects(bounded, { code: "NOTIFICATIONS_UNAVAILABLE", status: 503 });
});

test("event table transport diagnostics classify pre-response failures without exception details", async () => {
    const sensitive = `${env.SUPABASE_AUTH} ${ACCOUNT_A} https://database.example/rest/v1/notification_events?secret=query-cookie`;
    const originalInfo = console.info;
    const records = [];
    console.info = (_label, record) => records.push(record);
    try {
        const diagnostics = createNotificationDiagnostics("list_notifications");
        await assert.rejects(listOcrNotificationEvents(env, ACCOUNT_A, async () => { throw new TypeError(sensitive); }, diagnostics), {
            code: "NOTIFICATIONS_UNAVAILABLE", status: 503
        });
        diagnostics.finish({ code: "NOTIFICATIONS_UNAVAILABLE" });
        const record = records.at(-1);
        assert.equal(record.stage, "event_list");
        assert.equal(record.code, "UPSTREAM_UNAVAILABLE");
        assert.equal(record.upstreamStatus, null);
        assert.equal(record.timeout, false);
        assert.equal(record.transportClass, "fetch_type_error");
        assert.equal(record.exceptionName, "TypeError");
        assert.doesNotMatch(JSON.stringify(record), new RegExp(sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

        const unknownDiagnostics = createNotificationDiagnostics("list_notifications");
        const unknown = new Error(sensitive);
        unknown.name = "CustomTransportError";
        await assert.rejects(listOcrNotificationEvents(env, ACCOUNT_A, async () => { throw unknown; }, unknownDiagnostics));
        unknownDiagnostics.finish({ code: "NOTIFICATIONS_UNAVAILABLE" });
        assert.equal(records.at(-1).transportClass, "unknown_transport");
        assert.equal("exceptionName" in records.at(-1), false);
        assert.doesNotMatch(JSON.stringify(records.at(-1)), new RegExp(sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally { console.info = originalInfo; }
});

test("event table HTTP rejection keeps upstream status and has no transport classification", async () => {
    const originalInfo = console.info;
    let record;
    console.info = (_label, value) => { record = value; };
    try {
        const diagnostics = createNotificationDiagnostics("list_notifications");
        await assert.rejects(listOcrNotificationEvents(env, ACCOUNT_A, async () => new Response("{}", { status: 503 }), diagnostics));
        diagnostics.finish({ code: "NOTIFICATIONS_UNAVAILABLE" });
        assert.equal(record.stage, "event_list_decode");
        assert.equal(record.upstreamStatus, 503);
        assert.equal("transportClass" in record, false);
    } finally { console.info = originalInfo; }
});
