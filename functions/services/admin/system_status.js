"use strict";

const CACHE_KEY = "admin:system-status:v2";
const CACHE_TTL_SECONDS = 45;
const CHECK_TIMEOUT_MS = 2000;
const ACTION_TIMEOUT_MS = 15000;
const CLOUD_RUN_ACTION_TIMEOUT_MS = 30000;
const INTERNAL_HOSTNAME = "ocr-google-transport.internal";
let inFlightCheck = null;
const actionLocks = new Set();
const ACTION_COOLDOWNS = { "mmr-api:reconnect": 30, "mmr-api:check-version": 60, "cloud-run-ocr:recheck": 60, "rl-presence:run-now": 60 };
const ACTIONS = {
    pages: ["recheck"], "rl-presence": ["recheck", "run-now"], "ocr-transport": ["recheck"],
    "ocr-queue": ["recheck"], "cloud-run-ocr": ["recheck"], supabase: ["recheck"],
    "mmr-api": ["recheck", "reconnect", "check-version"]
};
const SERVICE_STATUS_PREFIX = "admin:service-status:";

function statusEntry(id, name, status, detail, extra = {}) {
    return { id, name, status: String(status).toLowerCase(), checkedAt: new Date().toISOString(), responseTimeMs: null, lastSuccessfulAt: null, lastFailureAt: null, message: detail, detail, dependencies: [], actions: ACTIONS[id] || [], ...extra };
}

async function readStatus(env, id) {
    try { return await env?.RL_STATS_CACHE?.get(`${SERVICE_STATUS_PREFIX}${id}`, "json"); } catch { return null; }
}
async function writeStatus(env, id, value) {
    try { await env?.RL_STATS_CACHE?.put(`${SERVICE_STATUS_PREFIX}${id}`, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 30 }); } catch { /* Best effort; status remains available for this response. */ }
}
function applyOperationalState(entry, state) {
    if (!state || typeof state !== "object") return entry;
    const lastSuccess = state.lastSuccessAt || state.lastSuccessfulAt || null;
    const lastFailure = state.lastFailureAt || null;
    return { ...entry, lastSuccessfulAt: lastSuccess, lastFailureAt: lastFailure, lastInvocationAt: state.lastInvocationAt || null, responseTimeMs: Number.isFinite(state.responseTimeMs) ? state.responseTimeMs : entry.responseTimeMs };
}

async function timedFetch(fetcher, timeoutMs = CHECK_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetcher(controller.signal); }
    finally { clearTimeout(timer); }
}

async function readSmallJson(response) {
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > 4096) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (body.length > 4096) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
    return body ? JSON.parse(body) : {};
}

async function checkPresenceMonitor(env) {
    const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim();
    const triggerKey = String(env?.PRESENCE_TRIGGER_KEY || "");
    const actions = endpoint && triggerKey.length >= 32 ? ["recheck", "run-now"] : ["recheck"];
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
        return statusEntry("rl-presence", "RL presence monitor", failedRecently || configurationMissing ? "Degraded" : payload.status || "unknown", "Protected lightweight readiness; scheduled work was not triggered.", { actions, lastInvocationAt: payload.lastInvocationAt || null, lastSuccessfulAt: payload.lastSuccessAt || null, lastFailureAt: payload.lastFailureAt || null, lastDurationMs: payload.lastDurationMs ?? null, lastSummary: payload.lastSummary || null, configuration: payload.configuration || null, responseTimeMs: Date.now() - started });
    } catch (error) {
        return statusEntry("rl-presence", "RL presence monitor", error?.name === "AbortError" ? "Down" : "Unknown", error?.name === "AbortError" ? "Health check timed out." : "Health check failed.", { actions });
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
        const operational = payload.operational || {};
        const cloudRun = payload.cloudRun || null;
        const recentFailure = operational.lastFailureAt && (!operational.lastSuccessAt || operational.lastFailureAt >= operational.lastSuccessAt);
        return statusEntry("ocr-transport", "OCR transport Worker", missing || recentFailure ? "Degraded" : "Healthy", missing ? `Worker reachable; configuration check incomplete (${missing} missing item${missing === 1 ? "" : "s"}).` : recentFailure ? `Worker reachable; last OCR request failed during ${operational.lastFailureStage || "an unknown stage"}.` : "Liveness/configuration only; routine check did not contact Google.", { ...operational, lastSuccessfulAt: operational.lastSuccessAt || null, responseTimeMs: Date.now() - started, dependencies: cloudRun ? [{ id: "cloud-run-ocr", status: cloudRun.status || "unknown", checkedAt: cloudRun.checkedAt || null }] : [] });
    } catch (error) {
        return statusEntry("ocr-transport", "OCR transport Worker", error?.name === "AbortError" ? "Down" : "Unknown", error?.name === "AbortError" ? "Health check timed out." : "Health check failed.");
    }
}

