"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../http/upstream.js";
import { dedupeNotificationCandidates } from "./core.js";

const TABLE = "notification_state";
const EVENT_TABLE = "notification_events";
const MAX_RESPONSE_BYTES = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEDUPE_KEY = /^[a-z0-9][a-z0-9:._-]{0,159}$/;
const COLUMNS = "public_code,account_id,dedupe_key,acknowledged_at,suppress_until,first_seen_at,last_seen_at,updated_at";
const EVENT_COLUMNS = "account_id,source,event_type,dedupe_key,source_public_code,occurred_at,resolved_at,expires_at";
const OCR_EVENT_TYPES = new Set(["review_required", "failed", "completed"]);
const OCR_JOB_ID = /^[A-Z0-9]{16}$/;
const OCR_PUBLIC_CODE = /^[A-Z0-9]{16}$/;
const UPSTREAM_CODES = new Set(["42501", "42P01", "42703", "23505", "PGRST116", "PGRST204", "PGRST301",
    "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_RESPONSE_TOO_LARGE", "UPSTREAM_RESPONSE_INVALID"]);

export class NotificationPersistenceError extends Error {
    constructor(code = "NOTIFICATIONS_UNAVAILABLE", status = 503) {
        super(code);
        this.name = "NotificationPersistenceError";
        this.code = code;
        this.status = status;
    }
}

function fail(code = "NOTIFICATIONS_UNAVAILABLE", status = 503) {
    throw new NotificationPersistenceError(code, status);
}

function configuration(env) {
    const base = typeof env?.SUPABASE_URL === "string"
        ? env.SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "")
        : "";
    const key = (typeof env?.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "")
        || (typeof env?.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "");
    if (!base || !key) fail();
    try {
        const parsed = new URL(base);
        if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash) fail();
    } catch { fail(); }
    return { base, key };
}

function validateIdentity(accountId, dedupeKey = null, publicCode = null) {
    if (typeof accountId !== "string" || !UUID.test(accountId)) fail();
    if (dedupeKey !== null && (typeof dedupeKey !== "string" || !DEDUPE_KEY.test(dedupeKey))) fail();
    if (publicCode !== null && (typeof publicCode !== "string" || !UUID.test(publicCode))) fail("NOTIFICATION_NOT_FOUND", 404);
}

function normalizeState(value, accountId, dedupeKey = null) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || !UUID.test(value.public_code || "") || typeof value.account_id !== "string" || value.account_id.toLowerCase() !== accountId.toLowerCase()
        || typeof value.dedupe_key !== "string" || !DEDUPE_KEY.test(value.dedupe_key)
        || (dedupeKey !== null && value.dedupe_key !== dedupeKey)
        || !validTimestamp(value.first_seen_at) || !validTimestamp(value.last_seen_at) || !validTimestamp(value.updated_at)
        || !nullableTimestamp(value.acknowledged_at) || !nullableTimestamp(value.suppress_until)) fail("NOTIFICATIONS_DATA_INVALID");
    return Object.freeze({
        publicCode: value.public_code.toLowerCase(),
        accountId: value.account_id.toLowerCase(),
        dedupeKey: value.dedupe_key,
        acknowledgedAt: value.acknowledged_at,
        suppressUntil: value.suppress_until,
        firstSeenAt: value.first_seen_at,
        lastSeenAt: value.last_seen_at,
        updatedAt: value.updated_at
    });
}

function validTimestamp(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nullableTimestamp(value) { return value === null || validTimestamp(value); }

function requestUrl(base, parameters = {}, table = TABLE, columns = COLUMNS) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.searchParams.set("select", columns);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url.toString();
}

function classifyFetchException(error) {
    const exceptionName = ["TypeError", "AbortError", "DOMException"].includes(error?.name) ? error.name : null;
    if (exceptionName === "AbortError" || exceptionName === "DOMException") return { transportClass: "abort", exceptionName };
    if (exceptionName === "TypeError") return { transportClass: "fetch_type_error", exceptionName };
    if (exceptionName === "Error") return { transportClass: "network_failure", exceptionName: null };
    return { transportClass: "unknown_transport", exceptionName: null };
}

