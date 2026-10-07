import { callDiscordCommunications, readCommunicationBody, verifyCommunicationRequest } from "../../../services/admin/discord_communications.js";
import { ADMIN_TASK_RPCS, callAdminTaskRpc } from "../../../services/supabase/admin/tasks/rpc.js";

export async function onRequest({ request, env }) {
    if (request.method !== "POST") return Response.json({ success: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
    try {
        const body = await readCommunicationBody(request, 1024);
        const nonce = await verifyCommunicationRequest(env, request, body);
        if (env.DISCORD_COMMUNICATIONS_ENABLED !== "true") throw new Error("DISABLED");
        const value = JSON.parse(body);
        if (!value || Object.keys(value).join(",") !== "occurrence" || !/^\d{4}-\d{2}-\d{2}$/.test(value.occurrence)) throw new Error("INVALID");
        const claim = await callDiscordCommunications(env, "/internal/claim", { key: `summary-request:${nonce}` });
        if (!claim.accepted) return Response.json({ success: false, code: "REQUEST_REPLAY" }, { status: 409 });
        const result = await callAdminTaskRpc(env, ADMIN_TASK_RPCS.WEEKLY_SUMMARY, {});
        return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch {
        return Response.json({ success: false, code: "TASK_SUMMARY_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
