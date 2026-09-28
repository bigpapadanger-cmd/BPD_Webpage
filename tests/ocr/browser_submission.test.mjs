import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const coreSource =
    fs.readFileSync(
        new URL(
            "../../public/ocr/JS/submit_core.js",
            import.meta.url
        ),
        "utf8"
    );

function loadSubmissionAdapter({
    manual = false,
    playersPerTeam = 3,
    names = []
} = {}) {
    const context = {
        console,
        window: {}
    };

    vm.runInNewContext(
        coreSource
        + `
            manualMetadataToggle = {
                checked: ${JSON.stringify(manual)},
                setAttribute() {}
            };
            manualMetadataFields = {
                hidden: false,
                setAttribute() {}
            };
            automaticMetadataPreview = {
                hidden: false
            };
            matchSize = {
                value: ${JSON.stringify(String(playersPerTeam))},
                disabled: false
            };
            const testNames = ${JSON.stringify(names)};
            const testInputs = testNames.map(
                value => ({ value, disabled: false })
            );
            playerNamesContainer = {
                querySelectorAll() {
                    return testInputs;
                }
            };
            globalThis.__submissionAdapter = {
                configureMetadataMode,
                resolveSavedSourceMode,
                validateOcrSubmissionMetadata,
                testInputs
            };
        `,
        context
    );

    return context.__submissionAdapter;
}

test(
    "automatic mode omits unknown roster metadata",
    function() {
        const adapter =
            loadSubmissionAdapter();

        const result =
            adapter.validateOcrSubmissionMetadata();

        assert.equal(
            result.valid,
            true
        );
        assert.equal(
            result.sourceMode,
            "automatic"
        );
        assert.equal(
            result.playersPerTeam,
            null
        );
        assert.deepEqual(
            Array.from(
                result.names
            ),
            []
        );
        assert.deepEqual(
            Array.from(
                result.matchMetadata.teams,
                team => ({
                    team:
                        team.team,
                    roster:
                        Array.from(
                            team.roster
                        )
                })
            ),
            [
                {
                    team: 1,
                    roster: []
                },
                {
                    team: 2,
                    roster: []
                }
            ]
        );
    }
);

test(
    "manual mode supports 16 players per team and preserves team order",
    function() {
        const names =
            Array.from(
                {
                    length: 32
                },
                function(
                    _,
                    index
                ) {
                    return `PLAYER${index + 1}`;
                }
            );

        const adapter =
            loadSubmissionAdapter({
                manual: true,
                playersPerTeam: 16,
                names
            });

        const result =
            adapter.validateOcrSubmissionMetadata();

        assert.equal(
            result.valid,
            true
        );
        assert.equal(
            result.playersPerTeam,
            16
        );
        assert.deepEqual(
            Array.from(
                result.matchMetadata
                    .teams[0]
                    .roster
            ),
            names.slice(
                0,
                16
            )
        );
        assert.deepEqual(
            Array.from(
                result.matchMetadata
                    .teams[1]
                    .roster
            ),
            names.slice(
                16
            )
        );
    }
);

test(
    "mode changes disable but do not clear hidden manual values",
    function() {
        const adapter =
            loadSubmissionAdapter({
                names: [
                    "ALPHA",
                    "BRAVO"
                ]
            });

        adapter.configureMetadataMode();

        assert.deepEqual(
            Array.from(
                adapter.testInputs,
                input => input.value
            ),
            [
                "ALPHA",
                "BRAVO"
            ]
        );
        assert.equal(
            adapter.testInputs.every(
                input => input.disabled
            ),
            true
        );
    }
);

test(
    "legacy saved names reopen manual mode without changing fresh default",
    function() {
        const adapter =
            loadSubmissionAdapter();

        assert.equal(
            adapter.resolveSavedSourceMode(
                null
            ),
            "automatic"
        );
        assert.equal(
            adapter.resolveSavedSourceMode({
                playerNames: [
                    "ALPHA",
                    ""
                ]
            }),
            "manual"
        );
    }
);
