"use strict";

import { isValidProviderRuntimeCallerSecret, withAbortTimeout } from "../auth/providers/discord_matchbot/runtime_contract.js";
import { withUpstreamDeadline, fetchBoundedResponse } from "../http/upstream.js";
import { getFeaturedRocketLeaguePlayer, getRocketLeagueHomepageCounters } from "../supabase/rocketleague/discovery.js";
import { signedCommunicationRequest } from "./discord_communications.js";

const CACHE_KEY = "admin:system-status:v4";
const CACHE_TTL_SECONDS = 45;
const HEALTH_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 2000;
const ACTION_TIMEOUT_MS = 15000;
const CLOUD_RUN_ACTION_TIMEOUT_MS = 30000;
const INTERNAL_HOSTNAME = "ocr-google-transport.internal";
let inFlightCheck = null;
const actionLocks = new Set();
const botCooldowns = new WeakMap();
const BOT_NAMES = { "discord-matchbot": "Discord MatchBot", "discord-authz-bot": "Discord role-authorization bot" };
const ACTION_COOLDOWNS = { "mmr-api:reconnect-psynet": 30, "mmr-api:refresh-eos": 15, "mmr-api:repair-session": 15, "cloud-run-ocr:recheck": 60, "rl-presence:run-now": 60, "rl-presence:refresh-shop": 60, "provider-runtime:recheck": 15 };
const ACTIONS = {
    pages: ["recheck"], "rl-presence": ["recheck", "run-now", "refresh-shop"], "ocr-transport": ["recheck"],
    "ocr-queue": ["recheck"], "cloud-run-ocr": ["recheck"], "provider-runtime": ["recheck"], supabase: ["recheck", "test-rl-counters"],
    "discord-matchbot": ["recheck"], "discord-authz-bot": ["recheck"],
    "custom-match-runtime": ["recheck"], "discord-communications": ["recheck"],
    "mmr-api": ["recheck", "refresh-eos", "reauthorize-account", "poll-authorization", "reconnect-psynet", "repair-session", "functional-test"]
};
const SERVICE_STATUS_PREFIX = "admin:service-status:";
const SERVICE_GROUPS = {
    pages: "Application", supabase: "Data", "provider-runtime": "Provider Services", "mmr-api": "Rocket League", "rl-presence": "Rocket League",
    "custom-match-runtime": "Custom Matches", "custom-match-session": "Custom Matches",
    "ocr-transport": "OCR", "ocr-queue": "OCR", "cloud-run-ocr": "OCR",
    "discord-communications": "Discord", "discord-matchbot": "Discord", "discord-authz-bot": "Discord", "google-mtls-diagnostic": "Diagnostics"
};
const HEALTH_CODES = new Set(["PSYNET_AUTH_FAILED", "EOS_AUTH_FAILED", "MMR_CONFIGURATION_MISSING", "MMR_UNAVAILABLE", "RL_VERSION_MISMATCH",
    "RL_VERSION_SOURCE_UNAVAILABLE", "VersionMismatch", "BuildError", "OCR_QUEUE_BATCH_PARTIAL_FAILURE", "OCR_PROVIDER_TIMEOUT", "OCR_UNAVAILABLE"]);
const HEALTH_STATES = new Set(["authorized", "unauthorized", "valid", "invalid", "failed", "connected", "disconnected", "idle", "ready", "repairing",
    "unknown", "configured", "unconfigured", "healthy", "degraded", "unhealthy", "success", "completed", "pending", "runtime-validated", "secret", "environment"]);
const healthCode = value => HEALTH_CODES.has(value) ? value : value ? "UNRECOGNIZED_HEALTH_CODE" : null;
const healthState = value => HEALTH_STATES.has(value) ? value : value ? "unknown" : null;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
const healthTimedOut = error => error?.name === "AbortError" || error?.code === "UPSTREAM_TIMEOUT";
function healthSummary(value) {
    return Object.fromEntries(["attempted", "succeeded", "failed", "mmrChanged", "mmrUnchanged", "candidateCount", "entryCount", "playlistCount", "checked", "healthy", "degraded", "down", "unknown"]
        .filter(key => count(value?.[key]) !== null).map(key => [key, value[key]])
        .concat(["success", "changed"].filter(key => typeof value?.[key] === "boolean").map(key => [key, value[key]])));
}
function operationalState(value) {
    const output = {};
    for (const key of ["checkedAt", "lastRequestAt", "lastInvocationAt", "lastSuccessAt", "lastSuccessfulAt", "lastFailureAt"]) output[key] = safeTimestamp(value?.[key]);
    for (const key of ["lastDurationMs", "responseTimeMs", "lastBatchSize", "lastCompletedCount", "lastFailureCount"]) output[key] = count(value?.[key]);
    output.lastErrorCode = healthCode(value?.lastErrorCode);
    output.lastFailureStage = healthState(value?.lastFailureStage);
    output.lastSummary = healthSummary(value?.lastSummary);
    return output;
}
function scheduledHealth(value) {
    return Object.fromEntries(["mmr", "shop", "leaderboards", "health"].filter(key => value?.[key] && typeof value[key] === "object")
        .map(key => [key, operationalState(value[key])]));
}

function canonicalStatus(value) {
    const status = String(value || "").toLowerCase();
    if (["healthy", "online"].includes(status)) return "healthy";
    if (["degraded", "repairing"].includes(status)) return "degraded";
    if (["down", "offline", "unhealthy", "unavailable"].includes(status)) return "unavailable";
    if (status === "disabled") return "disabled";
    return "unknown";
}

function statusEntry(id, name, status, detail, extra = {}) {
    const normalizedStatus = ["healthy", "degraded", "down", "unavailable", "disabled", "unknown", "repairing"].includes(String(status).toLowerCase()) ? String(status).toLowerCase() : "unknown";
    return { id, name, group: SERVICE_GROUPS[id], status: normalizedStatus, canonicalStatus: canonicalStatus(normalizedStatus), stale: false, checkedAt: new Date().toISOString(), responseTimeMs: null, lastSuccessfulAt: null, lastFailureAt: null, message: detail, detail, dependencies: [], actions: ACTIONS[id] || [], ...extra };
}

function statusKv(env) { return env?.RL_STATS_CACHE || env?.SERVICE_STATUS || null; }

