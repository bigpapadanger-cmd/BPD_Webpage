import assert from "node:assert/strict";
import test from "node:test";

import { handleOCRTrainingUpload } from "../../functions/services/ocr/training.js";

function createBucket() {
    const objects = new Map();
    const writes = [];
    return {
        objects,
        writes,
        async put(key, value, options = {}) {
            const condition = options.onlyIf?.get?.("If-None-Match");
            if (condition === "*" && objects.has(key)) return null;
            objects.set(key, { value, options });
            writes.push(key);
            return { key };
        },
        async head(key) {
            return objects.has(key) ? { key } : null;
        },
        async list({ prefix = "" } = {}) {
            return {
                objects: [...objects.keys()]
                    .filter(key => key.startsWith(prefix))
                    .map(key => ({ key })),
                truncated: false
            };
        }
    };
}

function makeRequest(fields, { token = "review-secret" } = {}) {
    const form = new FormData();
    form.set("matchId", "1234567890ABCDEF");
    form.set("fingerprint", "a".repeat(64));
    form.set("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "digit.png");
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) form.set(key, String(value));
    }
    return new Request("https://example.test/api/ocr/training", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
}

async function upload(fields, options) {
    const bucket = createBucket();
    const response = await handleOCRTrainingUpload(
        makeRequest(fields, options),
        { OCR_TRAINING_REVIEW_TOKEN: "review-secret", OCR_TRAINING: bucket }
    );
    return { response, bucket, body: await response.json() };
}

const validApproval = {
    candidateId: "score-t1-p1-d0",
    jobId: "ABCDEFGHIJKLMNOP",
    sourceImageKey: "ocr-jobs/ABCDEFGHIJKLMNOP/input.png",
    approvedLabel: "7",
    approvalStatus: "approved",
    reviewer: "operator@example.test",
    approvalSource: "human_review",
    field: "score"
};

test("OCR runtime credentials cannot authorize the legacy training route", async () => {
    const bucket = createBucket();
    const response = await handleOCRTrainingUpload(
        makeRequest(validApproval, { token: "ocr-runtime-secret" }),
        {
            OCR_STORAGE_TOKEN: "ocr-runtime-secret",
            OCR_TRAINING_REVIEW_TOKEN: "review-secret",
            OCR_TRAINING: bucket
        }
    );
    assert.equal(response.status, 401);
    assert.equal(bucket.writes.length, 0);
});

test("prediction/final OCR values cannot stand in for an explicit approvedLabel", async () => {
    const { response, bucket, body } = await upload({
        ...validApproval,
        approvedLabel: undefined,
        prediction: 7,
        legacyResult: 7,
        finalValue: 7,
        category: 7
    });
    assert.equal(response.status, 400);
    assert.equal(body.reason, "explicit_approved_label_required");
    assert.equal(bucket.writes.length, 0);
});

test("unapproved or invalid labels are rejected without training-bucket writes", async () => {
    for (const fields of [
        { ...validApproval, approvedLabel: "10" },
        { ...validApproval, approvedLabel: "7.0" },
        { ...validApproval, approvalStatus: "pending_review" },
        { ...validApproval, approvalSource: "onnx_prediction" },
        { ...validApproval, reviewer: "" }
    ]) {
        const { response, bucket } = await upload(fields);
        assert.equal(response.status, 400);
        assert.equal(bucket.writes.length, 0);
    }
});

test("explicitly human-approved candidate is stored under its approved class with provenance", async () => {
    const { response, bucket, body } = await upload(validApproval);
    assert.equal(response.status, 200);
    assert.equal(body.stored, true);
    const imageKey = bucket.writes.find(key => /^7\//.test(key));
    assert.ok(imageKey);
    const metadata = bucket.objects.get(imageKey).options.customMetadata;
    assert.equal(metadata.approvedLabel, "7");
    assert.equal(metadata.approvalStatus, "approved");
    assert.equal(metadata.approvalSource, "human_review");
    assert.equal(metadata.candidateId, validApproval.candidateId);
    assert.equal(metadata.jobId, validApproval.jobId);
    assert.equal(metadata.sourceImageKey, validApproval.sourceImageKey);
    assert.ok(metadata.approvalTimestamp);
});

test("zero is accepted as an explicit human-approved label", async () => {
    const { response, bucket } = await upload({
        ...validApproval,
        approvedLabel: "0",
        candidateId: "team2-header-d0"
    });
    assert.equal(response.status, 200);
    assert.ok(bucket.writes.some(key => /^0\//.test(key)));
});
