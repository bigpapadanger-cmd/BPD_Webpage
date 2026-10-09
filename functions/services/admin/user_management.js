"use strict";

import { createRequestDiagnostics } from "../http/diagnostics.js";
import { authorizeRequest } from "../auth/authorization.js";
import { fetchBoundedResponse, withUpstreamDeadline } from "../http/upstream.js";
import { fetchSupabase, supabaseRestBase, supabaseRestUrl } from "../supabase/rest.js";

const RPCS = Object.freeze({
    list: "admin_list_users",
    details: "admin_get_user_details",
    history: "admin_get_user_management_history",
    notes: "admin_get_user_notes",
    addNote: "admin_add_user_note",
    suspend: "admin_suspend_user",
    liftSuspension: "admin_lift_user_suspension",
    setRlActive: "admin_set_rl_player_active",
    ban: "admin_ban_user",
    reinstate: "admin_reinstate_user",
    remove: "admin_remove_user",
    setRole: "admin_set_user_management_role"
});
const ALLOWED_RPCS = new Set(Object.values(RPCS));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLES = new Set(["owner", "admin", "moderator", "staff"]);
const STATUSES = new Set(["active", "inactive", "suspended", "banned", "removed"]);
const PROVIDERS = new Set(["discord", "epic", "google", "steam"]);
const PERMISSION_KEYS = ["view", "addNote", "suspend", "disableRocketLeague", "ban", "remove", "manageRoles"];
const DETAIL_PERMISSION_KEYS = ["canManage", "canAddNote", "canSuspend", "canLiftSuspension", "canDisableRocketLeague", "canEnableRocketLeague", "canBan", "canReinstate", "canRemove"];
const ERROR_CODES = new Set([
    "USER_MANAGEMENT_FORBIDDEN", "INVALID_STATUS_FILTER", "INVALID_SORT", "TARGET_ACCOUNT_REQUIRED", "ACCOUNT_NOT_FOUND", "TARGET_ACCOUNT_PROTECTED",
    "NOTE_REQUIRED", "NOTE_TOO_LONG", "INVALID_SUSPENSION_DURATION", "SUSPENSION_REASON_REQUIRED",
    "SUSPENSION_REASON_TOO_LONG", "INTERNAL_NOTE_TOO_LONG", "USER_MESSAGE_TOO_LONG", "ACCOUNT_ALREADY_BANNED",
    "ACCOUNT_REMOVED", "ACCOUNT_ALREADY_SUSPENDED", "LIFT_REASON_REQUIRED", "LIFT_REASON_TOO_LONG",
    "NO_ACTIVE_SUSPENSION", "RL_ACTIVE_STATE_REQUIRED", "RL_STATE_REASON_REQUIRED", "RL_STATE_REASON_TOO_LONG",
    "ROCKET_LEAGUE_ACCOUNT_NOT_FOUND", "ROCKET_LEAGUE_ACCOUNT_ALREADY_ACTIVE", "ROCKET_LEAGUE_ACCOUNT_ALREADY_DISABLED",
    "SELF_ROLE_CHANGE_FORBIDDEN", "INVALID_MANAGEMENT_ROLE", "ROLE_CHANGE_REASON_REQUIRED", "ROLE_CHANGE_REASON_TOO_LONG",
    "OWNER_ROLE_PROTECTED", "ADMIN_ROLE_REQUIRES_OWNER", "ROLE_ALREADY_SET", "BAN_REASON_REQUIRED", "NO_ACTIVE_BAN",
    "BAN_REASON_TOO_LONG", "ACCOUNT_ALREADY_REMOVED", "REMOVAL_REASON_REQUIRED", "REMOVAL_REASON_TOO_LONG",
    "REINSTATEMENT_REASON_REQUIRED", "REINSTATEMENT_REASON_TOO_LONG"
]);

