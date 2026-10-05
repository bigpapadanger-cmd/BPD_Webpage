import { readGlobalProbeEpoch } from "./rl_probe_authority.js";
const HASH = /^[a-f0-9]{64}$/u;
const JTI = /^[A-Za-z0-9_-]{43}$/u;
const AUDIENCE = "bpd-provider-runtime/rl-compatibility-probe";
const ACTION = "rl.compatibility.probe";
const IDLE_MS = 10 * 60 * 1000;
const HARD_MS = 30 * 60 * 1000;
const SKEW_SECONDS = 15;

function result(code, status = 400, extra = {}) {
    return Response.json({ success: status === 200, code, ...extra }, {
        status, headers: { "Cache-Control": "no-store" }
    });
}

function decode(value) {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid");
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
}

export async function credentialDigest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyAssertion(assertion, env, now, currentEpoch) {
    try {
        if (typeof assertion !== "string" || assertion.length > 8192) return null;
        const parts = assertion.split(".");
        if (parts.length !== 3) return null;
        const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
        if (header.alg !== "ES256" || header.typ !== "JWT" || header.kid !== env.RL_PROBE_KEY_VERSION
            || Object.keys(header).some(key => !["alg", "typ", "kid"].includes(key))) return null;
        const jwk = JSON.parse(env.RL_PROBE_VERIFY_JWK);
        if (jwk.kty !== "EC" || jwk.crv !== "P-256" || Object.hasOwn(jwk, "d")) return null;
        const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        const signature = decode(parts[2]);
        if (signature.length !== 64 || !await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
            signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
        const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
        const seconds = Math.floor(now / 1000);
        if (!env.RL_PROBE_ISSUER || !currentEpoch || !env.RL_PROBE_KEY_VERSION
            || claims.iss !== env.RL_PROBE_ISSUER || claims.aud !== AUDIENCE || claims.action !== ACTION
            || claims.securityEpoch !== currentEpoch
            || !HASH.test(claims.sub) || !HASH.test(claims.epicIdentityHash) || !HASH.test(claims.credentialDigest)
            || !JTI.test(claims.jti) || decode(claims.jti).length !== 32
            || !Number.isSafeInteger(claims.generation) || claims.generation < 0
            || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
            || claims.exp <= claims.iat || claims.exp - claims.iat > 60
            || claims.iat > seconds + SKEW_SECONDS || seconds >= claims.exp + SKEW_SECONDS) return null;
        return claims;
    } catch { return null; }
}

// Discord never enters this class. Credentials and provider responses are never stored.
export class UserRocketLeagueSession {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.handoff = null;
        this.handoffTimer = null;
    }

    clearHandoff() {
        this.handoff = null;
        clearTimeout(this.handoffTimer);
        this.handoffTimer = null;
    }

    async fetch(request) {
        try {
            if (request.method !== "POST") return result("METHOD_NOT_ALLOWED", 405);
            const text = await request.text();
            if (text.length > 16384) return result("REQUEST_SCHEMA_INVALID");
            const body = JSON.parse(text);
            const operation = new URL(request.url).pathname.split("/").at(-1);
            const allowed = operation === "bootstrap" ? ["accountKey", "epicIdentityHash"]
                : operation === "invalidate" ? ["accountKey", "reason"]
                    : ["consume", "prepare"].includes(operation) ? ["accountKey", "assertion", "credential", ...(operation === "prepare" ? ["transactionHash"] : [])]
                        : ["begin", "claim"].includes(operation) ? ["accountKey", "epicIdentityHash", "sessionHash", "transactionHash", "stateHash"]
                            : operation === "execute" ? ["accountKey", "epicIdentityHash", "sessionHash", "transactionHash"] : [];
            if (!body || Array.isArray(body) || !allowed.length || Object.keys(body).length !== allowed.length
                || allowed.some(key => !Object.hasOwn(body, key)) || !HASH.test(body.accountKey)) return result("REQUEST_SCHEMA_INVALID");
            if (operation === "bootstrap" && !HASH.test(body.epicIdentityHash)) return result("REQUEST_SCHEMA_INVALID");
            if (["begin", "claim", "execute"].includes(operation)
                && ["epicIdentityHash", "sessionHash", "transactionHash", ...(operation !== "execute" ? ["stateHash"] : [])].some(key => !HASH.test(body[key]))) return result("REQUEST_SCHEMA_INVALID");
            if (operation === "prepare" && !HASH.test(body.transactionHash)) return result("REQUEST_SCHEMA_INVALID");
            if (operation === "invalidate" && !["logout", "epic_unlink", "profile_delete", "identity_change", "emergency"].includes(body.reason)) return result("REQUEST_SCHEMA_INVALID");
            let currentEpoch;
            try { currentEpoch = await readGlobalProbeEpoch(this.env, operation === "invalidate" ? null : body.accountKey); }
            catch { if (operation !== "invalidate") return result("RL_PROBE_SECURITY_CONFIGURATION_REQUIRED", 503); }
            const epoch = Number(currentEpoch);
            if (operation !== "invalidate" && (!Number.isSafeInteger(epoch) || epoch < 1
                || String(epoch) !== currentEpoch || !this.env.RL_PROBE_ISSUER
                || !this.env.RL_PROBE_VERIFY_JWK || !this.env.RL_PROBE_KEY_VERSION)) {
                return result("RL_PROBE_SECURITY_CONFIGURATION_REQUIRED", 503);
            }
            const now = Date.now();
            let claims = null;
            if (["consume", "prepare"].includes(operation)) {
                if (typeof body.credential !== "string" || !body.credential || body.credential.length > 8192) return result("REQUEST_SCHEMA_INVALID");
                claims = await verifyAssertion(body.assertion, this.env, now, currentEpoch);
                if (!claims || claims.sub !== body.accountKey || claims.credentialDigest !== await credentialDigest(body.credential)) {
                    return result("RL_PROBE_ASSERTION_REJECTED", 403);
                }
            }
            if (operation === "execute") {
                const handoff = this.handoff;
                // Credentials disappear on eviction: never restore from storage or cached OAuth freshness.
                if (!handoff || Date.now() >= handoff.expiresAt || handoff.transactionHash !== body.transactionHash) {
                    this.clearHandoff(); return result("RL_PROBE_FRESH_REAUTH_REQUIRED", 409);
                }
                const ready = await this.ctx.storage.transaction(async storage => {
                    const state = await storage.get("security");
                    const tx = state?.reauth;
                    if (!tx || tx.status !== "ready" || tx.transactionHash !== body.transactionHash
                        || tx.sessionHash !== body.sessionHash || state.accountKey !== body.accountKey
                        || state.epicIdentityHash !== body.epicIdentityHash || tx.generation !== state.generation
                        || tx.securityEpoch !== currentEpoch || tx.expiresAt <= Date.now()) return false;
                    tx.status = "executed";
                    await storage.put("security", state);
                    return true;
                });
                if (!ready) { this.clearHandoff(); return result("RL_PROBE_REAUTH_REJECTED", 403); }
                try {
                    // Consume the signed jti atomically. No provider executor exists.
                    const consumed = await this.fetch(new Request("https://rl-probe.internal/consume", {
                        method: "POST", body: JSON.stringify({ accountKey: body.accountKey, assertion: handoff.assertion, credential: handoff.credential })
                    }));
                    if (!consumed.ok) return consumed;
                    return result("RL_PROBE_IDENTITY_PROOF_BLOCKED", 200, { handoffAccepted: true,
                        identityVerified: false, probeExecutionEnabled: false, probeStarted: false });
                } finally { this.clearHandoff(); }
            }
            const response = await this.ctx.storage.transaction(async storage => {
                const state = await storage.get("security") || { accountKey: body.accountKey, generation: 0,
                    invalidatedBefore: 0, epicIdentityHash: null, nonces: {}, temporary: null };
                if (state.accountKey !== body.accountKey) return result("RL_PROBE_ACCOUNT_MISMATCH", 403);
                const clear = () => {
                    state.generation += 1;
                    state.invalidatedBefore = Math.max(state.invalidatedBefore, now);
                    state.epicIdentityHash = null;
                    state.temporary = null;
                    state.reauth = null;
                    this.clearHandoff();
                };
                if (Number.isSafeInteger(Number(state.securityEpoch)) && Number(state.securityEpoch) > epoch) {
                    if (operation !== "invalidate") return result("RL_PROBE_SECURITY_EPOCH_ROLLBACK", 503);
                }
                if (currentEpoch && state.securityEpoch !== undefined && state.securityEpoch !== currentEpoch) clear();
                state.securityEpoch = String(Math.max(Number(state.securityEpoch) || 0, Number.isSafeInteger(epoch) ? epoch : 0));
                state.nonces = Object.fromEntries(Object.entries(state.nonces).filter(([, expires]) => expires > now));
                if (state.temporary && (now >= state.temporary.hardExpiresAt || now - state.temporary.lastActiveAt >= IDLE_MS)) clear();
                let response;
                if (operation === "invalidate") {
                    clear();
                    response = result("RL_PROBE_INVALIDATED", 200);
                } else if (operation === "begin") {
                    if (state.epicIdentityHash && state.epicIdentityHash !== body.epicIdentityHash) {
                        clear(); response = result("RL_PROBE_IDENTITY_MISMATCH", 409);
                    } else if (state.reauth && state.reauth.expiresAt > now && !["executed"].includes(state.reauth.status)) {
                        response = result("RL_PROBE_ALREADY_IN_FLIGHT", 409);
                    } else {
                        this.clearHandoff();
                        state.epicIdentityHash = body.epicIdentityHash;
                        state.temporary = { createdAt: now, lastActiveAt: now, hardExpiresAt: now + HARD_MS };
                        state.reauth = { transactionHash: body.transactionHash, stateHash: body.stateHash,
                            sessionHash: body.sessionHash, generation: state.generation, securityEpoch: currentEpoch,
                            status: "pending", expiresAt: now + 300000 };
                        response = result("RL_PROBE_REAUTH_STARTED", 200);
                    }
                } else if (operation === "claim") {
                    const tx = state.reauth;
                    if (!tx || tx.status !== "pending" || tx.expiresAt <= now || tx.transactionHash !== body.transactionHash
                        || tx.stateHash !== body.stateHash || tx.sessionHash !== body.sessionHash
                        || state.epicIdentityHash !== body.epicIdentityHash || tx.generation !== state.generation
                        || tx.securityEpoch !== currentEpoch) response = result("RL_PROBE_REAUTH_REJECTED", 403);
                    else {
                        tx.status = "claimed";
                        response = result("RL_PROBE_REAUTH_CLAIMED", 200, { generation: state.generation, invalidatedBefore: state.invalidatedBefore });
                    }
                } else if (operation === "prepare") {
                    const tx = state.reauth;
                    if (!tx || tx.status !== "claimed" || tx.expiresAt <= now || tx.transactionHash !== body.transactionHash
                        || tx.generation !== state.generation || tx.securityEpoch !== currentEpoch
                        || claims.generation !== state.generation || claims.epicIdentityHash !== state.epicIdentityHash
                        || claims.iat * 1000 <= state.invalidatedBefore || state.nonces[claims.jti]) response = result("RL_PROBE_REAUTH_REJECTED", 403);
                    else {
                        tx.status = "ready";
                        tx.expiresAt = Math.min(now + 60000, claims.exp * 1000);
                        response = result("RL_PROBE_HANDOFF_READY", 200);
                    }
                } else if (operation === "bootstrap") {
                    if (state.epicIdentityHash && state.epicIdentityHash !== body.epicIdentityHash) {
                        clear();
                        response = result("RL_PROBE_IDENTITY_MISMATCH", 409);
                    } else {
                        state.epicIdentityHash = body.epicIdentityHash;
                        state.temporary ||= { createdAt: now, lastActiveAt: now, hardExpiresAt: now + HARD_MS };
                        response = result("RL_PROBE_CONTEXT_READY", 200, { generation: state.generation,
                            invalidatedBefore: state.invalidatedBefore });
                    }
                } else if (!state.temporary || state.epicIdentityHash !== claims.epicIdentityHash) {
                    clear();
                    response = result("RL_PROBE_IDENTITY_MISMATCH", 403);
                } else if (state.generation !== claims.generation || claims.iat * 1000 <= state.invalidatedBefore) {
                    response = result("RL_PROBE_GENERATION_REJECTED", 403);
                } else if (state.nonces[claims.jti]) {
                    response = result("RL_PROBE_REPLAY_REJECTED", 409);
                } else if (state.temporary.handoffConsumed === true) {
                    response = result("RL_PROBE_ALREADY_IN_FLIGHT", 409);
                } else {
                    // Commit one-time consumption before any future provider execution.
                    state.nonces[claims.jti] = (claims.exp + SKEW_SECONDS) * 1000;
                    state.temporary.lastActiveAt = now;
                    state.temporary.handoffConsumed = true;
                    response = result("RL_PROBE_HANDOFF_ACCEPTED", 200, { handoffAccepted: true, probeExecutionEnabled: false });
                }
                await storage.put("security", state);
                const deadlines = Object.values(state.nonces);
                if (state.reauth?.expiresAt > now) deadlines.push(state.reauth.expiresAt);
                if (state.temporary) deadlines.push(state.temporary.lastActiveAt + IDLE_MS, state.temporary.hardExpiresAt);
                if (deadlines.length) await storage.setAlarm(Math.min(...deadlines));
                else await storage.deleteAlarm();
                return response;
            });
            if (operation === "prepare" && response.ok) {
                const state = await this.ctx.storage.get("security");
                if (state?.reauth?.status !== "ready" || state.reauth.transactionHash !== body.transactionHash) return result("RL_PROBE_REAUTH_REJECTED", 403);
                this.handoff = { assertion: body.assertion, credential: body.credential,
                    transactionHash: body.transactionHash, expiresAt: state.reauth.expiresAt };
                this.handoffTimer = setTimeout(() => this.clearHandoff(), Math.max(0, this.handoff.expiresAt - Date.now()));
                this.handoffTimer.unref?.();
            }
            return response;
        } catch { return result("RL_PROBE_SECURITY_UNAVAILABLE", 503); }
    }

    async alarm() {
        const now = Date.now();
        let currentEpoch;
        try { currentEpoch = await readGlobalProbeEpoch(this.env); } catch { /* Expiry cleanup still runs when authority is unavailable. */ }
        await this.ctx.storage.transaction(async storage => {
            const state = await storage.get("security");
            if (!state) return;
            state.nonces = Object.fromEntries(Object.entries(state.nonces).filter(([, expiry]) => expiry > now));
            if (state.reauth && state.reauth.expiresAt <= now) { state.reauth = null; this.clearHandoff(); }
            if (currentEpoch && state.securityEpoch !== currentEpoch
                || state.temporary && (now >= state.temporary.hardExpiresAt || now - state.temporary.lastActiveAt >= IDLE_MS)) {
                state.generation += 1;
                state.invalidatedBefore = Math.max(state.invalidatedBefore, now);
                state.temporary = null;
                state.epicIdentityHash = null;
                state.reauth = null;
                this.clearHandoff();
                state.securityEpoch = String(Math.max(Number(state.securityEpoch) || 0, Number(currentEpoch) || 0));
            }
            // Keep the monotonic tombstone. Deleting it would resurrect old generations.
            await storage.put("security", state);
            const deadlines = Object.values(state.nonces);
            if (state.reauth?.expiresAt > now) deadlines.push(state.reauth.expiresAt);
            if (state.temporary) deadlines.push(state.temporary.lastActiveAt + IDLE_MS, state.temporary.hardExpiresAt);
            if (deadlines.length) await storage.setAlarm(Math.min(...deadlines));
            else await storage.deleteAlarm();
        });
    }
}