async function callTable(env, url, { method = "GET", body, prefer = null, signal, fetcher = fetch, diagnostics = null, stage }) {
    const { base, key } = configuration(env);
    diagnostics?.mark(stage);
    let response;
    try {
        response = await fetchBoundedResponse(url || requestUrl(base), {
            method,
            redirect: "error",
            signal,
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                "Accept-Profile": "core",
                "Content-Profile": "core",
                ...(prefer ? { Prefer: prefer } : {})
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }, MAX_RESPONSE_BYTES, async (input, init) => {
            let upstream;
            try { upstream = await fetcher(input, init); }
            catch (error) {
                const transport = classifyFetchException(error);
                diagnostics?.transportFailure(transport.transportClass, transport.exceptionName);
                throw error;
            }
            diagnostics?.upstream(upstream.status);
            return upstream;
        });
    } catch (error) {
        if (error instanceof NotificationPersistenceError) throw error;
        const code = UPSTREAM_CODES.has(error?.code) ? error.code : "UPSTREAM_UNAVAILABLE";
        diagnostics?.upstream(undefined, code);
        if (code === "UPSTREAM_TIMEOUT") diagnostics?.markTimeout?.();
        fail();
    }
    diagnostics?.mark(`${stage}_decode`);
    let payload = null;
    if (response.status !== 204 && response.status !== 205) {
        const text = await response.text();
        if (text) {
            try { payload = JSON.parse(text); }
            catch { fail("NOTIFICATIONS_DATA_INVALID"); }
        }
    }
    if (!response.ok) {
        const code = UPSTREAM_CODES.has(payload?.code) ? payload.code : "UPSTREAM_REJECTED";
        diagnostics?.upstream(response.status, code);
        fail();
    }
    return payload;
}

async function bounded(env, diagnostics, callback) {
    diagnostics?.mark("configuration");
    configuration(env);
    try {
        return await withUpstreamDeadline(async signal => callback(signal), 10_000);
    } catch (error) {
        if (error instanceof NotificationPersistenceError) throw error;
        if (error?.code === "UPSTREAM_TIMEOUT") {
            diagnostics?.markTimeout?.();
            diagnostics?.upstream(undefined, "UPSTREAM_TIMEOUT");
        }
        fail();
    }
}

export async function getNotificationState(env, accountId, dedupeKey, fetcher = fetch, diagnostics = null) {
    validateIdentity(accountId, dedupeKey);
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, { account_id: `eq.${accountId}`, dedupe_key: `eq.${dedupeKey}`, limit: "2" });
        const rows = await callTable(env, url, { signal, fetcher, diagnostics, stage: "state_lookup" });
        if (!Array.isArray(rows) || rows.length > 1) fail("NOTIFICATIONS_DATA_INVALID");
        return rows.length ? normalizeState(rows[0], accountId, dedupeKey) : null;
    });
}

export async function reconcileNotificationState(env, accountId, dedupeKey, fetcher = fetch, diagnostics = null, now = new Date()) {
    validateIdentity(accountId, dedupeKey);
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    return bounded(env, diagnostics, async signal => {
        const base = configuration(env).base;
        const insertUrl = requestUrl(base, { on_conflict: "account_id,dedupe_key" });
        const inserted = await callTable(env, insertUrl, {
            method: "POST", body: { account_id: accountId, dedupe_key: dedupeKey },
            prefer: "resolution=ignore-duplicates,return=representation", signal, fetcher, diagnostics, stage: "state_reconcile"
        });
        if (!Array.isArray(inserted) || inserted.length > 1) fail("NOTIFICATIONS_DATA_INVALID");

        let state = inserted.length ? normalizeState(inserted[0], accountId, dedupeKey) : null;
        if (!state) {
            const lookupUrl = requestUrl(base, { account_id: `eq.${accountId}`, dedupe_key: `eq.${dedupeKey}`, limit: "2" });
            const rows = await callTable(env, lookupUrl, { signal, fetcher, diagnostics, stage: "state_lookup" });
            if (!Array.isArray(rows) || rows.length !== 1) fail("NOTIFICATIONS_DATA_INVALID");
            state = normalizeState(rows[0], accountId, dedupeKey);
        }

        const updateUrl = requestUrl(base, { account_id: `eq.${accountId}`, dedupe_key: `eq.${dedupeKey}` });
        const updated = await callTable(env, updateUrl, {
            method: "PATCH", body: { last_seen_at: timestamp }, prefer: "return=representation",
            signal, fetcher, diagnostics, stage: "state_last_seen"
        });
        if (!Array.isArray(updated) || updated.length !== 1) fail("NOTIFICATIONS_DATA_INVALID");
        return normalizeState(updated[0], accountId, dedupeKey);
    });
}

