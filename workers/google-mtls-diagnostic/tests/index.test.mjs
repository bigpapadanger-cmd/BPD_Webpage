import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, { buildProviderResource, handleRequest, parseCertificateChain } from "../src/index.js";

const BEARER = "diagnostic-only-secret-value-that-is-long-enough";
const originalInfo = console.info;
const originalFetch = globalThis.fetch;
afterEach(() => {
    console.info = originalInfo;
    globalThis.fetch = originalFetch;
});

function request(path, { method = "GET", body, token = BEARER } = {}) {
    return new Request(`https://diagnostic.invalid${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
}

test("provider resource uses the configured WIF identifiers", () => {
    assert.equal(buildProviderResource({
        OCR_GCP_PROJECT_NUMBER: "1094994524157",
        OCR_GCP_WORKLOAD_IDENTITY_POOL_ID: "ocr-cloudflare-transfer-handler",
        OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "bpd-ocr-cloudflare-x509"
    }), "//iam.googleapis.com/projects/1094994524157/locations/global/workloadIdentityPools/ocr-cloudflare-transfer-handler/providers/bpd-ocr-cloudflare-x509");
});

test("certificate chain parser rejects non-array/invalid material", () => {
    assert.deepEqual(parseCertificateChain(JSON.stringify(["Y2VydA=="])), ["Y2VydA=="]);
    assert.throws(() => parseCertificateChain("not-json"), { message: "CERTIFICATE_CHAIN_INVALID" });
    assert.throws(() => parseCertificateChain(JSON.stringify(["%%%"])), { message: "CERTIFICATE_CHAIN_INVALID" });
});

test("all routes require the dedicated bearer secret before making calls", async () => {
    let calls = 0;
    const env = { DIAGNOSTIC_BEARER_TOKEN: BEARER, OCR_GCP_MTLS: { fetch: async () => { calls += 1; } } };
    const response = await handleRequest(request("/probe/empty", { method: "POST", token: "wrong" }), env);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
    assert.equal((await response.json()).error, "UNAUTHORIZED");
});

test("empty probe directly uses mTLS binding and reports only safe response metadata", async () => {
    let target;
    let options;
    const env = {
        DIAGNOSTIC_BEARER_TOKEN: BEARER,
        OCR_GCP_MTLS: { fetch: async (url, init) => {
            target = url;
            options = init;
            return Response.json({ error: "invalid_request", error_description: "subject_token must be nonempty" }, { status: 400 });
        } }
    };
    const response = await handleRequest(request("/probe/empty", { method: "POST" }), env);
    const result = await response.json();
    assert.equal(target, "https://sts.mtls.googleapis.com/v1/token");
    assert.equal(options.redirect, "manual");
    assert.equal(options.body, "");
    assert.equal(result.googleError, "invalid_request");
    assert.equal(result.googleErrorDescription, "subject_token must be nonempty");
    assert.equal("subject_token" in result, false);
    assert.equal("access_token" in result, false);
});

test("full STS probe never returns or logs the access token or certificate chain", async () => {
    const accessToken = "ya29.mock-access-secret";
    const certificateChain = JSON.stringify(["Y2VydA=="]);
    const log = [];
    console.info = (...args) => log.push(args);
    let bindingCalls = 0;
    const env = {
        DIAGNOSTIC_BEARER_TOKEN: BEARER,
        OCR_GCP_X509_CERT_CHAIN: certificateChain,
        OCR_GCP_PROJECT_NUMBER: "1094994524157",
        OCR_GCP_WORKLOAD_IDENTITY_POOL_ID: "ocr-cloudflare-transfer-handler",
        OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "bpd-ocr-cloudflare-x509",
        OCR_GCP_SERVICE_ACCOUNT_EMAIL: "ocr-cloudflare-handler@project-95bc2520-286c-45bf-9cb.iam.gserviceaccount.com",
        OCR_GCP_MTLS: { fetch: async (url, init) => {
            bindingCalls += 1;
            assert.equal(url, "https://sts.mtls.googleapis.com/v1/token");
            assert.equal(init.method, "POST");
            assert.equal(JSON.parse(init.body).audience.includes("/providers/bpd-ocr-cloudflare-x509"), true);
            return Response.json({ access_token: accessToken, expires_in: 3600, issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer" });
        } }
    };
    const result = await (await handleRequest(request("/probe/full-sts", { method: "POST" }), env)).json();
    assert.equal(bindingCalls, 1);
    assert.equal(result.success, true);
    assert.equal(result.accessTokenReceived, true);
    assert.equal(JSON.stringify(result).includes(accessToken), false);
    assert.equal(JSON.stringify(result).includes(certificateChain), false);
    assert.equal(JSON.stringify(log).includes(accessToken), false);
    assert.equal(JSON.stringify(log).includes(certificateChain), false);
});

test("ID-token probe does not expose generated credentials and uses STS binding only for STS", async () => {
    const accessToken = "ya29.mock-access-secret";
    const idToken = "header.payload.signature-mock-secret";
    const log = [];
    console.info = (...args) => log.push(args);
    let stsCalls = 0;
    let iamCalls = 0;
    globalThis.fetch = async (url, init) => {
        iamCalls += 1;
        assert.equal(String(url).startsWith("https://iamcredentials.googleapis.com/"), true);
        assert.equal(init.headers.Authorization, `Bearer ${accessToken}`);
        return Response.json({ token: idToken });
    };
    const env = {
        DIAGNOSTIC_BEARER_TOKEN: BEARER,
        OCR_GCP_X509_CERT_CHAIN: JSON.stringify(["Y2VydA=="]),
        OCR_GCP_PROJECT_NUMBER: "1094994524157",
        OCR_GCP_WORKLOAD_IDENTITY_POOL_ID: "ocr-cloudflare-transfer-handler",
        OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "bpd-ocr-cloudflare-x509",
        OCR_GCP_SERVICE_ACCOUNT_EMAIL: "ocr-cloudflare-handler@project-95bc2520-286c-45bf-9cb.iam.gserviceaccount.com",
        OCR_GCP_CLOUD_RUN_AUDIENCE: "https://bpd-ocr-y5wgeempka-uc.a.run.app",
        OCR_GCP_MTLS: { fetch: async () => {
            stsCalls += 1;
            return Response.json({ access_token: accessToken });
        } }
    };
    const result = await (await handleRequest(request("/probe/id-token", { method: "POST" }), env)).json();
    assert.equal(stsCalls, 1);
    assert.equal(iamCalls, 1);
    assert.equal(result.idTokenReceived, true);
    assert.equal(JSON.stringify(result).includes(accessToken), false);
    assert.equal(JSON.stringify(result).includes(idToken), false);
    assert.equal(JSON.stringify(log).includes(accessToken), false);
    assert.equal(JSON.stringify(log).includes(idToken), false);
});

test("diagnostic worker has no scheduled, queue, or arbitrary-proxy handler", () => {
    assert.equal(typeof worker.fetch, "function");
    assert.equal("scheduled" in worker, false);
    assert.equal("queue" in worker, false);
});
