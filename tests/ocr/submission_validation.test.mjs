import assert from "node:assert/strict";
import test from "node:test";

import {
    parseMatchMetadata,
    validateLegacyRoster,
    validateOcrImageMetadata
} from "../../functions/api/ocr/jobs/submit_job.js";
import { normalizeOcrRosterContract } from "../../functions/services/ocr/contracts.js";

test("structured match metadata rejects malformed and oversized roster names", function() {
    assert.equal(parseMatchMetadata("{bad json"), null);
    const partialMetadata = parseMatchMetadata(JSON.stringify({
        teams: [{ team: 1, roster: ["A"] }]
    }));
    assert.notEqual(partialMetadata, null);
    assert.equal(normalizeOcrRosterContract({
        sourceMode: "automatic",
        team1Roster: partialMetadata.teams[0].roster,
        team2Roster: partialMetadata.teams[1].roster
    }), null);
    assert.equal(parseMatchMetadata(JSON.stringify({ teams: [{ team: 1, roster: [{}] }] })), null);
    assert.equal(parseMatchMetadata(JSON.stringify({
        teams: [{ team: 1, roster: ["x".repeat(65)] }]
    })), null);

    const metadata = parseMatchMetadata(JSON.stringify({
        name: null,
        id: null,
        season: null,
        date: null,
        teams: [
            { team: 1, roster: ["Alpha"] },
            { team: 2, roster: ["Bravo"] }
        ]
    }));
    assert.equal(metadata.teams[0].roster[0], "Alpha");
    assert.equal(metadata.teams[1].roster[0], "Bravo");
});

test("legacy roster validation remains symmetric and bounded", function() {
    assert.equal(validateLegacyRoster(16, Array.from({ length: 32 }, (_, index) => `P${index}`)).valid, true);
    assert.equal(validateLegacyRoster(2, ["A", "A", "B", "C"]).valid, false);
    assert.equal(validateLegacyRoster(1, ["A", "B".repeat(65)]).valid, false);
});

test("ingress image validation enforces media type and size", function() {
    assert.equal(validateOcrImageMetadata({ type: "image/png", size: 20 }).valid, true);
    assert.equal(validateOcrImageMetadata({ type: "text/plain", size: 20 }).status, 415);
    assert.equal(validateOcrImageMetadata({ type: "image/png", size: 0 }).valid, false);
    assert.equal(validateOcrImageMetadata({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).status, 413);
});
