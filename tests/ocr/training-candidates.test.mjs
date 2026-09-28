import assert from "node:assert/strict";
import test from "node:test";

import {
    getCandidateJobPrefix,
    persistOcrCandidateArchive
} from "../../functions/services/ocr/trainingCandidates.js";

function makeBucket() {
    const objects = new Map();
    return {
        objects,
        async put(key, value, options = {}) {
            objects.set(key, { value, options });
        }
    };
}

const crop = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("native-digit-crop")
]).toString("base64");

function candidate(overrides = {}) {
    return {
        candidateId: "score-t1-p1-d0",
        field: "score",
        team: 1,
        teamPlayerIndex: 1,
        sequenceIndex: 0,
        componentBox: { x: 100, y: 200, width: 12, height: 24 },
        cellBox: { x: 90, y: 190, width: 40, height: 30 },
        priorityBucket: "P2",
        priorityReasons: ["low_or_medium_or_missing_evidence"],
        prediction: { digit: 7, score: 0.84, runnerUpDigit: 1, runnerUpScore: 0.1, margin: 0.74, evidence: "medium" },
        legacyResult: null,
        finalValue: 7,
        engine: "onnx_review",
        requiresVerification: true,
        fallbackReason: "medium_evidence",
        modelVersion: "digit-classifier-test",
        modelSha256: "a".repeat(64),
        cropPngBase64: crop,
        ...overrides
    };
}

test("candidate job prefix is stable and UTC date-partitioned", () => {
    assert.equal(
        getCandidateJobPrefix("abcdefghijklmnop", "2026-09-28T23:59:00-04:00"),
        "ocr-training-candidates/2026/09/29/ABCDEFGHIJKLMNOP"
    );
});

test("archive writes source, OCR artifacts, pending crop, metadata, then manifest only", async () => {
    const bucket = makeBucket();
    const result = await persistOcrCandidateArchive({
        bucket,
        jobId: "ABCDEFGHIJKLMNOP",
        createdAt: "2026-09-28T12:00:00Z",
        sourceImage: new Uint8Array([0xff, 0xd8, 0xff, 0x01]).buffer,
        sourceContentType: "image/jpeg",
        originalSourceImageKey: "ocr-jobs/ABCDEFGHIJKLMNOP/input.png",
        canonicalResult: { teams: [] },
        candidateArchive: {
            schemaVersion: 1,
            candidateCountFound: 3,
            candidateCountSaved: 1,
            candidateCountDropped: 2,
            candidateCap: 64,
            candidateByteCap: 512 * 1024,
            priorityBreakdown: {
                P1: { found: 0, saved: 0, dropped: 0 },
                P2: { found: 3, saved: 1, dropped: 2 }
            },
            truncationReasons: { candidate_cap: 2 },
            truncated: true,
            modelMetadata: { modelVersion: "digit-classifier-test", modelSha256: "a".repeat(64) },
            candidates: [candidate()]
        }
    });
    const prefix = "ocr-training-candidates/2026/09/28/ABCDEFGHIJKLMNOP";
    assert.equal(result.saved, true);
    assert.equal(result.candidateCount, 1);
    assert.ok(bucket.objects.has(`${prefix}/source/scoreboard.jpg`));
    assert.ok(bucket.objects.has(`${prefix}/result/canonical_result.json`));
    assert.ok(bucket.objects.has(`${prefix}/result/diagnostics.json`));
    assert.ok(bucket.objects.has(`${prefix}/model/model_metadata.json`));
    assert.ok(bucket.objects.has(`${prefix}/candidates/pending/score-t1-p1-d0/crop.png`));
    const metadata = JSON.parse(bucket.objects.get(`${prefix}/candidates/pending/score-t1-p1-d0/metadata.json`).value);
    const manifest = JSON.parse(bucket.objects.get(`${prefix}/candidates/manifest.json`).value);
    assert.equal(metadata.approvalStatus, "pending_review");
    assert.equal(metadata.approvedLabel, null);
    assert.equal(metadata.sourceImageKey, "ocr-jobs/ABCDEFGHIJKLMNOP/input.png");
    assert.equal(manifest.candidateCount, 1);
    assert.equal(manifest.candidateCountFound, 3);
    assert.equal(manifest.candidateCountSaved, 1);
    assert.equal(manifest.candidateCountDropped, 2);
    assert.equal(manifest.candidateCap, 64);
    assert.equal(manifest.candidateByteCap, 512 * 1024);
    assert.equal(manifest.truncated, true);
    assert.equal(manifest.priorityBreakdown.P2.found, 3);
    assert.equal(manifest.priorityBreakdown.P2.saved, 1);
    assert.equal(manifest.priorityBreakdown.P2.dropped, 2);
    assert.equal(manifest.candidates[0].approvalStatus, "pending_review");
    assert.equal(manifest.candidates[0].priorityBucket, "P2");
    assert.equal([...bucket.objects.keys()].some(key => /^[0-9]\//.test(key)), false);
});

test("fully truncated candidates still produce a countable review manifest", async () => {
    const bucket = makeBucket();
    const result = await persistOcrCandidateArchive({
        bucket,
        jobId: "ABCDEFGHIJKLMNOP",
        createdAt: "2026-09-28T12:00:00Z",
        sourceImage: new Uint8Array([0xff, 0xd8, 0xff, 0x01]).buffer,
        sourceContentType: "image/jpeg",
        candidateArchive: {
            candidateCountFound: 4,
            candidateCountSaved: 0,
            candidateCountDropped: 4,
            candidateCap: 64,
            candidateByteCap: 512 * 1024,
            priorityBreakdown: { P1: { found: 4, saved: 0, dropped: 4 } },
            truncated: true,
            candidates: []
        }
    });
    const manifest = JSON.parse(bucket.objects.get(
        "ocr-training-candidates/2026/09/28/ABCDEFGHIJKLMNOP/candidates/manifest.json"
    ).value);
    assert.equal(result.saved, true);
    assert.equal(manifest.candidateCountFound, 4);
    assert.equal(manifest.candidateCountSaved, 0);
    assert.equal(manifest.candidateCountDropped, 4);
    assert.equal(manifest.truncated, true);
    assert.equal(manifest.priorityBreakdown.P1.dropped, 4);
});

test("malformed candidate crops are excluded but their loss is recorded in the manifest", async () => {
    const bucket = makeBucket();
    const result = await persistOcrCandidateArchive({
        bucket,
        jobId: "ABCDEFGHIJKLMNOP",
        createdAt: "2026-09-28T12:00:00Z",
        sourceImage: new Uint8Array([1, 2, 3]).buffer,
        sourceContentType: "image/png",
        candidateArchive: { candidates: [candidate({ cropPngBase64: "not-base64-png" })] }
    });
    const manifest = JSON.parse(bucket.objects.get(
        "ocr-training-candidates/2026/09/28/ABCDEFGHIJKLMNOP/candidates/manifest.json"
    ).value);
    assert.equal(result.saved, true);
    assert.equal(bucket.objects.has(
        "ocr-training-candidates/2026/09/28/ABCDEFGHIJKLMNOP/candidates/pending/score-t1-p1-d0/crop.png"
    ), false);
    assert.equal(manifest.candidateCountFound, 1);
    assert.equal(manifest.candidateCountSaved, 0);
    assert.equal(manifest.candidateCountDropped, 1);
    assert.equal(manifest.invalidCandidateCount, 1);
    assert.deepEqual(manifest.priorityBreakdown.P2, { found: 1, saved: 0, dropped: 1 });
});
