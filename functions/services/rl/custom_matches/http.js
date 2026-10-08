"use strict";

import { isAuthorizationError } from "../../auth/authorization.js";
import { authorizeRocketLeagueRequest } from "../authorization.js";
import { callCustomMatchRuntime, isCustomMatchRuntimeCallerConfigured } from "./runtime_client.js";
import { readJsonBody } from "../../http/json.js";
import { withUpstreamDeadline } from "../../http/upstream.js";
import { callCustomMatchRpc } from "../../supabase/rocketleague/custom_matches.js";
import { CustomMatchError, validateCustomMatchRequest } from "./contracts.js";
import { executeCustomMatchOperation } from "./service.js";

const BASIC_ACTIONS = new Set(["open", "join", "leave", "assign_team", "resize", "set_join_policy", "set_allow_join_after_start", "begin_pregame", "start", "cancel", "close", "archive", "kick_member", "transfer_host",
    "create_invite", "revoke_invite", "join_with_invite", "request_join", "approve_join", "reject_join", "allow_rejoin", "set_spectator_settings"]);
const GET_OPERATIONS = new Set(["access", "limits", "list", "detail", "credentials", "rounds", "voteResult", "playerResults", "invites", "joinRequests", "memberHistory"]);
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json; charset=utf-8" };
export function customMatchJson(value, status = 200, headers = {}) {
    return Response.json(value, { status, headers: { ...HEADERS, ...headers } });
}
function failure(code, status) { throw new CustomMatchError(code, status); }
function query(request, operation) {
    const params = new URL(request.url).searchParams;
    const fields = operation === "list" ? new Set(["state", "page", "pageSize"]) : new Set();
    if ([...params.keys()].some(key => !fields.has(key) || params.getAll(key).length !== 1)) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
    const input = {};
    for (const [key, value] of params) {
        if (["page", "pageSize"].includes(key)) {
            if (!/^\d{1,6}$/.test(value)) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
            input[key] = Number(value);
        } else input[key] = value;
    }
    return validateCustomMatchRequest(operation, input);
}
async function mutationBody(request) {
    const origin = new URL(request.url).origin;
    if (request.headers.get("Origin") !== origin || request.headers.get("Sec-Fetch-Site") === "cross-site") failure("CUSTOM_MATCH_ORIGIN_FORBIDDEN", 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) failure("CUSTOM_MATCH_INPUT_INVALID", 415);
    // Cancel a stalled browser body as well as bounding the read/parse operation.
    const readerRequest = new Request(request);
    try {
        const body = await withUpstreamDeadline(signal => readJsonBody(readerRequest, 8192, signal), 3000);
        if (!body.success) failure("CUSTOM_MATCH_INPUT_INVALID", body.tooLarge ? 413 : 400);
        return body.data;
    } catch (error) {
        if (error?.code === "UPSTREAM_TIMEOUT") {
            void readerRequest.body?.cancel().catch(() => {});
            failure("CUSTOM_MATCH_INPUT_TIMEOUT", 408);
        }
        throw error;
    }
}
function errorResponse(error) {
    if (error instanceof CustomMatchError) return customMatchJson({ success: false, code: error.code }, error.status);
    if (isAuthorizationError(error)) {
        // Never forward provider/restriction diagnostics or arbitrary exception text.
        const code = error.code === "ACCOUNT_ACCESS_RESTRICTED" ? error.code
            : error.status === 401 ? "CUSTOM_MATCH_SIGN_IN_REQUIRED"
                : error.status === 403 ? "CUSTOM_MATCH_ACCESS_DENIED" : "CUSTOM_MATCH_UNAVAILABLE";
        return customMatchJson({ success: false, code }, error.status === 401 ? 401 : error.status === 403 ? 403 : 503);
    }
    return customMatchJson({ success: false, code: "CUSTOM_MATCH_UNAVAILABLE" }, 503);
}

