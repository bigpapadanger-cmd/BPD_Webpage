import assert from "node:assert/strict";
import test from "node:test";

import {
    OCR_DISPOSITIONS,
    OCR_COLUMN_SEMANTICS,
    OCR_IMAGE_SOURCE_MODES,
    OCR_JOB_STATES,
    OCR_SAFE_REJECTION_CODES,
    OCR_SOURCE_MODES,
    canTransitionOcrJobState,
    isIdempotentOcrStateEvent,
    normalizeOcrDisposition,
    normalizeOcrExecutionId,
    normalizeOcrImageSourceMode,
    normalizeOcrRosterSize,
    normalizeOcrRosterContract,
    normalizeOcrSourceMode,
    sanitizeOcrRejectionDetail,
    sanitizeOcrColumns,
    validateOcrExecutionFence,
    validateOcrRosterSizes,
    validateOcrTerminalOutcome
} from "../../functions/services/ocr/contracts.js";

test("metadata source and image crop source stay independent", function() {
    assert.equal(normalizeOcrSourceMode(null), null);
    assert.equal(normalizeOcrSourceMode("manual"), OCR_SOURCE_MODES.MANUAL);
    assert.equal(normalizeOcrSourceMode("manual_crop_retry"), null);
    assert.equal(
        normalizeOcrImageSourceMode("manual_crop_retry"),
        OCR_IMAGE_SOURCE_MODES.MANUAL_CROP_RETRY
    );
    assert.equal(normalizeOcrImageSourceMode("unknown"), null);
});

test("automatic rosters may be unknown while manual rosters are complete", function() {
    assert.deepEqual(
        normalizeOcrRosterContract({ sourceMode: "automatic" }),
        {
            sourceMode: OCR_SOURCE_MODES.AUTOMATIC,
            playersPerTeam: null,
            team1Roster: null,
            team2Roster: null
        }
    );
    assert.deepEqual(
        normalizeOcrRosterContract({
            sourceMode: "automatic",
            team1Roster: [],
            team2Roster: []
        })?.playersPerTeam,
        null
    );
    assert.equal(
        normalizeOcrRosterContract({
            sourceMode: "automatic",
            team1Roster: ["One"]
        }),
        null
    );
    assert.deepEqual(
        normalizeOcrRosterContract({
            sourceMode: "manual",
            playersPerTeam: 2,
            team1Roster: ["One", "Two"],
            team2Roster: ["Three", "Four"]
        })?.playersPerTeam,
        2
    );
    assert.equal(
        normalizeOcrRosterContract({
            sourceMode: "manual",
            playersPerTeam: 1,
            team1Roster: ["Same"],
            team2Roster: ["same"]
        }),
        null
    );
});

test("column descriptors reject team-total claims and duplicate keys", function() {
    assert.deepEqual(
        sanitizeOcrColumns([
            { key: "score", label: "Score", semantic: "player_score", editable: true },
            { key: "goals", label: "Goals", semantic: "player_stat" },
            { key: "score", label: "Duplicate", semantic: "player_stat" },
            { key: "total", label: "Total", semantic: "team_total" }
        ]),
        [
            {
                key: "score",
                label: "Score",
                semantic: OCR_COLUMN_SEMANTICS.PLAYER_SCORE,
                editable: true,
                order: 0
            },
            {
                key: "goals",
                label: "Goals",
                semantic: OCR_COLUMN_SEMANTICS.PLAYER_STAT,
                editable: false,
                order: 1
            }
        ]
    );
});

test("symmetric roster sizes are strict through 16v16", function() {
    for (let size = 1; size <= 16; size += 1) {
        assert.equal(normalizeOcrRosterSize(size), size);
        assert.equal(normalizeOcrRosterSize(String(size)), size);
    }

    for (const invalid of [0, 17, 1.5, true, [1], {}, "1.0", "01", ""]) {
        assert.equal(normalizeOcrRosterSize(invalid), null);
    }

    assert.deepEqual(
        validateOcrRosterSizes({ team1: 16, team2: "16" }),
        { valid: true, playersPerTeam: 16 }
    );
    assert.equal(
        validateOcrRosterSizes({ team1: 1, team2: 16 }).valid,
        false
    );
    assert.equal(
        validateOcrRosterSizes({ allowUnknown: true }).valid,
        true
    );
});

