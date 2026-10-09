"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";
import { CustomMatchError, OPERATIONS, customMatchDomainError, sanitizeCustomMatchResponse } from "../../rl/custom_matches/contracts.js";

// No provider ingestion RPCs, generic RPC export, retries, or direct table access.
export async function callCustomMatchRpc(env, operation, parameters) {
    if (!Object.hasOwn(OPERATIONS, operation)) throw new CustomMatchError("CUSTOM_MATCH_INPUT_INVALID", 400);
    let root;
    const key = typeof env?.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "";
    try {
        const url = new URL(env.SUPABASE_URL);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/rest/v1", "/rest/v1/"].includes(url.pathname)
            || typeof key !== "string" || !key.trim()) throw new Error();
        root = url.origin;
    } catch { throw new CustomMatchError(); }
    try {
        return await withUpstreamDeadline(async signal => {
            const headers = {
                apikey: key,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            };
            // New Supabase secret API keys are opaque API keys, not JWTs.
            // Keep Authorization for legacy service_role JWT compatibility only.
            if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
            const response = await fetchBoundedResponse(`${root}/rest/v1/rpc/${OPERATIONS[operation]}`, {
                method: "POST", redirect: "error", signal,
                headers,
                body: JSON.stringify(parameters)
            }, 256 * 1024);
            let raw;
            try { raw = await response.json(); } catch { throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502); }
            if (!response.ok || raw?.success === false) throw customMatchDomainError(raw);
            return sanitizeCustomMatchResponse(operation, raw);
        }, 10000);
    } catch (error) {
        if (error instanceof CustomMatchError) throw error;
        throw new CustomMatchError(error?.code === "UPSTREAM_TIMEOUT" ? "CUSTOM_MATCH_TIMEOUT" : "CUSTOM_MATCH_UNAVAILABLE", error?.code === "UPSTREAM_TIMEOUT" ? 504 : 503);
    }
}