async function checkQueueConsumer(env) {
    const state = await readStatus(env, "ocr-queue");
    if (!state) return statusEntry("ocr-queue", "OCR queue consumer", "Unknown", "No queue invocation has reported status yet; an idle queue is not considered down.");
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
    return statusEntry("supabase", "Supabase", state.status || "unknown", state.message || "Last explicit API availability check.", state);
}

async function checkMmrApi(env) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const apiKey = String(env?.MMR_API_KEY || "").trim();
    const actions = ["recheck", ...(String(env?.MMR_ADMIN_API_KEY || "").trim() ? ["reconnect", "check-version"] : [])];
    if (!endpoint || !apiKey) return statusEntry("mmr-api", "MMR API", "unknown", "MMR readiness authorization is not configured.", { actions, configReady: false });
    const startedAt = Date.now();
    try {
        const response = await timedFetch(signal => fetch(new URL("/health/ready", endpoint), { method: "GET", redirect: "manual", signal, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }));
        const responseTimeMs = Date.now() - startedAt;
        if (!response.ok) return statusEntry("mmr-api", "MMR API", response.status >= 500 ? "down" : "degraded", `Readiness endpoint returned HTTP ${response.status}.`, { actions, responseTimeMs });
        const payload = await readSmallJson(response);
        if (!payload?.psynet || !["healthy", "degraded", "unknown"].includes(payload.status)) return statusEntry("mmr-api", "MMR API", "unknown", "Readiness response was not recognized.", { actions, responseTimeMs });
        const psynet = payload.psynet;
        const recovery = payload.recovery || {};
        const traffic = payload.traffic || {};
        const config = payload.config || {};
        const state = String(psynet.state || "unknown");
        const detail = state === "connected" ? "PsyNet is connected." : state === "idle" && payload.status === "healthy" ? "PsyNet is ready and will connect on the next request." : `MMR Worker is reachable; PsyNet state is ${state}.`;
        return statusEntry("mmr-api", "MMR API", payload.status, detail, {
            actions,
            responseTimeMs,
            psynetState: state,
            configReady: config.requiredConfigPresent === true,
            missingConfig: Array.isArray(config.missingConfig) ? config.missingConfig : [],
            lastAuthAttemptAt: psynet.lastAuthAttemptAt || null,
            lastAuthSuccessAt: psynet.lastAuthSuccessAt || null,
            lastAuthFailureAt: psynet.lastAuthFailureAt || null,
            lastSuccessfulAt: psynet.lastSuccessfulAt || traffic.lastSuccessAt || null,
            lastFailureAt: psynet.lastFailureAt || traffic.lastFailureAt || null,
            lastFailureCode: psynet.lastFailureCode || traffic.lastFailureCode || null,
            lastFailureStage: psynet.lastFailureStage || null,
            lastProviderCode: psynet.lastProviderCode || null,
            backoffUntil: psynet.backoffUntil || psynet.nextRetryAt || null,
            retryAfterSeconds: Number(psynet.retryAfterSeconds) || null,
            consecutiveFailures: Number(psynet.consecutiveFailures) || 0,
            lastMmrRequestAt: traffic.lastRequestAt || null,
            lastMmrSuccessAt: traffic.lastSuccessAt || null,
            lastMmrFailureAt: traffic.lastFailureAt || null,
            lastMmrFailureCode: traffic.lastFailureCode || null,
            mmrRequests: Number(traffic.totalRequests) || 0,
            mmrSuccesses: Number(traffic.successfulRequests) || 0,
            mmrFailures: Number(traffic.failedRequests) || 0,
            emptyRequests: Number(traffic.emptyRequests) || 0,
            rateLimitedRequests: Number(traffic.rateLimitedRequests) || 0,
            normalLimitPerMinute: Number(traffic.normalLimitPerMinute) || 30,
            emptyLimitPerMinute: Number(traffic.emptyLimitPerMinute) || 5,
            lastReconnectAttemptAt: recovery.lastAttemptAt || null,
            lastReconnectCompletedAt: recovery.lastCompletedAt || null,
            lastReconnectResult: recovery.lastResult || null,
            reconnectAttempts: Number(recovery.attempts) || 0,
            reconnectSuccesses: Number(recovery.successes) || 0,
            reconnectFailures: Number(recovery.failures) || 0,
            buildStatus: payload.build?.status || "unknown",
            currentBuildId: payload.build?.currentBuildId || null,
            currentFeatureSet: payload.build?.currentFeatureSet || null,
            userAgentConfigured: payload.build?.userAgentConfigured === true,
            userAgentSummary: payload.build?.userAgentSummary || null,
            buildSource: payload.build?.source || null,
            lastVersionCheckAt: payload.build?.lastVersionCheckAt || null,
            lastVersionCheckResult: payload.build?.lastVersionCheckResult || null,
            lastBuildValidationAt: payload.build?.lastBuildValidationAt || null,
            lastBuildValidationResult: payload.build?.lastBuildValidationResult || null,
            versionMismatchDetectedAt: payload.build?.versionMismatchDetectedAt || null,
            detectedBuildId: payload.build?.detectedBuildId || null,
            detectedFeatureSet: payload.build?.detectedFeatureSet || null,
            candidateValidationResult: payload.build?.candidateValidationResult || null,
            nextScheduledVersionCheckAt: payload.build?.nextScheduledCheckAt || null
        });
    } catch (error) {
        return statusEntry("mmr-api", "MMR API", error?.name === "AbortError" ? "down" : "unknown", error?.name === "AbortError" ? "Readiness check timed out." : "Readiness check failed.", { actions, responseTimeMs: Date.now() - startedAt });
    }
}

