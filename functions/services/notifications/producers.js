"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../http/upstream.js";
import { fetchSupabase, supabaseRestBase, supabaseRestUrl } from "../supabase/rest.js";
import { getProviderAuthorizationState } from "../auth/providers/provider_auth_state.js";
import { verifyAccountProviderIdentity } from "../auth/providers/provider_identity.js";
import { getRocketLeagueProfileByAccountId } from "../supabase/rocketleague/rocketleague_profile.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const ENFORCEMENT_TYPES = new Set(["suspension", "ban", "removal"]);

function fail(code = "NOTIFICATIONS_UNAVAILABLE") {
    throw Object.assign(new Error(code), { code, status: 503 });
}

function supabaseConfig(env) {
    const key = (typeof env?.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "")
        || (typeof env?.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "");
    if (!key) fail();
    try { return { base: supabaseRestBase(env?.SUPABASE_URL), key }; }
    catch { fail(); }
}

async function getActiveEnforcement(env, accountId, fetcher = fetch) {
    const { base, key } = supabaseConfig(env);
    return withUpstreamDeadline(async signal => {
        let response;
        try {
            response = await fetchBoundedResponse(supabaseRestUrl(base, "rpc/get_account_enforcement_state"), {
                method: "POST", signal, redirect: "error",
                headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
                    Accept: "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
                body: JSON.stringify({ p_account_id: accountId })
            }, 64 * 1024, (input, init) => fetchSupabase(input, init, fetcher));
        } catch { fail(); }
        let body;
        try { body = await response.json(); } catch { fail(); }
        if (!response.ok) fail();
        if (!body || typeof body !== "object" || Array.isArray(body) || body.success !== true
            || typeof body.active !== "boolean" || !Object.hasOwn(body, "enforcement") || !validTimestamp(body.capturedAt)) {
            fail("NOTIFICATIONS_DATA_INVALID");
        }
        if (body.active === false && body.enforcement === null) return null;
        if (body.active !== true || !body.enforcement || typeof body.enforcement !== "object" || Array.isArray(body.enforcement)) {
            fail("NOTIFICATIONS_DATA_INVALID");
        }
        return normalizeEnforcement(body.enforcement);
    });
}

function normalizeEnforcement(row) {
    const { publicCode, type, startsAt, expiresAt, userMessage, createdAt } = row;
    if (!UUID.test(publicCode || "") || typeof type !== "string" || !ENFORCEMENT_TYPES.has(type)
        || !validTimestamp(startsAt) || (expiresAt !== null && !validTimestamp(expiresAt)) || !validTimestamp(createdAt)
        || (userMessage !== null && typeof userMessage !== "string")) fail("NOTIFICATIONS_DATA_INVALID");
    const message = typeof userMessage === "string" ? userMessage.trim().slice(0, 280) : "";
    return { publicCode: publicCode.toLowerCase(), type: type.toLowerCase(), startsAt: new Date(startsAt).toISOString(),
        expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
        createdAt: new Date(createdAt).toISOString(),
        userMessage: message && !EMAIL.test(message) && !UUID_IN_TEXT.test(message) ? message : null };
}

function validTimestamp(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

async function sourceKey(publicCode) {
    const bytes = new TextEncoder().encode(publicCode);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].slice(0, 12).map(value => value.toString(16).padStart(2, "0")).join("");
    return `account:moderation:${hex}`;
}

function generatedPublicCode() {
    return crypto.randomUUID();
}

function moderationTitle(type) {
    if (type === "suspension") return "Account suspended";
    if (type === "ban") return "Account banned";
    return "Account removed";
}

function moderationMessage(enforcement) {
    return enforcement.userMessage || (enforcement.expiresAt
        ? `An account restriction is active until ${enforcement.expiresAt}.`
        : "An account restriction is active.");
}

