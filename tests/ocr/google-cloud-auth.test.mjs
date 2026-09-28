import assert from "node:assert/strict";
import test from "node:test";

import { getGoogleCloudRunIdToken } from "../../functions/services/ocr/googleCloudAuth.js";

const EXPECTED_PROVIDER_RESOURCE =
    "//iam.googleapis.com/projects/1094994524157/locations/global/workloadIdentityPools/ocr-cloudflare-transfer-handle/providers/bpd-ocr-cloudflare-x509";
const EXPECTED_STS_URL = "https://sts.mtls.googleapis.com/v1/token";

function createEnvironment(certificateValue = "A".repeat(160)) {
    const certificate = btoa(certificateValue);
    const mtlsCalls = [];
    const env = {
        OCR_GCP_PROJECT_NUMBER: "1094994524157",
        OCR_GCP_WORKLOAD_IDENTITY_POOL_ID: "ocr-cloudflare-transfer-handle",
        OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "bpd-ocr-cloudflare-x509",
        OCR_GCP_SERVICE_ACCOUNT_EMAIL: "ocr-cloudflare-handler@example.iam.gserviceaccount.com",
        OCR_GCP_X509_CERT_CHAIN: JSON.stringify([certificate]),
        OCR_API_KEY: "ocr/api+key-secret",
        OCR_GCP_MTLS: {
            async fetch(url, options) {
                mtlsCalls.push({ url: String(url), options });
                return Response.json({ access_token: "federated-access-token", expires_in: 3600 });
            }
        }
    };
    return { env, mtlsCalls, certificate, certificateValue };
}

function captureConsoleError(run) {
    const originalError = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    return Promise.resolve()
        .then(run)
        .finally(() => {
            console.error = originalError;
        })
        .then(result => ({ result, calls }));
}

test("STS rejection logs only temporary mTLS diagnostics and redacts credential material", async () => {
    const { env, mtlsCalls, certificate, certificateValue } = createEnvironment();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("ID token exchange must not run after STS rejection");
    };
    env.OCR_GCP_MTLS.fetch = async (url, options) => {
        mtlsCalls.push({ url: String(url), options });
        return Response.json({
            error: "invalid_grant",
            error_description: `certificate ${certificate}; decoded ${certificateValue}; subject ${JSON.stringify([certificate])}; API key ocr/api+key-secret; encoded key ocr%2Fapi%2Bkey-secret; Bearer leaked-token; -----BEGIN PRIVATE KEY-----secret-key-material-----END PRIVATE KEY-----`,
            error_uri: "https://sts.example/errors/invalid-grant?token=leaked-token"
        }, {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" }
        });
    };

    const captured = await captureConsoleError(async () => {
        try {
            await getGoogleCloudRunIdToken(env, "https://ocr-service-abc.run.app/api/ocr");
        }
        catch (error) {
            assert.equal(error.code, "OCR_GOOGLE_STS_EXCHANGE_FAILED");
            assert.equal(error.message, "Google authentication could not be completed.");
            return error;
        }
        throw new Error("Expected Google STS exchange to fail.");
    }).finally(() => {
        globalThis.fetch = originalFetch;
    });
    const { result: authError, calls } = captured;

    assert.equal(mtlsCalls.length, 1);
    assert.equal(mtlsCalls[0].url, EXPECTED_STS_URL);
    assert.equal(mtlsCalls[0].options.method, "POST");
    const stsBody = JSON.parse(mtlsCalls[0].options.body);
    assert.equal(stsBody.audience, EXPECTED_PROVIDER_RESOURCE);
    assert.equal(stsBody.subject_token_type, "urn:ietf:params:oauth:token-type:mtls");

    const diagnostic = calls[0][1];
    assert.deepEqual(Object.keys(diagnostic).sort(), [
        "sameBindingObject",
        "bindingFetchType",
        "requestMethod",
        "hostname",
        "hasSignal",
        "contentType",
        "bodyLength",
        "bodyFieldNames",
        "redirectMode",
        "responseStatus",
        "locationHeaderExists",
        "redirectLocationHostPath",
        "googleError",
        "googleErrorDescription",
    ].sort());
    assert.equal(diagnostic.sameBindingObject, true);
    assert.equal(diagnostic.bindingFetchType, "function");
    assert.equal(diagnostic.requestMethod, "POST");
    assert.equal(diagnostic.hostname, "sts.mtls.googleapis.com");
    assert.equal(diagnostic.hasSignal, true);
    assert.equal(diagnostic.contentType, "application/json");
    assert.ok(diagnostic.bodyLength > 0);
    assert.deepEqual(diagnostic.bodyFieldNames, [
        "audience",
        "grant_type",
        "requested_token_type",
        "scope",
        "subject_token",
        "subject_token_type"
    ]);
    assert.equal(diagnostic.responseStatus, 400);
    assert.equal(diagnostic.redirectMode, "follow");
    assert.equal(diagnostic.locationHeaderExists, false);
    assert.equal(diagnostic.redirectLocationHostPath, null);
    assert.equal(diagnostic.googleError, "invalid_grant");
    assert.match(diagnostic.googleErrorDescription, /certificate \[REDACTED\]/);

    const logged = JSON.stringify(calls);
    for (const secret of [certificate, certificateValue, JSON.stringify([certificate]), "ocr/api+key-secret", "ocr%2Fapi%2Bkey-secret", "leaked-token", "secret-key-material"]) {
        assert.equal(logged.includes(secret), false, `diagnostic log leaked ${secret}`);
    }
    assert.equal(authError.message, "Google authentication could not be completed.");
    assert.equal(authError.message.includes("invalid_grant"), false);
    for (const secret of [certificate, certificateValue, "ocr/api+key-secret", "leaked-token", "secret-key-material"]) {
        assert.equal(String(authError.stack).includes(secret), false, `thrown error leaked ${secret}`);
    }
});

