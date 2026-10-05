import { authorizeRequest } from "../../authorization.js";
import { verifyAccountProviderIdentity } from "../provider_identity.js";
import { handleLinkProvider } from "../../account/link_provider.js";
import { getDiscordMatchBotEligibility } from "../discord_matchbot/eligibility.js";
import { createCookie, clearCookie, getCookie } from "../../sessions/session.js";
import { createRandomState, json } from "../../../common_helpers/responses.js";
import { withUpstreamDeadline, fetchBoundedResponse } from "../../../http/upstream.js";
import { isValidProviderRuntimeCallerSecret } from "../discord_matchbot/runtime_contract.js";

const COOKIE = "bpd_discord_verification";
const TTL_SECONDS = 300;
const ROUTE = "/api/auth/discord/linked-roles/verify";
const RETURN_TO = "/RocketLeague/MyProfile";
const validNonce = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
const unavailable = () => json({ success: false, code: "DISCORD_VERIFICATION_UNAVAILABLE" }, 503);

async function bindingHash(kind, value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${value}`));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function nonceAuthority(env, operation, nonce, accountId, discordSubject) {
    if (!env.PROVIDER_RUNTIME?.fetch || !isValidProviderRuntimeCallerSecret(env.PROVIDER_RUNTIME_CALLER_SECRET)) {
        throw new Error("DISCORD_VERIFICATION_UNAVAILABLE");
    }
    const body = { nonce, accountBinding: await bindingHash("bpd-account", accountId),
        discordBinding: await bindingHash("discord-identity", discordSubject), action: "discord_linked_roles_verify",
        ...(operation === "create" ? { expiresAt: Date.now() + TTL_SECONDS * 1000 } : {}) };
    await withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(`https://provider-runtime.internal/internal/discord/linked-roles/nonce/${operation}`, {
            method: "POST", signal, headers: { Authorization: `Bearer ${env.PROVIDER_RUNTIME_CALLER_SECRET}`,
                "Content-Type": "application/json" }, body: JSON.stringify(body)
        }, 1024, (input, init) => env.PROVIDER_RUNTIME.fetch(new Request(input, init)));
        // Fixed tiny response only; no provider IDs/session data are returned.
        const result = await response.json();
        const expected = { create: "DISCORD_NONCE_CREATED", begin: "DISCORD_NONCE_BEGUN", consume: "DISCORD_NONCE_CONSUMED" }[operation];
        if (!response.ok || result?.success !== true || result.code !== expected) {
            throw Object.assign(new Error("Discord verification failed."), {
                code: response.status === 409 ? "DISCORD_VERIFICATION_STATE_INVALID" : "DISCORD_VERIFICATION_UNAVAILABLE"
            });
        }
    });
}

// GET is a confirmation screen, not a provider call or an eligibility mutation.
export async function startLinkedRolesVerification(request, env) {
    if (!["GET", "POST"].includes(request.method)) {
        return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
    }
    if (new URL(request.url).search) return json({ success: false, code: "INVALID_REQUEST" }, 400);
    if (request.method === "POST" && (request.headers.get("Origin") !== new URL(request.url).origin
        || request.headers.get("Sec-Fetch-Site") === "cross-site")) {
        return json({ success: false, code: "SAME_ORIGIN_REQUIRED" }, 403);
    }
    try {
        const authorization = await authorizeRequest(request, env, { account: true, recovery: true });
        const accountId = authorization.accountId;
        const identity = await verifyAccountProviderIdentity(env, accountId, "discord");
        if (!identity?.active || !/^\d{16,22}$/u.test(identity.providerSubject || "")) {
            return json({ success: false, code: "DISCORD_LINK_REQUIRED" }, 403);
        }
        if (request.method === "GET") {
            const nonce = createRandomState();
            await nonceAuthority(env, "create", nonce, accountId, identity.providerSubject);
            return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verify Discord connection</title><h1>Verify Discord connection</h1><p>Confirm your linked Discord account, then check for a shared server with the BPD bot. Discord authorization alone does not enable notifications.</p><form method="post" action="${ROUTE}"><input type="hidden" name="state" value="${nonce}"><button type="submit">Continue to Discord</button></form><p><a href="${RETURN_TO}">Return to My Profile</a></p></html>`, {
                headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
                    "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
                    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
                    "Set-Cookie": createCookie(request, COOKIE, nonce, TTL_SECONDS) }
            });
        }
        if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
            return json({ success: false, code: "INVALID_REQUEST" }, 400);
        }
        // Bound the stream, not merely Content-Length (which clients can omit).
        const reader = request.body?.getReader();
        if (!reader) return json({ success: false, code: "INVALID_REQUEST" }, 400);
        let size = 0;
        const chunks = [];
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 128) { await reader.cancel(); return json({ success: false, code: "INVALID_REQUEST" }, 400); }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const form = new URLSearchParams(new TextDecoder().decode(bytes));
        const nonce = form.get("state");
        if ([...form.keys()].length !== 1 || !validNonce(nonce) || nonce !== getCookie(request, COOKIE)) {
            return json({ success: false, code: "DISCORD_VERIFICATION_STATE_INVALID" }, 403);
        }
        await nonceAuthority(env, "begin", nonce, accountId, identity.providerSubject);
        const url = new URL("/api/auth/link", request.url);
        url.searchParams.set("provider", "discord");
        url.searchParams.set("returnTo", RETURN_TO);
        return await handleLinkProvider(new Request(url, { headers: request.headers }), env);
    } catch (error) {
        const status = [401, 403].includes(error?.status) ? error.status : 503;
        return json({ success: false, code: status === 401 ? "AUTHENTICATION_REQUIRED"
            : status === 403 ? "DISCORD_VERIFICATION_FORBIDDEN" : "DISCORD_VERIFICATION_UNAVAILABLE" }, status);
    }
}

// Called only after the existing one-use OAuth code/PKCE exchange and canonical
// reauthorization identity check. No provider payload or IDs reach the redirect.
export async function completeLinkedRolesVerification(request, env, accountId, providerIdentity) {
    const nonce = getCookie(request, COOKIE);
    if (!nonce) return null;
    const cookies = [clearCookie(request, COOKIE)];
    const result = code => ({ location: `${RETURN_TO}?discordVerification=${code}`, cookies });
    if (!validNonce(nonce)) return result("failed");
    try {
        if (!accountId || !/^\d{16,22}$/u.test(providerIdentity?.providerSubject || "")) return result("failed");
        await nonceAuthority(env, "consume", nonce, accountId, providerIdentity.providerSubject);
        // The same canonical-identity + complete-inventory service decides eligibility.
        const eligibility = await getDiscordMatchBotEligibility(env, accountId, { force: true });
        return result(eligibility.status !== "available" ? "unavailable"
            : eligibility.eligible === true ? "eligible" : "ineligible");
    } catch (error) { return result(error?.code === "DISCORD_VERIFICATION_STATE_INVALID" ? "failed" : "unavailable"); }
}