export async function collectConditionNotifications(env, accountId, now = new Date(), fetcher = fetch) {
    if (!UUID.test(accountId || "")) fail("ACCOUNT_IDENTITY_MISSING");
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(nowMs)) fail("NOTIFICATIONS_UNAVAILABLE");

    const [enforcement, profile, epicIdentity] = await Promise.all([
        getActiveEnforcement(env, accountId, fetcher),
        getRocketLeagueProfileByAccountId(env, accountId),
        verifyAccountProviderIdentity(env, accountId, "epic")
    ]);

    const notifications = [];
    const currentEnforcement = enforcement && Date.parse(enforcement.startsAt) <= nowMs
        && (!enforcement.expiresAt || Date.parse(enforcement.expiresAt) > nowMs) ? enforcement : null;
    if (currentEnforcement) {
        notifications.push({
            publicCode: generatedPublicCode(), source: "account", behavior: "condition",
            dedupeKey: await sourceKey(currentEnforcement.publicCode), severity: "warning",
            title: moderationTitle(currentEnforcement.type), message: moderationMessage(currentEnforcement),
            actionRequired: true, reviewAction: "account.status", createdAt: currentEnforcement.createdAt,
            updatedAt: currentEnforcement.createdAt, expiresAt: currentEnforcement.expiresAt, resolvedAt: null
        });
    }

    if (!profile || (profile.registrationStatus ?? profile.registration_status) !== "complete") {
        notifications.push({
            publicCode: generatedPublicCode(), source: "profile", behavior: "condition",
            dedupeKey: "profile:incomplete", severity: "notice", title: "Complete your Rocket League profile",
            message: "Finish the required Rocket League registration and consent steps to enable player features.",
            actionRequired: true, reviewAction: "profile.complete", createdAt: new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(), expiresAt: null, resolvedAt: null
        });
    }

    if (epicIdentity) {
        const freshness = await getProviderAuthorizationState(env, accountId, "epic");
        if (freshness?.authorized !== true) {
            notifications.push({
                publicCode: generatedPublicCode(), source: "account", behavior: "condition",
                dedupeKey: "account:epic-reauthorize", severity: "warning", title: "Verify your Epic account",
                message: "Your Epic account is still linked. Reauthorize it to continue using Rocket League features.",
                actionRequired: true, reviewAction: "provider.reauthorize", createdAt: new Date(nowMs).toISOString(),
                updatedAt: new Date(nowMs).toISOString(), expiresAt: null, resolvedAt: null
            });
        }
    }
    return notifications;
}

export function mapOcrEventsToNotifications(events, now = new Date()) {
    if (!Array.isArray(events)) return [];
    const instant = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(instant)) fail("NOTIFICATIONS_UNAVAILABLE");
    return events.flatMap(event => {
        if (!event || event.source !== "ocr" || !validTimestamp(event.occurredAt)) return [];
        if (event.resolvedAt && Date.parse(event.resolvedAt) <= instant) return [];
        if (event.expiresAt && Date.parse(event.expiresAt) <= instant) return [];
        const common = {
            publicCode: crypto.randomUUID(), source: "ocr", behavior: "event", dedupeKey: event.dedupeKey,
            reviewAction: "ocr.review", createdAt: event.occurredAt, updatedAt: event.resolvedAt,
            resolvedAt: event.resolvedAt, expiresAt: event.expiresAt, reviewCode: event.sourcePublicCode
        };
        if (event.eventType === "review_required" && event.sourcePublicCode) return [{
            ...common, severity: "warning", title: "Scoreboard review required",
            message: "Review and confirm the scoreboard details to finish this match submission.",
            actionRequired: true
        }];
        if (event.eventType === "failed") return [{
            ...common, severity: "notice", title: "Scoreboard scan failed",
            message: "Your scoreboard could not be processed. Review the submission and try again.",
            actionRequired: false
        }];
        if (event.eventType === "completed") return [{
            ...common, severity: "info", title: "Scoreboard scan completed",
            message: "Your scoreboard was processed successfully.", actionRequired: false
        }];
        return [];
    });
}

