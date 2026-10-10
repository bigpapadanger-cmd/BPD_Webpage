"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";
import { CustomMatchError, OPERATIONS, customMatchDomainError, sanitizeCustomMatchResponse } from "../../rl/custom_matches/contracts.js";

const SAFE_UPSTREAM_CODES = new Set([
    "CUSTOM_MATCH_UNAVAILABLE", "CUSTOM_MATCH_TIMEOUT", "CUSTOM_MATCH_RESPONSE_INVALID",
    "CUSTOM_MATCH_NOT_FOUND", "CUSTOM_MATCH_VERSION_CONFLICT", "CUSTOM_MATCH_CREDENTIALS_FORBIDDEN",
    "CUSTOM_MATCH_RUNTIME_REQUIRED", "CUSTOM_MATCH_CAPACITY_REACHED", "CUSTOM_MATCH_STATE_CONFLICT",
    "CUSTOM_MATCH_RATE_LIMITED", "CUSTOM_MATCH_ACCESS_DENIED", "UPSTREAM_TIMEOUT",
    "UPSTREAM_UNAVAILABLE", "UPSTREAM_CONFIGURATION_INVALID", "UPSTREAM_RESPONSE_TOO_LARGE", "UPSTREAM_RESPONSE_INVALID"
]);
const SAFE_TRANSPORT_CLASSES = new Set(["abort", "type_error", "error", "other"]);
const SAFE_TRANSPORT_CAUSES = new Set(["dns", "connection", "timeout", "tls", "other", "not_available"]);
const EXPECTED_SUPABASE_HOST = "xslrwamnfqgoziaczgsn.supabase.co";
const SAFE_PARAMETER_KEYS = new Set([
    "p_game_key", "p_state", "p_page", "p_page_size", "p_match_code", "p_round_code",
    "p_idempotency_key", "p_expected_version", "p_expected_match_version", "p_expected_round_version",
    "p_actor_account_id", "p_admin_account_id", "p_action", "p_payload", "p_options", "p_vote",
    "p_target_member_code", "p_reason", "p_result_code", "p_team_a_score", "p_team_b_score"
]);

function logRpcFailure({ operation, stage, rawUrl, urlValid, targetMatches, key, upstreamStatus, code, transportErrorClass, transportCauseClass, headers, parameters }) {
    try {
        console.warn("custom_match_supabase_rpc_failure", {
            operation,
            stage,
            method: "POST",
            endpointType: "supabase_rpc",
            supabaseUrlConfigured: Boolean(rawUrl),
            supabaseUrlValid: urlValid,
            expectedProjectMatch: targetMatches,
            serviceRoleKeyConfigured: Boolean(key),
            serviceRoleKeyType: !key ? "missing" : key.startsWith("sb_secret_") ? "secret_api_key"
                : key.startsWith("eyJ") ? "legacy_jwt" : "other",
            requestHeaderState: {
                apiKeyPresent: Boolean(headers?.apikey),
                authorizationPresent: Boolean(headers?.Authorization),
                explicitUserAgent: headers?.["User-Agent"] === "BPD-Server-Diagnostic/1.0",
                contentTypePresent: headers?.["Content-Type"] === "application/json",
                profileHeadersPresent: headers?.["Content-Profile"] === "api" && headers?.["Accept-Profile"] === "api"
            },
            parameterKeys: Object.keys(parameters ?? {}).filter(keyName => SAFE_PARAMETER_KEYS.has(keyName)).sort(),
            upstreamStatus,
            transportErrorClass: SAFE_TRANSPORT_CLASSES.has(transportErrorClass) ? transportErrorClass : "not_applicable",
            transportCauseClass: SAFE_TRANSPORT_CAUSES.has(transportCauseClass) ? transportCauseClass : "not_available",
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
    let urlValid = false;
    let targetMatches = false;
    let requestHeaders = null;
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/rest/v1", "/rest/v1/"].includes(url.pathname)) throw new Error();
        urlValid = true;
        targetMatches = url.hostname === EXPECTED_SUPABASE_HOST;
        if (!key) throw new Error();
        root = url.origin;
    } catch {
        logRpcFailure({ operation, stage: "configuration", rawUrl, urlValid, targetMatches, key, upstreamStatus: null,
            code: "CUSTOM_MATCH_UNAVAILABLE", transportErrorClass: null, headers: null, parameters });
        throw new CustomMatchError();
    }
    let stage = "request";
    let upstreamStatus = null;
    try {
        return await withUpstreamDeadline(async signal => {
            const headers = {
                apikey: key,
                "User-Agent": "BPD-Server-Diagnostic/1.0",
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            };
            // New Supabase secret API keys are opaque API keys, not JWTs.
            // Keep Authorization for legacy service_role JWT compatibility only.
            if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
            requestHeaders = headers;
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
        // Preserve the bounded internal transport category in logs while keeping
        // the existing public error mapping unchanged.
        const code = error instanceof CustomMatchError ? error.code : error?.code;
        logRpcFailure({ operation, stage, rawUrl, urlValid, targetMatches, key, upstreamStatus, code,
            transportErrorClass: error?.transportErrorClass, transportCauseClass: error?.transportCauseClass,
            headers: requestHeaders, parameters });
        if (error instanceof CustomMatchError) throw error;
        throw new CustomMatchError(error?.code === "UPSTREAM_TIMEOUT" ? "CUSTOM_MATCH_TIMEOUT" : "CUSTOM_MATCH_UNAVAILABLE", error?.code === "UPSTREAM_TIMEOUT" ? 504 : 503);
    }
}
