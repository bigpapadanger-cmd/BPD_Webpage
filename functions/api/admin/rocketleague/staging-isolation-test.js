import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../../../services/admin/permissions.js";

const TEST_GATE = "RL_PROBE_STAGING_TEST_ENABLED";
const CONFIRMATION = "RUN_STAGING_ISOLATION_TEST";
const hashPattern = /^[a-f0-9]{64}$/u;
const safeFailureCodes = new Set(["STAGING_TEST_DISABLED", "STAGING_TEST_UNAVAILABLE", "STAGING_CLEANUP_INCOMPLETE", "STAGING_ISOLATION_ASSERTION_FAILED"]);

function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function validSecret(value) {
    return typeof value === "string" && value.length >= 64 && value.length <= 256 && value.trim() === value && !/\s/u.test(value);
}

export function isSameOriginRequest(request) {
    return request.headers.get("origin") === new URL(request.url).origin
        && request.headers.get("sec-fetch-site") !== "cross-site";
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
