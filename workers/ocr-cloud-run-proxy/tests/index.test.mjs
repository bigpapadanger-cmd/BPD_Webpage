import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const CLOUD_RUN_URL = "https://bpd-ocr-y5wgeempka-uc.a.run.app/api/ocr";
let certificateSequence = 0;

function makeEnvironment(options = {}) {
    certificateSequence += 1;
    const sequence = certificateSequence;
    const certificate = btoa(`${String(sequence).padStart(3, "0")}${"C".repeat(160)}`);
    const mtlsRequests = [];
    const env = {
        OCR_API_URL: CLOUD_RUN_URL,
        OCR_PUBLIC_HOSTNAME: "ocr-transport.bpd-gaming-network.com",
        OCR_API_KEY: "private-test-api-key",
        OCR_GOOGLE_TRANSPORT_SECRET: "T".repeat(48),
        OCR_GCP_PROJECT_NUMBER: "1094994524157",
        OCR_GCP_WORKLOAD_IDENTITY_POOL_ID: "ocr-cloudflare-transfer-handler",
        OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "bpd-ocr-cloudflare-x509",
        OCR_GCP_SERVICE_ACCOUNT_EMAIL: "ocr-cloudflare-handler@example.iam.gserviceaccount.com",
        OCR_GCP_X509_CERT_CHAIN: JSON.stringify([certificate]),
        OCR_GCP_MTLS: {
            async fetch(url, request) {
                mtlsRequests.push({ url: String(url), request });
                if (options.stsFailure) {
                    return Response.json({ error: "invalid_grant", error_description: "safe rejection" }, { status: 400 });
                }
                return Response.json({ access_token: `access-${sequence}`, expires_in: 3600 });
            }
        }
    };
    return { env, mtlsRequests };
}

function multipartRequest(form = null, url = "https://ocr-google-transport.internal/api/ocr", authorization = "Bearer " + "T".repeat(48)) {
    if (!form) {
        form = new FormData();
        form.set("image", new Blob(["image-bytes"], { type: "image/png" }), "scoreboard.png");
    }
    return new Request(url, { method: "POST", body: form, headers: { "X-BPD-OCR-Job-ID": "ABCDEFGHIJKLMNOP", ...(authorization ? { Authorization: authorization } : {}) } });
}

async function withFetch(mock, run) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    try { return await run(); }
    finally { globalThis.fetch = original; }
}

test("rejects a missing mTLS binding without contacting Google", async () => {
    const env = makeEnvironment().env;
    delete env.OCR_GCP_MTLS;
    const response = await handleRequest(multipartRequest(), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "OCR_GOOGLE_MTLS_BINDING_MISSING");
});

test("Worker custom domain is shared-secret gated and Pages uses its fixed service binding", async () => {
    const workerConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const pagesConfig = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
    assert.equal(workerConfig.name, "bpd-ocr-cloud-run-proxy");
    assert.equal(workerConfig.workers_dev, false);
    assert.equal(workerConfig.preview_urls, false);
    assert.deepEqual(workerConfig.routes, [{ pattern: "ocr-transport.bpd-gaming-network.com", custom_domain: true }]);
    assert.equal(workerConfig.vars.OCR_PUBLIC_HOSTNAME, "ocr-transport.bpd-gaming-network.com");
    assert.equal(workerConfig.triggers?.crons, undefined);
    assert.equal(workerConfig.queues, undefined);
    assert.deepEqual(pagesConfig.services, [{
        binding: "OCR_GOOGLE_TRANSPORT",
        service: "bpd-ocr-cloud-run-proxy"
    }]);
});

test("rejects missing and incorrect shared secrets before any Google or Cloud Run request", async () => {
    const { env, mtlsRequests } = makeEnvironment();
    let externalCalls = 0;
    const missing = await handleRequest(multipartRequest(null, undefined, null), env);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, "UNAUTHORIZED");
    const incorrect = await handleRequest(multipartRequest(null, undefined, "Bearer wrong"), env);
    assert.equal(incorrect.status, 401);
    assert.equal((await incorrect.json()).code, "UNAUTHORIZED");
    assert.equal(mtlsRequests.length, 0);
    await withFetch(async () => { externalCalls += 1; throw new Error("must not call external services"); }, async () => {
        const misconfiguredEnv = { ...env, OCR_GOOGLE_TRANSPORT_SECRET: "short" };
        const response = await handleRequest(multipartRequest(), misconfiguredEnv);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "OCR_TRANSPORT_AUTH_NOT_CONFIGURED");
    });
    assert.equal(externalCalls, 0);
});

