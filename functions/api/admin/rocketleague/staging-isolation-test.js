import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";

const TEST_GATE = "RL_PROBE_STAGING_TEST_ENABLED";
const CONFIRMATION = "RUN_STAGING_ISOLATION_TEST";
const CALLER_CHECK_HEADER = "x-bpd-staging-caller-check";
const CALLER_NONCE_HEADER = "x-bpd-staging-caller-nonce";
const CALLER_PROOF_PURPOSE = "bpd-provider-runtime-staging-caller-check-v1\0";
const REVOCATION_CHECK_HEADER = "x-bpd-staging-revocation-check";
const REVOCATION_PROOF_PURPOSE = "bpd-provider-runtime-staging-revocation-check-v1\0";
const SIGNING_CHECK_PURPOSE = "bpd.rl.staging.signing-key-correspondence.v1";
const SIGNING_CHECK_TTL_SECONDS = 30;
const hashPattern = /^[a-f0-9]{64}$/u;
const safeFailureCodes = new Set(["STAGING_TEST_DISABLED", "STAGING_TEST_UNAVAILABLE", "STAGING_CLEANUP_INCOMPLETE", "STAGING_ISOLATION_ASSERTION_FAILED"]);

function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function validSecret(value) {
    return typeof value === "string" && value.length >= 64 && value.length <= 256 && value.trim() === value && !/\s/u.test(value);
}

function encodeBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function isBase64Url64(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{86}$/u.test(value)) return false;
    try {
        const decoded = Uint8Array.from(atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + "=="), character => character.charCodeAt(0));
        return decoded.length === 64 && encodeBase64Url(decoded) === value;
    }
    catch { return false; }
}

function decodeBase64Url32(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
    try {
        const decoded = atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + "=");
        return decoded.length === 32 ? Uint8Array.from(decoded, character => character.charCodeAt(0)) : null;
    } catch { return null; }
}

async function verifyRuntimeCallerProof(payload, secret, nonce) {
    if (payload?.code !== "INTERNAL_AUTH_REQUIRED") return "unavailable";
    const proof = decodeBase64Url32(payload.callerCheckProof);
    if (!proof) return "unavailable";
    try {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        const matches = await crypto.subtle.verify("HMAC", key, proof,
            new TextEncoder().encode(`${CALLER_PROOF_PURPOSE}${nonce}`));
        return matches ? "match" : "mismatch";
    } catch { return "unavailable"; }
}

async function verifyRuntimeRevocationProof(payload, secret, nonce) {
    if (payload?.success !== true || payload.service !== "bpd-provider-runtime" || payload.status !== "ok") return "unavailable";
    const proof = decodeBase64Url32(payload.revocationCredentialProof);
    if (!proof || !validSecret(secret)) return "unavailable";
    try {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        const matches = await crypto.subtle.verify("HMAC", key, proof,
            new TextEncoder().encode(`${REVOCATION_PROOF_PURPOSE}${nonce}`));
        return matches ? "match" : "mismatch";
    } catch { return "unavailable"; }
}

export function isSameOriginRequest(request) {
    return request.headers.get("origin") === new URL(request.url).origin
        && request.headers.get("sec-fetch-site") !== "cross-site";
}

export function isSafeHealthRead(request) {
    const origin = request.headers.get("origin");
    return request.headers.get("sec-fetch-site") !== "cross-site"
        && (!origin || origin === new URL(request.url).origin);
}

export function isLiveAdminHost(request) {
    const url = new URL(request.url);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "bpd-gaming-network.com";
}

