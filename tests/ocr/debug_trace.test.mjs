import assert from "node:assert/strict";
import test from "node:test";

import { writeOcrDebugTrace } from "../../workers/ocr-job-consumer/src/debug.js";

test("OCR trace strips raw processor responses and credential-shaped fields", async () => {
    let saved;
    const env = {
        OCR_DEBUG_TRACE_ENABLED: "true",
        OCR_STORAGE: {
            async put(key, body) {
                saved = { key, payload: JSON.parse(body) };
            }
        }
    };

    const written = await writeOcrDebugTrace(env, {
        jobId: "ABCD1234EFGH5678",
        component: "consumer",
        event: "processor_rejected",
        detail: {
            httpStatus: 502,
            responseBytes: 2048,
            responseType: "application/json",
            response: "raw OCR/player text must not persist",
            message: "processor error body must not persist",
            preview: "private OCR text",
            accessToken: "access-token-secret",
            nested: { requestBody: "image data" }
        }
    });

    assert.equal(written, true);
    assert.match(saved.key, /^debug\/ABCD1234EFGH5678\//);
    const serialized = JSON.stringify(saved.payload);
    assert.match(serialized, /"httpStatus":502/);
    assert.match(serialized, /"responseBytes":2048/);
    assert.doesNotMatch(serialized, /raw OCR|access-token-secret|image data|requestBody|accessToken/);
});

test("oversized OCR debug fields are capped without content previews", async () => {
    let saved;
    await writeOcrDebugTrace({
        OCR_DEBUG_TRACE_ENABLED: "true",
        OCR_STORAGE: { async put(_key, body) { saved = JSON.parse(body); } }
    }, {
        jobId: "ABCD1234EFGH5678",
        component: "consumer",
        event: "large_detail",
        detail: { diagnostic: "x".repeat(20000) }
    });

    assert.equal("preview" in saved.detail, false);
    assert.equal(saved.detail.diagnostic.length, 2000);
    assert.equal(saved.detail.diagnostic.includes("xxxxxx"), true);
});
