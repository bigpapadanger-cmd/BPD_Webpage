"use strict";
import { withUpstreamDeadline, fetchBoundedResponse } from "../../http/upstream.js";

const validSecret = value => typeof value === "string" && value.length >= 64 && value.length <= 256;
export const isCustomMatchRuntimeCallerConfigured = env => validSecret(env?.CUSTOM_MATCH_RUNTIME_CALLER_SECRET)
    && typeof env?.CUSTOM_MATCH_RUNTIME?.fetch === "function";

export async function callCustomMatchRuntime(env, path, accountId, body) {
    if (env?.CUSTOM_MATCH_RUNTIME_ENABLED === "false") {
        return Response.json({ success: false, code: "CUSTOM_MATCH_RUNTIME_DISABLED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!isCustomMatchRuntimeCallerConfigured(env) || typeof accountId !== "string") {
        return Response.json({ success: false, code: "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    try {
        return await withUpstreamDeadline(signal => fetchBoundedResponse(`https://custom-match-runtime.internal${path}`, {
            method: "POST", headers: { "Content-Type": "application/json", "X-Custom-Match-Caller": env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET,
                "X-Custom-Match-Account": accountId }, body: JSON.stringify(body), signal
        }, 256 * 1024, (url, init) => env.CUSTOM_MATCH_RUNTIME.fetch(new Request(url, init))), 15000);
    } catch {
        return Response.json({ success: false, code: "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
