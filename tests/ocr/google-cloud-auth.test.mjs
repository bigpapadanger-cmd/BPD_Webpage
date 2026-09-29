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

test("STS rejection logs safe diagnostics and redacts credential material", async () => {
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
        "authStage",
        "httpStatus",
        "responseContentType",
        "googleError",
        "googleErrorDescription",
        "googleErrorUri",
        "requestAudience",
        "providerResource",
        "mtlsBindingPresent",
        "certificateChainPresent",
        "certificateChainEntryCount",
        "serviceAccountEmail"
    ].sort());
    assert.equal(diagnostic.authStage, "sts_exchange");
    assert.equal(diagnostic.httpStatus, 400);
    assert.equal(diagnostic.responseContentType, "application/json; charset=utf-8");
    assert.equal(diagnostic.mtlsBindingPresent, true);
    assert.equal(diagnostic.certificateChainPresent, true);
    assert.equal(diagnostic.certificateChainEntryCount, 1);
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
        assert.equal(calls.length, 1);
        assert.equal(JSON.stringify(calls).includes("federated-access-secret"), false);
        assert.equal(authError.message, "Google authentication could not be completed.");
        assert.equal(String(authError.stack).includes("federated-access-secret"), false);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test("production STS fetch preserves the mTLS binding receiver and has no diagnostic overrides", async () => {
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
        normal.env.OCR_GCP_STS_DIAGNOSTIC_DIRECT_FETCH = "true";
        normal.env.OCR_GCP_STS_DIAGNOSTIC_NO_SIGNAL = "true";
        normal.env.OCR_GCP_STS_DIAGNOSTIC_MANUAL_REDIRECT = "true";
        const { result: request } = await captureConsoleError(
            () => captureStsRequest(normal.env)
        );

        assert.equal(request.url, EXPECTED_STS_URL);
        assert.equal(request.options.method, "POST");
        assert.equal(request.options.signal instanceof AbortSignal, true);
        assert.equal(request.options.redirect, undefined);
        assert.equal(request.options.headers["Content-Type"], "application/json");
        const body = JSON.parse(request.options.body);
        assert.equal(body.audience, EXPECTED_PROVIDER_RESOURCE);
        assert.equal(body.subject_token_type, "urn:ietf:params:oauth:token-type:mtls");
        assert.ok(body.subject_token);
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
