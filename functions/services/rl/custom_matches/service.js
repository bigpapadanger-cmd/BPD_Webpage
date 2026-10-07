"use strict";

import { authorizeRocketLeagueRequest } from "../authorization.js";
import { callCustomMatchRpc } from "../../supabase/rocketleague/custom_matches.js";
import { CustomMatchError, validateCustomMatchRequest, toCustomMatchRpcParameters } from "./contracts.js";

// Server-only boundary. Phase B will add narrow HTTP routes with method/CSRF gates.
// No caller-supplied authorization context, actor IDs or dependency overrides.
export async function executeCustomMatchOperation(request, env, operation, input) {
    const validated = validateCustomMatchRequest(operation, input);
    if (operation === "action" && validated.action === "start") throw new CustomMatchError("CUSTOM_MATCH_RUNTIME_REQUIRED", 503);
    if (["openVote", "castVote", "resolveVote"].includes(operation)) throw new CustomMatchError("CUSTOM_MATCH_VOTING_NOT_AVAILABLE", 503);
    const action = operation === "create" ? "create_private_match"
        : operation === "action" && ["join", "join_with_invite", "request_join"].includes(validated.action) ? "join_private_match"
            : ["submitResult", "confirmResult"].includes(operation) ? "submit_result" : "rocket_league";
    const authorization = await authorizeRocketLeagueRequest(request, env, action);
    const parameters = toCustomMatchRpcParameters(operation, validated, authorization.accountId);
    if (operation === "create" || (operation === "action" && validated.action === "resize")) {
        const limits = await callCustomMatchRpc(env, "limits", { p_game_key: "rocketleague" });
        const options = operation === "create" ? validated.options : validated.payload;
        const mode = limits.modes.find(item => item.modeKey === (options.modeKey ?? "standard"));
        if (operation === "create" && !mode) throw new CustomMatchError("CUSTOM_MATCH_INPUT_INVALID", 400);
        const a = options.teamACapacity ?? mode?.defaultTeamACapacity ?? limits.defaultTeamCapacity;
        const b = options.teamBCapacity ?? mode?.defaultTeamBCapacity ?? limits.defaultTeamCapacity;
        if (a > limits.maxTeamCapacity || b > limits.maxTeamCapacity || a + b > limits.maxTotalParticipants) {
            throw new CustomMatchError("CUSTOM_MATCH_INPUT_INVALID", 400);
        }
    }
    const result = await callCustomMatchRpc(env, operation, parameters);
    if ((validated.matchCode && result.matchCode && validated.matchCode !== result.matchCode)
        || (validated.matchCode && result.match && validated.matchCode !== result.match.matchCode)
        || (validated.roundCode && result.roundCode && validated.roundCode !== result.roundCode)
        || (operation === "action" && result.action !== validated.action)) {
        throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502);
    }
    if (operation === "create" && (result.match.state !== "created" || result.match.version !== 1)) {
        throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502);
    }
    if (operation === "action" && (result.previousVersion !== validated.expectedVersion || result.version <= result.previousVersion)) {
        throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502);
    }
    return result;
}
