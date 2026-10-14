const HASH = /^[a-f0-9]{64}$/u;
const SLOTS = Object.freeze({
    A: "rl-stage-synthetic-account:v1:slot-a",
    B: "rl-stage-synthetic-account:v1:slot-b"
});
const AUDIENCE = "bpd-provider-runtime/rl-compatibility-probe";
const ACTION = "rl.compatibility.probe";
const SIGNING_CHECK_PATH = "/internal/signing-key-check";
const SIGNING_CHECK_PURPOSE = "bpd.rl.staging.signing-key-correspondence.v1";
const SIGNING_CHECK_DOMAIN = "BPD-RL-STAGING-KEY-CORRESPONDENCE\0";
const SIGNING_CHECK_TTL_SECONDS = 30;

function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function validSecret(value) {
    return typeof value === "string" && value.length >= 64 && value.length <= 256
        && value.trim() === value && !/\s/u.test(value);
}

function equalSecret(expected, actual) {
    if (!expected || !actual || expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    return diff === 0;
}

function authorized(request, env) {
    const expected = env.RL_PROBE_STAGING_ISSUER_CALLER_SECRET;
    return validSecret(expected) && equalSecret(`Bearer ${expected}`, request.headers.get("Authorization") || "");
}

function enabled(env) {
    return env.RL_PROBE_STAGING_ISSUER_ENABLED === "true";
}

function decodeFixedSlot(slot) {
    return Object.hasOwn(SLOTS, slot) ? SLOTS[slot] : null;
}

async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveAccountKey(env, accountId) {
    if (!validSecret(env.RL_PROBE_ACCOUNT_KEY_SECRET)) throw new Error("configuration");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.RL_PROBE_ACCOUNT_KEY_SECRET),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`bpd-rl-probe-account:${accountId}`));
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function identity(env, slot) {
    const accountId = decodeFixedSlot(slot);
    if (!accountId) throw new Error("schema");
    return {
        accountKey: await deriveAccountKey(env, accountId),
        epicIdentityHash: await sha256(`rl-stage-synthetic-epic-identity:v1:${slot}`)
    };
}

function base64url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function encodeJson(value) { return base64url(new TextEncoder().encode(JSON.stringify(value))); }

function validSigningCheckChallenge(body, env) {
    const now = Math.floor(Date.now() / 1000);
    let nonceBytes = null;
    if (typeof body?.nonce === "string" && /^[A-Za-z0-9_-]{43}$/u.test(body.nonce)) {
        try {
            nonceBytes = atob(body.nonce.replace(/-/gu, "+").replace(/_/gu, "/") + "=");
            if (nonceBytes.length !== 32 || base64url(Uint8Array.from(nonceBytes, character => character.charCodeAt(0))) !== body.nonce) nonceBytes = null;
        } catch { nonceBytes = null; }
    }
    return exactKeys(body, ["algorithm", "issuer", "keyVersion", "purpose", "nonce", "issuedAt", "expiresAt"])
        && body.algorithm === "ES256"
        && body.issuer === "bpd-provider-runtime-staging"
        && env.RL_PROBE_ISSUER === body.issuer
        && body.keyVersion === "staging-v1"
        && env.RL_PROBE_KEY_VERSION === body.keyVersion
        && body.purpose === SIGNING_CHECK_PURPOSE
        && nonceBytes?.length === 32
        && Number.isSafeInteger(body.issuedAt) && Number.isSafeInteger(body.expiresAt)
        && body.expiresAt - body.issuedAt === SIGNING_CHECK_TTL_SECONDS
        && body.issuedAt <= now + 5 && body.expiresAt > now;
}

function signingCheckMessage(challenge) {
    return new TextEncoder().encode(`${SIGNING_CHECK_DOMAIN}${challenge.algorithm}\0${challenge.issuer}\0${challenge.keyVersion}\0${challenge.purpose}\0${challenge.nonce}\0${challenge.issuedAt}\0${challenge.expiresAt}`);
}

async function signSigningKeyCheck(env, challenge) {
    if (!validSigningCheckChallenge(challenge, env)) throw new Error("challenge");
    let jwk;
    try { jwk = JSON.parse(env.RL_PROBE_SIGNING_JWK); } catch { throw new Error("configuration"); }
    if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || typeof jwk.d !== "string"
        || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("configuration");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signingCheckMessage(challenge));
    return base64url(signature);
}

