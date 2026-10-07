import { communicationsError, operationHash, readCommunicationBody, signedCommunicationRequest,
    verifyCommunicationRequest } from "../../../functions/services/admin/discord_communications.js";
import { fetchBoundedResponse, withUpstreamDeadline } from "../../../functions/services/http/upstream.js";
import { verifyDiscordMatchBotInteraction, parseDiscordMatchBotInteraction,
    createDiscordMatchBotPong, createDiscordMatchBotEphemeralMessage,
    createDiscordMatchBotAutocompleteResponse } from "../../../functions/services/auth/providers/discord_matchbot/interactions.js";
export { DiscordCommunicationReceipts } from "./receipts.js";

function schema(value, fields) {
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== fields.sort().join(",")) {
        throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
    }
}
export async function claimOperation(env, key, ttlMs) {
    if (!env.DISCORD_COMMUNICATION_RECEIPTS) throw communicationsError();
    const hash = await operationHash(key);
    const stub = env.DISCORD_COMMUNICATION_RECEIPTS.get(env.DISCORD_COMMUNICATION_RECEIPTS.idFromName(hash));
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse("https://receipt.internal/claim", { method: "POST", signal,
            body: JSON.stringify({ key: hash, expiresAt: Date.now() + ttlMs }) }, 1024,
        (input, init) => stub.fetch(input, init));
        const result = await response.json();
        if (!response.ok || typeof result.accepted !== "boolean") throw communicationsError();
        return result.accepted;
    }, 2000);
}
async function deliver(url, payload) {
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(url, { method: "POST", signal, redirect: "error",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 16384);
        if (!response.ok) throw communicationsError(response.status === 429 ? "DISCORD_RATE_LIMITED" : "DISCORD_DELIVERY_UNAVAILABLE");
    }, 10000);
}
function webhook(env, destination) {
    const value = env[destination === "created" ? "NEW_TASKBOARD_REPORT_DISCORD" : "TASKBOARD_SUMMARY_DISCORD"];
    let url;
    try { url = new URL(value); } catch { throw communicationsError(); }
    if (url.origin !== "https://discord.com" || !/^\/api(?:\/v10)?\/webhooks\/[1-9][0-9]{16,19}\/[A-Za-z0-9_.-]+$/.test(url.pathname)
        || url.search || url.hash || url.username || url.password) throw communicationsError();
    return url.href;
}
export function weeklyOccurrence(timestamp) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
        weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    return parts.weekday === "Fri" && parts.hour === "18" ? `${parts.year}-${parts.month}-${parts.day}` : null;
}
export function validateSummary(value) {
    const groups = { status: ["to_do", "in_progress", "completed", "shelved", "archived", "deleted"],
        responsibility: ["owner", "database", "security", "ui"] };
    schema(value, ["total_tasks", "active_tasks", "deleted_tasks", "status", "responsibility"]);
    const count = n => Number.isSafeInteger(n) && n >= 0;
    if (![value.total_tasks, value.active_tasks, value.deleted_tasks].every(count)) throw communicationsError();
    for (const [name, fields] of Object.entries(groups)) {
        schema(value[name], fields);
        if (!Object.values(value[name]).every(count)) throw communicationsError();
    }
    return value;
}
export async function runWeeklySummary(env, timestamp) {
    if (env.DISCORD_COMMUNICATIONS_ENABLED !== "true") return;
    const date = weeklyOccurrence(timestamp);
    if (!date || !await claimOperation(env, `weekly:${date}`, 8 * 86400000)) return;
    // Claim first: uncertain delivery is never automatically retried.
    if (env.BPD_SITE_URL !== "https://bpd-gaming-network.com") throw communicationsError();
    const request = await signedCommunicationRequest(env, `${env.BPD_SITE_URL}/api/internal/discord/task-summary`, { occurrence: date });
    const summary = await withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(request, { signal, redirect: "error" }, 16384);
        if (!response.ok) throw communicationsError();
        return validateSummary(await response.json());
    }, 10000);
    await deliver(webhook(env, "summary"), { username: "BPD Taskboard", allowed_mentions: { parse: [] }, embeds: [{
        title: "BPD Taskboard Weekly Summary", color: 0x9B59B6,
        description: `Total: ${summary.total_tasks} · Active (not deleted): ${summary.active_tasks} · Deleted: ${summary.deleted_tasks}`,
        fields: [{ name: "Task status", value: Object.entries(summary.status).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join("\n") },
            { name: "Responsibility", value: Object.entries(summary.responsibility).map(([k, v]) => `${k}: ${v}`).join("\n") }],
        timestamp: new Date(timestamp).toISOString()
    }] });
}
export default {
    async fetch(request, env) {
        try {
            if (request.method !== "POST") return Response.json({ success: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
            const body = await readCommunicationBody(request);
            await verifyCommunicationRequest(env, request, body);
            if (env.DISCORD_COMMUNICATIONS_ENABLED !== "true") throw communicationsError("COMMUNICATIONS_DISABLED");
            const value = JSON.parse(body);
            const path = new URL(request.url).pathname;
            if (path === "/internal/claim") {
                schema(value, ["key"]);
                if (typeof value.key !== "string" || value.key.length > 200) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                return Response.json({ success: true, accepted: await claimOperation(env, value.key, 60000) });
            }
            if (path === "/internal/verify") {
                schema(value, ["rawBody", "signature", "timestamp"]);
                if (typeof value.rawBody !== "string" || value.rawBody.length > 32768
                    || typeof value.signature !== "string" || typeof value.timestamp !== "string") throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                const signed = new Request("https://discord.internal", { headers: {
                    "X-Signature-Ed25519": value.signature, "X-Signature-Timestamp": value.timestamp } });
                if (!await verifyDiscordMatchBotInteraction(signed, env, value.rawBody)) throw communicationsError("DISCORD_SIGNATURE_INVALID", 401);
                const interaction = parseDiscordMatchBotInteraction(value.rawBody);
                if (interaction.applicationId !== env.DISCORD_MATCHBOT_CLIENT_ID) throw communicationsError("DISCORD_APPLICATION_INVALID", 401);
                if (interaction.type === 2 && interaction.data?.name === "complete") {
                    if (!/^[1-9][0-9]{16,19}$/.test(interaction.id || "") || !/^[A-Za-z0-9_.-]{1,512}$/.test(interaction.token || "")) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                    if (!await claimOperation(env, `interaction:${interaction.id}`, 10 * 60000)) throw communicationsError("DISCORD_INTERACTION_REPLAY", 409);
                    return Response.json({ success: true, interaction: { id: interaction.id, applicationId: interaction.applicationId,
                        type: interaction.type, guildId: interaction.guildId, token: interaction.token,
                        user: { id: interaction.user?.id }, data: { name: "complete", options: interaction.data.options } } });
                }
                const response = interaction.type === 1 ? createDiscordMatchBotPong()
                    : interaction.type === 4 ? createDiscordMatchBotAutocompleteResponse([])
                        : createDiscordMatchBotEphemeralMessage("This MatchBot action is not configured yet.");
                return Response.json({ success: true, response });
            }
            if (path === "/internal/reply") {
                schema(value, ["applicationId", "interactionId", "token", "content"]);
                if (value.applicationId !== env.DISCORD_MATCHBOT_CLIENT_ID || !/^[1-9][0-9]{16,19}$/.test(value.interactionId)
                    || !/^[A-Za-z0-9_.-]{1,512}$/.test(value.token) || typeof value.content !== "string" || value.content.length > 2000) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                if (!await claimOperation(env, `reply:${value.interactionId}`, 20 * 60000)) throw communicationsError("DISCORD_INTERACTION_REPLAY", 409);
                await withUpstreamDeadline(async signal => {
                    const result = await fetchBoundedResponse(`https://discord.com/api/v10/webhooks/${value.applicationId}/${encodeURIComponent(value.token)}/messages/@original`,
                        { method: "PATCH", signal, redirect: "error", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ content: value.content, allowed_mentions: { parse: [] } }) }, 16384);
                    if (!result.ok) throw communicationsError();
                });
                return Response.json({ success: true });
            }
            if (path === "/internal/notify") {
                schema(value, ["destination", "payload"]);
                if (!["created", "summary"].includes(value.destination)) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                const payload = value.payload;
                if (!payload || typeof payload !== "object" || Object.keys(payload).some(k => !["username", "content", "embeds", "allowed_mentions"].includes(k))
                    || !Array.isArray(payload.embeds) || payload.embeds.length !== 1 || JSON.stringify(payload).length > 16000) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                // No user/everyone mentions; only canonical server-generated role IDs.
                const roles = payload.allowed_mentions?.roles || [];
                if (!Array.isArray(roles) || roles.length > 4 || roles.some(r => !/^[1-9][0-9]{16,19}$/.test(r))) throw communicationsError("COMMUNICATION_INPUT_INVALID", 400);
                payload.allowed_mentions = { parse: [], roles };
                if (!await claimOperation(env, `notification:${value.destination}:${await operationHash(JSON.stringify(payload))}`, 86400000)) return Response.json({ success: true, duplicate: true });
                await deliver(webhook(env, value.destination), payload);
                return Response.json({ success: true });
            }
            return Response.json({ success: false, code: "NOT_FOUND" }, { status: 404 });
        } catch (error) {
            return Response.json({ success: false, code: ["COMMUNICATION_AUTH_FAILED", "COMMUNICATION_INPUT_INVALID", "COMMUNICATIONS_DISABLED", "DISCORD_SIGNATURE_INVALID", "DISCORD_APPLICATION_INVALID", "DISCORD_INTERACTION_REPLAY", "DISCORD_RATE_LIMITED"].includes(error?.code)
                ? error.code : "DISCORD_COMMUNICATIONS_UNAVAILABLE" }, { status: error?.status === 401 ? 401 : error?.status === 400 ? 400 : error?.status === 409 ? 409 : 503 });
        }
    },
    scheduled(controller, env, ctx) {
        ctx.waitUntil(runWeeklySummary(env, controller.scheduledTime).catch(() => console.warn("Discord weekly summary unavailable.", { code: "WEEKLY_SUMMARY_UNAVAILABLE" })));
    }
};