async function readStatus(env, id) {
    try {
        const value = await withUpstreamDeadline(() => statusKv(env)?.get(`${SERVICE_STATUS_PREFIX}${id}`, "json"), CHECK_TIMEOUT_MS);
        if (!value || typeof value !== "object") return null;
        const saved = { ...operationalState(value), status: ["healthy", "degraded", "down", "unavailable", "disabled", "unknown"].includes(value.status) ? value.status : "unknown",
            errorCode: BOT_CODES.has(value.errorCode) ? value.errorCode : null, retryAfterSeconds: count(value.retryAfterSeconds),
            dependencies: [], message: "Last recorded health result.", detail: "Last recorded health result." };
        const checkedAt = saved.checkedAt || saved.lastInvocationAt || saved.lastSuccessfulAt || saved.lastFailureAt;
        saved.checkedAt = safeTimestamp(checkedAt);
        const checkedAtMs = Date.parse(checkedAt || "");
        const stale = !Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() || Date.now() - checkedAtMs > HEALTH_STALE_AFTER_MS;
        if (!stale) return { ...saved, canonicalStatus: canonicalStatus(saved.status), stale: false };
        const lastKnownStatus = saved.lastKnownStatus || saved.status || "unknown";
        return { ...saved, status: "unknown", canonicalStatus: "unknown", stale: true, lastKnownStatus,
            message: "Health result is stale.", detail: `Last health result is stale; the last recorded status was ${lastKnownStatus}.` };
    } catch { return null; }
}
async function writeStatus(env, id, value) {
    try { await withUpstreamDeadline(() => statusKv(env)?.put(`${SERVICE_STATUS_PREFIX}${id}`, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 30 }), CHECK_TIMEOUT_MS); } catch { /* Best effort; status remains available for this response. */ }
}
function applyOperationalState(entry, state) {
    if (!state || typeof state !== "object") return entry;
    const lastSuccess = state.lastSuccessAt || state.lastSuccessfulAt || null;
    const lastFailure = state.lastFailureAt || null;
    return { ...entry, lastSuccessfulAt: lastSuccess, lastFailureAt: lastFailure, lastInvocationAt: state.lastInvocationAt || null, responseTimeMs: Number.isFinite(state.responseTimeMs) ? state.responseTimeMs : entry.responseTimeMs };
}

async function timedFetch(fetcher, timeoutMs = CHECK_TIMEOUT_MS) {
    return withUpstreamDeadline(signal => fetchBoundedResponse("https://health.internal", { signal }, 256 * 1024,
        (_input, init) => fetcher(init.signal)), timeoutMs);
}

async function readSmallJson(response, maximumBytes = 4096) {
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
    return body ? JSON.parse(body) : {};
}

async function checkPresenceMonitor(env) {
    const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim();
    const triggerKey = String(env?.PRESENCE_TRIGGER_KEY || "");
    const actions = endpoint && triggerKey.length >= 32 ? ["recheck", "run-now", "refresh-shop"] : ["recheck"];
    if (!endpoint) return statusEntry("rl-presence", "RL presence monitor", "Unknown", "Health endpoint is not configured.", { actions });
    if (triggerKey.length < 32) return statusEntry("rl-presence", "RL presence monitor", "Unknown", "Protected health authorization is not configured.", { actions });
    const started = Date.now();
    try {
        const response = await timedFetch(signal => fetch(new URL("/admin/health", endpoint), { method: "GET", redirect: "manual", signal, headers: { Authorization: `Bearer ${triggerKey}`, Accept: "application/json" } }));
        if (!response.ok) return statusEntry("rl-presence", "RL presence monitor", response.status >= 500 ? "Down" : "Degraded", `Health endpoint returned HTTP ${response.status}.`, { actions, responseTimeMs: Date.now() - started });
        const payload = await readSmallJson(response);
        if (payload?.success !== true) return statusEntry("rl-presence", "RL presence monitor", "Unknown", "Health response was not recognized.");
        const failedRecently = payload.lastFailureAt && (!payload.lastSuccessAt || payload.lastFailureAt > payload.lastSuccessAt);
        const configurationMissing = payload.configuration && Object.values(payload.configuration).some(value => value === false);
        return statusEntry("rl-presence", "bpd-rl-presence-monitor", failedRecently || configurationMissing ? "Degraded" : payload.status || "unknown", "Protected lightweight readiness; scheduled work was not triggered.", { actions, ...operationalState(payload), lastSuccessfulAt: safeTimestamp(payload.lastSuccessAt), scheduledJobs: scheduledHealth(payload.scheduledJobs), responseTimeMs: Date.now() - started });
    } catch (error) {
        return statusEntry("rl-presence", "RL presence monitor", healthTimedOut(error) ? "Down" : "Unknown", healthTimedOut(error) ? "Health check timed out." : "Health check failed.", { actions });
    }
}

async function checkOcrTransport(env) {
    if (typeof env?.OCR_GOOGLE_TRANSPORT?.fetch !== "function") return statusEntry("ocr-transport", "OCR transport Worker", "Unknown", "Service Binding is unavailable.");
    const secret = String(env?.OCR_GOOGLE_TRANSPORT_SECRET || "");
    if (secret.length < 32 || secret.length > 256) return statusEntry("ocr-transport", "OCR transport Worker", "Unknown", "Transport authorization is not configured.");
    const started = Date.now();
    try {
        const response = await timedFetch(signal => env.OCR_GOOGLE_TRANSPORT.fetch(new Request("https://ocr-google-transport.internal/health", { method: "GET", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal })));
        if (!response.ok) return statusEntry("ocr-transport", "OCR transport Worker", response.status >= 500 ? "Down" : "Degraded", `Health endpoint returned HTTP ${response.status}.`);
        const payload = await readSmallJson(response);
        const configuration = payload?.configuration;
        if (payload?.success !== true || !configuration || typeof configuration !== "object") return statusEntry("ocr-transport", "OCR transport Worker", "Unknown", "Health response was not recognized.");
        const missing = Object.values(configuration).filter(present => present !== true).length;
        const operational = operationalState(payload.operational);
        const cloudRun = payload.cloudRun || null;
        const recentFailure = operational.lastFailureAt && (!operational.lastSuccessAt || operational.lastFailureAt >= operational.lastSuccessAt);
        return statusEntry("ocr-transport", "bpd-ocr-cloud-run-proxy", missing || recentFailure ? "Degraded" : "Healthy", missing ? `Worker reachable; configuration check incomplete (${missing} missing item${missing === 1 ? "" : "s"}).` : recentFailure ? "Worker reachable; the last OCR request failed." : "Liveness/configuration only; routine check did not contact Google.", { ...operational, checkedAt: new Date().toISOString(), lastSuccessfulAt: operational.lastSuccessAt, responseTimeMs: Date.now() - started, dependencies: cloudRun ? [{ id: "cloud-run-ocr", status: canonicalStatus(cloudRun.status), checkedAt: safeTimestamp(cloudRun.checkedAt) }] : [] });
    } catch (error) {
        return statusEntry("ocr-transport", "OCR transport Worker", healthTimedOut(error) ? "Down" : "Unknown", healthTimedOut(error) ? "Health check timed out." : "Health check failed.");
    }
}

