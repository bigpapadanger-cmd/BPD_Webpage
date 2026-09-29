import assert from "node:assert/strict";
import test from "node:test";

import { getTeamTotalPresentation, normalizePlayerNameCandidate, suggestRosterName } from "../../functions/services/ocr/playerNameMatching.js";
import { processReviewConfirmation } from "../../functions/services/ocr/confirm.js";
import { resultRequiresReview } from "../../functions/api/ocr/jobs/process_job.js";

test("roster exact and normalized matches are suggestions, not human approval", () => {
    assert.equal(suggestRosterName("Chef Boy RD", ["Chef Boy RD"]).status, "needs_verification");
    const normalized = suggestRosterName("Café-Boy_RD", ["Cafe Boy RD"]);
    assert.equal(normalized.status, "needs_verification");
    assert.equal(normalized.userVerified, false);
    assert.equal(normalizePlayerNameCandidate(" [BOG] Wolf-Man "), "bogwolfman");
});

test("plausible OCR roster candidate stays review-required and ambiguous match resolves safely", () => {
    const fuzzy = suggestRosterName("Chef Boy RX", ["Chef Boy RD", "Another Player"]);
    assert.equal(fuzzy.status, "needs_verification");
    assert.equal(fuzzy.candidate, "Chef Boy RD");
    assert.equal(fuzzy.userVerified, false);
    const ambiguous = suggestRosterName("Alex", ["Alec", "Alix"]);
    assert.equal(ambiguous.status, "unresolved");
});

test("low-confidence name remains unresolved", () => {
    assert.equal(suggestRosterName("Completely Different", ["Wolfman"]).status, "unresolved");
});

test("roster candidate forces review instead of being silently auto-accepted", () => {
    const result = { teams: [{ team: 1, totalGoals: 2, players: [{ player: "Wolfman", nameEvidence: { raw: "Wolfm4n" }, reviewFields: { score: { value: 12 } } }] }] };
    assert.equal(resultRequiresReview(result, [{ team: 1, roster: ["Wolfman"] }]), true);
    assert.equal(resultRequiresReview(result, []), false);
});

test("team total UI model uses only authoritative totalGoals, never player SCORE", () => {
    assert.equal(getTeamTotalPresentation({ totalGoals: 3, players: [{ SCORE: 999 }] }).total, 3);
    assert.equal(getTeamTotalPresentation({ players: [{ SCORE: 999 }] }).total, null);
    assert.equal(getTeamTotalPresentation({ totalGoals: 2, totalGoalsRequiresVerification: true }).requiresVerification, true);
});

function reviewFixture() {
    const team = {
        team: 1,
        totalGoals: null,
        totalGoalsRequiresVerification: true,
        players: [{
            teamPlayerIndex: 1,
            player: "Unknown Player 1",
            matchStatus: "NAME_UNVERIFIED",
            nameEvidence: { raw: "Wolfm4n" },
            reviewFields: { score: { value: 142, confidence: 0.8 } }
        }]
    };
    const report = { confirmationStatus: "pending_review", rosterCandidates: [{ team: 1, roster: ["Wolfman"] }] };
    const fields = [{ team: 1, player: "Unknown Player 1", field: "score", userValue: 142 }];
    const fieldKeys = new Set(["1|UNKNOWN PLAYER 1|score"]);
    return { report, team, fields, fieldKeys };
}

test("pending roster suggestion cannot verify name or team total without explicit reviewer values", () => {
    const { report, team, fields, fieldKeys } = reviewFixture();
    const result = processReviewConfirmation(report, [team], fields, fieldKeys, [], []);
    assert.equal(result.success, undefined);
    assert.ok(result.error);
    assert.equal(team.players[0].nameResolution, undefined);
    assert.equal(team.totalGoals, null);
});

test("explicit reviewer roster selection and total record human provenance", () => {
    const { report, team, fields, fieldKeys } = reviewFixture();
    const result = processReviewConfirmation(report, [team], fields, fieldKeys,
        [{ team: 1, userValue: 2 }],
        [{ team: 1, playerIndex: 1, resolvedDisplayName: "Wolfman", matchSource: "manual-roster" }],
        "reviewer-test-id");
    assert.equal(result.success, true);
    assert.equal(team.players[0].player, "Wolfman");
    assert.equal(team.players[0].nameResolution.userVerified, true);
    assert.equal(team.players[0].nameResolution.matchedPlayerId, null);
    assert.equal(team.players[0].nameResolution.originalOcrName, "Wolfm4n");
    assert.equal(team.totalGoals, 2);
    assert.equal(team.totalGoalsProvenance.source, "human-review");
    assert.equal(team.totalGoalsProvenance.userVerified, true);
    assert.equal(team.totalGoalsProvenance.reviewerAccountId, "reviewer-test-id");
    assert.equal(team.players[0].nameResolution.reviewerAccountId, "reviewer-test-id");
});

test("explicit free-text player correction is recorded with no account identity", () => {
    const { report, team, fields, fieldKeys } = reviewFixture();
    const result = processReviewConfirmation(report, [team], fields, fieldKeys,
        [{ team: 1, userValue: 2 }],
        [{ team: 1, playerIndex: 1, resolvedDisplayName: "Verified Guest", matchSource: "manual-text" }]);
    assert.equal(result.success, true);
    assert.equal(team.players[0].nameResolution.matchSource, "manual-text");
    assert.equal(team.players[0].nameResolution.matchedPlayerId, null);
    assert.equal(team.players[0].nameResolution.userVerified, true);
});
