import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const coreSource = fs.readFileSync(
    new URL("../../public/ocr/JS/submit_core.js", import.meta.url),
    "utf8"
);

function createHarness({ records = new Map(), deferWrites = false } = {}) {
    const sessionValues = new Map();
    const localValues = new Map();
    const createdUrls = [];
    const revokedUrls = [];
    const assignedImageSources = [];
    const pendingWrites = [];

    const sessionStorage = {
        getItem: key => sessionValues.get(key) ?? null,
        setItem: (key, value) => sessionValues.set(key, String(value)),
        removeItem: key => sessionValues.delete(key)
    };
    const localStorage = {
        getItem: key => localValues.get(key) ?? null,
        setItem: (key, value) => localValues.set(key, String(value)),
        removeItem: key => localValues.delete(key)
    };

    const database = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
            const transaction = {
                objectStore() {
                    return {
                        put(value, key) {
                            const write = { value, key, transaction };
                            if (deferWrites) {
                                pendingWrites.push(write);
                            }
                            else {
                                records.set(key, value);
                                queueMicrotask(() => transaction.oncomplete?.());
                            }
                        },
                        get(key) {
                            const request = {};
                            queueMicrotask(() => {
                                request.result = records.get(key);
                                request.onsuccess?.();
                            });
                            return request;
                        }
                    };
                }
            };
            return transaction;
        }
    };

    class TestImage {
        constructor() {
            this.naturalWidth = 800;
            this.naturalHeight = 600;
        }

        set src(value) {
            this._src = String(value);
            assignedImageSources.push(this._src);
            queueMicrotask(() => this.onload?.());
        }

        get src() {
            return this._src;
        }
    }

    const context = {
        Blob,
        File,
        Image: TestImage,
        URL: {
            createObjectURL(blob) {
                const objectUrl = `blob:test/${createdUrls.length + 1}`;
                createdUrls.push({ objectUrl, blob });
                return objectUrl;
            },
            revokeObjectURL(objectUrl) {
                revokedUrls.push(String(objectUrl));
            }
        },
        crypto: { randomUUID: () => "test-image-id" },
        sessionStorage,
        localStorage,
        console,
        queueMicrotask,
        setTimeout,
        clearTimeout,
        window: {
            devicePixelRatio: 1,
            indexedDB: {
                open() {
                    const request = { result: database };
                    queueMicrotask(() => request.onsuccess?.());
                    return request;
                }
            }
        }
    };

    vm.runInNewContext(
        coreSource + `
            const testContext = {
                clearRect() {},
                drawImage() {},
                save() {},
                restore() {},
                fillRect() {},
                strokeRect() {}
            };
            canvas = {
                width: 0,
                height: 0,
                hidden: false,
                style: {},
                setAttribute() {}
            };
            ctx = testContext;
            canvasWrap = { clientWidth: 800 };
            statusBox = { textContent: "" };
            emptyState = { hidden: false };
            matchSize = { value: "3", disabled: false };
            globalThis.__ocrImageTest = {
                savePageState,
                restorePageState,
                loadImageFile,
                getOriginalImageBlob,
                readState() {
                    return JSON.parse(sessionStorage.getItem(OCR_STATE_KEY) || "null");
                },
                setImage(image, imageId, persisted, file) {
                    sourceImage = image;
                    sourceImageId = imageId;
                    sourceImagePersisted = persisted;
                    sourceFile = file;
                    sourceFileName = file?.name || "scoreboard.png";
                },
                getSourceImage() { return sourceImage; },
                getSourceFile() { return sourceFile; },
                getSourceImagePersisted() { return sourceImagePersisted; }
            };
        `,
        context
    );

    return {
        adapter: context.__ocrImageTest,
        createdUrls,
        revokedUrls,
        assignedImageSources,
        pendingWrites,
        records,
        sessionValues,
        sessionStorage,
        commitPendingWrites() {
            for (const write of pendingWrites.splice(0)) {
                records.set(write.key, write.value);
                queueMicrotask(() => write.transaction.oncomplete?.());
            }
        }
    };
}

function createImageFile(name = "scoreboard.png") {
    return new File(["scoreboard image bytes"], name, { type: "image/png" });
}

test("durable page state stores an image ID, never a blob URL", () => {
    const harness = createHarness();
    const image = { src: "blob:https://example.test/revoked-image-url" };
    harness.adapter.setImage(image, "image-id-1", true, createImageFile());

    harness.adapter.savePageState();

    const state = harness.adapter.readState();
    assert.equal(state.imageId, "image-id-1");
    assert.equal(Object.hasOwn(state, "imageData"), false);
    assert.equal(JSON.stringify(state).includes("blob:"), false);
});

test("restore uses a fresh object URL and ignores a previously revoked URL", async () => {
    const records = new Map([[
        "lastUploadedImage",
        {
            blob: new Blob(["persisted image bytes"], { type: "image/png" }),
            name: "scoreboard.png",
            type: "image/png"
        }
    ]]);
    const harness = createHarness({ records });
    const oldRevokedUrl = "blob:https://example.test/old-revoked-url";
    harness.revokedUrls.push(oldRevokedUrl);
    harness.sessionStorage.setItem("rocketLeagueOcrStateV2", JSON.stringify({
        imageData: oldRevokedUrl,
        sourceFileName: "scoreboard.png",
        sourceMode: "automatic",
        matchSize: "3",
        playerNames: [],
        cropFallbackVisible: false
    }));

    assert.equal(harness.adapter.restorePageState(), true);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(harness.createdUrls.length, 1);
    const freshUrl = harness.createdUrls[0].objectUrl;
    assert.notEqual(freshUrl, oldRevokedUrl);
    assert.deepEqual(harness.assignedImageSources, [freshUrl]);
    assert.ok(harness.revokedUrls.includes(freshUrl));
    assert.equal(harness.assignedImageSources.includes(oldRevokedUrl), false);
    assert.equal(harness.adapter.getSourceImage().src, freshUrl);
    assert.equal(harness.adapter.readState().imageData, undefined);
    assert.equal(harness.adapter.readState().imageId, "test-image-id");
});

test("page state is not advanced until IndexedDB finishes persisting the image", async () => {
    const harness = createHarness({ deferWrites: true });
    const file = createImageFile();
    const loadPromise = harness.adapter.loadImageFile(file);

    for (let attempt = 0; attempt < 10 && harness.pendingWrites.length === 0; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(harness.pendingWrites.length, 1);
    assert.equal(harness.adapter.getSourceImagePersisted(), false);
    assert.equal(harness.adapter.readState(), null);

    harness.commitPendingWrites();
    assert.equal(await loadPromise, true);

    const state = harness.adapter.readState();
    assert.equal(state.imageId, harness.records.get("lastUploadedImage").imageId);
    assert.equal(Object.hasOwn(state, "imageData"), false);
});

test("OCR submission source remains the original selected File", async () => {
    const harness = createHarness();
    const originalFile = createImageFile();

    assert.equal(await harness.adapter.loadImageFile(originalFile), true);
    assert.equal(harness.adapter.getSourceFile(), originalFile);
    assert.equal(await harness.adapter.getOriginalImageBlob(), originalFile);
    assert.equal(harness.records.get("lastUploadedImage").blob, originalFile);
});