export function createUserManagementDiagnostics() {
    const codes = new Set(["PGRST202", "PGRST301", "42501", "42883", "57014", "53300", "08006",
        "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_RESPONSE_TOO_LARGE", "UPSTREAM_RESPONSE_INVALID",
        "USER_MANAGEMENT_RESPONSE_INVALID", "USER_MANAGEMENT_UNAVAILABLE", "AUTH_REQUIRED", "ACCOUNT_IDENTITY_MISSING",
        "ACCOUNT_ACCESS_UNAVAILABLE", "ACCOUNT_ACCESS_RESTRICTED", "ACCOUNT_SUSPENDED", "AUTHENTICATION_REQUIRED",
        "USER_MANAGEMENT_FORBIDDEN", "USER_MANAGEMENT_QUERY_INVALID"]);
    return createRequestDiagnostics({ label: "[USER MANAGEMENT DIAGNOSTIC]", operation: "list_users", codes, timeoutCode: "USER_MANAGEMENT_TIMEOUT" });
}

export class UserManagementError extends Error {
    constructor(code, status = 503) {
        super(code);
        this.name = "UserManagementError";
        this.code = code;
        this.status = status;
    }
}

function fail(code = "USER_MANAGEMENT_UNAVAILABLE", status = 503) {
    throw new UserManagementError(code, status);
}