// Operations are fixed by file-based routes, never taken from browser RPC names.
export async function handleCustomMatchHttp(context, operation) {
    const { request, env, params } = context;
    const mutation = !GET_OPERATIONS.has(operation);
    const method = mutation ? "POST" : "GET";
    if (request.method !== method) return customMatchJson({ success: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: method });
    try {
        if (operation === "access") {
            if (new URL(request.url).search) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
            await authorizeRocketLeagueRequest(request, env, "rocket_league");
            return customMatchJson({ success: true, allowed: true });
        }
        if (operation === "limits" || operation === "list") {
            const input = query(request, operation);
            const parameters = operation === "limits" ? { p_game_key: "rocketleague" }
                : { p_game_key: "rocketleague", p_state: input.state ?? null, p_page: input.page ?? 1, p_page_size: input.pageSize ?? 30 };
            const result = await callCustomMatchRpc(env, operation, parameters);
            if (operation === "list" && result.matches.some(match => match.visibility !== "public")) failure("CUSTOM_MATCH_RESPONSE_INVALID", 502);
            return customMatchJson(result);
        }
        if (new URL(request.url).search) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
        let input = mutation ? await mutationBody(request) : { matchCode: params?.matchCode };
        if (mutation && ["action", "beginRound", "openVote", "castVote", "resolveVote", "submitResult", "confirmResult"].includes(operation)
            && ["matchCode", "roundCode", "resultCode"].some(key => Object.hasOwn(input, key))) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
        if (["rounds", "playerResults"].includes(operation)) input = { matchCode: params?.matchCode };
        if (operation === "voteResult") input = { matchCode: params?.matchCode, roundCode: params?.roundCode };
        if (operation === "confirmResult") input = { ...input, matchCode: params?.matchCode, resultCode: params?.resultCode };
        if (["beginRound", "openVote", "castVote", "resolveVote", "submitResult"].includes(operation)) {
            input = { ...input, matchCode: params?.matchCode, ...(["openVote", "castVote", "resolveVote"].includes(operation) ? { roundCode: params?.roundCode } : {}) };
        }
        if (["openVote", "castVote", "resolveVote"].includes(operation)) {
            const validated = validateCustomMatchRequest(operation, input);
            const authorization = await authorizeRocketLeagueRequest(request, env, "rocket_league");
            if (!isCustomMatchRuntimeCallerConfigured(env)) failure("CUSTOM_MATCH_RUNTIME_UNAVAILABLE", 503);
            const runtimeOperation = operation === "openVote" ? "round-open" : operation === "resolveVote" ? "resolve-vote" : "vote";
            return await callCustomMatchRuntime(env, `/${runtimeOperation}/${validated.matchCode}`, authorization.accountId,
                operation !== "castVote" ? { roundCode: validated.roundCode, expectedVersion: validated.expectedVersion,
                    expectedRoundVersion: validated.expectedRoundVersion, idempotencyKey: validated.idempotencyKey }
                    : { roundCode: validated.roundCode, vote: validated.vote, idempotencyKey: validated.idempotencyKey });
        }
        if (operation === "action") {
            if (Object.hasOwn(input, "matchCode")) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
            const validated = validateCustomMatchRequest("action", { ...input, matchCode: params?.matchCode });
            if (validated.action === "start") {
                const authorization = await authorizeRocketLeagueRequest(request, env, "rocket_league");
                if (!isCustomMatchRuntimeCallerConfigured(env)) failure("CUSTOM_MATCH_RUNTIME_UNAVAILABLE", 503);
                return await callCustomMatchRuntime(env, `/start/${validated.matchCode}`, authorization.accountId, {
                    expectedVersion: validated.expectedVersion, idempotencyKey: validated.idempotencyKey
                });
            }
            if (!BASIC_ACTIONS.has(validated.action)) failure("CUSTOM_MATCH_ACTION_NOT_AVAILABLE", 403);
            input = { ...input, action: validated.action, payload: validated.payload };
        }
        if (operation === "action") {
            if (Object.hasOwn(input, "matchCode")) failure("CUSTOM_MATCH_INPUT_INVALID", 400);
            if (!BASIC_ACTIONS.has(input.action)) failure("CUSTOM_MATCH_ACTION_NOT_AVAILABLE", 403);
            input = { ...input, matchCode: params?.matchCode };
        }
        if (operation === "action" && ["kick_member", "leave"].includes(input.action) && !isCustomMatchRuntimeCallerConfigured(env)) {
            failure("CUSTOM_MATCH_RUNTIME_UNAVAILABLE", 503);
        }
        const result = await executeCustomMatchOperation(request, env, operation, input);
        if (operation === "action" && !["kick_member", "leave"].includes(input.action) && isCustomMatchRuntimeCallerConfigured(env)) {
            await callCustomMatchRuntime(env, `/refresh/${input.matchCode}`, (await authorizeRocketLeagueRequest(request, env, "rocket_league")).accountId, {});
        }
        if (operation === "action" && ["kick_member", "leave"].includes(input.action)) {
            const authorization = await authorizeRocketLeagueRequest(request, env, "rocket_league");
            const revoked = await callCustomMatchRuntime(env, `/revoke/${input.matchCode}`, authorization.accountId, {
                memberCode: input.action === "kick_member" ? input.payload.memberCode : null,
                accountId: input.action === "leave" ? authorization.accountId : null
            });
            if (!revoked.ok) return customMatchJson({ success: false, code: "CUSTOM_MATCH_RUNTIME_UNAVAILABLE" }, 503);
        }
        if (operation === "create") {
            // Credentials are available only through the explicit protected read.
            return customMatchJson({ success: true, match: result.match, capturedAt: result.capturedAt });
        }
        return customMatchJson(result);
    } catch (error) { return errorResponse(error); }
}