export async function acknowledgeNotificationState(env, accountId, publicCode, fetcher = fetch, diagnostics = null, now = new Date()) {
    validateIdentity(accountId, null, publicCode);
    const instant = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(instant)) fail();
    const acknowledgedAt = new Date(instant).toISOString();
    const suppressUntil = new Date(instant + 60 * 60 * 1000).toISOString();
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, { account_id: `eq.${accountId}`, public_code: `eq.${publicCode}` });
        const rows = await callTable(env, url, {
            method: "PATCH", body: { acknowledged_at: acknowledgedAt, suppress_until: suppressUntil, updated_at: acknowledgedAt },
            prefer: "return=representation", signal, fetcher, diagnostics, stage: "state_acknowledge"
        });
        if (!Array.isArray(rows)) fail("NOTIFICATIONS_DATA_INVALID");
        if (rows.length === 0) return null;
        if (rows.length !== 1) fail("NOTIFICATIONS_DATA_INVALID");
        return normalizeState(rows[0], accountId);
    });
}

export async function listNotificationStates(env, accountId, fetcher = fetch, diagnostics = null) {
    validateIdentity(accountId);
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, { account_id: `eq.${accountId}`, order: "last_seen_at.desc", limit: "100" });
        const rows = await callTable(env, url, { signal, fetcher, diagnostics, stage: "state_list" });
        if (!Array.isArray(rows) || rows.length > 100) fail("NOTIFICATIONS_DATA_INVALID");
        return rows.map(row => normalizeState(row, accountId));
    });
}

function normalizeOcrEvent(row, accountId) {
    if (!row || typeof row !== "object" || Array.isArray(row)
        || String(row.account_id || "").toLowerCase() !== accountId.toLowerCase()
        || row.source !== "ocr" || !OCR_EVENT_TYPES.has(row.event_type)
        || typeof row.dedupe_key !== "string" || !DEDUPE_KEY.test(row.dedupe_key)
        || !row.dedupe_key.startsWith(`ocr:${row.event_type}:`)
        || (row.source_public_code !== null && !OCR_PUBLIC_CODE.test(row.source_public_code || ""))
        || !validTimestamp(row.occurred_at) || !nullableTimestamp(row.resolved_at) || !nullableTimestamp(row.expires_at)) {
        fail("NOTIFICATIONS_DATA_INVALID");
    }
    return Object.freeze({
        source: "ocr",
        eventType: row.event_type,
        dedupeKey: row.dedupe_key,
        sourcePublicCode: row.source_public_code,
        occurredAt: new Date(row.occurred_at).toISOString(),
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null
    });
}

