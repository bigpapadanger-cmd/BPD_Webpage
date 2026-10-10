"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";
import { CustomMatchError, OPERATIONS, customMatchDomainError, sanitizeCustomMatchResponse } from "../../rl/custom_matches/contracts.js";

const SAFE_UPSTREAM_CODES = new Set([
    "CUSTOM_MATCH_UNAVAILABLE", "CUSTOM_MATCH_TIMEOUT", "CUSTOM_MATCH_RESPONSE_INVALID",
    "CUSTOM_MATCH_NOT_FOUND", "CUSTOM_MATCH_VERSION_CONFLICT", "CUSTOM_MATCH_CREDENTIALS_FORBIDDEN",
    "CUSTOM_MATCH_RUNTIME_REQUIRED", "CUSTOM_MATCH_CAPACITY_REACHED", "CUSTOM_MATCH_STATE_CONFLICT",
    "CUSTOM_MATCH_RATE_LIMITED", "CUSTOM_MATCH_ACCESS_DENIED", "UPSTREAM_TIMEOUT",
    "UPSTREAM_UNAVAILABLE", "UPSTREAM_RESPONSE_TOO_LARGE", "UPSTREAM_RESPONSE_INVALID"
]);

function logRpcFailure(operation, stage, urlConfigured, keyConfigured, upstreamStatus, code) {
    try {
        console.warn("custom_match_supabase_rpc_failure", {
            operation,
            stage,
            supabaseUrlConfigured: urlConfigured,
            serviceRoleKeyConfigured: keyConfigured,
            upstreamStatus,
            code: SAFE_UPSTREAM_CODES.has(code) ? code : "CUSTOM_MATCH_UNAVAILABLE"
        });
    } catch {
        // Diagnostics must never affect the request outcome.
    }
}

// No provider ingestion RPCs, generic RPC export, retries, or direct table access.
export async function callCustomMatchRpc(env, operation, parameters) {
    if (!Object.hasOwn(OPERATIONS, operation)) throw new CustomMatchError("CUSTOM_MATCH_INPUT_INVALID", 400);
    let root;
    const rawUrl = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
    const key = typeof env?.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "";
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/rest/v1", "/rest/v1/"].includes(url.pathname)
            || typeof key !== "string" || !key.trim()) throw new Error();
        root = url.origin;
    } catch {
        logRpcFailure(operation, "configuration", Boolean(rawUrl), Boolean(key), null, "CUSTOM_MATCH_UNAVAILABLE");
        throw new CustomMatchError();
    }
    let stage = "request";
    let upstreamStatus = null;
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
            upstreamStatus = response.status;
            stage = "response_decode";
            let raw;
            try { raw = await response.json(); } catch { throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502); }
            if (!response.ok || raw?.success === false) {
                stage = "upstream_response";
                throw customMatchDomainError(raw);
            }
            stage = "response_validation";
            return sanitizeCustomMatchResponse(operation, raw);
        }, 10000);
    } catch (error) {
        const code = error instanceof CustomMatchError ? error.code
            : error?.code === "UPSTREAM_TIMEOUT" ? "CUSTOM_MATCH_TIMEOUT" : "CUSTOM_MATCH_UNAVAILABLE";
        logRpcFailure(operation, stage, true, true, upstreamStatus, code);
        if (error instanceof CustomMatchError) throw error;
        throw new CustomMatchError(error?.code === "UPSTREAM_TIMEOUT" ? "CUSTOM_MATCH_TIMEOUT" : "CUSTOM_MATCH_UNAVAILABLE", error?.code === "UPSTREAM_TIMEOUT" ? 504 : 503);
    }
}