async function checkProviderRuntime(env) {
    const binding = env?.PROVIDER_RUNTIME;
    const secret = env?.PROVIDER_RUNTIME_CALLER_SECRET;
    const unavailable = (message, errorCode, responseTimeMs = null) => statusEntry(
        "provider-runtime", "bpd-provider-runtime", "down", message,
        { errorCode, responseTimeMs }
    );
    if (typeof binding?.fetch !== "function") return unavailable("Provider runtime Service Binding is unavailable.", "PROVIDER_RUNTIME_BINDING_MISSING");
    if (!isValidProviderRuntimeCallerSecret(secret)) return unavailable("Provider runtime caller authentication is not configured.", "PROVIDER_RUNTIME_CALLER_SECRET_UNCONFIGURED");
    const started = Date.now();
    let response = null;
    try {
        return await withAbortTimeout(async signal => {
            response = await fetchBoundedResponse("https://bpd-provider-runtime.internal/internal/health", {
                method: "GET", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal
            }, 1024, (input, init) => binding.fetch(new Request(input, init)));
            const responseTimeMs = Date.now() - started;
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    return unavailable("Provider runtime rejected caller authentication.", "PROVIDER_RUNTIME_CALLER_REJECTED", responseTimeMs);
                }
                if (response.status === 404) {
                    return unavailable("Provider runtime health endpoint was not found.", "PROVIDER_RUNTIME_HEALTH_ENDPOINT_MISSING", responseTimeMs);
                }
                return unavailable("Provider runtime health check returned an unsuccessful response.", "PROVIDER_RUNTIME_HTTP_ERROR", responseTimeMs);
            }

            let payload;
            try { payload = await readSmallJson(response, 1024); }
            catch (error) {
                if (signal.aborted) throw error;
                return unavailable("Provider runtime returned an invalid health response.", "PROVIDER_RUNTIME_HEALTH_INVALID", responseTimeMs);
            }
            const allowedKeys = ["success", "service", "status", "timestamp"];
            const validKeys = payload && typeof payload === "object" && !Array.isArray(payload)
                && Object.keys(payload).length === allowedKeys.length
                && Object.keys(payload).every(key => allowedKeys.includes(key));
            const validTimestamp = typeof payload?.timestamp === "string" && Number.isFinite(Date.parse(payload.timestamp));
            if (!validKeys || payload.success !== true || payload.service !== "bpd-provider-runtime"
                || !["ok", "degraded"].includes(payload.status) || !validTimestamp) {
                return unavailable("Provider runtime returned an unrecognized health response.", "PROVIDER_RUNTIME_HEALTH_INVALID", responseTimeMs);
            }
            const degraded = payload.status === "degraded";
            return statusEntry("provider-runtime", "bpd-provider-runtime", degraded ? "degraded" : "healthy",
                degraded ? "Provider runtime is reachable but reports degraded health." : "Provider runtime is online.",
                { responseTimeMs });
        }, CHECK_TIMEOUT_MS, () => response?.body?.cancel());
    } catch (error) {
        const timeout = error?.code === "PROVIDER_RUNTIME_TIMEOUT" || error?.code === "UPSTREAM_TIMEOUT" || error?.name === "AbortError";
        return unavailable(timeout ? "Provider runtime health check timed out." : "Provider runtime health check is unavailable.",
            timeout ? "PROVIDER_RUNTIME_TIMEOUT" : "PROVIDER_RUNTIME_UNAVAILABLE", Date.now() - started);
    }
}

async function checkBoundRuntime(env, kind) {
    const custom = kind === "custom-match-runtime";
    const name = custom ? "bpd-custom-match-runtime" : "bpd-discord-communications";
    const flag = env?.[custom ? "CUSTOM_MATCH_RUNTIME_ENABLED" : "DISCORD_COMMUNICATIONS_ENABLED"];
    if (flag === "false") return statusEntry(kind, name, "disabled", "Intentionally disabled in application configuration; no Worker or Durable Object was contacted.");
    if (flag !== "true") return statusEntry(kind, name, "unknown", "Enablement is not explicitly configured.");
    const binding = env?.[custom ? "CUSTOM_MATCH_RUNTIME" : "DISCORD_COMMUNICATIONS"];
    if (typeof binding?.fetch !== "function") return statusEntry(kind, name, "unavailable", "The required Service Binding is missing.");
    const secret = env?.[custom ? "CUSTOM_MATCH_RUNTIME_CALLER_SECRET" : "DISCORD_COMMUNICATIONS_SECRET"];
    if (typeof secret !== "string" || secret.length < (custom ? 64 : 32)) return statusEntry(kind, name, "unavailable", "Internal caller authentication is not configured.");
    const started = Date.now();
    try {
        return await withUpstreamDeadline(async signal => {
            const request = custom ? new Request("https://custom-match-runtime.internal/internal/health", {
                headers: { "X-Custom-Match-Caller": secret, Accept: "application/json" }
            }) : await signedCommunicationRequest(env, "https://discord-communications.internal/internal/health", {});
            const result = await fetchBoundedResponse(request, { signal }, 2048, (input, init) => binding.fetch(new Request(input, init)));
            if (!result.ok) return statusEntry(kind, name, "unavailable", "The Worker health route is unreachable or rejected caller authentication.");
            const value = await result.json();
            const fields = custom ? ["success", "service", "status", "checkedAt", "namespaceConfigured", "dataConfigured", "instanceChecked"]
                : ["success", "service", "status", "checkedAt", "receiptsConfigured", "deliveryChecked"];
            if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
                || value.success !== true || value.service !== name || !["healthy", "degraded", "disabled", "unknown"].includes(value.status)
                || !safeTimestamp(value.checkedAt) || (custom ? typeof value.namespaceConfigured !== "boolean" || typeof value.dataConfigured !== "boolean" || value.instanceChecked !== false
                    : typeof value.receiptsConfigured !== "boolean" || value.deliveryChecked !== false)) {
                return statusEntry(kind, name, "unavailable", "The Worker returned an invalid health contract.");
            }
            return statusEntry(kind, name, value.status, value.status === "disabled" ? "The Worker is intentionally disabled; application and Worker enablement differ."
                : custom ? "Authenticated Worker liveness and configuration only; no match instance was opened."
                    : "Authenticated Worker liveness only; no Discord delivery or receipt instance was attempted.",
                { checkedAt: safeTimestamp(value.checkedAt), responseTimeMs: Date.now() - started,
                    ...(custom ? { namespaceConfigured: value.namespaceConfigured, dataConfigured: value.dataConfigured, instanceChecked: false } : { deliveryChecked: false }) });
        }, CHECK_TIMEOUT_MS);
    } catch (error) {
        return statusEntry(kind, name, "unavailable", error?.code === "UPSTREAM_TIMEOUT" ? "Worker health check timed out." : "Worker health check failed.", { responseTimeMs: Date.now() - started });
    }
}

function customSessionAvailability(runtime) {
    const status = runtime.status === "disabled" ? "disabled" : runtime.canonicalStatus === "unavailable" ? "unavailable"
        : runtime.namespaceConfigured === false ? "unavailable" : "unknown";
    return statusEntry("custom-match-session", "CustomMatchSession runtime availability", status,
        status === "disabled" ? "Runtime is intentionally disabled; no match instances were checked."
            : runtime.namespaceConfigured === true ? "Worker is reachable and namespace is configured. Individual match instance health was not checked."
                : "Runtime availability could not be established; no Durable Object was created.",
        { instanceChecked: false, runtimeAvailable: runtime.status === "healthy" && runtime.namespaceConfigured === true });
}

async function isolatedHealth(id, name, check, timeout = CHECK_TIMEOUT_MS + 100) {
    try { return { ...await withUpstreamDeadline(check, timeout), id, name, group: SERVICE_GROUPS[id] }; }
    catch (error) { return statusEntry(id, name, "unavailable", error?.code === "UPSTREAM_TIMEOUT" ? "Health check deadline exceeded." : "Health check could not be completed."); }
}