async function createOcrDedupeKey(jobId, eventType, secret) {
    if (!OCR_JOB_ID.test(jobId || "") || !OCR_EVENT_TYPES.has(eventType) || typeof secret !== "string" || !secret.trim()) fail();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.trim()),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ocr-event-v1\0${eventType}\0${jobId}`));
    const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    return `ocr:${eventType}:${hex}`;
}

export async function emitOcrNotificationEvent(env, { accountId, jobId, eventType, sourcePublicCode = null, occurredAt = new Date() }, fetcher = fetch, diagnostics = null) {
    validateIdentity(accountId);
    if (!OCR_EVENT_TYPES.has(eventType) || (sourcePublicCode !== null && !OCR_PUBLIC_CODE.test(sourcePublicCode || ""))) fail("NOTIFICATIONS_DATA_INVALID");
    if (eventType === "review_required" && sourcePublicCode === null) fail("NOTIFICATIONS_DATA_INVALID");
    const timestamp = occurredAt instanceof Date ? occurredAt.toISOString() : new Date(occurredAt).toISOString();
    if (!validTimestamp(timestamp)) fail("NOTIFICATIONS_DATA_INVALID");
    const dedupeKey = await createOcrDedupeKey(jobId, eventType, env?.OCR_OWNER_SECRET);
    const expiresAt = eventType === "review_required" ? null : new Date(Date.parse(timestamp) + 30 * 24 * 60 * 60 * 1000).toISOString();
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, { on_conflict: "account_id,source,event_type,dedupe_key" }, EVENT_TABLE, EVENT_COLUMNS);
        const rows = await callTable(env, url, {
            method: "POST",
            body: { account_id: accountId, source: "ocr", event_type: eventType, dedupe_key: dedupeKey,
                source_public_code: sourcePublicCode, occurred_at: timestamp, resolved_at: null, expires_at: expiresAt },
            prefer: "resolution=ignore-duplicates,return=representation", signal, fetcher, diagnostics, stage: "event_insert"
        });
        if (!Array.isArray(rows) || rows.length > 1) fail("NOTIFICATIONS_DATA_INVALID");
        if (rows.length === 1) return normalizeOcrEvent(rows[0], accountId);
        const lookup = requestUrl(configuration(env).base, { account_id: `eq.${accountId}`, source: "eq.ocr", event_type: `eq.${eventType}`,
            dedupe_key: `eq.${dedupeKey}`, limit: "2" }, EVENT_TABLE, EVENT_COLUMNS);
        const existing = await callTable(env, lookup, { signal, fetcher, diagnostics, stage: "event_lookup" });
        if (!Array.isArray(existing) || existing.length !== 1) fail("NOTIFICATIONS_DATA_INVALID");
        return normalizeOcrEvent(existing[0], accountId);
    });
}

export async function listOcrNotificationEvents(env, accountId, fetcher = fetch, diagnostics = null) {
    validateIdentity(accountId);
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, {
            account_id: `eq.${accountId}`, source: "eq.ocr", order: "occurred_at.desc", limit: "100"
        }, EVENT_TABLE, EVENT_COLUMNS);
        const rows = await callTable(env, url, { signal, fetcher, diagnostics, stage: "event_list" });
        if (!Array.isArray(rows) || rows.length > 100) fail("NOTIFICATIONS_DATA_INVALID");
        return rows.map(row => normalizeOcrEvent(row, accountId));
    });
}

export async function resolveOcrReviewEvent(env, { accountId, jobId, occurredAt = new Date() }, fetcher = fetch, diagnostics = null) {
    validateIdentity(accountId);
    const dedupeKey = await createOcrDedupeKey(jobId, "review_required", env?.OCR_OWNER_SECRET);
    const timestamp = occurredAt instanceof Date ? occurredAt.toISOString() : new Date(occurredAt).toISOString();
    if (!validTimestamp(timestamp)) fail("NOTIFICATIONS_DATA_INVALID");
    return bounded(env, diagnostics, async signal => {
        const url = requestUrl(configuration(env).base, { account_id: `eq.${accountId}`, source: "eq.ocr",
            event_type: "eq.review_required", dedupe_key: `eq.${dedupeKey}` }, EVENT_TABLE, EVENT_COLUMNS);
        const rows = await callTable(env, url, { method: "PATCH", body: { resolved_at: timestamp }, prefer: "return=representation",
            signal, fetcher, diagnostics, stage: "event_resolve" });
        if (!Array.isArray(rows) || rows.length > 1) fail("NOTIFICATIONS_DATA_INVALID");
        return rows.length ? normalizeOcrEvent(rows[0], accountId) : null;
    });
}

export function notificationIsVisible(candidate, state, now = new Date()) {
    if (!candidate || !state || candidate.dedupeKey !== state.dedupeKey) return false;
    const merged = { ...candidate, publicCode: state.publicCode, acknowledgedAt: state.acknowledgedAt, suppressUntil: state.suppressUntil };
    return dedupeNotificationCandidates([merged], now).length === 1;
}
