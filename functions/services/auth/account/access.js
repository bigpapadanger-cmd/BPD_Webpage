"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../http/upstream.js";

const ACCOUNT_STATES = new Set(["active", "suspended", "banned", "removed", "inactive"]);
const ACCOUNT_ACTIONS = new Set(["login", "view_account", "view_suspension", "post", "manage_account", "manage_profile",
    "rocket_league", "join_series", "join_match", "create_private_match", "join_private_match", "submit_scoreboard", "submit_result", "refresh_rl_stats"]);
const RL_ACTIONS = new Set(["rocket_league", "join_series", "join_match", "create_private_match", "join_private_match", "submit_scoreboard", "submit_result", "refresh_rl_stats"]);

export class AccountAccessError extends Error {
    constructor(code, status, message, state = null) {
        super(message);
        this.name = "AccountAccessError";
        this.code = code;
        this.status = status;
        this.accessState = state;
    }
}

function unavailable() {
    return new AccountAccessError("ACCOUNT_ACCESS_UNAVAILABLE", 503, "Account access could not be verified.");
}

function getConfiguration(env) {
    const base = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "") : "";
    const key = typeof env?.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "";
    if (!base || !key) throw unavailable();
    return { base, key };
}

async function callRpc(env, name, args, fetcher = fetch) {
    const { base, key } = getConfiguration(env);
    try {
        return await withUpstreamDeadline(async signal => {
            const response = await fetchBoundedResponse(`${base}/rest/v1/rpc/${name}`, {
                method: "POST",
                signal,
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Content-Profile": "api",
                    "Accept-Profile": "api"
                },
                body: JSON.stringify(args)
            }, 16 * 1024, fetcher);
            if (!response.ok) throw unavailable();
            return await response.json();
        });
    } catch {
        throw unavailable();
    }
}

function normalizeAccessState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || typeof value.exists !== "boolean" || typeof value.state !== "string") throw unavailable();
    if (!value.exists) {
        if (value.state !== "unknown") throw unavailable();
        return { exists: false, state: "unknown", accountActive: false, suspended: false, suspendedUntil: null,
            banned: false, removed: false, rocketLeague: { exists: false, active: false } };
    }
    if (!ACCOUNT_STATES.has(value.state) || typeof value.accountActive !== "boolean"
        || typeof value.suspended !== "boolean" || typeof value.banned !== "boolean" || typeof value.removed !== "boolean"
        || !value.rocketLeague || typeof value.rocketLeague !== "object" || Array.isArray(value.rocketLeague)
        || typeof value.rocketLeague.exists !== "boolean" || typeof value.rocketLeague.active !== "boolean") throw unavailable();
    const until = value.suspendedUntil;
    if (until !== null && (typeof until !== "string" || !Number.isFinite(Date.parse(until)))) throw unavailable();
    return {
        exists: true,
        state: value.state,
        accountActive: value.accountActive,
        suspended: value.suspended,
        suspendedUntil: until,
        banned: value.banned,
        removed: value.removed,
        rocketLeague: { exists: value.rocketLeague.exists, active: value.rocketLeague.active,
            registrationStatus: typeof value.rocketLeague.registrationStatus === "string" ? value.rocketLeague.registrationStatus : null,
            registrationComplete: typeof value.rocketLeague.registrationComplete === "boolean" ? value.rocketLeague.registrationComplete : null }
    };
}

export async function getAccountAccessState(env, accountId, fetcher = fetch) {
    if (typeof accountId !== "string" || !accountId.trim()) throw unavailable();
    return normalizeAccessState(await callRpc(env, "get_account_access_state", { p_account_id: accountId.trim() }, fetcher));
}

export async function canAccountPerform(env, accountId, action, fetcher = fetch) {
    const normalized = typeof action === "string" ? action.trim().toLowerCase() : "";
    if (typeof accountId !== "string" || !accountId.trim() || !ACCOUNT_ACTIONS.has(normalized)) throw unavailable();
    const allowed = await callRpc(env, "can_account_perform", { p_account_id: accountId.trim(), p_action: normalized }, fetcher);
    if (typeof allowed !== "boolean") throw unavailable();
    return allowed;
}

export async function assertAccountCanPerform(env, accountId, action, fetcher = fetch) {
    const normalized = typeof action === "string" ? action.trim().toLowerCase() : "";
    const state = await getAccountAccessState(env, accountId, fetcher);
    if (!state.exists) throw new AccountAccessError("ACCOUNT_ACCESS_RESTRICTED", 403, "Account access is restricted.", state);
    if (await canAccountPerform(env, accountId, normalized, fetcher)) return state;
    const code = state.state === "suspended" ? "ACCOUNT_SUSPENDED"
        : RL_ACTIONS.has(normalized) && state.rocketLeague.exists && !state.rocketLeague.active ? "ROCKET_LEAGUE_DISABLED"
            : "ACCOUNT_ACCESS_RESTRICTED";
    const message = code === "ACCOUNT_SUSPENDED" ? "Account participation is temporarily suspended."
        : code === "ROCKET_LEAGUE_DISABLED" ? "Rocket League access is disabled for this account."
            : "Account access is restricted.";
    throw new AccountAccessError(code, 403, message, state);
}

export function safeAccountAccessSummary(state) {
    if (!state || typeof state !== "object") return null;
    return {
        state: state.state,
        suspended: state.suspended === true,
        suspendedUntil: state.suspended === true ? state.suspendedUntil : null,
        rocketLeague: { exists: state.rocketLeague?.exists === true, active: state.rocketLeague?.active === true,
            registrationStatus: state.rocketLeague?.registrationStatus ?? null,
            registrationComplete: state.rocketLeague?.registrationComplete ?? null }
    };
}