async function runChecks(env) {
    const [presence, transport, queue, cloudRun, supabase, mmr] = await Promise.all([checkPresenceMonitor(env), checkOcrTransport(env), checkQueueConsumer(env), checkCloudRun(env), checkSupabase(env), checkMmrApi(env)]);
    return {
        success: true,
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        services: [
            statusEntry("pages", "Pages Functions", "healthy", "This authenticated request is being served.", { actions: ACTIONS.pages, responseTimeMs: 0 }),
            presence,
            transport,
            queue,
            cloudRun,
            mmr,
            supabase
        ]
    };
}

export async function getSystemStatus(env, { force = false } = {}) {
    if (!force) {
        try {
            const cached = await env?.RL_STATS_CACHE?.get(CACHE_KEY, "json");
            if (cached?.success === true && Array.isArray(cached.services)) return { ...cached, cache: "hit" };
        } catch { /* Continue with a bounded live sweep. */ }
    }
    if (!inFlightCheck) {
        inFlightCheck = runChecks(env).then(async payload => {
            try { await env?.RL_STATS_CACHE?.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS }); } catch { /* Best effort. */ }
            return payload;
        }).finally(() => { inFlightCheck = null; });
    }
    return { ...(await inFlightCheck), cache: "miss" };
}

export async function performSystemStatusAction(env, service, action) {
    if (!ACTIONS[service]?.includes(action)) {
        const error = new Error("Unsupported system action.");
        error.code = "SYSTEM_ACTION_UNSUPPORTED";
        error.status = 400;
        throw error;
    }
    const lockKey = `${service}:${action}`;
    if (actionLocks.has(lockKey)) { const error = new Error("Action already running."); error.code = "SERVICE_RECHECK_IN_PROGRESS"; error.status = 409; throw error; }
    const cooldown = ACTION_COOLDOWNS[lockKey] || 15;
    const cooldownKey = `admin:system-action:${lockKey}`;
    const now = Date.now();
    try {
        const last = Number(await env?.RL_STATS_CACHE?.get(cooldownKey));
        if (last && now - last < cooldown * 1000) { const error = new Error("Action is cooling down."); error.code = "SERVICE_RECHECK_COOLDOWN"; error.status = 429; error.retryAfterSeconds = Math.ceil(cooldown - (now - last) / 1000); throw error; }
    } catch (error) { if (error?.code === "SERVICE_RECHECK_COOLDOWN") throw error; }
    actionLocks.add(lockKey);
    try {
        try { await env?.RL_STATS_CACHE?.put(cooldownKey, String(now), { expirationTtl: cooldown }); } catch { /* Isolate lock still deduplicates concurrent actions. */ }
        if (service === "mmr-api" && action === "recheck") {
            const result = await checkMmrApi(env); await storeActionResult(env, result); return { success: true, service, action, result };
        }
        if (service === "mmr-api" && action === "reconnect") return await reconnectMmr(env, service, action);
        if (service === "mmr-api" && action === "check-version") return await checkMmrVersion(env, service, action);
        let result;
        if (service === "pages") result = statusEntry("pages", "Pages Functions", "healthy", "Authenticated Pages API is responding.", { responseTimeMs: 0 });
        else if (service === "rl-presence") {
            if (action === "run-now") {
                const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim(); const token = String(env?.PRESENCE_TRIGGER_KEY || "");
                if (!endpoint || token.length < 32) throw actionError("PRESENCE_RUN_NOT_CONFIGURED", 503);
                const response = await timedFetch(signal => fetch(new URL("/admin/run-scheduled", endpoint), { method: "POST", redirect: "manual", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ job: "presence" }) }), ACTION_TIMEOUT_MS);
                if (!response.ok) throw actionError(response.status === 409 ? "SERVICE_RECHECK_IN_PROGRESS" : "PRESENCE_RUN_FAILED", response.status === 409 ? 409 : 502);
            }
            result = await checkPresenceMonitor(env);
        } else if (service === "ocr-transport") result = await checkOcrTransport(env);
        else if (service === "ocr-queue") result = await checkQueueConsumer(env);
        else if (service === "supabase") result = await recheckSupabase(env);
        else if (service === "cloud-run-ocr") result = await recheckCloudRun(env);
        await storeActionResult(env, result);
        return { success: true, service, action, result };
    } finally { actionLocks.delete(lockKey); }
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
        lastFailureAt: entry.status === "down" || entry.status === "degraded" ? checkedAt : entry.lastFailureAt || previous?.lastFailureAt || null
    };
    await writeStatus(env, entry.id, statusPayload);
    try { await env?.RL_STATS_CACHE?.delete(CACHE_KEY); } catch { /* Best effort. */ }
}

