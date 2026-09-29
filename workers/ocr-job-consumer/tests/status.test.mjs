import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleQueueBatch } from "../src/index.js";

function createEnv() {
    const records = new Map();
    return {
        records,
        SERVICE_STATUS: {
            async get(key) { return records.get(key) || null; },
            async put(key, value) { records.set(key, JSON.parse(value)); }
        }
    };
}

test("queue consumer remains queue-only and records one successful heartbeat per invocation", async () => {
    const env = createEnv();
    assert.equal("queue" in worker, true);
    assert.equal((await worker.fetch(new Request("https://consumer.invalid/health"))).status, 404);
    await handleQueueBatch({ messages: [] }, env, {});
    const state = env.records.get("admin:service-status:ocr-queue");
    assert.ok(state.lastInvocationAt);
    assert.ok(state.lastSuccessAt);
    assert.equal(state.lastBatchSize, 0);
    assert.equal(env.records.size, 1);
});

test("failed queue invocation records bounded safe metadata and does not store job identifiers", async () => {
    const env = createEnv();
    let acked = false;
    await handleQueueBatch({ messages: [{ body: {}, ack() { acked = true; }, retry() { assert.fail("permanent malformed message should be acknowledged"); } }] }, env, {});
    const state = env.records.get("admin:service-status:ocr-queue");
    assert.equal(acked, true);
    assert.ok(state.lastFailureAt);
    assert.equal(state.lastFailureCount, 1);
    assert.equal(state.lastErrorCode, "OCR_QUEUE_BATCH_PARTIAL_FAILURE");
    assert.equal(JSON.stringify(state).includes("jobId"), false);
});
