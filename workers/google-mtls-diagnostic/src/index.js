"use strict";

const WORKER_NAME = "google-mtls-diagnostic";
const GOOGLE_STS_URL = "https://sts.mtls.googleapis.com/v1/token";
const GOOGLE_STS_HOSTNAME = "sts.mtls.googleapis.com";
const GOOGLE_TOKEN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const FEDERATED_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const X509_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:mtls";
const IAM_CREDENTIALS_URL = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
const MAX_CHAIN_ENTRIES = 8;
const MAX_CERTIFICATE_BYTES = 16384;
const MAX_RESPONSE_BYTES = 32768;
const MAX_DIAGNOSTIC_SECRET_LENGTH = 256;

export function buildProviderResource(env) {
    const projectNumber = String(env?.OCR_GCP_PROJECT_NUMBER || "").trim();
    const poolId = String(env?.OCR_GCP_WORKLOAD_IDENTITY_POOL_ID || "").trim();
    const providerId = String(env?.OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID || "").trim();

    if (
        !/^\d{6,20}$/.test(projectNumber)
        || !/^[a-z][a-z0-9-]{2,31}$/.test(poolId)
        || !/^[a-z][a-z0-9-]{2,31}$/.test(providerId)
    ) {
        throw new Error("WIF_CONFIGURATION_INVALID");
    }

    return `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
}

export function parseCertificateChain(serialized) {
    if (typeof serialized !== "string" || !serialized || serialized.length > MAX_CHAIN_ENTRIES * MAX_CERTIFICATE_BYTES * 1.5) {
        throw new Error("CERTIFICATE_CHAIN_INVALID");
    }

    let chain;
    try {
        chain = JSON.parse(serialized);
    }
    catch {
        throw new Error("CERTIFICATE_CHAIN_INVALID");
    }

    if (!Array.isArray(chain) || chain.length < 1 || chain.length > MAX_CHAIN_ENTRIES) {
        throw new Error("CERTIFICATE_CHAIN_INVALID");
    }

    for (const certificate of chain) {
        if (
            typeof certificate !== "string"
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(certificate)
            || certificate.length % 4 === 1
        ) {
            throw new Error("CERTIFICATE_CHAIN_INVALID");
        }

        let decoded;
        try {
            decoded = atob(certificate.padEnd(certificate.length + ((4 - certificate.length % 4) % 4), "="));
        }
        catch {
            throw new Error("CERTIFICATE_CHAIN_INVALID");
        }

        if (!decoded.length || decoded.length > MAX_CERTIFICATE_BYTES) {
            throw new Error("CERTIFICATE_CHAIN_INVALID");
        }
    }

    return chain;
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

function constantTimeEqual(left, right) {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    const length = Math.max(leftBytes.length, rightBytes.length);
    let difference = leftBytes.length ^ rightBytes.length;

    for (let index = 0; index < length; index += 1) {
        difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }

    return difference === 0;
}

function safeSecrets(env, chain = [], additional = []) {
    const values = [
        env?.DIAGNOSTIC_BEARER_TOKEN,
        env?.OCR_GCP_X509_CERT_CHAIN,
        chain.length ? JSON.stringify(chain) : null,
        ...chain.flatMap(certificate => {
            try {
                return [certificate, atob(certificate)];
            }
            catch {
                return [certificate];
            }
        }),
        ...additional
    ];

    return [...new Set(values.filter(value => typeof value === "string" && value.length > 0))];
}

function sanitizeText(value, secrets = []) {
    if (typeof value !== "string") {
        return null;
    }

    let safeValue = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const redactions = secrets.flatMap(secret => {
        const variants = [secret];
        try {
            variants.push(encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1));
        }
        catch {
            // Retain exact-value redaction if an encoding helper rejects input.
        }
        return variants;
    }).sort((left, right) => right.length - left.length);

    for (const secret of redactions) {
        safeValue = safeValue.split(secret).join("[REDACTED]");
    }

    return safeValue
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/\bya29\.[A-Za-z0-9._~-]+/g, "[REDACTED_TOKEN]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
        .replace(/\b((?:[A-Z0-9_]*_)?API[_ -]?KEY|(?:subject|access|id)[_ -]?token|authorization)\b\s*[:=]\s*["']?[^,\s"'<>]+/gi, "$1=[REDACTED]")
        .slice(0, 512) || null;
}

function googleErrorFields(payload, secrets) {
    const error = typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.error?.status === "string"
            ? payload.error.status
            : null;
    const description = typeof payload?.error_description === "string"
        ? payload.error_description
        : typeof payload?.error?.message === "string"
            ? payload.error.message
            : null;

    return {
        googleError: sanitizeText(error, secrets),
        googleErrorDescription: sanitizeText(description, secrets)
    };
}

async function readResponseJson(response) {
    const contentLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        try {
            await response.body?.cancel();
        }
        catch {
            // Ignore unread body cleanup failures.
        }
        return null;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return null;
    }

    const chunks = [];
    let byteLength = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            byteLength += value.byteLength;
            if (byteLength > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    }
    catch {
        try {
            await reader.cancel();
        }
        catch {
            // Ignore response-stream cleanup failures.
        }
        return null;
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        return payload && typeof payload === "object" && !Array.isArray(payload)
            ? payload
            : null;
    }
    catch {
        return null;
    }
}

function bindingMetadata(env) {
    return {
        bindingExists: Boolean(env?.OCR_GCP_MTLS),
        bindingFetchIsFunction: typeof env?.OCR_GCP_MTLS?.fetch === "function",
        destinationHostname: GOOGLE_STS_HOSTNAME
    };
}

function authorizeRequest(request, env) {
    const expected = typeof env?.DIAGNOSTIC_BEARER_TOKEN === "string"
        ? env.DIAGNOSTIC_BEARER_TOKEN
        : "";

    if (expected.length < 32 || expected.length > MAX_DIAGNOSTIC_SECRET_LENGTH) {
        return jsonResponse({ success: false, error: "DIAGNOSTIC_AUTH_NOT_CONFIGURED" }, 503);
    }

    const authorization = request.headers.get("Authorization") || "";
    const prefix = "Bearer ";
    const provided = authorization.startsWith(prefix)
        ? authorization.slice(prefix.length)
        : "";

    if (!provided || provided.length > MAX_DIAGNOSTIC_SECRET_LENGTH || !constantTimeEqual(provided, expected)) {
        return jsonResponse({ success: false, error: "UNAUTHORIZED" }, 401);
    }

    return null;
}

function logSafeProbe(probe, result) {
    console.info("[Google mTLS diagnostic]", {
        probe,
        probeCompleted: result.probeCompleted === true,
        success: result.success === true,
        destinationHostname: result.destinationHostname || GOOGLE_STS_HOSTNAME,
        httpStatus: result.httpStatus ?? null,
        googleError: result.googleError || null,
        googleErrorDescription: result.googleErrorDescription || null,
        ...(typeof result.accessTokenReceived === "boolean"
            ? { accessTokenReceived: result.accessTokenReceived }
            : {}),
        ...(typeof result.idTokenReceived === "boolean"
            ? { idTokenReceived: result.idTokenReceived }
            : {})
    });
}

function requestMetadata(env, options, chain = []) {
    let bodyFieldNames = [];
    try {
        const body = JSON.parse(options.body);
        if (body && typeof body === "object" && !Array.isArray(body)) {
            bodyFieldNames = Object.keys(body).sort();
        }
    }
    catch {
        // An empty/malformed request has no reportable fields.
    }

    return {
        ...bindingMetadata(env),
        requestMethod: options.method,
        contentType: new Headers(options.headers).get("Content-Type"),
        bodyFieldNames,
        subjectTokenPresent: chain.length > 0,
        subjectTokenChainCount: chain.length
    };
}

async function handleEmptyProbe(env) {
    const options = {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
        redirect: "manual"
    };
    const metadata = requestMetadata(env, options);

    if (!metadata.bindingFetchIsFunction) {
        return jsonResponse({ probeCompleted: false, success: false, ...metadata }, 503);
    }

    try {
        const response = await env.OCR_GCP_MTLS.fetch(GOOGLE_STS_URL, options);
        const payload = await readResponseJson(response);
        const secrets = safeSecrets(env);
        const result = {
            probeCompleted: true,
            success: response.ok,
            ...metadata,
            httpStatus: Number(response.status) || 0,
            ...googleErrorFields(payload, secrets)
        };
        logSafeProbe("empty", result);
        return jsonResponse(result);
    }
    catch {
        const result = {
            probeCompleted: false,
            success: false,
            ...metadata,
            httpStatus: null,
            googleError: null,
            googleErrorDescription: null,
            error: "GOOGLE_STS_REQUEST_FAILED"
        };
        logSafeProbe("empty", result);
        return jsonResponse(result, 502);
    }
}

function readWifConfiguration(env) {
    const providerResource = buildProviderResource(env);
    const serviceAccountEmail = String(env?.OCR_GCP_SERVICE_ACCOUNT_EMAIL || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/i.test(serviceAccountEmail)) {
        throw new Error("WIF_CONFIGURATION_INVALID");
    }
    return { providerResource, serviceAccountEmail };
}

async function performFullSts(env) {
    const metadataBase = {
        ...bindingMetadata(env),
        requestMethod: "POST",
        contentType: "application/json",
        bodyFieldNames: [
            "audience",
            "grant_type",
            "requested_token_type",
            "scope",
            "subject_token",
            "subject_token_type"
        ]
    };

    if (!metadataBase.bindingFetchIsFunction) {
        return {
            publicResult: {
                probeCompleted: false,
                success: false,
                ...metadataBase,
                subjectTokenPresent: false,
                subjectTokenChainCount: 0,
                httpStatus: null,
                error: "MTLS_BINDING_MISSING"
            },
            accessToken: null,
            secrets: safeSecrets(env)
        };
    }

    let config;
    let chain;
    try {
        config = readWifConfiguration(env);
        chain = parseCertificateChain(env?.OCR_GCP_X509_CERT_CHAIN);
    }
    catch (error) {
        return {
            publicResult: {
                probeCompleted: false,
                success: false,
                ...metadataBase,
                subjectTokenPresent: false,
                subjectTokenChainCount: 0,
                httpStatus: null,
                error: error.message === "CERTIFICATE_CHAIN_INVALID"
                    ? "CERTIFICATE_CHAIN_INVALID"
                    : "WIF_CONFIGURATION_INVALID"
            },
            accessToken: null,
            secrets: safeSecrets(env)
        };
    }

    const subjectToken = JSON.stringify(chain);
    const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: TOKEN_EXCHANGE_GRANT,
            audience: config.providerResource,
            requested_token_type: FEDERATED_TOKEN_TYPE,
            subject_token_type: X509_SUBJECT_TOKEN_TYPE,
            subject_token: subjectToken,
            scope: GOOGLE_TOKEN_SCOPE
        }),
        redirect: "manual"
    };
    const metadata = {
        ...metadataBase,
        subjectTokenPresent: true,
        subjectTokenChainCount: chain.length
    };
    const secrets = safeSecrets(env, chain, [subjectToken]);

    try {
        const response = await env.OCR_GCP_MTLS.fetch(GOOGLE_STS_URL, options);
        const payload = await readResponseJson(response);
        const accessToken = typeof payload?.access_token === "string" && payload.access_token.length > 0
            ? payload.access_token
            : null;
        const result = {
            probeCompleted: true,
            success: response.ok && Boolean(accessToken),
            ...metadata,
            httpStatus: Number(response.status) || 0,
            ...(response.ok
                ? {
                    issuedTokenType: payload?.issued_token_type === FEDERATED_TOKEN_TYPE
                        ? FEDERATED_TOKEN_TYPE
                        : null,
                    tokenType: payload?.token_type === "Bearer" ? "Bearer" : null,
                    expiresIn: Number.isInteger(payload?.expires_in) && payload.expires_in >= 0 && payload.expires_in <= 86400
                        ? payload.expires_in
                        : null,
                    accessTokenReceived: Boolean(accessToken),
                    ...(!accessToken ? { error: "GOOGLE_STS_RESPONSE_INVALID" } : {})
                }
                : googleErrorFields(payload, secrets))
        };
        logSafeProbe("full-sts", result);
        return { publicResult: result, accessToken, secrets };
    }
    catch {
        const result = {
            probeCompleted: false,
            success: false,
            ...metadata,
            httpStatus: null,
            googleError: null,
            googleErrorDescription: null,
            error: "GOOGLE_STS_REQUEST_FAILED"
        };
        logSafeProbe("full-sts", result);
        return { publicResult: result, accessToken: null, secrets };
    }
}

async function handleIdTokenProbe(env) {
    const sts = await performFullSts(env);
    if (!sts.accessToken) {
        return jsonResponse({ probe: "id-token", ...sts.publicResult });
    }

    let audience;
    let serviceAccountEmail;
    try {
        ({ serviceAccountEmail } = readWifConfiguration(env));
        const audienceUrl = new URL(String(env?.OCR_GCP_CLOUD_RUN_AUDIENCE || ""));
        if (audienceUrl.protocol !== "https:" || audienceUrl.username || audienceUrl.password) {
            throw new Error();
        }
        audience = audienceUrl.origin;
    }
    catch {
        return jsonResponse({
            probeCompleted: false,
            success: false,
            probe: "id-token",
            error: "ID_TOKEN_CONFIGURATION_INVALID"
        }, 503);
    }

    const url = `${IAM_CREDENTIALS_URL}/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${sts.accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ audience, includeEmail: true }),
            redirect: "manual"
        });
    }
    catch {
        const result = {
            probeCompleted: false,
            success: false,
            probe: "id-token",
            destinationHostname: "iamcredentials.googleapis.com",
            httpStatus: null,
            idTokenReceived: false,
            googleError: null,
            googleErrorDescription: null,
            error: "GOOGLE_ID_TOKEN_REQUEST_FAILED"
        };
        logSafeProbe("id-token", result);
        return jsonResponse(result, 502);
    }

    const payload = await readResponseJson(response);
    const idToken = typeof payload?.token === "string" && payload.token.length > 0
        ? payload.token
        : null;
    const secrets = safeSecrets(env, sts.secrets || [], [sts.accessToken, idToken || ""]);
    const result = {
        probeCompleted: true,
        success: response.ok && Boolean(idToken),
        probe: "id-token",
        destinationHostname: "iamcredentials.googleapis.com",
        requestMethod: "POST",
        contentType: "application/json",
        httpStatus: Number(response.status) || 0,
        idTokenReceived: Boolean(idToken),
        ...(response.ok
            ? { ...(idToken ? {} : { error: "GOOGLE_ID_TOKEN_RESPONSE_INVALID" }) }
            : googleErrorFields(payload, secrets))
    };
    logSafeProbe("id-token", result);
    return jsonResponse(result);
}

export async function handleRequest(request, env) {
    const unauthorized = authorizeRequest(request, env);
    if (unauthorized) {
        return unauthorized;
    }

    const url = new URL(request.url);
    if ((url.pathname === "/" || url.pathname === "/health") && request.method === "GET") {
        return jsonResponse({
            success: true,
            worker: WORKER_NAME,
            ...bindingMetadata(env)
        });
    }

    if (request.method !== "POST") {
        return jsonResponse({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (url.pathname === "/probe/empty") {
        return handleEmptyProbe(env);
    }
    if (url.pathname === "/probe/full-sts") {
        const result = await performFullSts(env);
        const status = result.publicResult.probeCompleted !== true
            ? 503
            : 200;
        return jsonResponse(result.publicResult, status);
    }
    if (url.pathname === "/probe/id-token") {
        return handleIdTokenProbe(env);
    }

    return jsonResponse({ success: false, error: "NOT_FOUND" }, 404);
}

export default {
    fetch: handleRequest
};