async function recheckSupabase(env) {
    const configuredUrl = String(env?.SUPABASE_URL || "").trim(); const apiKey = String(env?.SUPABASE_AUTH || "").trim();
    if (!configuredUrl || !apiKey) return statusEntry("supabase", "Supabase", "unknown", "Supabase availability check is not configured.");
    const started = Date.now();
    try {
        const root = new URL(configuredUrl); const path = root.pathname.replace(/\/rest\/v1\/?$/, "/rest/v1/");
        const response = await timedFetch(signal => fetch(new URL(path, root.origin), { method: "HEAD", redirect: "manual", signal, headers: { apikey: apiKey, Accept: "application/json" } }));
        const status = response.ok ? "healthy" : response.status >= 500 ? "down" : "degraded";
        return statusEntry("supabase", "Supabase", status, response.ok ? "Supabase Data API is reachable." : `Supabase Data API returned HTTP ${response.status}.`, { responseTimeMs: Date.now() - started });
    } catch (error) { return statusEntry("supabase", "Supabase", error?.name === "AbortError" ? "down" : "unknown", error?.name === "AbortError" ? "Supabase check timed out." : "Supabase availability check failed.", { responseTimeMs: Date.now() - started }); }
}

async function recheckCloudRun(env) {
    if (typeof env?.OCR_GOOGLE_TRANSPORT?.fetch !== "function") return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", "unknown", "OCR transport Service Binding is unavailable.");
    const secret = String(env?.OCR_GOOGLE_TRANSPORT_SECRET || "");
    if (secret.length < 32) return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", "unknown", "OCR transport authorization is not configured.");
    const started = Date.now();
    try {
        const response = await timedFetch(signal => env.OCR_GOOGLE_TRANSPORT.fetch(new Request(`https://${INTERNAL_HOSTNAME}/admin/recheck/cloud-run`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal })), CLOUD_RUN_ACTION_TIMEOUT_MS);
        const payload = await readSmallJson(response);
        const status = ["healthy", "degraded", "down"].includes(payload.status) ? payload.status : response.status >= 500 ? "down" : "unknown";
        return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", status, payload.message || (response.ok ? "Authenticated Cloud Run readiness check completed." : "Cloud Run readiness check failed."), { ...payload, responseTimeMs: Date.now() - started });
    } catch (error) { return statusEntry("cloud-run-ocr", "Google Cloud Run OCR", error?.name === "AbortError" ? "down" : "unknown", error?.name === "AbortError" ? "Cloud Run readiness check timed out." : "Cloud Run readiness check failed.", { responseTimeMs: Date.now() - started }); }
}

