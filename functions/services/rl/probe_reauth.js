import { ADMIN_PERMISSIONS, authorizeAdminPermission } from "../admin/permissions.js";
import { verifyAccountProviderIdentity } from "../auth/providers/provider_identity.js";
import { startEpicAuthorization } from "../auth/providers/epic/login.js";
import { getCookie, createCookie } from "../auth/sessions/session.js";
import { createRlProbeAssertion, deriveRlProbeAccountKey, probeRuntimeRequest } from "./probe_security.js";

export const PROBE_COOKIE = "bpd_rl_probe_transaction";
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
export async function probeHash(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function context(request, env) {
    const auth = await authorizeAdminPermission(request, env, ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE);
    const epic = await verifyAccountProviderIdentity(env, auth.accountId, "epic");
    if (!auth.accountId || !auth.sessionId || !epic?.providerSubject || epic.provider !== "epic") throw new Error("RL_PROBE_REAUTH_REQUIRED");
    return { accountId: auth.accountId, accountKey: await deriveRlProbeAccountKey(env, auth.accountId),
        sessionHash: await probeHash(`bpd-session:${auth.sessionId}`),
        epicIdentityHash: await probeHash(`epic:${epic.providerSubject}`) };
}

export async function beginProbeReauthorization(request, env) {
    const ctx = await context(request, env);
    const transaction = random();
    const state = random();
    const authorization = startEpicAuthorization(request, env, {
        mode: "reauthorize", accountId: ctx.accountId, returnTo: "/Admin/WorkerStatus", probeState: state
    });
    await probeRuntimeRequest(env, "begin", { accountKey: ctx.accountKey, epicIdentityHash: ctx.epicIdentityHash,
        sessionHash: ctx.sessionHash, transactionHash: await probeHash(transaction), stateHash: await probeHash(state) });
    return { redirectUrl: authorization.redirectUrl,
        cookies: [...authorization.cookies, createCookie(request, PROBE_COOKIE, transaction, 300)] };
}

// Called only from the state-validated reauthorization callback BEFORE code exchange.
export async function claimProbeCallback(request, env, mode, state) {
    const transaction = getCookie(request, PROBE_COOKIE);
    if (!transaction) return null; // Ordinary OAuth remains unchanged.
    if (mode !== "reauthorize" || !/^[A-Za-z0-9_-]{43}$/u.test(transaction)) throw new Error("RL_PROBE_REAUTH_REQUIRED");
    const ctx = await context(request, env);
    const transactionHash = await probeHash(transaction);
    const claimed = await probeRuntimeRequest(env, "claim", { accountKey: ctx.accountKey,
        epicIdentityHash: ctx.epicIdentityHash, sessionHash: ctx.sessionHash,
        transactionHash, stateHash: await probeHash(state) });
    if (claimed.code !== "RL_PROBE_REAUTH_CLAIMED" || !Number.isSafeInteger(claimed.generation)
        || claimed.generation < 0 || !Number.isSafeInteger(claimed.invalidatedBefore)) throw new Error("RL_PROBE_REAUTH_REJECTED");
    // Provider runtime never supplies/overrides the canonical control-plane identity.
    return { ...ctx, transactionHash, generation: claimed.generation, invalidatedBefore: claimed.invalidatedBefore };
}

// No refresh credential, raw identity or assertion is ever returned to the browser.
export async function prepareProbeCallback(env, ctx, epicAccountId, credential) {
    if (await probeHash(`epic:${epicAccountId}`) !== ctx.epicIdentityHash) throw new Error("RL_PROBE_IDENTITY_MISMATCH");
    const assertion = await createRlProbeAssertion(env, { ...ctx, credential, reauthorizedAt: Date.now() });
    await probeRuntimeRequest(env, "prepare", { accountKey: ctx.accountKey, transactionHash: ctx.transactionHash,
        assertion, credential });
}

export async function executePreparedProbe(request, env) {
    const ctx = await context(request, env);
    const transaction = getCookie(request, PROBE_COOKIE);
    if (!transaction || !/^[A-Za-z0-9_-]{43}$/u.test(transaction)) throw new Error("RL_PROBE_REAUTH_REQUIRED");
    return probeRuntimeRequest(env, "execute", { accountKey: ctx.accountKey, epicIdentityHash: ctx.epicIdentityHash,
        sessionHash: ctx.sessionHash, transactionHash: await probeHash(transaction) });
}
