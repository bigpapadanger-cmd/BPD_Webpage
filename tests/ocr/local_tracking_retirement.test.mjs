import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/ocr/localTracking.js";

test("retired tracking POST returns 410 without invoking the upstream", async () => {
  let accessedUpstream = false;
  const env = new Proxy({}, { get() { accessedUpstream = true; throw new Error("Upstream must not be accessed"); } });
  const response = onRequest({
    request: new Request("https://example.test/api/ocr/localTracking", {
      method: "POST", body: '{"accountId":"untrusted","payload":"arbitrary"}'
    }),
    env
  });
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { success: false, code: "OCR_TRACKING_RETIRED" });
  assert.equal(accessedUpstream, false);
});

test("retired tracking rejects other methods without reading input", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const response = onRequest({ request: new Request("https://example.test/api/ocr/localTracking", { method }) });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
  }
});
