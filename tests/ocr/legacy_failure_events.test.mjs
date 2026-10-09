import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createLegacyFailureJobId, handleOCRRequest } from "../../functions/services/ocr/handler.js";
import { sanitizeJobResponse } from "../../functions/api/ocr/jobs/get_job.js";
import { emitOcrNotificationEvent } from "../../functions/services/notifications/persistence.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "local-test-only-ocr-owner-secret";

test("legacy failure dedupe identity is stable per account and UUID Idempotency-Key", async () => {
    const key = "00000000-0000-4000-8000-000000000001";
    const first = await createLegacyFailureJobId(ACCOUNT_ID, SECRET, key);
    const replay = await createLegacyFailureJobId(ACCOUNT_ID, SECRET, key);
    const otherAccount = await createLegacyFailureJobId("22222222-2222-4222-8222-222222222222", SECRET, key);
    const distinctRequest = await createLegacyFailureJobId(ACCOUNT_ID, SECRET, "00000000-0000-4000-8000-000000000002");
    assert.match(first, /^[A-F0-9]{16}$/);
    assert.equal(replay, first);
    assert.notEqual(otherAccount, first);
    assert.notEqual(distinctRequest, first);
    await assert.rejects(createLegacyFailureJobId(ACCOUNT_ID, SECRET, "bad value"), TypeError);
});

test("legacy route rejects missing or malformed idempotency keys before authentication or OCR", async () => {
    for (const [headers, code] of [
        [{}, "IDEMPOTENCY_KEY_REQUIRED"],
        [{ "Idempotency-Key": "bad value" }, "IDEMPOTENCY_KEY_INVALID"]
    ]) {
        const response = await handleOCRRequest(new Request("https://example.test/api/ocr", { method: "POST", headers } ), {});
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, code);
    }
});

test("retrying a logical legacy failure with the same key inserts one durable event", async () => {
    const key = "00000000-0000-4000-8000-000000000003";
    const jobId = await createLegacyFailureJobId(ACCOUNT_ID, SECRET, key);
    const env = { OCR_OWNER_SECRET: SECRET, SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "test-server-key" };
    let row = null;
    const writes = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        writes.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : null });
        if (init.method === "POST") {
            if (!row) {
                row = { account_id: ACCOUNT_ID, source: "ocr", event_type: "failed", dedupe_key: JSON.parse(init.body).dedupe_key,
                    source_public_code: null, occurred_at: "2026-10-08T00:00:00.000Z", resolved_at: null, expires_at: "2026-11-07T00:00:00.000Z" };
                return Response.json([row], { status: 201 });
            }
            return Response.json([], { status: 201 });
        }
        return Response.json([row]);
    };
    try {
        const first = await emitOcrNotificationEvent(env, { accountId: ACCOUNT_ID, jobId, eventType: "failed" });
        const replay = await emitOcrNotificationEvent(env, { accountId: ACCOUNT_ID, jobId, eventType: "failed" });
        assert.equal(first.dedupeKey, replay.dedupeKey);
        assert.equal(writes.filter(write => write.method === "POST").length, 2);
        assert.equal(writes.filter(write => write.method === "GET").length, 1);
        assert.equal(writes[0].body.account_id, ACCOUNT_ID);
        assert.equal(writes[0].body.event_type, "failed");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("legacy synchronous handler emits a failed event only after an authenticated upstream attempt", async () => {
    const source = await readFile(new URL("../../functions/services/ocr/handler.js", import.meta.url), "utf8");
    assert.match(source, /if \(!ocrResponse\.ok \|\| result\?\.success === false\)\s*\{\s*await persistLegacyFailureEvent/);
    assert.match(source, /if \(upstreamAttemptStarted && authenticatedAccountId && terminalFailureJobId\)/);
    assert.match(source, /emitOcrNotificationEvent\(env, \{ accountId, jobId, eventType: "failed" \}\)/);
});

test("no-match job reader and route preserve an owner-checked review state without a fabricated match ID", async () => {
    const job = sanitizeJobResponse({ jobId: "ABCD1234EFGH5678", status: "completed", disposition: "needs_review",
        reviewRequired: true, confirmationStatus: "pending_review", matchId: null,
        reviewObjectKey: "private/path", accountId: ACCOUNT_ID, ownerId: "private-owner-hash" });
    assert.equal(job.reviewRequired, true);
    assert.equal(job.matchId, null);
    assert.equal(Object.hasOwn(job, "reviewObjectKey"), false);
    assert.equal(Object.hasOwn(job, "accountId"), false);
    assert.equal(Object.hasOwn(job, "ownerId"), false);

    const runtime = await readFile(new URL("../../public/Framework/Shell/JS/ocr_runtime.js", import.meta.url), "utf8");
    assert.match(runtime, /job\?\.reviewRequired !== true/);
    assert.match(runtime, /if \(!OCR_JOB_ID\.test\(matchId\)\)/);
    assert.match(runtime, /imageInput/);
    assert.match(runtime, /never invent a match ID/);
});