async function readBotStatus(env, id) {
    const saved = await readStatus(env, id);
    const entry = statusEntry(id, BOT_NAMES[id], "unknown", "No connection check yet. Use Check connection; page loads do not contact Discord.");
    if (!saved) return entry;
    // Whitelist stored fields rather than forwarding a provider payload/cache blob.
    return { ...entry, status: ["healthy", "degraded", "down", "unknown"].includes(saved.status) ? saved.status : "unknown",
        canonicalStatus: canonicalStatus(saved.status), stale: saved.stale === true, lastKnownStatus: saved.lastKnownStatus || null,
        checkedAt: safeTimestamp(saved.checkedAt), responseTimeMs: Number.isFinite(saved.responseTimeMs) ? saved.responseTimeMs : null,
        lastSuccessfulAt: safeTimestamp(saved.lastSuccessfulAt), lastFailureAt: safeTimestamp(saved.lastFailureAt),
        message: saved.stale ? "Discord bot connection result is stale." : saved.status === "healthy" ? "Last read-only Discord bot connection check succeeded." : "Last Discord bot connection check was unavailable.",
        detail: saved.stale ? saved.detail : saved.status === "healthy" ? "Last read-only Discord bot connection check succeeded." : "Last Discord bot connection check was unavailable.",
        errorCode: BOT_CODES.has(saved.errorCode) ? saved.errorCode : null,
        retryAfterSeconds: Number.isSafeInteger(saved.retryAfterSeconds) ? saved.retryAfterSeconds : null };
}

const BOT_CODES = new Set(["DISCORD_BOT_UNAVAILABLE", "DISCORD_BOT_TIMEOUT", "DISCORD_BOT_RESPONSE_INVALID", "DISCORD_BOT_RATE_LIMITED", "DISCORD_BOT_UNAUTHORIZED", "DISCORD_BOT_GUILD_UNAVAILABLE", "PROVIDER_RUNTIME_BINDING_MISSING", "PROVIDER_RUNTIME_CALLER_SECRET_UNCONFIGURED", "PROVIDER_RUNTIME_CALLER_REJECTED", "PROVIDER_RUNTIME_HEALTH_ENDPOINT_MISSING"]);

async function recheckDiscordBot(env, id) {
    const started = Date.now();
    const failed = (code, retryAfterSeconds = null) => statusEntry(id, BOT_NAMES[id], "degraded", "Discord bot connection could not be verified.",
        { errorCode: BOT_CODES.has(code) ? code : "DISCORD_BOT_UNAVAILABLE", retryAfterSeconds, responseTimeMs: Date.now() - started });
    try {
        return await withUpstreamDeadline(async signal => {
            if (id === "discord-matchbot") {
                if (typeof env?.PROVIDER_RUNTIME?.fetch !== "function") return failed("PROVIDER_RUNTIME_BINDING_MISSING");
                if (!isValidProviderRuntimeCallerSecret(env.PROVIDER_RUNTIME_CALLER_SECRET)) return failed("PROVIDER_RUNTIME_CALLER_SECRET_UNCONFIGURED");
                const response = await fetchBoundedResponse("https://bpd-provider-runtime.internal/internal/discord/bot-health", {
                    method: "GET", signal, headers: { Authorization: `Bearer ${env.PROVIDER_RUNTIME_CALLER_SECRET}`, Accept: "application/json" }, redirect: "manual"
                }, 1024, (url, init) => env.PROVIDER_RUNTIME.fetch(new Request(url, init)));
                const payload = await response.json();
                if (!response.ok || payload?.success !== true) {
                    if (response.status === 401 || response.status === 403 || payload?.code === "CALLER_UNAUTHORIZED") return failed("PROVIDER_RUNTIME_CALLER_REJECTED");
                    if (response.status === 404) return failed("PROVIDER_RUNTIME_HEALTH_ENDPOINT_MISSING");
                    return failed(payload?.code, safeBotRetry(payload?.retryAfterSeconds));
                }
                const keys = ["success", "botAuthenticated", "checkedAt"];
                if (Object.keys(payload).length !== keys.length || keys.some(key => !Object.hasOwn(payload, key))
                    || payload.botAuthenticated !== true || !safeTimestamp(payload.checkedAt)) return failed("DISCORD_BOT_RESPONSE_INVALID");
            } else {
                const token = typeof env?.DISCORD_AUTHZ_BOT_TOKEN === "string" ? env.DISCORD_AUTHZ_BOT_TOKEN.trim() : "";
                const guild = env?.DISCORD_AUTHZ_GUILD_ID;
                if (!token || typeof guild !== "string" || !/^\d{16,22}$/u.test(guild)) return failed("DISCORD_BOT_UNAVAILABLE");
                for (const path of ["/users/@me", `/guilds/${guild}`]) {
                    const response = await fetchBoundedResponse(`https://discord.com/api/v10${path}`, {
                        method: "GET", signal, redirect: "manual", headers: { Authorization: `Bot ${token}`, Accept: "application/json" }
                    }, 256 * 1024);
                    let payload;
                    try { payload = await response.json(); } catch { return failed("DISCORD_BOT_RESPONSE_INVALID"); }
                    if (response.status === 429) return failed("DISCORD_BOT_RATE_LIMITED", safeBotRetry(response.headers.get("Retry-After") ?? payload?.retry_after) || 60);
                    if (response.status === 401) return failed("DISCORD_BOT_UNAUTHORIZED");
                    if (!response.ok) return failed(path.startsWith("/guilds/") ? "DISCORD_BOT_GUILD_UNAVAILABLE" : "DISCORD_BOT_UNAVAILABLE");
                    if (!payload || typeof payload.id !== "string" || !/^\d{16,22}$/u.test(payload.id)
                        || (path === "/users/@me" ? payload.bot !== true : payload.id !== guild)) return failed("DISCORD_BOT_RESPONSE_INVALID");
                }
            }
            return statusEntry(id, BOT_NAMES[id], "healthy", id === "discord-matchbot"
                ? "Discord accepted the MatchBot credential and returned a valid bot identity. No message or membership change was made."
                : "Discord accepted the authorization bot credential and confirmed access to its configured guild. No role or membership change was made.",
            { responseTimeMs: Date.now() - started });
        }, 15000);
    } catch (error) { return failed(error?.code === "UPSTREAM_TIMEOUT" ? "DISCORD_BOT_TIMEOUT" : "DISCORD_BOT_UNAVAILABLE"); }
}

function safeTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function safeBotRetry(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - Date.now()) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(86400, Math.ceil(seconds)) : null;
}

async function checkQueueConsumer(env) {
    const state = await readStatus(env, "ocr-queue");
    if (!state) return statusEntry("ocr-queue", "OCR queue consumer", "Unknown", "No queue invocation has reported status yet; an idle queue is not considered down.");
    if (state.stale) return statusEntry("ocr-queue", "OCR queue consumer", "Unknown", state.detail, state);
    const failedAfterSuccess = state.lastFailureAt && (!state.lastSuccessAt || state.lastFailureAt >= state.lastSuccessAt);
    return statusEntry("ocr-queue", "OCR queue consumer", failedAfterSuccess ? "Degraded" : "Healthy", failedAfterSuccess ? "Latest queue invocation recorded a retryable or permanent failure." : "Last queue invocation completed without a recorded failure.", { ...state, lastSuccessfulAt: state.lastSuccessAt || null, lastInvocationAt: state.lastInvocationAt || null });
}

async function checkCloudRun(env) {
    const state = await readStatus(env, "cloud-run-ocr");
    if (!state) return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", "Unknown", "No explicit authenticated readiness check has been run; page loads do not mint Google tokens.");
    return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", state.status || "unknown", state.message || "Last known authenticated readiness result.", state);
}