test("secret-gated custom domain accepts only its fixed OCR route", async () => {
    const { env, mtlsRequests } = makeEnvironment();
    const tokenPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const response = await withFetch(async url => String(url).includes("iamcredentials.googleapis.com")
        ? Response.json({ token: `header.${tokenPayload}.sig` })
        : Response.json({ success: true }),
    () => handleRequest(multipartRequest(null, "https://ocr-transport.bpd-gaming-network.com/api/ocr"), env));
    assert.equal(response.status, 200);
    assert.equal(mtlsRequests.length, 1);
    const wrongHost = await handleRequest(multipartRequest(null, "https://attacker.example/api/ocr"), env);
    assert.equal(wrongHost.status, 404);
});

test("rejects malformed certificate chain before STS", async () => {
    const { env, mtlsRequests } = makeEnvironment();
    env.OCR_GCP_X509_CERT_CHAIN = "not-json";
    const response = await withFetch(async () => { throw new Error("IAM must not run"); }, () => handleRequest(multipartRequest(), env));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID");
    assert.equal(mtlsRequests.length, 0);
});

test("performs STS, IAM, and fixed Cloud Run OCR; never returns or logs Google credentials", async () => {
    const { env, mtlsRequests } = makeEnvironment();
    const requests = [];
    const accessToken = `access-${certificateSequence}`;
    const tokenPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const idToken = `header.${tokenPayload}.id-token-never-return-this`;
    const logs = [];
    let cloudRunRequest = null;
    const originalInfo = console.info;
    const originalError = console.error;
    console.info = (...args) => logs.push(args);
    console.error = (...args) => logs.push(args);

    try {
        const response = await withFetch(async (url, request) => {
            requests.push({ url: String(url), request });
            if (String(url).includes("iamcredentials.googleapis.com")) {
                assert.equal(new Headers(request.headers).get("Authorization"), `Bearer ${accessToken}`);
                return Response.json({ token: idToken });
            }
            cloudRunRequest = { url: String(url), headers: new Headers(request.headers), body: request.body };
            return Response.json({
                success: true,
                matchId: "MATCH123456789012",
                accidentalEcho: `${idToken} private-test-api-key`
            });
        }, () => handleRequest(multipartRequest(), env));

        assert.equal(response.status, 200);
        const responseText = await response.text();
        assert.match(responseText, /MATCH123456789012/);
        assert.equal(responseText.includes(accessToken), false);
        assert.equal(responseText.includes(idToken), false);
        assert.equal(JSON.stringify(logs).includes(accessToken), false);
        assert.equal(JSON.stringify(logs).includes(idToken), false);
        assert.equal(mtlsRequests[0].url, "https://sts.mtls.googleapis.com/v1/token");
        assert.equal(requests.length, 2);
        assert.equal(cloudRunRequest.url, CLOUD_RUN_URL);
        assert.equal(cloudRunRequest.headers.get("Authorization"), `Bearer ${idToken}`);
        assert.equal(cloudRunRequest.headers.get("X-API-Key"), "private-test-api-key");
        assert.equal(cloudRunRequest.headers.get("X-BPD-OCR-Job-ID"), "ABCDEFGHIJKLMNOP");
        assert.match(cloudRunRequest.headers.get("Content-Type"), /^multipart\/form-data; boundary=/);
        assert.match(new TextDecoder().decode(cloudRunRequest.body), /image-bytes/);
    }
    finally {
        console.info = originalInfo;
        console.error = originalError;
    }
});

test("maps STS failure to stable Google auth code without leaking upstream details", async () => {
    const { env } = makeEnvironment({ stsFailure: true });
    const response = await withFetch(async () => { throw new Error("IAM must not run"); }, () => handleRequest(multipartRequest(), env));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "OCR_GOOGLE_STS_EXCHANGE_FAILED");
    assert.doesNotMatch(JSON.stringify(body), /subject_token|private-test-api-key|access_token/i);
});

