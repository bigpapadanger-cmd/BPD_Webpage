import test from "node:test";
import assert from "node:assert/strict";
import {
    emitOcrNotificationEvent,
    listOcrNotificationEvents,
    resolveOcrReviewEvent
} from "../../functions/services/notifications/persistence.js";
import { mapOcrEventsToNotifications } from "../../functions/services/notifications/producers.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "ABCD1234EFGH5678";
const MATCH_ID = "8765HGFEDCBA4321";
const SECRET = "test-only-ocr-owner-secret";
const NOW = new Date("2026-10-08T12:00:00.000Z");
const env = { SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "server-only-test-key", OCR_OWNER_SECRET: SECRET };

function database() {
    const rows = [];
    const fetcher = async (input, init) => {
        const url = new URL(input);
        const rpc = url.pathname.split("/").at(-1);
        assert.equal(url.pathname, `/rest/v1/rpc/${rpc}`);
        assert.equal(init.headers["Content-Profile"], "api");
        assert.equal(init.headers.apikey, env.SUPABASE_AUTH);
        assert.equal(init.headers["Accept-Profile"], "api");
        assert.equal(init.redirect, "manual");
        const params = JSON.parse(init.body);
        if (rpc === "emit_ocr_notification_event") {
            let row = rows.find(item => item.account_id === params.p_account_id && item.source === "ocr"
                && item.event_type === params.p_event_type && item.dedupe_key === params.p_dedupe_key);
            if (row) return Response.json(row);
            row = { account_id: params.p_account_id, source: "ocr", event_type: params.p_event_type,
                dedupe_key: params.p_dedupe_key, source_public_code: params.p_source_public_code,
                occurred_at: params.p_occurred_at, resolved_at: null, expires_at: params.p_expires_at };
            rows.push(row);
            return Response.json(row);
        }
        if (rpc === "list_ocr_notification_events") {
            return Response.json(rows.filter(row => row.account_id === params.p_account_id && row.source === "ocr"));
        }
        if (rpc === "resolve_ocr_review_event") {
            const row = rows.find(item => item.account_id === params.p_account_id && item.source === "ocr"
                && item.event_type === "review_required" && item.dedupe_key === params.p_dedupe_key);
            if (row) row.resolved_at = params.p_resolved_at;
            return Response.json(row ?? null);
        }
        throw new Error(`Unexpected notification RPC: ${rpc}`);
    };
    return { rows, fetcher };
}

test("OCR events are idempotent, account-scoped, and dedupe without exposing job IDs", async () => {
    const db = database();
    const input = { accountId: ACCOUNT_A, jobId: JOB_ID, eventType: "review_required", sourcePublicCode: JOB_ID, occurredAt: NOW };
    const first = await emitOcrNotificationEvent(env, input, db.fetcher);
    const second = await emitOcrNotificationEvent(env, input, db.fetcher);
    assert.equal(db.rows.length, 1);
    assert.equal(first.dedupeKey, second.dedupeKey);
    assert.match(first.dedupeKey, /^ocr:review_required:[0-9a-f]{64}$/);
    assert.doesNotMatch(first.dedupeKey, new RegExp(JOB_ID));
    assert.equal(first.sourcePublicCode, JOB_ID);
    assert.equal((await listOcrNotificationEvents(env, ACCOUNT_B, db.fetcher)).length, 0);
});

test("failed and completed events get bounded retention; review events remain until resolved", async () => {
    const db = database();
    const review = await emitOcrNotificationEvent(env, { accountId: ACCOUNT_A, jobId: JOB_ID,
        eventType: "review_required", sourcePublicCode: MATCH_ID, occurredAt: NOW }, db.fetcher);
    const failed = await emitOcrNotificationEvent(env, { accountId: ACCOUNT_A, jobId: "1234567890ABCDEF",
        eventType: "failed", occurredAt: NOW }, db.fetcher);
    assert.equal(review.expiresAt, null);
    assert.equal(failed.expiresAt, new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
    const resolved = await resolveOcrReviewEvent(env, { accountId: ACCOUNT_A, jobId: JOB_ID, occurredAt: NOW }, db.fetcher);
    assert.equal(resolved.resolvedAt, NOW.toISOString());
    assert.equal((await listOcrNotificationEvents(env, ACCOUNT_A, db.fetcher)).find(row => row.eventType === "review_required").resolvedAt, NOW.toISOString());
});

test("event mapping uses fixed copy and never propagates event identifiers or payloads", () => {
    const events = [{ source: "ocr", eventType: "review_required", dedupeKey: `ocr:review_required:${"a".repeat(64)}`,
        sourcePublicCode: JOB_ID, occurredAt: NOW.toISOString(), resolvedAt: null, expiresAt: null,
        privatePayload: SECRET, accountId: ACCOUNT_A }];
    const [notice] = mapOcrEventsToNotifications(events, NOW);
    assert.equal(notice.reviewCode, JOB_ID);
    assert.equal(notice.reviewAction, "ocr.review");
    assert.equal(notice.title, "Scoreboard review required");
    assert.doesNotMatch(JSON.stringify(notice), new RegExp(`${ACCOUNT_A}|${SECRET}`));
    assert.deepEqual(mapOcrEventsToNotifications([{ ...events[0], resolvedAt: NOW.toISOString() }], NOW), []);
});

test("invalid job identifiers, event types and review codes fail before database access", async () => {
    const db = database();
    await assert.rejects(emitOcrNotificationEvent(env, { accountId: ACCOUNT_A, jobId: "not-a-job", eventType: "failed" }, db.fetcher));
    await assert.rejects(emitOcrNotificationEvent(env, { accountId: ACCOUNT_A, jobId: JOB_ID, eventType: "arbitrary" }, db.fetcher));
    await assert.rejects(emitOcrNotificationEvent(env, { accountId: ACCOUNT_A, jobId: JOB_ID, eventType: "review_required" }, db.fetcher));
    assert.equal(db.rows.length, 0);
});
