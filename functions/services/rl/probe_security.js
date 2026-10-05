// Server-only security hooks. Never accepts a browser-selected identity or object key.
export function isRlProbeSecurityEnabled(env) {
    if (env.RL_PROBE_SECURITY_ENABLED === undefined || env.RL_PROBE_SECURITY_ENABLED === "false") return false;
    if (env.RL_PROBE_SECURITY_ENABLED !== "true") throw new Error("RL_PROBE_SECURITY_CONFIGURATION_INVALID");
    return true;
}

export async function deriveRlProbeAccountKey(env, accountId) {
    const secret = env.RL_PROBE_ACCOUNT_KEY_SECRET;
    if (typeof accountId !== "string" || !accountId || accountId.length > 128
        || typeof secret !== "string" || secret.length < 64 || secret.length > 256 || /\s/u.test(secret)) {
        throw new Error("RL_PROBE_SECURITY_CONFIGURATION_INVALID");
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`bpd-rl-probe-account:${accountId}`));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Only the Admin-authorized, one-time probe reauthorization callback calls this.
// Ordinary login, scheduled work and page loads never issue probe assertions.
export async function createRlProbeAssertion(env, { accountId, epicIdentityHash, credential, generation, invalidatedBefore, reauthorizedAt }) {
    const now = Date.now();
    if (!isRlProbeSecurityEnabled(env) || !Number.isSafeInteger(reauthorizedAt)
        || reauthorizedAt > now || now - reauthorizedAt > 60000
        || !/^[a-f0-9]{64}$/u.test(epicIdentityHash) || typeof credential !== "string" || !credential
        || !Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(invalidatedBefore)
        || !env.RL_PROBE_ISSUER || !env.RL_PROBE_KEY_VERSION) throw new Error("RL_PROBE_FRESH_REAUTH_REQUIRED");
    const securityEpoch = await getRlProbeGlobalEpoch(env);
    try {
        const jwk = JSON.parse(env.RL_PROBE_SIGNING_JWK);
        if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) throw new Error("invalid");
        const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
        const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
        const encode = value => b64(new TextEncoder().encode(JSON.stringify(value)));
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
        const accountKey = await deriveRlProbeAccountKey(env, accountId);
        const iat = Math.max(Math.floor(now / 1000), Math.floor(invalidatedBefore / 1000) + 1);
        const claims = { iss: env.RL_PROBE_ISSUER, aud: "bpd-provider-runtime/rl-compatibility-probe", action: "rl.compatibility.probe",
            sub: accountKey, epicIdentityHash, generation, iat, exp: iat + 60,
            jti: b64(crypto.getRandomValues(new Uint8Array(32))), securityEpoch,
            credentialDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
        const input = `${encode({ alg: "ES256", typ: "JWT", kid: env.RL_PROBE_KEY_VERSION })}.${encode(claims)}`;
        const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
        return `${input}.${b64(signature)}`;
    } catch { throw new Error("RL_PROBE_SIGNING_UNAVAILABLE"); }
}

export async function getRlProbeGlobalEpoch(env) {
    const body = await probeRuntimeRequest(env, "epoch/read", {});
    if (!/^[1-9]\d*$/u.test(body.epoch) || !Number.isSafeInteger(Number(body.epoch))) throw new Error("RL_PROBE_AUTHORITY_UNAVAILABLE");
    return body.epoch;
}

// The bump secret is separate from routine provider/Discord caller authorization.
export async function revokeAllRlProbeSessions(env) {
    await probeRuntimeRequest(env, "epoch/bump", {}, env.RL_PROBE_REVOCATION_SECRET);
}

export async function probeRuntimeRequest(env, operation, body, secret = env.PROVIDER_RUNTIME_CALLER_SECRET) {
    if (!isRlProbeSecurityEnabled(env) || !env.PROVIDER_RUNTIME?.fetch
        || typeof secret !== "string" || secret.length < 64 || secret.length > 256 || /\s/u.test(secret)) throw new Error("RL_PROBE_SECURITY_UNAVAILABLE");
    const controller = new AbortController();
    let timer;
    try {
        const work = async () => {
            const response = await env.PROVIDER_RUNTIME.fetch(`https://provider-runtime.internal/internal/rl-probe/${operation}`, {
                method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
                body: JSON.stringify(body), signal: controller.signal
            });
            const result = await response.json();
            if (!response.ok || result?.success !== true) throw new Error("invalid");
            return result;
        };
        return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new Error("timeout"));
        }, 3000); })]);
    } catch { throw new Error("RL_PROBE_SECURITY_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
}

export async function invalidateRlProbeSession(env, accountId, reason) {
    if (!isRlProbeSecurityEnabled(env)) return;
    if (!accountId) return;
    if (!["logout", "epic_unlink", "profile_delete", "identity_change"].includes(reason)) throw new Error("RL_PROBE_INVALIDATION_REQUIRED");
    const secret = env.PROVIDER_RUNTIME_CALLER_SECRET;
    if (!env.PROVIDER_RUNTIME?.fetch || typeof secret !== "string" || secret.length < 64
        || secret.length > 256 || /\s/u.test(secret)) throw new Error("RL_PROBE_INVALIDATION_REQUIRED");
    const accountKey = await deriveRlProbeAccountKey(env, accountId);
    const controller = new AbortController();
    let timer;
    try {
        const operation = async () => {
            const response = await env.PROVIDER_RUNTIME.fetch("https://provider-runtime.internal/internal/rl-probe/invalidate", {
                method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
                body: JSON.stringify({ accountKey, reason }), signal: controller.signal
            });
            const result = await response.json();
            if (!response.ok || result?.success !== true || result?.code !== "RL_PROBE_INVALIDATED") throw new Error("invalid");
        };
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new Error("timeout"));
        }, 3000); });
        await Promise.race([operation(), timeout]);
    } catch { throw new Error("RL_PROBE_INVALIDATION_REQUIRED"); }
    finally { clearTimeout(timer); }
}