async function checkSupabase(env) {
    const state = await readStatus(env, "supabase");
    if (!state) return statusEntry("supabase", "Supabase", "Unknown", "No explicit availability check has been run.");
    return statusEntry("supabase", "Supabase", state.status || "unknown", state.detail || state.message || "Last database readiness check.", { ...state, actions: ACTIONS.supabase });
}

const MMR_ADVERTISED_ACTIONS = new Set(["recheck", "refresh-eos", "reauthorize-account", "reconnect-psynet", "validate-build", "repair-session"]);

function safeMmrActions(payload, adminConfigured) {
    const advertised = Array.isArray(payload?.availableActions) ? payload.availableActions.filter(action => MMR_ADVERTISED_ACTIONS.has(action)) : ["recheck"];
    return [...new Set(advertised.filter(action => action === "recheck" || adminConfigured))];
}

function normalizeMmrHealth(payload, responseTimeMs, adminConfigured) {
    const components = payload?.components || {};
    const psynet = payload?.psynet || {};
    const recovery = payload?.recovery || {};
    const traffic = payload?.traffic || {};
    const build = payload?.build || {};
    const config = payload?.config || {};
    const component = name => ({
        status: ["healthy", "degraded", "unhealthy", "unknown"].includes(components[name]?.status) ? components[name].status : "unknown",
        state: healthState(components[name]?.state)
    });
    const status = ["healthy", "degraded", "down", "unknown", "repairing"].includes(payload?.status) ? payload.status : "unknown";
    const rootCause = healthCode(payload?.rootCause);
    const activeRepair = MMR_ADVERTISED_ACTIONS.has(payload?.activeRepair) ? payload.activeRepair : null;
    const state = healthState(psynet.state || components.psynetSocket?.state || "unknown");
    const detail = status === "healthy" ? "MMR Worker, EOS, PsyNet, and MMR service are healthy."
        : status === "repairing" ? `MMR repair is active${activeRepair ? `: ${activeRepair}` : "."}`
            : rootCause ? `MMR Worker is ${status}; current cause: ${rootCause}.` : `MMR Worker is ${status}; no current root cause was reported.`;
    return statusEntry("mmr-api", "MMR API", status, detail, {
        actions: safeMmrActions(payload, adminConfigured), responseTimeMs, rootCause, activeRepair,
        components: {
            worker: component("worker"), configuration: component("configuration"), eosAuthorization: component("eosAuthorization"),
            psynetAuthentication: component("psynetAuthentication"), psynetSocket: component("psynetSocket"),
            buildConfiguration: component("buildConfiguration"), mmrService: component("mmrService")
        },
        psynetState: state, configReady: config.requiredConfigPresent === true,
        missingConfig: Array.isArray(config.missingConfig) ? config.missingConfig.slice(0, 20).map(() => "Required setting") : [],
        gameVersion: safeBuildValue(components.buildConfiguration?.gameVersion || build.gameVersion, /^\d{1,10}(?:\.\d{1,10}){1,4}$/),
        currentBuildId: safeBuildValue(components.buildConfiguration?.derivedBuildId || build.currentBuildId, /^\d{1,20}$/),
        currentFeatureSet: safeBuildValue(components.buildConfiguration?.featureSet || build.currentFeatureSet, /^[A-Za-z][A-Za-z0-9]{0,39}$/),
        configurationGeneration: count(components.buildConfiguration?.configurationGeneration ?? build.configurationGeneration) || 0,
        buildSource: healthState(components.buildConfiguration?.source || build.source),
        buildSecretConfigured: components.buildConfiguration?.buildSecretConfigured === true || build.buildSecretConfigured === true,
        buildStatus: healthState(components.buildConfiguration?.status || build.status) || "unknown",
        supportsBuildUpdate: adminConfigured,
        lastAuthAttemptAt: safeTimestamp(psynet.lastAuthAttemptAt),
        lastAuthSuccessAt: safeTimestamp(components.psynetAuthentication?.lastSuccessAt || psynet.lastAuthSuccessAt),
        lastMmrRequestAt: safeTimestamp(traffic.lastRequestAt),
        lastMmrSuccessAt: safeTimestamp(components.mmrService?.lastSuccessAt || traffic.lastSuccessAt),
        lastMmrFailureAt: safeTimestamp(components.mmrService?.lastFailureAt || traffic.lastFailureAt),
        lastMmrFailureCode: healthCode(components.mmrService?.lastFailureCode || traffic.lastFailureCode),
        lastRepairAction: MMR_ADVERTISED_ACTIONS.has(recovery.lastRepairAction) ? recovery.lastRepairAction : null,
        lastRepairResult: healthState(recovery.lastRepairResult),
        nextScheduledVersionCheckAt: safeTimestamp(build.nextScheduledCheckAt),
        historical: {
            lastVersionCheckAt: safeTimestamp(build.lastVersionCheckAt), lastVersionCheckResult: healthCode(build.lastVersionCheckResult),
            lastBuildValidationAt: safeTimestamp(build.lastBuildValidationAt), lastBuildValidationResult: healthState(build.lastBuildValidationResult),
            versionMismatchDetectedAt: safeTimestamp(build.versionMismatchDetectedAt), lastFailureCode: healthCode(psynet.lastFailureCode),
            lastFailureStage: healthState(psynet.lastFailureStage), lastProviderCode: healthCode(psynet.lastProviderCode)
        },
        mmrRequests: count(traffic.totalRequests) || 0, mmrSuccesses: count(traffic.successfulRequests) || 0,
        mmrFailures: count(traffic.failedRequests) || 0, emptyRequests: count(traffic.emptyRequests) || 0,
        rateLimitedRequests: count(traffic.rateLimitedRequests) || 0,
        normalLimitPerMinute: count(traffic.normalLimitPerMinute) || 30, emptyLimitPerMinute: count(traffic.emptyLimitPerMinute) || 5
    });
}

function safeBuildValue(value, pattern) { return typeof value === "string" && pattern.test(value) ? value : null; }

async function checkMmrApi(env) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const apiKey = String(env?.MMR_API_KEY || "").trim();
    const adminConfigured = Boolean(String(env?.MMR_ADMIN_API_KEY || "").trim());
    if (!endpoint || !apiKey) return statusEntry("mmr-api", "MMR API", "unknown", "MMR readiness authorization is not configured.", { actions: ["recheck"], configReady: false, supportsBuildUpdate: false });
    const startedAt = Date.now();
    try {
        const response = await timedFetch(signal => fetch(new URL("/health/ready", endpoint), { method: "GET", redirect: "manual", signal, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }));
        const responseTimeMs = Date.now() - startedAt;
        if (!response.ok) return statusEntry("mmr-api", "MMR API", response.status >= 500 ? "down" : "degraded", `Readiness endpoint returned HTTP ${response.status}.`, { actions: ["recheck"], responseTimeMs, supportsBuildUpdate: adminConfigured });
        const payload = await readSmallJson(response, 16384);
        if (!payload?.components || !["healthy", "degraded", "down", "unknown", "repairing"].includes(payload.status)) return statusEntry("mmr-api", "MMR API", "unknown", "Readiness response was not recognized.", { actions: ["recheck"], responseTimeMs, supportsBuildUpdate: adminConfigured });
        return normalizeMmrHealth(payload, responseTimeMs, adminConfigured);
    } catch (error) {
        return statusEntry("mmr-api", "MMR API", healthTimedOut(error) ? "down" : "unknown", healthTimedOut(error) ? "Readiness check timed out." : "Readiness check failed.", { actions: ["recheck"], responseTimeMs: Date.now() - startedAt, supportsBuildUpdate: adminConfigured });
    }
}

