import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { fetchOcrThroughGoogleWorker } from "../../functions/services/ocr/googleCloudTransport.js";

test("Pages sends OCR multipart requests through the private binding without Google credentials", async () => {
    const form = new FormData();
    form.set("image", new Blob(["image"]), "scoreboard.png");
    let captured;
    const response = await fetchOcrThroughGoogleWorker({
        OCR_GOOGLE_TRANSPORT_SECRET: "T".repeat(48),
        OCR_GOOGLE_TRANSPORT: {
            async fetch(request) {
                captured = request;
                return Response.json({ success: true, result: { matchId: "MATCH123456789012" } });
            }
        }
    }, form, { "X-BPD-OCR-Job-ID": "ABCDEFGHIJKLMNOP" });

    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://ocr-google-transport.internal/api/ocr");
    assert.equal(captured.method, "POST");
    assert.match(captured.headers.get("Content-Type"), /^multipart\/form-data; boundary=/);
    assert.equal(captured.headers.get("X-BPD-OCR-Job-ID"), "ABCDEFGHIJKLMNOP");
    assert.equal(captured.headers.get("Authorization"), `Bearer ${"T".repeat(48)}`);
    assert.equal(captured.headers.has("X-API-Key"), false);
});

test("missing or weak shared secret blocks Pages-to-Worker request", async () => {
    for (const env of [
        { OCR_GOOGLE_TRANSPORT: { fetch() { throw new Error("must not send"); } } },
        { OCR_GOOGLE_TRANSPORT_SECRET: "short", OCR_GOOGLE_TRANSPORT: { fetch() { throw new Error("must not send"); } } }
    ]) {
        await assert.rejects(fetchOcrThroughGoogleWorker(env, new FormData()), error =>
            error.code === "OCR_GOOGLE_TRANSPORT_AUTH_NOT_CONFIGURED" && error.httpStatus === 503);
    }
});

test("missing Pages service binding has a stable internal error", async () => {
    await assert.rejects(
        fetchOcrThroughGoogleWorker({}, new FormData()),
        error => error.code === "OCR_GOOGLE_TRANSPORT_UNAVAILABLE" && error.httpStatus === 503
    );
});

test("OCR attempt callback runs only when the configured private binding is invoked", async () => {
    let attempts = 0;
    const headers = { "X-BPD-OCR-Handler-Version": "test" };
    await fetchOcrThroughGoogleWorker({ OCR_GOOGLE_TRANSPORT_SECRET: "T".repeat(48), OCR_GOOGLE_TRANSPORT: {
        async fetch() { return Response.json({ success: true }); }
    } }, new FormData(), headers, undefined, () => { attempts++; });
    assert.equal(attempts, 1);

    await assert.rejects(fetchOcrThroughGoogleWorker({ OCR_GOOGLE_TRANSPORT_SECRET: "short", OCR_GOOGLE_TRANSPORT: {
        async fetch() { throw new Error("must not invoke"); }
    } }, new FormData(), headers, undefined, () => { attempts++; }));
    assert.equal(attempts, 1);
});

test("normal Pages OCR callers use the transport and do not import Google auth directly", async () => {
    const paths = [
        "../../functions/api/ocr/jobs/process_job.js",
        "../../functions/services/ocr/handler.js"
    ];
    for (const path of paths) {
        const source = await readFile(new URL(path, import.meta.url), "utf8");
        assert.match(source, /fetchOcrThroughGoogleWorker/);
        assert.doesNotMatch(source, /getGoogleCloudRunIdToken/);
    }
});
