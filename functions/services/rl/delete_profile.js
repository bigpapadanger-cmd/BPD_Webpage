"use strict";

import { authorizeRequest, isAuthorizationError } from "../auth/authorization.js";
import { json } from "../common_helpers/responses.js";
import { invalidateRlProbeSession } from "./probe_security.js";

const CONFIRMATION_VALUE = "DELETE_ROCKETLEAGUE_PROFILE";
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_ERRORS = Object.freeze({
    ACCOUNT_ID_REQUIRED: [400, "The account could not be verified."],
    ROCKET_LEAGUE_PLAYER_NOT_FOUND: [404, "No Rocket League profile was found to delete."],
    ROCKET_LEAGUE_PROFILE_DELETE_FAILED: [409, "The Rocket League profile could not be deleted. Please try again."]
});

function failure(code, status, message) {
    return json({ success: false, code, message }, status);
}

function rpcErrorCode(body) {
    return Object.keys(DATABASE_ERRORS).find(code =>
        body?.code === code || body?.message === code || body?.error === code
    ) || null;
}

function validateRequest(request) {
    if (request.method !== "DELETE") return ["METHOD_NOT_ALLOWED", 405, "Only DELETE requests are allowed."];
    if (request.headers.get("origin") !== new URL(request.url).origin
        || request.headers.get("sec-fetch-site") === "cross-site") {
        return ["ORIGIN_REQUIRED", 403, "This action must be submitted from this website."];
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return ["INVALID_REQUEST", 400, "Confirm the Rocket League profile deletion and try again."];
    }
    return null;
}

export async function handleRocketLeagueProfileDelete(request, env) {
    const invalid = validateRequest(request);
    if (invalid) return failure(...invalid);

    let input;
    try {
        input = await request.json();
    } catch {
        return failure("INVALID_REQUEST", 400, "Confirm the Rocket League profile deletion and try again.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).length !== 1 || input.confirmation !== CONFIRMATION_VALUE) {
        return failure("CONFIRMATION_REQUIRED", 400, "Confirm the Rocket League profile deletion and try again.");
    }

    let authorization;
    try {
        authorization = await authorizeRequest(request, env, { account: true, action: "rocket_league" });
    } catch (error) {
        if (!isAuthorizationError(error)) {
            return failure("AUTH_SERVICE_UNAVAILABLE", 503, "Account services are temporarily unavailable. Please try again.");
        }
        const status = error.status >= 500 ? 503 : error.status;
        return failure(status === 503 ? "AUTH_SERVICE_UNAVAILABLE" : error.code, status,
            status === 401 ? "Sign in to delete your Rocket League profile."
                : status === 403 ? (error.message || "Account access is restricted.")
                    : "Account services are temporarily unavailable. Please try again.");
    }

    const base = env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
    if (!base || !env.SUPABASE_AUTH || !authorization.accountId) {
        return failure("AUTH_SERVICE_UNAVAILABLE", 503, "Account services are temporarily unavailable. Please try again.");
    }

    let response;
    let result;
    try { await invalidateRlProbeSession(env, authorization.accountId, "profile_delete"); }
    catch { return failure("RL_PROBE_INVALIDATION_REQUIRED", 503, "Temporary Rocket League access could not be revoked. Please try again."); }
    try {
        response = await fetch(`${base}/rest/v1/rpc/delete_rocketleague_profile`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "Accept-Profile": "api",
                "Content-Profile": "api",
                apikey: env.SUPABASE_AUTH,
                Authorization: `Bearer ${env.SUPABASE_AUTH}`
            },
            body: JSON.stringify({ p_account_id: authorization.accountId }),
            signal: AbortSignal.timeout(15000)
        });
        result = await response.json().catch(() => null);
    } catch {
        return failure("AUTH_SERVICE_UNAVAILABLE", 503, "Account services are temporarily unavailable. Please try again.");
    }

    if (!response.ok || result?.success !== true) {
        const code = rpcErrorCode(result);
        if (code) {
            const [status, message] = DATABASE_ERRORS[code];
            return failure(code, status, message);
        }
        return failure("AUTH_SERVICE_UNAVAILABLE", 503, "Account services are temporarily unavailable. Please try again.");
    }

    if (!PLAYER_ID_PATTERN.test(String(result.playerId || ""))
        || !Number.isSafeInteger(result.epicIdentitiesRemoved)
        || result.epicIdentitiesRemoved < 0) {
        return failure("AUTH_SERVICE_UNAVAILABLE", 503, "The deletion result could not be confirmed. Please retry later.");
    }

    return json({
        success: true,
        profileDeleted: true,
        epicLinkRemoved: result.epicIdentitiesRemoved > 0
    });
}