test("historical review flags map without accepting conflicts", function() {
    assert.equal(
        normalizeOcrDisposition(null, "auto_accepted"),
        OCR_DISPOSITIONS.ACCEPTED
    );
    assert.equal(
        normalizeOcrDisposition(null, null, true),
        OCR_DISPOSITIONS.NEEDS_REVIEW
    );
    assert.equal(
        normalizeOcrDisposition("accepted", "pending_review"),
        null
    );
});

test("state mutation and idempotent events are separate", function() {
    const allowed = [
        ["created", "uploading"],
        ["uploading", "uploaded"],
        ["uploaded", "queued"],
        ["queued", "dispatching"],
        ["queued", "processing"],
        ["dispatching", "processing"],
        ["dispatching", "queued"],
        ["processing", "queued"],
        ["processing", "completed"]
    ];

    for (const [current, next] of allowed) {
        assert.equal(canTransitionOcrJobState(current, next), true);
    }

    assert.equal(
        canTransitionOcrJobState(
            OCR_JOB_STATES.COMPLETED,
            OCR_JOB_STATES.PROCESSING
        ),
        false
    );
    assert.equal(
        canTransitionOcrJobState(OCR_JOB_STATES.FAILED, OCR_JOB_STATES.QUEUED),
        false
    );
    assert.equal(
        canTransitionOcrJobState(
            OCR_JOB_STATES.COMPLETED,
            OCR_JOB_STATES.COMPLETED
        ),
        false
    );
    assert.equal(
        isIdempotentOcrStateEvent(
            OCR_JOB_STATES.COMPLETED,
            OCR_JOB_STATES.COMPLETED
        ),
        true
    );
});

test("callbacks are fenced to the active attempt and execution", function() {
    const executionId = "01J9OCRATTEMPT0001";

    assert.equal(normalizeOcrExecutionId(executionId), executionId);
    assert.equal(
        validateOcrExecutionFence({
            activeAttempt: 2,
            activeExecutionId: executionId,
            receivedAttempt: 2,
            receivedExecutionId: executionId
        }),
        true
    );
    assert.equal(
        validateOcrExecutionFence({
            activeAttempt: 2,
            activeExecutionId: executionId,
            receivedAttempt: 1,
            receivedExecutionId: executionId
        }),
        false
    );
    assert.equal(
        validateOcrExecutionFence({
            activeAttempt: 2,
            activeExecutionId: executionId,
            receivedAttempt: 2,
            receivedExecutionId: "01J9OCRATTEMPT0000"
        }),
        false
    );
});

test("completed outcomes require durable references", function() {
    assert.equal(
        validateOcrTerminalOutcome({
            state: "completed",
            disposition: "accepted",
            resultObjectKey: "ocr/jobs/JOB/results/1.json"
        }).valid,
        true
    );
    assert.equal(
        validateOcrTerminalOutcome({
            state: "completed",
            disposition: "needs_review",
            reviewObjectKey: "ocr/review/needs-review/JOB/1.json",
            reviewReason: "roster_uncertain"
        }).valid,
        true
    );
    assert.equal(
        validateOcrTerminalOutcome({
            state: "completed",
            disposition: "rejected"
        }).valid,
        false
    );
    assert.equal(
        validateOcrTerminalOutcome({
            state: "failed",
            disposition: "rejected"
        }).valid,
        false
    );
});

test("public rejection behavior is contract-owned and sanitized", function() {
    for (const code of Object.values(OCR_SAFE_REJECTION_CODES)) {
        const sanitized = sanitizeOcrRejectionDetail({
            code,
            retryable: false,
            message: "private",
            upstreamUrl: "https://private.invalid"
        });

        assert.equal(sanitized.code, code);
        assert.equal(Object.hasOwn(sanitized, "message"), false);
        assert.equal(Object.hasOwn(sanitized, "upstreamUrl"), false);
        assert.match(sanitized.messageKey, /^ocr\.rejection\./);
    }

    assert.deepEqual(
        sanitizeOcrRejectionDetail({
            code: "DATABASE_SECRET_FAILURE",
            retryable: false
        }),
        {
            code: OCR_SAFE_REJECTION_CODES.PROCESSING_UNAVAILABLE,
            messageKey: "ocr.rejection.processing_unavailable",
            retryable: true,
            reviewRequired: false,
            disposition: null
        }
    );
});
