import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/ocr/jobs/process_job.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "ABCD1234EFGH5678";
const OWNER_SECRET = "test-only-owner-secret";
const PROCESS_TOKEN = "test-only-process-token";

async function ownerHash(accountId) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(OWNER_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accountId));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function statusBucket(status) {
    return { async get(key) { return key === `ocr-jobs/${JOB_ID}/status.json` ? { async json() { return status; } } : null; } };
}

test("internal OCR processing validates queue owner against stored HMAC and retries terminal event persistence", async () => {
    const status = { jobId: JOB_ID, ownerId: await ownerHash(ACCOUNT_ID), status: "completed", completedAt: "2026-10-08T12:00:00.000Z",
        requiresPlayerReview: true, reviewRequired: true, confirmationStatus: "pending_review" };
    const writes = [];
    const env = { OCR_STORAGE: statusBucket(status), OCR_OWNER_SECRET: OWNER_SECRET, OCR_JOB_PROCESS_SECURE_TOKEN: PROCESS_TOKEN,
        SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "test-server-key" };
    const validRequest = new Request("https://example.test/api/ocr/jobs/process_job", {
        method: "POST", headers: { "X-OCR-Job-Token": PROCESS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: JOB_ID, notificationOwnerAccountId: ACCOUNT_ID })
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        writes.push({ url: new URL(url), init });
        return Response.json([{ account_id: ACCOUNT_ID, source: "ocr", event_type: "review_required",
            dedupe_key: JSON.parse(init.body).dedupe_key, source_public_code: JOB_ID,
            occurred_at: status.completedAt, resolved_at: null, expires_at: null }]);
    };
    try {
        const response = await onRequestPost({ request: validRequest, env });
        assert.equal(response.status, 200);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].url.pathname, "/rest/v1/notification_events");
        assert.equal(JSON.parse(writes[0].init.body).account_id, ACCOUNT_ID);
    } finally { globalThis.fetch = previousFetch; }
});

test("mismatched queue account owner is rejected before notification database access", async () => {
    let calls = 0;
    const status = { jobId: JOB_ID, ownerId: await ownerHash(ACCOUNT_ID), status: "completed" };
    const env = { OCR_STORAGE: statusBucket(status), OCR_OWNER_SECRET: OWNER_SECRET, OCR_JOB_PROCESS_SECURE_TOKEN: PROCESS_TOKEN,
        SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "test-server-key" };
    const request = new Request("https://example.test/api/ocr/jobs/process_job", {
        method: "POST", headers: { "X-OCR-Job-Token": PROCESS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: JOB_ID, notificationOwnerAccountId: OTHER_ACCOUNT_ID })
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls++; return Response.json([]); };
    try {
        const response = await onRequestPost({ request, env });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "JOB_OWNER_INVALID");
        assert.equal(calls, 0);
    } finally { globalThis.fetch = previousFetch; }
});
