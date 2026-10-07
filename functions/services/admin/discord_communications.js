import { fetchBoundedResponse, withUpstreamDeadline } from "../http/upstream.js";

const encoder = new TextEncoder();
export function communicationsError(code = "DISCORD_COMMUNICATIONS_UNAVAILABLE", status = 503) {
    return Object.assign(new Error("Discord communication unavailable."), { code, status });
}
async function signingKey(env) {
    const secret = env.DISCORD_COMMUNICATIONS_SECRET;
    if (typeof secret !== "string" || secret.length < 32) throw communicationsError();
    return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function message(path, timestamp, nonce, body) { return encoder.encode(`POST\n${path}\n${timestamp}\n${nonce}\n${body}`); }
export async function signedCommunicationRequest(env, url, value) {
    const body = JSON.stringify(value);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const signature = await crypto.subtle.sign("HMAC", await signingKey(env), message(new URL(url).pathname, timestamp, nonce, body));
    return new Request(url, { method: "POST", headers: { "Content-Type": "application/json",
        "X-BPD-Time": timestamp, "X-BPD-Nonce": nonce,
        "X-BPD-Signature": Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("") }, body });
}
export async function readCommunicationBody(request, maxBytes = 65536) {
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(request, { signal }, maxBytes,
            async () => new Response(request.body, { headers: request.headers }));
        return response.text();
    }, 5000);
}
export async function verifyCommunicationRequest(env, request, body) {
    const time = request.headers.get("X-BPD-Time") || "";
    const nonce = request.headers.get("X-BPD-Nonce") || "";
    const hex = request.headers.get("X-BPD-Signature") || "";
    if (request.method !== "POST" || !/^\d{10}$/.test(time) || Math.abs(Date.now() / 1000 - Number(time)) > 30
        || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(hex)) throw communicationsError("COMMUNICATION_AUTH_FAILED", 401);
    const bytes = Uint8Array.from(hex.match(/../g), b => parseInt(b, 16));
    if (!await crypto.subtle.verify("HMAC", await signingKey(env), bytes,
        message(new URL(request.url).pathname, time, nonce, body))) throw communicationsError("COMMUNICATION_AUTH_FAILED", 401);
    return nonce;
}
export async function callDiscordCommunications(env, path, value) {
    if (!env.DISCORD_COMMUNICATIONS?.fetch) throw communicationsError();
    const request = await signedCommunicationRequest(env, `https://discord-communications.internal${path}`, value);
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(request, { signal }, 65536,
            (input, init) => env.DISCORD_COMMUNICATIONS.fetch(new Request(input, init)));
        const result = await response.json();
        if (!response.ok) {
            const allowed = new Set(["DISCORD_SIGNATURE_INVALID", "DISCORD_APPLICATION_INVALID", "DISCORD_INTERACTION_REPLAY", "COMMUNICATION_INPUT_INVALID"]);
            throw communicationsError(allowed.has(result?.code) ? result.code : undefined,
                [400, 401, 409].includes(response.status) ? response.status : 503);
        }
        if (result?.success !== true) throw communicationsError();
        return result;
    }, 10000);
}
export async function operationHash(value) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
        b => b.toString(16).padStart(2, "0")).join("");
}