test("service-account ID-token rejection preserves its external code and redacts the federated token", async () => {
    const { env, mtlsCalls } = createEnvironment("B".repeat(160));
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return Response.json({
            error: "permission_denied",
            error_description: "invalid federated-access-secret",
            error_uri: "https://iam.example/errors/denied"
        }, {
            status: 403,
            headers: { "Content-Type": "application/json" }
        });
    };

    try {
        const { result: authError, calls } = await captureConsoleError(async () => {
            env.OCR_GCP_MTLS.fetch = async (url, options) => {
                mtlsCalls.push({ url: String(url), options });
                return Response.json({
                    access_token: "federated-access-secret",
                    expires_in: 3600
                });
            };
            try {
                await getGoogleCloudRunIdToken(env, "https://other-ocr-service.run.app/route");
            }
            catch (error) {
                assert.equal(error.code, "OCR_GOOGLE_ID_TOKEN_FAILED");
                assert.equal(error.message, "Google authentication could not be completed.");
                return error;
            }
            throw new Error("Expected service-account ID-token exchange to fail.");
        });

        assert.equal(mtlsCalls[0].url, EXPECTED_STS_URL);
        assert.equal(requests.length, 1);
        assert.match(requests[0].url, /^https:\/\/iamcredentials\.googleapis\.com\/v1\/projects\/\-\/serviceAccounts\//);
        const body = JSON.parse(requests[0].options.body);
        assert.equal(body.audience, "https://other-ocr-service.run.app");
        const idTokenDiagnostic = calls.find(call =>
            call[0] === "[OCR GOOGLE AUTH] Google token endpoint rejected authentication."
        )[1];
        assert.equal(idTokenDiagnostic.authStage, "service_account_id_token");
        assert.equal(idTokenDiagnostic.httpStatus, 403);
        assert.equal(idTokenDiagnostic.googleError, "permission_denied");
        assert.equal(idTokenDiagnostic.googleErrorUri, "https://iam.example/errors/denied");
        const stsDiagnostic = calls.find(call =>
            call[0] === "[OCR GOOGLE AUTH] Temporary mTLS STS diagnostic."
        )[1];
        assert.equal(stsDiagnostic.responseStatus, 200);
        assert.equal(stsDiagnostic.googleError, null);
        assert.equal(JSON.stringify(calls).includes("federated-access-secret"), false);
        assert.equal(authError.message, "Google authentication could not be completed.");
        assert.equal(String(authError.stack).includes("federated-access-secret"), false);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test("normal STS fetch preserves the binding receiver and direct diagnostic path keeps the exact request body", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("ID token exchange must not run after STS rejection");
    };

    async function captureStsRequest(env) {
        let request;
        const binding = env.OCR_GCP_MTLS;
        binding.fetch = async function(url, options) {
            assert.equal(this, binding, "mTLS fetch receiver must remain the original binding");
            request = { url: String(url), options };
            return Response.json({
                error: "invalid_grant",
                error_description: `No client cert found. Chain ${env.OCR_GCP_X509_CERT_CHAIN}; API key ${env.OCR_API_KEY}.`
            }, { status: 400 });
        };

        await assert.rejects(
            getGoogleCloudRunIdToken(env, "https://diagnostic-ocr-service.run.app"),
            error => error.code === "OCR_GOOGLE_STS_EXCHANGE_FAILED"
        );
        return request;
    }

    try {
        const normal = createEnvironment("D".repeat(160));
        const direct = createEnvironment("D".repeat(160));
        direct.env.OCR_GCP_STS_DIAGNOSTIC_DIRECT_FETCH = "true";

        const { result: normalRequest, calls: normalLogs } = await captureConsoleError(
            () => captureStsRequest(normal.env)
        );
        const { result: directRequest, calls: directLogs } = await captureConsoleError(
            () => captureStsRequest(direct.env)
        );

        assert.equal(normalRequest.url, EXPECTED_STS_URL);
        assert.equal(directRequest.url, EXPECTED_STS_URL);
        assert.equal(normalRequest.options.method, "POST");
        assert.equal(directRequest.options.method, "POST");
        assert.equal(normalRequest.options.signal instanceof AbortSignal, true);
        assert.equal(directRequest.options.signal instanceof AbortSignal, true);
        assert.equal(normalRequest.options.redirect, undefined);
        assert.equal(directRequest.options.redirect, undefined);
        assert.equal(normalRequest.options.headers["Content-Type"], "application/json");
        assert.equal(directRequest.options.headers["Content-Type"], "application/json");
        assert.equal(normalRequest.options.body, directRequest.options.body);

        const normalDiagnostic = normalLogs.find(call =>
            call[0] === "[OCR GOOGLE AUTH] Temporary mTLS STS diagnostic."
        )[1];
        const directDiagnostic = directLogs.find(call =>
            call[0] === "[OCR GOOGLE AUTH] Temporary mTLS STS diagnostic."
        )[1];
        assert.deepEqual(normalDiagnostic, directDiagnostic);
        assert.equal(normalDiagnostic.sameBindingObject, true);
        assert.equal(normalDiagnostic.hasSignal, true);
        assert.equal(normalDiagnostic.redirectMode, "follow");
        assert.equal(normalDiagnostic.locationHeaderExists, false);
        assert.equal(normalDiagnostic.redirectLocationHostPath, null);
        assert.equal(JSON.stringify(directLogs).includes(direct.env.OCR_GCP_X509_CERT_CHAIN), false);
        assert.equal(JSON.stringify(directLogs).includes(direct.env.OCR_API_KEY), false);
        assert.equal(JSON.stringify(directLogs).includes("D".repeat(160)), false);

        direct.env.OCR_GCP_STS_DIAGNOSTIC_NO_SIGNAL = "true";
        const { result: noSignalRequest, calls: noSignalLogs } = await captureConsoleError(
            () => captureStsRequest(direct.env)
        );
        assert.equal(noSignalRequest.options.signal, undefined);
        assert.equal(noSignalRequest.options.redirect, undefined);
        assert.equal(noSignalLogs[0][1].hasSignal, false);
        assert.equal(noSignalRequest.options.body, directRequest.options.body);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test("manual STS redirect diagnostic is opt-in and redacts Location query values", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("ID token exchange must not run after STS rejection.");
    };

    const normal = createEnvironment("E".repeat(160));
    const manual = createEnvironment("E".repeat(160));
    manual.env.OCR_GCP_STS_DIAGNOSTIC_MANUAL_REDIRECT = "true";

    async function rejectStsRequest(environment, response) {
        const binding = environment.OCR_GCP_MTLS;
        let request;
        binding.fetch = async function(url, options) {
            assert.equal(this, binding);
            request = { url: String(url), options };
            return response;
        };

        const { calls } = await captureConsoleError(async () => {
            await assert.rejects(
                getGoogleCloudRunIdToken(environment, "https://redirect-ocr-service.run.app"),
                error => {
                    assert.equal(error.code, "OCR_GOOGLE_STS_EXCHANGE_FAILED");
                    assert.equal(error.message, "Google authentication could not be completed.");
                    return true;
                }
            );
        });
        return { request, calls };
    }

    try {
        const normalResult = await rejectStsRequest(
            normal.env,
            Response.json({ error: "invalid_grant", error_description: "normal rejection" }, { status: 400 })
        );
        const manualResult = await rejectStsRequest(
            manual.env,
            new Response(null, {
                status: 302,
                headers: {
                    Location: "https://redirect.example/google/sts/ocr%2Fapi%2Bkey-secret?subject_token=redirect-secret&code=private"
                }
            })
        );

        assert.equal(normalResult.request.url, EXPECTED_STS_URL);
        assert.equal(manualResult.request.url, EXPECTED_STS_URL);
        assert.equal(normalResult.request.options.method, "POST");
        assert.equal(manualResult.request.options.method, "POST");
        assert.equal(normalResult.request.options.redirect, undefined);
        assert.equal(manualResult.request.options.redirect, "manual");
        assert.equal(normalResult.request.options.headers["Content-Type"], "application/json");
        assert.equal(manualResult.request.options.headers["Content-Type"], "application/json");
        assert.equal(normalResult.request.options.body, manualResult.request.options.body);

        const normalBody = JSON.parse(normalResult.request.options.body);
        assert.equal(normalBody.audience, EXPECTED_PROVIDER_RESOURCE);
        assert.equal(normalBody.subject_token_type, "urn:ietf:params:oauth:token-type:mtls");
        assert.ok(normalBody.subject_token);

        const normalDiagnostic = normalResult.calls[0][1];
        const manualDiagnostic = manualResult.calls[0][1];
        assert.equal(normalDiagnostic.redirectMode, "follow");
        assert.equal(normalDiagnostic.locationHeaderExists, false);
        assert.equal(normalDiagnostic.redirectLocationHostPath, null);
        assert.equal(manualDiagnostic.redirectMode, "manual");
        assert.equal(manualDiagnostic.responseStatus, 302);
        assert.equal(manualDiagnostic.locationHeaderExists, true);
        assert.deepEqual(manualDiagnostic.redirectLocationHostPath, {
            hostname: "redirect.example",
            path: "/google/sts/[REDACTED]"
        });
        assert.equal(manualDiagnostic.googleError, null);
        assert.equal(manualDiagnostic.googleErrorDescription, null);

        const logs = JSON.stringify(manualResult.calls);
        for (const secret of [
            "redirect-secret",
            "private",
            normalBody.subject_token,
            manual.env.OCR_GCP_X509_CERT_CHAIN,
            manual.env.OCR_API_KEY
        ]) {
            assert.equal(logs.includes(secret), false, `diagnostic log leaked ${secret}`);
        }
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test("X.509 certificate chain remains required", async () => {
    const { env } = createEnvironment();
    delete env.OCR_GCP_X509_CERT_CHAIN;

    await assert.rejects(
        getGoogleCloudRunIdToken(env, "https://ocr-service.run.app"),
        error => error.code === "OCR_GOOGLE_CERTIFICATE_CHAIN_MISSING"
    );
});

test("unexpected binding exceptions are replaced by generic auth errors", async () => {
    const { env, certificate } = createEnvironment("C".repeat(160));
    env.OCR_GCP_MTLS.fetch = async () => {
        const error = new Error(`private certificate ${certificate} and API key ${env.OCR_API_KEY}`);
        error.code = "SENSITIVE_RUNTIME_ERROR";
        throw error;
    };

    await assert.rejects(
        getGoogleCloudRunIdToken(env, "https://binding-error-service.run.app"),
        error => {
            assert.equal(error.code, "OCR_GOOGLE_STS_EXCHANGE_FAILED");
            assert.equal(error.message, "Google authentication could not be completed.");
            assert.equal(String(error.stack).includes(certificate), false);
            assert.equal(String(error.stack).includes(env.OCR_API_KEY), false);
            return true;
        }
    );
});