async function signAssertion(env, { slot, generation, invalidatedBefore, securityEpoch }) {
    if (!Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(invalidatedBefore) || invalidatedBefore < 0
        || typeof securityEpoch !== "string" || !/^[1-9]\d*$/u.test(securityEpoch) || !Number.isSafeInteger(Number(securityEpoch))) {
        throw new Error("schema");
    }
    const current = await identity(env, slot);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const iat = Math.max(nowSeconds, Math.floor(invalidatedBefore / 1000) + 1);
    const exp = iat + 60;
    const credential = `synthetic-staging-credential:${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const claims = {
        iss: env.RL_PROBE_ISSUER,
        aud: AUDIENCE,
        action: ACTION,
        sub: current.accountKey,
        epicIdentityHash: current.epicIdentityHash,
        generation,
        iat,
        exp,
        jti: base64url(crypto.getRandomValues(new Uint8Array(32))),
        securityEpoch,
        credentialDigest: await sha256(credential)
    };
    let jwk;
    try { jwk = JSON.parse(env.RL_PROBE_SIGNING_JWK); } catch { throw new Error("configuration"); }
    if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || typeof jwk.d !== "string" || !jwk.x || !jwk.y
        || env.RL_PROBE_ISSUER !== "bpd-provider-runtime-staging" || env.RL_PROBE_KEY_VERSION !== "staging-v1") {
        throw new Error("configuration");
    }
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const input = `${encodeJson({ alg: "ES256", typ: "JWT", kid: env.RL_PROBE_KEY_VERSION })}.${encodeJson(claims)}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
    return { ...current, credential, assertion: `${input}.${base64url(signature)}` };
}

async function readBody(request) {
    const text = await request.text();
    if (text.length > 2048) return null;
    try { return JSON.parse(text); } catch { return null; }
}

function exactKeys(value, names) {
    return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === names.length
        && names.every(name => Object.hasOwn(value, name));
}

function configurationReady(env) {
    if (!validSecret(env.RL_PROBE_ACCOUNT_KEY_SECRET)) return false;
    if (!env.RL_PROBE_SIGNING_JWK) return false;
    try {
        const jwk = JSON.parse(env.RL_PROBE_SIGNING_JWK);
        return jwk?.kty === "EC" && jwk?.crv === "P-256" && typeof jwk.d === "string" && Boolean(jwk.x && jwk.y)
            && env.RL_PROBE_ISSUER === "bpd-provider-runtime-staging" && env.RL_PROBE_KEY_VERSION === "staging-v1";
    } catch { return false; }
}

export default {
    async fetch(request, env) {
        if (!authorized(request, env)) return json({ success: false, code: "INTERNAL_AUTH_REQUIRED" }, 401);
        const url = new URL(request.url);
        if (url.search || request.headers.has("Cookie")) return json({ success: false, code: "INVALID_INPUT" }, 400);
        if (url.pathname === "/internal/health" && request.method === "GET") {
            if (enabled(env) && !configurationReady(env)) return json({ success: false, enabled: false, code: "ISSUER_CONFIGURATION_REQUIRED" }, 503);
            return json({ success: true, enabled: enabled(env), service: "bpd-rl-probe-staging-issuer" });
        }
        if (url.pathname === SIGNING_CHECK_PATH && request.method === "POST") {
            if (url.hostname !== "rl-probe-issuer.internal"
                || env.RL_PROBE_ISSUER !== "bpd-provider-runtime-staging"
                || env.RL_PROBE_KEY_VERSION !== "staging-v1") return json({ success: false, code: "NOT_FOUND" }, 404);
            const body = await readBody(request);
            if (!validSigningCheckChallenge(body, env)) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            try { return json({ success: true, signature: await signSigningKeyCheck(env, body) }); }
            catch { return json({ success: false, code: "SIGNING_CHECK_UNAVAILABLE" }, 503); }
        }
        if (url.pathname === "/internal/identity" && request.method === "POST") {
            if (!enabled(env) || !configurationReady(env)) return json({ success: false, code: "ISSUER_DISABLED" }, 503);
            const body = await readBody(request);
            if (!exactKeys(body, ["slot"]) || !decodeFixedSlot(body.slot)) return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            try { return json({ success: true, ...await identity(env, body.slot) }); }
            catch { return json({ success: false, code: "ISSUER_UNAVAILABLE" }, 503); }
        }
        if (url.pathname === "/internal/issue" && request.method === "POST") {
            if (!enabled(env) || !configurationReady(env)) return json({ success: false, code: "ISSUER_DISABLED" }, 503);
            const body = await readBody(request);
            if (!exactKeys(body, ["slot", "generation", "invalidatedBefore", "securityEpoch"])
                || !decodeFixedSlot(body.slot) || !Number.isSafeInteger(body.generation) || body.generation < 0
                || !Number.isSafeInteger(body.invalidatedBefore) || body.invalidatedBefore < 0
                || typeof body.securityEpoch !== "string" || !/^[1-9]\d*$/u.test(body.securityEpoch)) {
                return json({ success: false, code: "REQUEST_SCHEMA_INVALID" }, 400);
            }
            try { return json({ success: true, ...await signAssertion(env, body) }); }
            catch { return json({ success: false, code: "ISSUER_UNAVAILABLE" }, 503); }
        }
        return json({ success: false, code: "NOT_FOUND" }, 404);
    }
};

export { SLOTS, deriveAccountKey, identity, signAssertion, signSigningKeyCheck };