async function runChecks(env) {
    const checks = [
        ["pages", "bpd-webpage / Pages Functions", () => statusEntry("pages", "bpd-webpage / Pages Functions", "healthy", "This authenticated request is being served.", { responseTimeMs: 0 })],
        ["rl-presence", "bpd-rl-presence-monitor", () => checkPresenceMonitor(env)],
        ["ocr-transport", "bpd-ocr-cloud-run-proxy", () => checkOcrTransport(env)],
        ["ocr-queue", "bpd-ocr-job-consumer", () => checkQueueConsumer(env)],
        ["cloud-run-ocr", "BPD OCR Cloud Run", () => checkCloudRun(env)],
        ["mmr-api", "bpd-mmr-api", () => checkMmrApi(env)],
        ["provider-runtime", "bpd-provider-runtime", () => checkProviderRuntime(env)],
        ["supabase", "Supabase", () => checkSupabase(env)],
        ["discord-matchbot", BOT_NAMES["discord-matchbot"], () => readBotStatus(env, "discord-matchbot")],
        ["discord-authz-bot", BOT_NAMES["discord-authz-bot"], () => readBotStatus(env, "discord-authz-bot")],
        ["custom-match-runtime", "bpd-custom-match-runtime", () => checkBoundRuntime(env, "custom-match-runtime")],
        ["discord-communications", "bpd-discord-communications", () => checkBoundRuntime(env, "discord-communications")],
        ["google-mtls-diagnostic", "bpd-google-mtls-diagnostic", () => statusEntry("google-mtls-diagnostic", "bpd-google-mtls-diagnostic", "unknown",
            "Diagnostic-only retirement candidate. No current production caller is configured; deployment presence and retirement require operator verification.", { classification: "retirement-candidate" })]
    ];
    const services = await Promise.all(checks.map(([id, name, check]) => isolatedHealth(id, name, check)));
    services.push(customSessionAvailability(services.find(service => service.id === "custom-match-runtime")));
    return {
        success: true,
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        services
    };
}

export async function getSystemStatus(env, { force = false } = {}) {
    if (!force) {
        try {
            const cached = await withUpstreamDeadline(() => statusKv(env)?.get(CACHE_KEY, "json"), CHECK_TIMEOUT_MS);
            if (cached?.success === true && Array.isArray(cached.services)) return { ...cached, cache: "hit" };
        } catch { /* Continue with a bounded live sweep. */ }
    }
    if (!inFlightCheck) {
        inFlightCheck = runChecks(env).then(async payload => {
            try { await withUpstreamDeadline(() => statusKv(env)?.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS }), CHECK_TIMEOUT_MS); } catch { /* Best effort. */ }
            return payload;
        }).finally(() => { inFlightCheck = null; });
    }
    return { ...(await inFlightCheck), cache: "miss" };
}

export async function performSystemStatusAction(env, service, action, input = {}) {
    if (!ACTIONS[service]?.includes(action)) throw actionError("SYSTEM_ACTION_UNSUPPORTED", 400);
    const lockKey = `${service}:${action}`;
    if (actionLocks.has(lockKey)) throw actionError("SERVICE_ACTION_IN_PROGRESS", 409);
    const bot = Object.hasOwn(BOT_NAMES, service);
    const cooldown = bot ? 60 : ACTION_COOLDOWNS[lockKey] || 0;
    const cooldownKey = `admin:system-action:${lockKey}`;
    const now = Date.now();
    if (bot) {
        const previous = await readStatus(env, service);
        const until = Math.max(botCooldowns.get(env)?.[service] || 0,
            previous?.retryAfterSeconds ? Date.parse(previous.checkedAt) + previous.retryAfterSeconds * 1000 : 0);
        if (until > now) { const error = actionError("SERVICE_ACTION_COOLDOWN", 429); error.retryAfterSeconds = Math.ceil((until - now) / 1000); throw error; }
    }
    if (cooldown) {
        try {
            const last = Number(await env?.RL_STATS_CACHE?.get(cooldownKey));
            if (last && now - last < cooldown * 1000) { const error = actionError("SERVICE_ACTION_COOLDOWN", 429); error.retryAfterSeconds = Math.ceil(cooldown - (now - last) / 1000); throw error; }
        } catch (error) { if (error?.code === "SERVICE_ACTION_COOLDOWN") throw error; }
    }
    actionLocks.add(lockKey);
    try {
        if (bot) botCooldowns.set(env, { ...botCooldowns.get(env), [service]: now + 60000 });
        if (cooldown) try { await env?.RL_STATS_CACHE?.put(cooldownKey, String(now), { expirationTtl: cooldown }); } catch { /* Local lock remains effective. */ }
        if (service === "supabase" && action === "test-rl-counters") {
            return { success: true, service, action, result: await testRocketLeagueCounters(env) };
        }
        if (service === "mmr-api") {
            if (action === "functional-test") return await testMmrSkills(env, service, action, input);
            return await runMmrAdminAction(env, service, action);
        }
        let result;
        if (service === "pages") result = statusEntry("pages", "Pages Functions", "healthy", "Authenticated Pages API is responding.", { responseTimeMs: 0 });
        else if (service === "rl-presence") {
            if (action === "refresh-shop") {
                const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim();
                const token = String(env?.PRESENCE_TRIGGER_KEY || "");
                if (!endpoint || token.length < 32) throw actionError("SHOP_REFRESH_NOT_CONFIGURED", 503);
                try {
                    await withUpstreamDeadline(async signal => {
                        const response = await fetchBoundedResponse(new URL("/admin/run-scheduled", endpoint), {
                            method: "POST", redirect: "manual", signal,
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ job: "shop" })
                        }, 4096);
                        if (response.status === 409) throw actionError("SERVICE_ACTION_IN_PROGRESS", 409);
                        if (!response.ok) throw actionError("SHOP_REFRESH_FAILED", 502);
                        const payload = await response.json();
                        if (payload?.success !== true || payload.job !== "shop" || payload.summary?.success !== true) {
                            throw actionError("SHOP_REFRESH_FAILED", 502);
                        }
                    }, 60000);
                } catch (error) {
                    if (["SHOP_REFRESH_FAILED", "SERVICE_ACTION_IN_PROGRESS"].includes(error?.code)) throw error;
                    throw actionError(error?.code === "UPSTREAM_TIMEOUT" ? "SHOP_REFRESH_TIMEOUT" : "SHOP_REFRESH_FAILED", error?.code === "UPSTREAM_TIMEOUT" ? 504 : 502);
                }
            }
            if (action === "run-now") {
                const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim(); const token = String(env?.PRESENCE_TRIGGER_KEY || "");
                if (!endpoint || token.length < 32) throw actionError("PRESENCE_RUN_NOT_CONFIGURED", 503);
                const response = await timedFetch(signal => fetch(new URL("/admin/run-scheduled", endpoint), { method: "POST", redirect: "manual", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ job: "presence" }) }), ACTION_TIMEOUT_MS);
                if (!response.ok) throw actionError(response.status === 409 ? "SERVICE_ACTION_IN_PROGRESS" : "PRESENCE_RUN_FAILED", response.status === 409 ? 409 : 502);
            }
            result = await isolatedHealth(service, "RL presence monitor", () => checkPresenceMonitor(env));
        } else if (service === "ocr-transport") result = await isolatedHealth(service, "OCR transport Worker", () => checkOcrTransport(env));
        else if (service === "ocr-queue") result = await isolatedHealth(service, "OCR queue consumer", () => checkQueueConsumer(env));
        else if (service === "provider-runtime") result = await isolatedHealth(service, "bpd-provider-runtime", () => checkProviderRuntime(env));
        else if (service === "custom-match-runtime" || service === "discord-communications") result = await checkBoundRuntime(env, service);
        else if (bot) result = await recheckDiscordBot(env, service);
        else if (service === "supabase") result = await isolatedHealth(service, "Supabase", () => recheckSupabase(env), 10000);
        else if (service === "cloud-run-ocr") result = await isolatedHealth(service, "BPD OCR Cloud Run", () => recheckCloudRun(env), CLOUD_RUN_ACTION_TIMEOUT_MS + 100);
        if (bot && result?.retryAfterSeconds) botCooldowns.set(env, { ...botCooldowns.get(env), [service]: Date.now() + Math.max(60, result.retryAfterSeconds) * 1000 });
        await storeActionResult(env, result);
        return { success: true, service, action, result };
    } finally { actionLocks.delete(lockKey); }
}

