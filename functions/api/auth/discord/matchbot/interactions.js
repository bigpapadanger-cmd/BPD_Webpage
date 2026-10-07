import { readCommunicationBody } from "../../../../services/admin/discord_communications.js";
import { processDiscordMatchBotInteraction } from "../../../../services/auth/providers/discord_matchbot/interactions.js";
import { withUpstreamDeadline } from "../../../../services/http/upstream.js";

// Pages is the thin public ingress. Worker verification/atomic replay acceptance
// precedes all account lookup and task work; a missing binding fails closed.
export async function onRequestPost({ request, env, waitUntil }) {
    try {
        const deadline = Date.now() + 2500;
        const result = await withUpstreamDeadline(async () => {
            const rawBody = await readCommunicationBody(request, 32768);
            return processDiscordMatchBotInteraction(request, env, rawBody, { waitUntil, deadline });
        }, 2500);
        return Response.json(result.response, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return Response.json({ success: false, code: error?.status === 401 ? "DISCORD_SIGNATURE_INVALID" : "DISCORD_INTERACTION_UNAVAILABLE" },
            { status: [400, 401, 409].includes(error?.status) ? error.status : 503, headers: { "Cache-Control": "no-store" } });
    }
}
export function onRequest(context) {
    return context.request.method === "POST" ? onRequestPost(context)
        : Response.json({ success: false, code: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST" } });
}