function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isTimestamp(value, nullable = false) { return (nullable && value === null) || (typeof value === "string" && Number.isFinite(Date.parse(value))); }
function requireBool(value) { if (typeof value !== "boolean") fail("USER_MANAGEMENT_RESPONSE_INVALID"); return value; }
function normalizeRole(value) { if (value === null) return null; if (typeof value !== "string" || !ROLES.has(value)) fail("USER_MANAGEMENT_RESPONSE_INVALID"); return value; }
function copyOptionalString(source, key, nullable = false) {
    if (!Object.hasOwn(source, key)) return {};
    const value = source[key];
    if (nullable && value === null) return { [key]: null };
    if (typeof value !== "string") fail("USER_MANAGEMENT_RESPONSE_INVALID");
    return { [key]: value };
}
function normalizePagination(value) {
    if (!isRecord(value) || !Number.isSafeInteger(value.total) || value.total < 0
        || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 30
        || !Number.isSafeInteger(value.offset) || value.offset < 0 || typeof value.hasMore !== "boolean") {
        fail("USER_MANAGEMENT_RESPONSE_INVALID");
    }
    return { total: value.total, limit: value.limit, offset: value.offset, hasMore: value.hasMore };
}
function normalizePermissions(value) {
    if (!isRecord(value)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const role = normalizeRole(value.role);
    const permissions = { role };
    for (const key of PERMISSION_KEYS) permissions[key] = requireBool(value[key]);
    return permissions;
}
function requireSuccess(value) {
    if (!isRecord(value) || value.success !== true) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    return value;
}
function normalizeSummary(value) {
    if (!isRecord(value) || typeof value.accountId !== "string" || !UUID.test(value.accountId)
        || !STATUSES.has(value.status) || typeof value.accountActive !== "boolean"
        || !isTimestamp(value.createdAt) || !Array.isArray(value.providers)
        || !isRecord(value.rocketLeague) || !isRecord(value.moderation)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const providers = value.providers.map(provider => {
        if (typeof provider !== "string" || !PROVIDERS.has(provider)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        return provider;
    });
    const rl = value.rocketLeague, moderation = value.moderation;
    if (typeof rl.exists !== "boolean" || typeof rl.active !== "boolean" || typeof moderation.suspended !== "boolean"
        || typeof moderation.banned !== "boolean" || typeof moderation.removed !== "boolean"
        || !Number.isSafeInteger(moderation.historyCount) || moderation.historyCount < 0
        || typeof value.canManage !== "boolean") fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const registrationStatus = rl.registrationStatus === undefined ? {} : copyOptionalString(rl, "registrationStatus", true);
    const user = {
        accountId: value.accountId,
        ...copyOptionalString(value, "displayName", true),
        role: normalizeRole(value.role),
        status: value.status,
        accountActive: value.accountActive,
        createdAt: value.createdAt,
        ...copyOptionalString(value, "lastSeenAt", true),
        providers,
        rocketLeague: {
            exists: rl.exists,
            active: rl.active,
            ...registrationStatus,
            ...copyOptionalString(rl, "platform", true),
            ...Object.fromEntries(["registrationCompletedAt", "presenceCheckedAt"].filter(key => Object.hasOwn(rl, key)).map(key => {
                if (!isTimestamp(rl[key], true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
                return [key, rl[key]];
            })),
            ...Object.fromEntries(["publicProfileEnabled", "showOnlineStatus"].filter(key => Object.hasOwn(rl, key)).map(key => [key, requireBool(rl[key])])),
            ...copyOptionalString(rl, "presenceState", true)
        },
        moderation: {
            suspended: moderation.suspended,
            banned: moderation.banned,
            removed: moderation.removed,
            historyCount: moderation.historyCount
        },
        canManage: value.canManage
    };
    return user;
}

function normalizeList(value, diagnostics = null) {
    requireSuccess(value);
    if (!Array.isArray(value.users) || !isTimestamp(value.capturedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    diagnostics?.mark("admin_authorization", RPCS.list);
    const permissions = normalizePermissions(value.permissions);
    if (!permissions.view) fail("USER_MANAGEMENT_FORBIDDEN", 403);
    diagnostics?.mark("response_normalization", RPCS.list);
    return { success: true, permissions, pagination: normalizePagination(value.pagination), users: value.users.map(normalizeSummary), capturedAt: value.capturedAt };
}

function normalizeDetail(value) {
    requireSuccess(value);
    if (!isRecord(value.account) || !Array.isArray(value.roles) || !Array.isArray(value.providers)
        || !isRecord(value.rocketLeague) || !isRecord(value.moderation) || !isRecord(value.permissions)
        || !isTimestamp(value.capturedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const account = value.account;
    if (!UUID.test(account.accountId || "") || typeof account.active !== "boolean" || !isTimestamp(account.createdAt)
        || !isTimestamp(account.lastSeenAt, true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const permissions = {};
    for (const key of DETAIL_PERMISSION_KEYS) permissions[key] = requireBool(value.permissions[key]);
    const rl = value.rocketLeague;
    if (typeof rl.exists !== "boolean" || typeof rl.active !== "boolean") fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const moderation = value.moderation;
    if (typeof moderation.suspended !== "boolean" || typeof moderation.banned !== "boolean"
        || typeof moderation.removed !== "boolean" || !Number.isSafeInteger(moderation.historyCount)
        || !Number.isSafeInteger(moderation.noteCount) || moderation.historyCount < 0 || moderation.noteCount < 0
        || !Object.hasOwn(moderation, "suspension") || !Object.hasOwn(moderation, "ban") || !isTimestamp(value.capturedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    return {
        success: true,
        account: { ...copyOptionalString(account, "displayName", true), active: account.active, createdAt: account.createdAt,
            ...copyOptionalString(account, "lastSeenAt", true), managementRole: normalizeRole(account.managementRole) },
        roles: value.roles.map(row => {
            if (!isRecord(row) || typeof row.role !== "string" || !isTimestamp(row.grantedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
            return { role: row.role, grantedAt: row.grantedAt };
        }),
        providers: value.providers.map(row => {
            if (!isRecord(row) || typeof row.provider !== "string") fail("USER_MANAGEMENT_RESPONSE_INVALID");
            return { provider: row.provider };
        }),
        rocketLeague: normalizeRocketLeagueDetail(rl),
        moderation: normalizeModeration(moderation),
        permissions,
        capturedAt: value.capturedAt
    };
}

function normalizeRocketLeagueDetail(rl) {
    const output = { exists: rl.exists, active: rl.active };
    if (!rl.exists) return output;
    for (const key of ["role", "primaryPlatform", "rlPlatform"]) Object.assign(output, copyOptionalString(rl, key, true));
    for (const key of ["createdAt", "updatedAt", "lastLoggedInAt"]) {
        if (!Object.hasOwn(rl, key)) continue;
        if (!isTimestamp(rl[key], true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output[key] = rl[key];
    }
    if (Object.hasOwn(rl, "registration")) {
        const section = rl.registration;
        if (!isRecord(section)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        const completedAt = section.completedAt;
        if (!isTimestamp(completedAt, true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output.registration = { ...copyOptionalString(section, "status", true),
            ageConsentVerified: nullableBoolean(section.ageConsentVerified),
            policyConsentVerified: nullableBoolean(section.policyConsentVerified), completedAt };
    }
    if (Object.hasOwn(rl, "preferences")) {
        const section = rl.preferences;
        if (!isRecord(section)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output.preferences = { findProfileEnabled: nullableBoolean(section.findProfileEnabled), showOnlineStatus: nullableBoolean(section.showOnlineStatus) };
    }
    if (Object.hasOwn(rl, "presence")) {
        const section = rl.presence;
        if (!isRecord(section) || !isTimestamp(section.checkedAt, true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output.presence = { ...copyOptionalString(section, "state", true), checkedAt: section.checkedAt };
    }
    if (Object.hasOwn(rl, "refresh")) {
        const section = rl.refresh;
        if (!isRecord(section)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output.refresh = {};
        for (const key of ["mmrLastSuccessAt", "careerStatsLastSuccessAt", "discordLastSuccessAt"]) {
            if (!isTimestamp(section[key], true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
            output.refresh[key] = section[key];
        }
    }
    return output;
}

function nullableBoolean(value) {
    if (value !== null && typeof value !== "boolean") fail("USER_MANAGEMENT_RESPONSE_INVALID");
    return value;
}

function normalizeModeration(value) {
    const output = { suspended: value.suspended, banned: value.banned, removed: value.removed,
        historyCount: value.historyCount, noteCount: value.noteCount };
    for (const key of ["suspension", "ban"]) {
        const record = value[key];
        if (record === null) { output[key] = null; continue; }
        if (!isRecord(record)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        const allowed = key === "suspension" ? ["startsAt", "expiresAt", "reason", "userMessage", "createdAt"] : ["startsAt", "reason", "userMessage", "createdAt"];
        for (const name of ["startsAt", "createdAt"]) if (!isTimestamp(record[name])) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        if (key === "suspension" && !isTimestamp(record.expiresAt, true)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        for (const name of ["reason", "userMessage"]) if (Object.hasOwn(record, name) && record[name] !== null && typeof record[name] !== "string") fail("USER_MANAGEMENT_RESPONSE_INVALID");
        output[key] = Object.fromEntries(allowed.filter(name => Object.hasOwn(record, name)).map(name => [name, record[name]]));
    }
    return output;
}

function normalizePagedRows(value, collection, { target = false } = {}) {
    requireSuccess(value);
    if (!Array.isArray(value[collection]) || !isTimestamp(value.capturedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    const pagination = normalizePagination(value.pagination);
    const rows = value[collection].map(row => {
        if (!isRecord(row)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        if (collection === "notes") {
            if (typeof row.note !== "string" || !isTimestamp(row.createdAt) || (row.createdByDisplayName !== null && typeof row.createdByDisplayName !== "string")) fail("USER_MANAGEMENT_RESPONSE_INVALID");
            return { note: row.note, createdByDisplayName: row.createdByDisplayName, createdAt: row.createdAt };
        }
        if (!isTimestamp(row.occurredAt) || typeof row.eventType !== "string"
            || (row.reason !== null && typeof row.reason !== "string")
            || (row.targetDisplayName !== null && typeof row.targetDisplayName !== "string")
            || (row.actorDisplayName !== null && typeof row.actorDisplayName !== "string")) fail("USER_MANAGEMENT_RESPONSE_INVALID");
        const metadata = sanitizeMetadata(row.metadata);
        return { targetDisplayName: row.targetDisplayName ?? null, actorDisplayName: row.actorDisplayName ?? null,
            eventType: String(row.eventType || ""), reason: row.reason ?? null, metadata, occurredAt: row.occurredAt };
    });
    return { success: true, pagination, [collection]: rows, capturedAt: value.capturedAt };
}

function sanitizeMetadata(value, depth = 0) {
    if (depth > 4 || value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeMetadata(item, depth + 1));
    if (!isRecord(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(^id$|account.?id|player.?id|epic.?id|discord.?id|provider.?id|email|phone|subject|token|secret)/iu.test(key))
        .slice(0, 50).map(([key, item]) => [key, sanitizeMetadata(item, depth + 1)]));
}

function classifyFetchException(error) {
    const exceptionName = ["TypeError", "AbortError", "Error", "RangeError"].includes(error?.name)
        ? error.name : null;
    if (exceptionName === "AbortError") return { transportErrorClass: "aborted", exceptionName };
    if (exceptionName === "TypeError") return { transportErrorClass: "fetch_type_error", exceptionName };
    if (exceptionName === "Error") return { transportErrorClass: "network_failure", exceptionName };
    return { transportErrorClass: "unknown_transport", exceptionName };
}

async function callRpc(env, name, parameters, diagnostics = null) {
    if (!ALLOWED_RPCS.has(name)) fail("USER_MANAGEMENT_RPC_NOT_ALLOWED", 500);
    diagnostics?.mark("configuration", name);
    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const key = serviceRoleKey || String(env?.SUPABASE_AUTH || "").trim();
    if (!key) {
        if (!diagnostics) console.warn("User Management RPC unavailable.", { rpc: name, stage: "configuration" });
        fail("USER_MANAGEMENT_UNAVAILABLE", 503);
    }
    let restBase;
    let rpcUrl;
    try {
        restBase = supabaseRestBase(env?.SUPABASE_URL);
        if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
            diagnostics?.transportFailure("request_construction");
            fail();
        }
        rpcUrl = supabaseRestUrl(restBase, `rpc/${name}`).href;
        const parsedRpcUrl = new URL(rpcUrl);
        if (parsedRpcUrl.protocol !== "https:" || parsedRpcUrl.pathname !== `/rest/v1/rpc/${name}`
            || parsedRpcUrl.search || parsedRpcUrl.hash || parsedRpcUrl.username || parsedRpcUrl.password) {
            diagnostics?.transportFailure("invalid_url");
            fail();
        }
    } catch (error) {
        if (error instanceof UserManagementError) throw error;
        diagnostics?.transportFailure("invalid_url");
        fail();
    }
    if (/[\u0000-\u001f\u007f]/u.test(key)) {
        diagnostics?.transportFailure("invalid_header");
        fail();
    }
    try {
        const response = await withUpstreamDeadline(async signal => {
            diagnostics?.mark("rpc_fetch_body", name);
            const bounded = await fetchBoundedResponse(rpcUrl, {
                method: "POST", signal, redirect: "error",
                headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
                body: JSON.stringify(parameters)
            }, 512 * 1024, async (url, init) => {
                let upstream;
                try { upstream = await fetchSupabase(url, init); }
                catch (error) {
                    const transport = classifyFetchException(error);
                    diagnostics?.transportFailure(transport.transportErrorClass, transport.exceptionName);
                    throw error;
                }
                diagnostics?.upstream(upstream.status);
                return upstream;
            });
            diagnostics?.mark("response_decode", name);
            diagnostics?.upstream(bounded.status);
            const text = await bounded.text();
            let body = null;
            if (text) { try { body = JSON.parse(text); } catch { fail("USER_MANAGEMENT_RESPONSE_INVALID", 503); } }
            if (!bounded.ok) {
                if (!diagnostics) console.warn("User Management RPC unavailable.", { rpc: name, stage: "upstream", status: bounded.status,
                    code: ["PGRST202", "PGRST301", "42501", "42883"].includes(body?.code) ? body.code : "UPSTREAM_REJECTED" });
                diagnostics?.mark("rpc_rejected", name);
                diagnostics?.upstream(bounded.status, body?.code);
                const candidates = [body?.message, body?.details, body?.code];
                const code = [...ERROR_CODES].find(candidate => candidates.some(item => typeof item === "string"
                    && new RegExp(`(?:^|[^A-Z0-9_])${candidate}(?:$|[^A-Z0-9_])`, "u").test(item)));
                if (code) fail(code, statusForError(code));
                fail("USER_MANAGEMENT_UNAVAILABLE", 503);
            }
            return body;
        });
        return response;
    } catch (error) {
        if (error instanceof UserManagementError) throw error;
        diagnostics?.upstream(undefined, error?.code);
        fail(error?.code === "UPSTREAM_TIMEOUT" ? "USER_MANAGEMENT_TIMEOUT" : "USER_MANAGEMENT_UNAVAILABLE", 503);
    }
}

function statusForError(code) {
    if (["USER_MANAGEMENT_FORBIDDEN", "TARGET_ACCOUNT_PROTECTED", "SELF_ROLE_CHANGE_FORBIDDEN", "OWNER_ROLE_PROTECTED", "ADMIN_ROLE_REQUIRES_OWNER"].includes(code)) return 403;
    if (["TARGET_ACCOUNT_REQUIRED", "ACCOUNT_NOT_FOUND", "ROCKET_LEAGUE_ACCOUNT_NOT_FOUND"].includes(code)) return code === "TARGET_ACCOUNT_REQUIRED" ? 400 : 404;
    if (code === "NO_ACTIVE_BAN") return 409;
    if (["ACCOUNT_ALREADY_BANNED", "ACCOUNT_ALREADY_SUSPENDED", "ACCOUNT_ALREADY_REMOVED", "NO_ACTIVE_SUSPENSION", "ROCKET_LEAGUE_ACCOUNT_ALREADY_ACTIVE", "ROCKET_LEAGUE_ACCOUNT_ALREADY_DISABLED", "ROLE_ALREADY_SET", "ACCOUNT_REMOVED"].includes(code)) return 409;
    if (["INVALID_STATUS_FILTER", "INVALID_SORT"].includes(code)) return 400;
    return 400;
}

async function getActor(request, env, diagnostics = null) {
    const authorization = await authorizeRequest(request, env, { account: true, action: "view_account", diagnostics });
    const actorAccountId = authorization?.accountId;
    if (typeof actorAccountId !== "string" || !UUID.test(actorAccountId)) fail("AUTHENTICATION_REQUIRED", 401);
    return actorAccountId;
}

function targetId(value) { if (typeof value !== "string" || !UUID.test(value)) fail("TARGET_ACCOUNT_REQUIRED", 400); return value; }

export async function listUsers(request, env, input, diagnostics = null) {
    const actor = await getActor(request, env, diagnostics);
    const result = await callRpc(env, RPCS.list, { p_actor_account_id: actor, p_query: input.query, p_status: input.status,
        p_role: input.role, p_provider: input.provider, p_has_rocket_league: input.hasRocketLeague,
        p_rl_active: input.rlActive, p_limit: 30, p_offset: input.offset, p_sort: input.sort }, diagnostics);
    diagnostics?.mark("response_normalization", RPCS.list);
    return normalizeList(result, diagnostics);
}

export async function getUserDetails(request, env, target) {
    const actor = await getActor(request, env);
    return normalizeDetail(await callRpc(env, RPCS.details, { p_actor_account_id: actor, p_target_account_id: targetId(target) }));
}

export async function getUserHistory(request, env, { target = null, eventType = null, limit = 30, offset = 0 } = {}) {
    const actor = await getActor(request, env);
    return normalizePagedRows(await callRpc(env, RPCS.history, { p_actor_account_id: actor, p_target_account_id: target ? targetId(target) : null,
        p_event_type: eventType, p_limit: limit, p_offset: offset }), "events", { target: Boolean(target) });
}

export async function getUserNotes(request, env, target, { limit = 30, offset = 0 } = {}) {
    const actor = await getActor(request, env);
    return normalizePagedRows(await callRpc(env, RPCS.notes, { p_actor_account_id: actor, p_target_account_id: targetId(target), p_limit: limit, p_offset: offset }), "notes");
}

export async function mutateUser(request, env, target, action, input) {
    const actor = await getActor(request, env), account = targetId(target);
    const args = { p_actor_account_id: actor, p_target_account_id: account };
    let rpc;
    switch (action) {
        case "add-note": rpc = RPCS.addNote; args.p_note = input.note; break;
        case "suspend": rpc = RPCS.suspend; Object.assign(args, { p_duration_days: input.durationDays, p_reason: input.reason, p_internal_note: input.internalNote ?? null, p_user_message: input.userMessage ?? null }); break;
        case "lift-suspension": rpc = RPCS.liftSuspension; Object.assign(args, { p_reason: input.reason }); break;
        case "set-rl-active": rpc = RPCS.setRlActive; Object.assign(args, { p_active: input.active, p_reason: input.reason }); break;
        case "ban": rpc = RPCS.ban; Object.assign(args, { p_reason: input.reason, p_internal_note: input.internalNote ?? null, p_user_message: input.userMessage ?? null }); break;
        case "reinstate": rpc = RPCS.reinstate; Object.assign(args, { p_reason: input.reason }); break;
        case "remove": rpc = RPCS.remove; Object.assign(args, { p_reason: input.reason, p_internal_note: input.internalNote ?? null, p_user_message: input.userMessage ?? null }); break;
        case "set-role": rpc = RPCS.setRole; Object.assign(args, { p_role: input.role ?? null, p_reason: input.reason }); break;
        default: fail("USER_MANAGEMENT_ACTION_INVALID", 400);
    }
    const result = requireSuccess(await callRpc(env, rpc, args));
    const validResult = {
        "add-note": () => isRecord(result.note) && typeof result.note.note === "string",
        suspend: () => isRecord(result.account) && result.account.status === "suspended" && isRecord(result.suspension),
        "lift-suspension": () => isRecord(result.account) && result.account.status === "active" && isRecord(result.suspension) && result.suspension.lifted === true,
        "set-rl-active": () => isRecord(result.rocketLeague) && typeof result.rocketLeague.active === "boolean",
        ban: () => isRecord(result.account) && result.account.status === "banned" && isRecord(result.ban),
        reinstate: () => isRecord(result.ban) && result.ban.reinstated === true,
        remove: () => isRecord(result.account) && result.account.status === "removed" && isRecord(result.removal),
        "set-role": () => isRecord(result.role) && Object.hasOwn(result.role, "current")
    }[action];
    if (!validResult?.() || !isTimestamp(result.capturedAt)) fail("USER_MANAGEMENT_RESPONSE_INVALID");
    return { success: true, action, capturedAt: result.capturedAt };
}

export async function parseListInput(url) {
    const params = new URL(url).searchParams;
    const allowed = new Set(["query", "status", "role", "provider", "hasRocketLeague", "rlActive", "sort", "page"]);
    for (const key of params.keys()) if (!allowed.has(key)) fail("USER_MANAGEMENT_QUERY_INVALID", 400);
    const query = params.get("query") || "";
    const status = params.get("status") || "all";
    const role = params.get("role") || null;
    const provider = params.get("provider") || null;
    const sort = params.get("sort") || "created_desc";
    const pageValue = params.get("page") || "1";
    if (query.length > 100 || !["all", ...STATUSES].includes(status) || (role && !ROLES.has(role))
        || (provider && !PROVIDERS.has(provider)) || !["created_desc", "created_asc", "name_asc", "name_desc", "last_seen_desc"].includes(sort)
        || !/^\d{1,7}$/u.test(pageValue)) fail("USER_MANAGEMENT_QUERY_INVALID", 400);
    const page = Number(pageValue);
    if (!Number.isSafeInteger(page) || page < 1 || page > 33334) fail("USER_MANAGEMENT_QUERY_INVALID", 400);
    const boolean = key => {
        const value = params.get(key);
        if (value === null || value === "") return null;
        if (value === "true") return true;
        if (value === "false") return false;
        fail("USER_MANAGEMENT_QUERY_INVALID", 400);
    };
    return { query, status, role, provider, hasRocketLeague: boolean("hasRocketLeague"), rlActive: boolean("rlActive"), sort, page, offset: (page - 1) * 30 };
}

export function parseMutationInput(body) {
    if (!isRecord(body) || typeof body.action !== "string") fail("USER_MANAGEMENT_INPUT_INVALID", 400);
    const action = body.action;
    const allowedFields = {
        "add-note": ["action", "note"], suspend: ["action", "durationDays", "reason", "internalNote", "userMessage"],
        "lift-suspension": ["action", "reason"], "set-rl-active": ["action", "active", "reason"],
        ban: ["action", "reason", "internalNote", "userMessage"], reinstate: ["action", "reason"], remove: ["action", "reason", "internalNote", "userMessage"],
        "set-role": ["action", "role", "reason"]
    }[action];
    if (!allowedFields || Object.keys(body).some(key => !allowedFields.includes(key))) fail("USER_MANAGEMENT_INPUT_INVALID", 400);
    const text = (key, max, required = false) => {
        const value = body[key];
        if (value === undefined && !required) return null;
        if (typeof value !== "string" || (required && !value.trim()) || value.length > max) fail("USER_MANAGEMENT_INPUT_INVALID", 400);
        return value.trim();
    };
    const reason = () => text("reason", 1000, true);
    if (action === "add-note") return { action, note: text("note", 4000, true) };
    if (action === "suspend") {
        const durationDays = body.durationDays;
        if (![3, 7, 14, 21, 30, 60, 90, 180, 360].includes(durationDays)) fail("USER_MANAGEMENT_INPUT_INVALID", 400);
        const internalNote = text("internalNote", 4000), userMessage = text("userMessage", 2000);
        return { action, durationDays, reason: reason(), internalNote, userMessage };
    }
    if (action === "set-rl-active") {
        if (typeof body.active !== "boolean") fail("USER_MANAGEMENT_INPUT_INVALID", 400);
        return { action, active: body.active, reason: reason() };
    }
    if (action === "set-role") {
        if (body.role !== null && body.role !== undefined && body.role !== "" && !["staff", "moderator", "admin"].includes(body.role)) fail("USER_MANAGEMENT_INPUT_INVALID", 400);
        return { action, role: body.role || null, reason: reason() };
    }
    if (action === "ban" || action === "remove") return { action, reason: reason(), internalNote: text("internalNote", 4000), userMessage: text("userMessage", 2000) };
    if (action === "lift-suspension" || action === "reinstate") return { action, reason: reason() };
    fail("USER_MANAGEMENT_INPUT_INVALID", 400);
}

export function mapUserManagementError(error) {
    if (error instanceof UserManagementError) return { status: error.status, code: error.code };
    if (error?.code === "USER_MANAGEMENT_INPUT_INVALID" || error?.code === "USER_MANAGEMENT_QUERY_INVALID") {
        return { status: Number.isInteger(error.status) ? error.status : 400, code: error.code };
    }
    const status = Number(error?.status);
    if (status === 401 || status === 403) return { status, code: status === 401 ? "AUTHENTICATION_REQUIRED" : "USER_MANAGEMENT_FORBIDDEN" };
    return { status: 503, code: "USER_MANAGEMENT_UNAVAILABLE" };
}