test("maps IAM failure without returning its bearer token or response details", async () => {
    const { env } = makeEnvironment();
    const response = await withFetch(async () => Response.json({ error: { message: "iam private detail" } }, { status: 403 }), () => handleRequest(multipartRequest(), env));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "OCR_GOOGLE_ID_TOKEN_FAILED");
    assert.doesNotMatch(JSON.stringify(body), /iam private detail|access-/i);
});

test("preserves Cloud Run application status/body and rejects non-contract routes", async () => {
    const { env } = makeEnvironment();
    const tokenPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const response = await withFetch(async url => String(url).includes("iamcredentials.googleapis.com")
        ? Response.json({ token: `header.${tokenPayload}.sig` })
        : Response.json({ code: "OCR_REVIEW_REQUIRED", message: "Review needed." }, { status: 422 }),
    () => handleRequest(multipartRequest(), env));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { code: "OCR_REVIEW_REQUIRED", message: "Review needed." });

    const serverError = await withFetch(async url => String(url).includes("iamcredentials.googleapis.com")
        ? Response.json({ token: `header.${tokenPayload}.sig` })
        : Response.json({ code: "OCR_INTERNAL", message: "Provider failed." }, { status: 503 }),
    () => handleRequest(multipartRequest(), makeEnvironment().env));
    assert.equal(serverError.status, 503);

    const malformedResponse = await withFetch(async url => String(url).includes("iamcredentials.googleapis.com")
        ? Response.json({ token: `header.${tokenPayload}.sig` })
        : new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    () => handleRequest(multipartRequest(), makeEnvironment().env));
    assert.equal(malformedResponse.status, 200);
    assert.equal(await malformedResponse.text(), "not-json");

    const arbitrary = await handleRequest(multipartRequest(new FormData(), "https://internal/proxy?url=https://evil.test"), env);
    assert.equal(arbitrary.status, 404);
});

test("validates method, multipart fields, and request/image limits", async () => {
    const env = makeEnvironment().env;
    const wrongMethod = await handleRequest(new Request("https://internal/api/ocr"), env);
    assert.equal(wrongMethod.status, 405);
    const noImage = await handleRequest(multipartRequest(new FormData()), env);
    assert.equal(noImage.status, 400);
    const empty = new FormData();
    empty.set("image", new Blob([]), "empty.png");
    assert.equal((await handleRequest(multipartRequest(empty), env)).status, 400);

    const oversized = new Request("https://ocr-google-transport.internal/api/ocr", {
        method: "POST",
        headers: {
            "Content-Type": "multipart/form-data; boundary=sample",
            "Content-Length": String(16 * 1024 * 1024 + 1),
            Authorization: `Bearer ${"T".repeat(48)}`
        },
        body: ""
    });
    assert.equal((await handleRequest(oversized, env)).status, 413);
});

test("returns safe transport failure for Cloud Run network and timeout errors", async () => {
    const { env } = makeEnvironment();
    const tokenPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const networkResponse = await withFetch(async url => {
        if (String(url).includes("iamcredentials.googleapis.com")) return Response.json({ token: `header.${tokenPayload}.sig` });
        throw new Error("upstream secret detail");
    }, () => handleRequest(multipartRequest(), env));
    assert.equal(networkResponse.status, 502);
    assert.equal((await networkResponse.json()).code, "OCR_PROVIDER_TRANSPORT_FAILED");

    const timeoutEnvironment = makeEnvironment().env;
    timeoutEnvironment.OCR_PROVIDER_TIMEOUT_MS = 1000;
    const timeoutTokenPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const timeoutResponse = await withFetch(async (url, request) => {
        if (String(url).includes("iamcredentials.googleapis.com")) return Response.json({ token: `header.${timeoutTokenPayload}.sig` });
        return new Promise((resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
    }, () => handleRequest(multipartRequest(), timeoutEnvironment));
    assert.equal(timeoutResponse.status, 502);
    assert.equal((await timeoutResponse.json()).code, "OCR_PROVIDER_TIMEOUT");
});