async function reconnectMmr(env, service, action) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const adminKey = String(env?.MMR_ADMIN_API_KEY || "").trim();
    if (!endpoint || !adminKey) {
        const error = new Error("MMR reconnect is not configured.");
        error.code = "MMR_RECONNECT_NOT_CONFIGURED";
        error.status = 503;
        throw error;
    }
    let response;
    try {
        response = await timedFetch(signal => fetch(new URL("/admin/reconnect", endpoint), { method: "POST", redirect: "manual", signal, headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" } }), ACTION_TIMEOUT_MS);
    } catch (cause) {
        const error = new Error("MMR reconnect request failed.");
        error.code = cause?.name === "AbortError" ? "MMR_RECONNECT_TIMEOUT" : "MMR_RECONNECT_UNAVAILABLE";
        error.status = 503;
        throw error;
    }
    let payload;
    try { payload = await readSmallJson(response); }
    catch {
        const error = new Error("MMR reconnect returned an invalid response.");
        error.code = "MMR_RECONNECT_INVALID_RESPONSE";
        error.status = 502;
        throw error;
    }
    if (!response.ok) {
        const error = new Error("MMR reconnect was not completed.");
        error.code = String(payload?.code || "MMR_RECONNECT_FAILED");
        error.status = [409, 429].includes(response.status) ? response.status : 502;
        error.retryAfterSeconds = Number(payload?.retryAfterSeconds) || null;
        throw error;
    }
    try { await env?.RL_STATS_CACHE?.delete(CACHE_KEY); } catch { /* Best effort. */ }
    return { success: true, service, action, result: { state: String(payload?.state || "connected"), completedAt: payload?.completedAt || new Date().toISOString() } };
}

async function checkMmrVersion(env, service, action) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const adminKey = String(env?.MMR_ADMIN_API_KEY || "").trim();
    if (!endpoint || !adminKey) throw actionError("RL_VERSION_CHECK_NOT_CONFIGURED", 503);
    let response;
    try {
        response = await timedFetch(signal => fetch(new URL("/admin/check-rocket-league-version", endpoint), {
            method: "POST",
            redirect: "manual",
            signal,
            headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" }
        }), ACTION_TIMEOUT_MS);
    } catch (cause) {
        throw actionError(cause?.name === "AbortError" ? "RL_VERSION_CHECK_TIMEOUT" : "RL_VERSION_CHECK_UNAVAILABLE", 503);
    }
    let payload;
    try { payload = await readSmallJson(response); }
    catch { throw actionError("RL_VERSION_CHECK_INVALID_RESPONSE", 502); }
    if (!response.ok) {
        const code = ["RL_VERSION_CHECK_IN_PROGRESS", "RL_VERSION_CHECK_COOLDOWN"].includes(payload?.code) ? payload.code : "RL_VERSION_CHECK_FAILED";
        const error = actionError(code, [409, 429].includes(response.status) ? response.status : 502);
        error.retryAfterSeconds = Number(payload?.retryAfterSeconds) || null;
        throw error;
    }
    const allowedCodes = new Set(["RL_VERSION_SOURCE_UNAVAILABLE", "RL_VERSION_CHECK_SKIPPED", "RL_VERSION_VALIDATED", "RL_VERSION_UPDATED"]);
    const resultCode = allowedCodes.has(payload?.resultCode) ? payload.resultCode : "RL_VERSION_CHECK_FAILED";
    try { await env?.RL_STATS_CACHE?.delete(CACHE_KEY); } catch { /* Best effort. */ }
    const readiness = await checkMmrApi(env);
    await storeActionResult(env, readiness);
    return {
        success: true,
        service,
        action,
        result: {
            resultCode,
            state: ["valid", "stale", "unknown", "checking"].includes(payload?.state) ? payload.state : "unknown",
            currentBuildId: typeof payload?.currentBuildId === "string" ? payload.currentBuildId : null,
            lastVersionCheckAt: typeof payload?.lastVersionCheckAt === "string" ? payload.lastVersionCheckAt : null,
            message: resultCode === "RL_VERSION_SOURCE_UNAVAILABLE" ? "No authoritative first-party build source is available; the current configuration was retained." : resultCode === "RL_VERSION_CHECK_SKIPPED" ? "The current build was checked recently; no new check was needed." : "Rocket League version check completed."
        }
    };
}