async function callService(service, url, secret, body = undefined) {
    if (!service?.fetch || !validSecret(secret)) throw new Error("STAGING_TEST_UNAVAILABLE");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await service.fetch(new Request(url, {
            method: body === undefined ? "GET" : "POST",
            headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal
        }));
        const text = await response.text();
        if (text.length > 8192) throw new Error("STAGING_TEST_UNAVAILABLE");
        let payload;
        try { payload = JSON.parse(text); } catch { throw new Error("STAGING_TEST_UNAVAILABLE"); }
        return { ok: response.ok, payload };
    } catch { throw new Error("STAGING_TEST_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
}

function runtimeCall(env, operation, body, useRevocationSecret = false) {
    return callService(env.RL_PROBE_STAGING_RUNTIME,
        `https://provider-runtime-staging.internal/internal/rl-probe/${operation}`,
        useRevocationSecret ? env.RL_PROBE_STAGING_REVOCATION_SECRET : env.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET, body);
}

function issuerCall(env, operation, body) {
    return callService(env.RL_PROBE_STAGING_ISSUER, `https://rl-probe-issuer.internal/internal/${operation}`,
        env.RL_PROBE_STAGING_ISSUER_CALLER_SECRET, body);
}

function requireSuccess(response) {
    if (!response.ok || response.payload?.success !== true) throw new Error("STAGING_TEST_UNAVAILABLE");
    return response.payload;
}

async function readiness(env) {
    if (env[TEST_GATE] !== "true" || !env.RL_PROBE_STAGING_RUNTIME?.fetch || !env.RL_PROBE_STAGING_ISSUER?.fetch
        || !validSecret(env.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET)
        || !validSecret(env.RL_PROBE_STAGING_REVOCATION_SECRET)
        || !validSecret(env.RL_PROBE_STAGING_ISSUER_CALLER_SECRET)) return false;
    try {
        const [runtime, issuer] = await Promise.all([
            callService(env.RL_PROBE_STAGING_RUNTIME, "https://provider-runtime-staging.internal/internal/health", env.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET),
            issuerCall(env, "health", undefined)
        ]);
        return runtime.ok && runtime.payload?.success === true && issuer.ok && issuer.payload?.success === true
            && issuer.payload?.enabled === true;
    } catch { return false; }
}

async function authenticatedHealth(service, url, secret) {
    try {
        const response = await callService(service, url, secret);
        return response.ok && response.payload?.success === true ? "authenticated" : "unavailable";
    } catch { return "unavailable"; }
}

async function runtimeHealth(service, url, secret, revocationSecret) {
    if (!service?.fetch) return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "BINDING_UNAVAILABLE" };
    if (!validSecret(secret)) return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "RUNTIME_ERROR" };
    const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await service.fetch(new Request(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${secret}`,
                [CALLER_CHECK_HEADER]: "v1",
                [CALLER_NONCE_HEADER]: nonce,
                [REVOCATION_CHECK_HEADER]: "v1"
            },
            signal: controller.signal
        }));
        if (response.status === 401) {
            const text = await response.text();
            if (text.length > 8192) return { status: "unavailable", credentialStatus: "unavailable", failureCode: "RUNTIME_HTTP_401" };
            let payload;
            try { payload = JSON.parse(text); } catch { payload = null; }
            return {
                status: "unavailable",
                credentialStatus: await verifyRuntimeCallerProof(payload, secret, nonce),
                revocationCredential: "unavailable",
                failureCode: "RUNTIME_HTTP_401"
            };
        }
        if (response.status === 403) {
            return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "RUNTIME_HTTP_403" };
        }
        if (!response.ok) {
            return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: response.status === 404 ? "INVALID_RESPONSE" : "RUNTIME_ERROR" };
        }
        const text = await response.text();
        if (text.length > 8192) return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "INVALID_RESPONSE" };
        let payload;
        try { payload = JSON.parse(text); } catch { return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "INVALID_RESPONSE" }; }
        return payload?.success === true
            ? { status: "authenticated", credentialStatus: "match",
                revocationCredential: await verifyRuntimeRevocationProof(payload, revocationSecret, nonce) }
            : { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: "INVALID_RESPONSE" };
    } catch (error) {
        return { status: "unavailable", credentialStatus: "unavailable", revocationCredential: "unavailable", failureCode: controller.signal.aborted ? "TIMEOUT" : "RUNTIME_ERROR" };
    } finally { clearTimeout(timer); }
}

export async function checkStagingConnectivity(env) {
    const [runtime, issuer] = await Promise.all([
        runtimeHealth(env.RL_PROBE_STAGING_RUNTIME,
            "https://provider-runtime-staging.internal/internal/health", env.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET,
            env.RL_PROBE_STAGING_REVOCATION_SECRET),
        authenticatedHealth(env.RL_PROBE_STAGING_ISSUER,
            "https://rl-probe-issuer.internal/internal/health", env.RL_PROBE_STAGING_ISSUER_CALLER_SECRET)
    ]);
    const signingKeyCorrespondence = await checkStagingSigningKeyCorrespondence(env);
    return {
        success: true,
        runtime: runtime.status,
        runtimeCallerCredential: runtime.credentialStatus,
        runtimeRevocationCredential: runtime.revocationCredential,
        signingKeyCorrespondence,
        ...(runtime.failureCode ? { runtimeFailureCode: runtime.failureCode } : {}),
        issuer
    };
}

async function checkStagingSigningKeyCorrespondence(env) {
    if (!env.RL_PROBE_STAGING_RUNTIME?.fetch || !env.RL_PROBE_STAGING_ISSUER?.fetch
        || !validSecret(env.RL_PROBE_STAGING_RUNTIME_CALLER_SECRET)
        || !validSecret(env.RL_PROBE_STAGING_ISSUER_CALLER_SECRET)) return "unavailable";
    const now = Math.floor(Date.now() / 1000);
    const challenge = {
        algorithm: "ES256",
        issuer: "bpd-provider-runtime-staging",
        keyVersion: "staging-v1",
        purpose: SIGNING_CHECK_PURPOSE,
        nonce: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        issuedAt: now,
        expiresAt: now + SIGNING_CHECK_TTL_SECONDS
    };
    try {
        const issuerResponse = await issuerCall(env, "signing-key-check", challenge);
        if (!issuerResponse.ok || issuerResponse.payload?.success !== true
            || Object.keys(issuerResponse.payload).length !== 2
            || !isBase64Url64(issuerResponse.payload.signature)) return "unavailable";
        const runtimeResponse = await runtimeCall(env, "key-correspondence/verify",
            { ...challenge, signature: issuerResponse.payload.signature });
        if (!runtimeResponse.ok || runtimeResponse.payload?.success !== true
            || Object.keys(runtimeResponse.payload).length !== 2
            || typeof runtimeResponse.payload.keyMatches !== "boolean") return "unavailable";
        return runtimeResponse.payload.keyMatches ? "match" : "mismatch";
    } catch { return "unavailable"; }
}

function assertResult(condition) {
    if (!condition) throw new Error("STAGING_ISOLATION_ASSERTION_FAILED");
}

function validEpoch(value) { return typeof value === "string" && /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value)); }

function validSessionContext(value) {
    return value && Number.isSafeInteger(value.generation) && value.generation >= 0
        && Number.isSafeInteger(value.invalidatedBefore) && value.invalidatedBefore >= 0;
}

function validateIdentity(value) {
    if (!hashPattern.test(value?.accountKey || "") || !hashPattern.test(value?.epicIdentityHash || "")) throw new Error("STAGING_TEST_UNAVAILABLE");
    return value;
}

function validateIssued(value) {
    if (!hashPattern.test(value?.accountKey || "") || typeof value.credential !== "string"
        || value.credential.length < 20 || value.credential.length > 512
        || typeof value.assertion !== "string" || value.assertion.length > 8192) throw new Error("STAGING_TEST_UNAVAILABLE");
    return value;
}

async function issue(env, slot, identity, context, securityEpoch) {
    const value = requireSuccess(await issuerCall(env, "issue", {
        slot, generation: context.generation, invalidatedBefore: context.invalidatedBefore, securityEpoch
    }));
    validateIssued(value);
    assertResult(value.accountKey === identity.accountKey);
    return value;
}

async function consume(env, accountKey, assertion, credential) {
    return runtimeCall(env, "consume", { accountKey, assertion, credential });
}

// Exported for deterministic contract tests; this function only talks to the explicit staging bindings.
export async function runStagingIsolationTest(env) {
    if (!(await readiness(env))) throw new Error("STAGING_TEST_DISABLED");
    let identities = [];
    let cleanupFailed = false;
    let result;
    let failureCode = null;
    try {
        const [identityA, identityB] = await Promise.all(["A", "B"].map(async slot =>
            validateIdentity(requireSuccess(await issuerCall(env, "identity", { slot })))));
        assertResult(identityA.accountKey !== identityB.accountKey && identityA.epicIdentityHash !== identityB.epicIdentityHash);
        identities = [identityA, identityB];

        const bootstraps = await Promise.all([identityA, identityB].map(identity =>
            runtimeCall(env, "bootstrap", { accountKey: identity.accountKey, epicIdentityHash: identity.epicIdentityHash })));
        const contextA = requireSuccess(bootstraps[0]);
        const contextB = requireSuccess(bootstraps[1]);
        assertResult(validSessionContext(contextA) && validSessionContext(contextB));
        const epoch = requireSuccess(await runtimeCall(env, "epoch/read", {})).epoch;
        assertResult(validEpoch(epoch));

        const [issuedA, issuedB, staleA] = await Promise.all([
            issue(env, "A", identityA, contextA, epoch),
            issue(env, "B", identityB, contextB, epoch),
            issue(env, "A", identityA, contextA, epoch)
        ]);

        const crossAccount = await consume(env, identityB.accountKey, issuedA.assertion, issuedA.credential);
        const crossAccountRejected = crossAccount.ok === false && crossAccount.payload?.code === "RL_PROBE_ASSERTION_REJECTED";
        assertResult(crossAccountRejected);

        const concurrent = await Promise.all([
            consume(env, identityA.accountKey, issuedA.assertion, issuedA.credential),
            consume(env, identityA.accountKey, issuedA.assertion, issuedA.credential)
        ]);
        const acceptedCount = concurrent.filter(item => item.ok && item.payload?.code === "RL_PROBE_HANDOFF_ACCEPTED").length;
        const replayCount = concurrent.filter(item => !item.ok && item.payload?.code === "RL_PROBE_REPLAY_REJECTED").length;
        assertResult(acceptedCount === 1 && replayCount === 1);

        requireSuccess(await runtimeCall(env, "invalidate", { accountKey: identityA.accountKey, reason: "logout" }));
        const staleAfterInvalidation = await consume(env, identityA.accountKey, staleA.assertion, staleA.credential);
        const replayDenied = staleAfterInvalidation.ok === false;
        assertResult(replayDenied);

        const bStillIndependent = await consume(env, identityB.accountKey, issuedB.assertion, issuedB.credential);
        const independentInvalidation = bStillIndependent.ok && bStillIndependent.payload?.code === "RL_PROBE_HANDOFF_ACCEPTED";
        assertResult(independentInvalidation);

        requireSuccess(await runtimeCall(env, "invalidate", { accountKey: identityB.accountKey, reason: "logout" }));
        const contextB2 = requireSuccess(await runtimeCall(env, "bootstrap", {
            accountKey: identityB.accountKey, epicIdentityHash: identityB.epicIdentityHash
        }));
        assertResult(validSessionContext(contextB2));
        const currentEpoch = requireSuccess(await runtimeCall(env, "epoch/read", {})).epoch;
        assertResult(validEpoch(currentEpoch));
        const issuedB2 = await issue(env, "B", identityB, contextB2, currentEpoch);
        requireSuccess(await runtimeCall(env, "epoch/bump", {}, true));
        const afterGlobalRevoke = await consume(env, identityB.accountKey, issuedB2.assertion, issuedB2.credential);
        const globalRevocation = afterGlobalRevoke.ok === false && afterGlobalRevoke.payload?.code === "RL_PROBE_ASSERTION_REJECTED";
        assertResult(globalRevocation);

        result = { success: true, concurrentHandoff: true, replayDenied: true, crossAccountRejected: true,
            independentInvalidation: true, globalRevocation: true, probeExecutionEnabled: false,
            epicAuthenticationAttempted: false, psynetAuthenticationAttempted: false };
    } catch (error) {
        failureCode = safeFailureCodes.has(error?.message) ? error.message : "STAGING_TEST_UNAVAILABLE";
    } finally {
        for (const identity of identities) {
            try {
                const response = await runtimeCall(env, "invalidate", { accountKey: identity.accountKey, reason: "emergency" });
                if (!response.ok || response.payload?.code !== "RL_PROBE_INVALIDATED") cleanupFailed = true;
            } catch { cleanupFailed = true; }
        }
    }
    if (cleanupFailed) throw new Error("STAGING_CLEANUP_INCOMPLETE");
    if (failureCode) throw new Error(failureCode);
    return result;
}

async function authorize(request, env) {
    try { await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE); return null; }
    catch (error) {
        const status = [401, 403].includes(Number(error?.status)) ? Number(error.status) : 503;
        return json({ success: false, code: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "ADMIN_PERMISSION_REQUIRED" : "AUTHORIZATION_UNAVAILABLE" }, status);
    }
}

export async function onRequestGet({ request, env }) {
    const denied = await authorize(request, env);
    if (denied) return denied;
    if (!isLiveAdminHost(request)) return json({ success: false, code: "NOT_FOUND" }, 404);
    if (new URL(request.url).searchParams.get("health") === "1") {
        if (!isSafeHealthRead(request)) return json({ success: false, code: "ORIGIN_REQUIRED" }, 403);
        return json(await checkStagingConnectivity(env));
    }
    const enabled = await readiness(env);
    return json({ success: true, enabled, code: enabled ? "STAGING_TEST_READY" : "STAGING_TEST_DISABLED" });
}

export async function onRequestPost({ request, env }) {
    const denied = await authorize(request, env);
    if (denied) return denied;
    if (!isLiveAdminHost(request)) return json({ success: false, code: "NOT_FOUND" }, 404);
    if (!isSameOriginRequest(request)) return json({ success: false, code: "ORIGIN_REQUIRED" }, 403);
    if (env[TEST_GATE] !== "true") return json({ success: false, code: "STAGING_TEST_DISABLED" }, 503);
    let body;
    try {
        const raw = await request.text();
        if (raw.length > 1024) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
        body = JSON.parse(raw);
    } catch { return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400); }
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || body.confirmation !== CONFIRMATION) {
        return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
    }
    try { return json(await runStagingIsolationTest(env)); }
    catch (error) {
        const code = safeFailureCodes.has(error?.message) ? error.message : "STAGING_TEST_UNAVAILABLE";
        return json({ success: false, code, probeExecutionEnabled: false,
            epicAuthenticationAttempted: false, psynetAuthenticationAttempted: false }, 503);
    }
}
