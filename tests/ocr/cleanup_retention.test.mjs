import assert from "node:assert/strict";
import test from "node:test";

import { cleanupStaleOcrJobs } from "../../workers/ocr-job-consumer/src/cleanup.js";

function jsonObject(value) {
    return {
        async json() {
            return value;
        }
    };
}

function createEnvironment(state) {
    const progressDeletes = [];
    const storageDeletes = [];

    return {
        progressDeletes,
        storageDeletes,
        env: {
            OCR_STORAGE: {
                async get() {
                    return state == null ? null : jsonObject({ status: state });
                },
                async delete(key) {
                    storageDeletes.push(key);
                }
            },
            OCR_PROGRESS: {
                async list() {
                    return {
                        objects: [{
                            key: "jobs/ABCDEF1234567890.json",
                            uploaded: new Date(Date.now() - 25 * 60 * 60 * 1000)
                        }],
                        truncated: false
                    };
                },
                async delete(key) {
                    progressDeletes.push(key);
                }
            }
        }
    };
}

test("cleanup preserves durable material and removes aged terminal progress", async function() {
    const fixture = createEnvironment("completed");

    await cleanupStaleOcrJobs(fixture.env);

    assert.deepEqual(fixture.storageDeletes, []);
    assert.deepEqual(fixture.progressDeletes, ["jobs/ABCDEF1234567890.json"]);
});

test("cleanup preserves progress for an active job", async function() {
    const fixture = createEnvironment("processing");

    await cleanupStaleOcrJobs(fixture.env);

    assert.deepEqual(fixture.storageDeletes, []);
    assert.deepEqual(fixture.progressDeletes, []);
});