export async function updateMmrBuildConfiguration(env, input) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const adminKey = String(env?.MMR_ADMIN_API_KEY || "").trim();
    if (!endpoint || !adminKey) throw actionError("RL_BUILD_UPDATE_NOT_CONFIGURED", 503);
    const gameVersion = typeof input?.gameVersion === "string" ? input.gameVersion.trim() : "";
    const featureSet = typeof input?.featureSet === "string" ? input.featureSet.trim() : "";
    const buildSecret = typeof input?.buildSecret === "string" ? input.buildSecret.trim() : "";
    if (!/^\d{6}\.\d{1,8}\.\d{1,8}$/.test(gameVersion) || !/^[A-Za-z0-9_.-]{1,64}$/.test(featureSet) || buildSecret.length < 8 || buildSecret.length > 512) throw actionError("RL_BUILD_UPDATE_INVALID", 400);
    let response;
    try {
        response = await timedFetch(signal => fetch(new URL("/admin/build-configuration", endpoint), {
            method: "POST", redirect: "manual", signal,
            headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ gameVersion, featureSet, buildSecret })
        }), ACTION_TIMEOUT_MS);
    } catch (cause) { throw actionError(healthTimedOut(cause) ? "RL_BUILD_UPDATE_TIMEOUT" : "RL_BUILD_UPDATE_UNAVAILABLE", healthTimedOut(cause) ? 504 : 502); }
    const payload = await readSmallJson(response).catch(() => ({}));
    if (!response.ok) {
        await invalidateMmrStatus(env);
        throw normalizedMmrError(response, payload, "RL_BUILD_UPDATE_REJECTED");
    }
    await invalidateMmrStatus(env);
    return {
        success: true, resultCode: safeCode(payload?.resultCode, "RL_BUILD_UPDATE_PROMOTED"),
        buildId: safeText(payload?.buildId), featureSet: safeText(payload?.featureSet || featureSet),
        gameVersion: safeText(payload?.gameVersion || gameVersion), configurationGeneration: Number(payload?.configurationGeneration) || 0,
        validatedAt: safeText(payload?.validatedAt), reconnectSucceeded: payload?.reconnectSucceeded === true,
        reconnectCode: safeCode(payload?.reconnectCode, null)
    };
}

function actionError(code, status = 503) { return Object.assign(new Error("Service action failed."), { code, status }); }
async function storeActionResult(env, entry) {
    if (!entry) return;
    const checkedAt = new Date().toISOString();
    const previous = await readStatus(env, entry.id);
    const invocationBased = ["rl-presence", "ocr-queue"].includes(entry.id);
    const statusPayload = {
        ...entry,
        checkedAt,
        lastSuccessfulAt: entry.lastSuccessfulAt || (entry.status === "healthy" && !invocationBased ? checkedAt : previous?.lastSuccessfulAt || null),
        lastFailureAt: ["unavailable", "degraded"].includes(canonicalStatus(entry.status)) ? checkedAt : entry.lastFailureAt || previous?.lastFailureAt || null
    };
    await writeStatus(env, entry.id, statusPayload);
    try { await withUpstreamDeadline(() => statusKv(env)?.delete(CACHE_KEY), CHECK_TIMEOUT_MS); } catch { /* Best effort. */ }
}

async function recheckSupabase(env) {
    const configuredUrl = String(env?.SUPABASE_URL || "").trim();
    const apiKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH || "").trim();
    if (!configuredUrl || !apiKey) return statusEntry("supabase", "Supabase", "down", "Supabase readiness check is not configured.", { errorCode: "SUPABASE_CONFIGURATION_UNAVAILABLE" });
    const started = Date.now();
    try {
        const result = await getFeaturedRocketLeaguePlayer({ ...env, SUPABASE_AUTH: apiKey });
        if (!result || !/^\d{4}-\d{2}-\d{2}$/.test(result.featuredDate)
            || !Number.isFinite(Date.parse(result.validUntil))
            || !(result.player === null || (typeof result.player === "object" && !Array.isArray(result.player)))) {
            return statusEntry("supabase", "Supabase", "down", "Supabase returned an unrecognized readiness response.", {
                responseTimeMs: Date.now() - started,
                errorCode: "SUPABASE_READINESS_RESPONSE_INVALID"
            });
        }
        return statusEntry("supabase", "Supabase", "healthy", "Read-only database RPC and response contract succeeded.", { responseTimeMs: Date.now() - started });
    } catch (error) {
        const timedOut = error?.status === 504 || error?.code === "UPSTREAM_TIMEOUT";
        const status = timedOut || Number(error?.status) >= 500 || [401, 403].includes(Number(error?.status)) ? "down" : "degraded";
        return statusEntry("supabase", "Supabase", status, timedOut ? "Supabase readiness check timed out." : "Supabase readiness RPC failed.", {
            responseTimeMs: Date.now() - started,
            errorCode: timedOut ? "SUPABASE_TIMEOUT" : "SUPABASE_READINESS_CHECK_FAILED"
        });
    }
}

async function testRocketLeagueCounters(env) {
    const checkedAt = new Date().toISOString();
    const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH || "").trim();
    if (!String(env?.SUPABASE_URL || "").trim() || !key) {
        return { available: false, errorCode: "SUPABASE_CONFIGURATION_UNAVAILABLE", checkedAt };
    }
    try {
        const counters = await getRocketLeagueHomepageCounters({ ...env, SUPABASE_AUTH: key });
        const fields = Object.fromEntries(Object.entries(counters)
            .filter(([name]) => name !== "capturedAt")
            .map(([name, value]) => [name, Number.isSafeInteger(value) && value >= 0 ? "available" : "unavailable"]));
        return {
            available: fields.registeredPlayers === "available",
            checkedAt: safeTimestamp(counters.capturedAt) || checkedAt,
            counters: Object.fromEntries(Object.keys(fields).map(name => [name, counters[name]])),
            fields,
            errorCode: fields.registeredPlayers === "available" ? null : "REGISTERED_PLAYER_COUNT_UNAVAILABLE"
        };
    } catch (error) {
        const timedOut = error?.status === 504 || error?.code === "UPSTREAM_TIMEOUT";
        return { available: false, errorCode: timedOut ? "SUPABASE_TIMEOUT" : "NETWORK_STATISTICS_UNAVAILABLE", checkedAt };
    }
}

