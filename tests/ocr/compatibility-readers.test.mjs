import assert from "node:assert/strict";
import test from "node:test";

import {
    sanitizePublicScoreboard
} from "../../functions/api/ocr/jobs/get_result.js";

import {
    sanitizeJobResponse
} from "../../functions/api/ocr/jobs/get_job.js";

const MATCH_ID = "MATCHID0000000001";
const JOB_ID = "JOBID00000000001";

test("legacy team1/team2 reports preserve player stats without deriving totals", function() {
    const scoreboard = sanitizePublicScoreboard({
        matchId: MATCH_ID,
        team1: [
            {
                name: "Alpha",
                score: 420,
                goals: 2
            }
        ],
        team2: {
            players: [
                {
                    username: "Bravo",
                    score: 390,
                    goals: 1
                }
            ],
            goals: 8
        },
        columns: [
            "score",
            "mmr",
            {
                field: "goals"
            }
        ]
    });

    assert.deepEqual(scoreboard.activeFields, ["score", "goals"]);
    assert.deepEqual(scoreboard.columns, ["score", "goals"]);
    assert.deepEqual(scoreboard.teams, [
        {
            team: 1,
            players: [
                {
                    player: "Alpha",
                    score: 420,
                    goals: 2
                }
            ]
        },
        {
            team: 2,
            players: [
                {
                    player: "Bravo",
                    score: 390,
                    goals: 1
                }
            ]
        }
    ]);

    assert.equal(Object.hasOwn(scoreboard.teams[1], "goals"), false);
    assert.equal(Object.hasOwn(scoreboard, "teamTotals"), false);
    assert.equal(scoreboard.editDeadlineAt, null);
});

test("missing active fields infer only observed player fields", function() {
    const scoreboard = sanitizePublicScoreboard({
        matchId: MATCH_ID,
        teams: [
            {
                team: 1,
                goals: 12,
                players: [
                    {
                        player: "Alpha",
                        score: 420
                    }
                ]
            },
            {
                team: 2,
                goals: 1,
                players: [
                    {
                        player: "Bravo",
                        score: 390
                    }
                ]
            }
        ]
    });

    assert.deepEqual(scoreboard.activeFields, ["score"]);
    assert.deepEqual(scoreboard.columns, ["score"]);
    assert.equal(Object.hasOwn(scoreboard.teams[0], "goals"), false);
    assert.equal(Object.hasOwn(scoreboard.teams[1], "goals"), false);
});

test("name review rows remain visible and only explicit totals are exposed", function() {
    const scoreboard = sanitizePublicScoreboard({
        matchId: MATCH_ID,
        sourceMode: "automatic",
        teams: [
            {
                team: 1,
                totalGoals: 3,
                totalGoalsConfidence: 0.92,
                players: [
                    {
                        teamPlayerIndex: 1,
                        player: null,
                        score: 420,
                        nameEvidence: { raw: "unclear", confidence: 0.4 },
                        matchStatus: "NAME_REVIEW_REQUIRED"
                    }
                ]
            },
            {
                team: 2,
                goals: 3,
                players: [{ player: "Bravo", score: 390 }]
            }
        ]
    });

    assert.equal(scoreboard.sourceMode, "automatic");
    assert.equal(scoreboard.teams[0].totalGoals, 3);
    assert.equal(scoreboard.teams[0].players[0].player, "Unknown Player 1");
    assert.equal(scoreboard.teams[0].players[0].observedName, "unclear");
    assert.equal(Object.hasOwn(scoreboard.teams[1], "totalGoals"), false);
    assert.deepEqual(scoreboard.columnDescriptors, [
        {
            key: "score",
            label: "Score",
            semantic: "player_score",
            editable: true,
            order: 0
        }
    ]);
});

test("job reader exposes only contract-safe review metadata additively", function() {
    const job = sanitizeJobResponse({
        jobId: JOB_ID,
        status: "completed",
        stage: "completed",
        progress: 100,
        disposition: "needs_review",
        reviewReason: "roster_uncertain",
        columns: [
            "score",
            "ping",
            "mmr"
        ],
        rejection: {
            code: "roster_uncertain",
            message: "private provider message",
            upstreamUrl: "https://private.invalid"
        }
    });

    assert.equal(job.disposition, "needs_review");
    assert.equal(job.reviewRequired, true);
    assert.equal(job.editDeadlineAt, null);
    assert.deepEqual(job.columns, ["score", "ping"]);
    assert.deepEqual(job.rejection, {
        code: "roster_uncertain",
        messageKey: "ocr.rejection.roster_uncertain",
        retryable: false,
        reviewRequired: true,
        disposition: "needs_review"
    });
    assert.equal(Object.hasOwn(job.rejection, "message"), false);
    assert.equal(Object.hasOwn(job.rejection, "upstreamUrl"), false);
});

test("rejected job status does not expose raw rejection detail", function() {
    const job = sanitizeJobResponse({
        jobId: JOB_ID,
        status: "completed",
        disposition: "rejected",
        rejectionCode: "image_invalid"
    });

    assert.equal(job.disposition, "rejected");
    assert.deepEqual(job.rejection, {
        code: "image_invalid",
        messageKey: "ocr.rejection.image_invalid",
        retryable: false,
        reviewRequired: false,
        disposition: "rejected"
    });
});
