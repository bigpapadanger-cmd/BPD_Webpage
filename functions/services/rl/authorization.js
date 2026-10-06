"use strict";

import { authorizeRequest, AuthorizationError } from "../auth/authorization.js";
import { getRocketLeagueProfileByAccountId } from "../supabase/rocketleague/rocketleague_profile.js";
import { getCanonicalAccount } from "../auth/account/get_session.js";
import { verifyAccountProviderIdentity } from "../auth/providers/provider_identity.js";
import { getProviderAuthorizationState } from "../auth/providers/provider_auth_state.js";

// Scheduled work has no browser session. Recheck account/link/freshness for each
// server-selected candidate; never infer authorization from a cached Epic ID.
export async function verifyBackgroundEpicAccount(env, accountId, epicAccountId) {
    const account = await getCanonicalAccount(env, accountId);
    if (account?.active !== true) return false;
    const identity = await verifyAccountProviderIdentity(env, accountId, "epic");
    if (!identity || identity.providerSubject !== epicAccountId) return false;
    const freshness = await getProviderAuthorizationState(env, accountId, "epic");
    return freshness.authorized === true;
}

// Current action policy owns registration eligibility. Canonical Epic linkage
// remains verified; freshness is required only for live stats refresh.
export async function authorizeRocketLeagueRequest(request, env, action = "rocket_league") {
    const authorization = await authorizeRequest(request, env, { account: true, action, provider: "epic",
        requireFreshProvider: action === "refresh_rl_stats" });
    let profile;
    try {
        profile = await getRocketLeagueProfileByAccountId(env, authorization.accountId);
    } catch {
        throw new AuthorizationError("RL_PROFILE_UNAVAILABLE", "Rocket League profile service is unavailable.", 503);
    }
    const accountId = profile?.accountId ?? profile?.account_id ?? profile?.userId ?? profile?.user_id;
    const playerId = profile?.rlPlayerId ?? profile?.rl_player_id;
    if (profile && accountId !== authorization.accountId) {
        throw new AuthorizationError("RL_PROFILE_UNAVAILABLE", "Rocket League profile identity could not be verified.", 503);
    }
    const complete = (profile?.registrationStatus ?? profile?.registration_status) === "complete";
    // The centralized current-state action policy has already authorized this
    // action. Optional profile completeness is not an additional permission.
    if (!playerId || profile?.active !== true || !complete) {
        throw new AuthorizationError("RL_REGISTRATION_REQUIRED", "Complete Rocket League registration and required consent first.", 403);
    }
    return { ...authorization, profile };
}

export function authorizationErrorResponse(error) {
    const status = Number.isInteger(error?.status) ? error.status : 503;
    return Response.json({ success: false, code: error?.code || "AUTH_SERVICE_UNAVAILABLE",
        message: status >= 500 ? "Authorization service is unavailable. Please retry." : error.message,
        authenticated: status === 401 ? false : status >= 500 ? null : true,
        available: status < 500, rocketLeagueAccess: false,
        epicLinked: error?.details?.linked ?? null,
        requiresEpicReauthorization: error?.code === "PROVIDER_REAUTHORIZATION_REQUIRED",
        requiresEpicLogin: error?.code === "PROVIDER_REQUIRED"
    }, { status, headers: { "Cache-Control": "no-store" } });
}