export async function runScheduledAdminHealthChecks(env) {
    const results = await Promise.all([
        isolatedHealth("supabase", "Supabase", () => recheckSupabase(env), 10000),
        isolatedHealth("mmr-api", "MMR API", () => checkMmrApi(env)),
        isolatedHealth("provider-runtime", "bpd-provider-runtime", () => checkProviderRuntime(env)),
        isolatedHealth("discord-matchbot", BOT_NAMES["discord-matchbot"], () => recheckDiscordBot(env, "discord-matchbot"), 10100)
    ]);
    await Promise.all(results.map(result => storeActionResult(env, result)));
    return {
        success: true,
        checked: results.length,
        healthy: results.filter(result => canonicalStatus(result.status) === "healthy").length,
        degraded: results.filter(result => canonicalStatus(result.status) === "degraded").length,
        down: results.filter(result => canonicalStatus(result.status) === "unavailable").length,
        unavailable: results.filter(result => canonicalStatus(result.status) === "unavailable").length,
        disabled: results.filter(result => canonicalStatus(result.status) === "disabled").length,
        unknown: results.filter(result => canonicalStatus(result.status) === "unknown").length
    };
}

async function recheckCloudRun(env) {
    if (typeof env?.OCR_GOOGLE_TRANSPORT?.fetch !== "function") return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", "unknown", "OCR transport Service Binding is unavailable.");
    const secret = String(env?.OCR_GOOGLE_TRANSPORT_SECRET || "");
    if (secret.length < 32) return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", "unknown", "OCR transport authorization is not configured.");
    const started = Date.now();
    try {
        const response = await timedFetch(signal => env.OCR_GOOGLE_TRANSPORT.fetch(new Request(`https://${INTERNAL_HOSTNAME}/admin/recheck/cloud-run`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal })), CLOUD_RUN_ACTION_TIMEOUT_MS);
        const payload = await readSmallJson(response);
        const status = ["healthy", "degraded", "down", "unavailable"].includes(payload.status) ? payload.status : response.status >= 500 ? "down" : "unknown";
        return statusEntry("cloud-run-ocr", "BPD OCR Cloud Run", status, response.ok ? "Authenticated Cloud Run readiness check completed." : "Cloud Run readiness check failed.",
            { responseTimeMs: Date.now() - started, dependencies: ["runtime", "templates", "scheduler"].map(id => ({ id, status: canonicalStatus(payload.dependencies?.find(item => item.id === id)?.status) })) });
    } catch (error) { return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", healthTimedOut(error) ? "down" : "unknown", healthTimedOut(error) ? "Cloud Run readiness check timed out." : "Cloud Run readiness check failed.", { responseTimeMs: Date.now() - started }); }
}

function safeText(value, maximum = 256) { return typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").slice(0, maximum) : null; }
function safeCode(value, fallback = null) { const code = typeof value === "string" ? value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) : ""; return code || fallback; }
function normalizedMmrError(response, payload, fallback) {
    const status = [400, 401, 403, 409, 422, 429, 502, 503, 504].includes(response.status) ? response.status : 502;
    const error = actionError(safeCode(payload?.code || payload?.error, fallback), status);
    error.providerCode = safeCode(payload?.providerCode, null);
    error.retryAfterSeconds = Number(payload?.retryAfterSeconds) || Number(response.headers.get("Retry-After")) || null;
    error.rootCause = safeCode(payload?.rootCause, null);
    error.action = safeCode(payload?.action, null);
    error.safeMessage = safeText(payload?.message, 200);
    return error;
}
async function invalidateMmrStatus(env) { try { await env?.RL_STATS_CACHE?.delete(CACHE_KEY); } catch { /* Best effort. */ } }

async function callMmr(env, path, keyName, { method = "POST", body, timeout = ACTION_TIMEOUT_MS, maximumBytes = 4096 } = {}) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const key = String(env?.[keyName] || "").trim();
    if (!endpoint || !key) throw actionError("MMR_ACTION_NOT_CONFIGURED", 503);
    try {
        const response = await timedFetch(signal => fetch(new URL(path, endpoint), {
            method, redirect: "manual", signal,
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        }), timeout);
        const payload = await readSmallJson(response, maximumBytes).catch(() => ({}));
        if (!response.ok) throw normalizedMmrError(response, payload, "MMR_ACTION_FAILED");
        return payload;
    } catch (error) {
        if (error?.code && !error.code.startsWith("UPSTREAM_")) throw error;
        throw actionError(healthTimedOut(error) ? "MMR_ACTION_TIMEOUT" : "MMR_ACTION_UNAVAILABLE", healthTimedOut(error) ? 504 : 502);
    }
}

async function runMmrAdminAction(env, service, action) {
    if (action === "recheck") {
        const result = await isolatedHealth(service, "MMR API", () => checkMmrApi(env));
        await storeActionResult(env, result);
        return { success: true, service, action, result };
    }
    const paths = {
        "refresh-eos": "/admin/refresh", "reauthorize-account": "/admin/bootstrap",
        "poll-authorization": "/admin/poll", "reconnect-psynet": "/admin/reconnect", "repair-session": "/admin/repair-session"
    };
    const payload = await callMmr(env, paths[action], "MMR_ADMIN_API_KEY");
    await invalidateMmrStatus(env);
    if (action === "reauthorize-account") return { success: true, service, action, result: { status: "authorization_pending", url: safeText(payload?.url, 512), interval: Math.max(5, Number(payload?.interval) || 10) } };
    if (action === "poll-authorization") return { success: true, service, action, result: { status: payload?.status === "authorized" ? "authorized" : "authorization_pending", retryAfter: Math.max(5, Number(payload?.retryAfter) || 10) } };
    const readiness = await checkMmrApi(env);
    await storeActionResult(env, readiness);
    return { success: true, service, action, result: {
        success: payload?.success !== false, resultCode: safeCode(payload?.resultCode || payload?.code, null),
        state: safeCode(payload?.state || payload?.status, null), action: safeCode(payload?.action, null),
        completedAt: safeText(payload?.completedAt), readiness
    } };
}

async function testMmrSkills(env, service, action, input) {
    const playerId = typeof input?.playerId === "string" ? input.playerId.trim() : "";
    if (!/^Epic\|[A-Za-z0-9_-]{8,64}\|0$/.test(playerId)) throw actionError("MMR_PLAYER_ID_INVALID", 400);
    const startedAt = Date.now();
    const payload = await callMmr(env, `/get-skills?playerId=${encodeURIComponent(playerId)}`, "MMR_API_KEY", { method: "GET", timeout: ACTION_TIMEOUT_MS, maximumBytes: 16384 });
    const playlists = Array.isArray(payload?.playlists) ? payload.playlists.slice(0, 32).map(item => ({
        id: Number(item?.id), mmr: Number(item?.mmr), tier: Number(item?.tier), division: Number(item?.division)
    })).filter(item => [item.id, item.mmr, item.tier, item.division].every(Number.isFinite)) : [];
    return { success: true, service, action, result: { success: true, playlistCount: playlists.length, playlists, responseTimeMs: Date.now() - startedAt } };
}
