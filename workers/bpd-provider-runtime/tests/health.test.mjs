import assert from "node:assert/strict";
import test from "node:test";
import providerRuntime from "../src/index.js";

const SECRET = "p".repeat(64);

function healthRequest({ method = "GET", secret = SECRET } = {}) {
    return new Request("https://service.internal/internal/health", {
        method,
        headers: secret ? { Authorization: `Bearer ${secret}` } : {}
    });
}

test("internal health endpoint requires caller authorization and returns only the non-sensitive contract", async () => {
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error("health check must not call Discord"); };
    try {
        const response = await providerRuntime.fetch(healthRequest(), { PROVIDER_RUNTIME_CALLER_SECRET: SECRET });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(Object.keys(payload).sort(), ["service", "status", "success", "timestamp"]);
        assert.equal(payload.success, true);
        assert.equal(payload.service, "bpd-provider-runtime");
        assert.equal(payload.status, "ok");
        assert.ok(Number.isFinite(Date.parse(payload.timestamp)));
        assert.equal(JSON.stringify(payload).includes(SECRET), false);
        assert.equal(providerCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test("internal health endpoint rejects unauthenticated callers and non-GET methods", async () => {
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: SECRET };
    const unauthorized = await providerRuntime.fetch(healthRequest({ secret: "" }), env);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { success: false, code: "INTERNAL_AUTH_REQUIRED" });

    const wrongMethod = await providerRuntime.fetch(healthRequest({ method: "POST" }), env);
    assert.equal(wrongMethod.status, 405);
    assert.deepEqual(await wrongMethod.json(), { success: false, code: "METHOD_NOT_ALLOWED" });
});
