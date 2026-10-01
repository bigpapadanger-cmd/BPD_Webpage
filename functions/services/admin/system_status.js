"use strict";

const CACHE_KEY = "admin:system-status:v2";
const CACHE_TTL_SECONDS = 45;
const CHECK_TIMEOUT_MS = 2000;
const ACTION_TIMEOUT_MS = 15000;
const CLOUD_RUN_ACTION_TIMEOUT_MS = 30000;
const INTERNAL_HOSTNAME = "ocr-google-transport.internal";
let inFlightCheck = null;
const actionLocks = new Set();
const ACTION_COOLDOWNS = { "mmr-api:reconnect-psynet": 30, "mmr-api:refresh-eos": 15, "mmr-api:repair-session": 15, "cloud-run-ocr:recheck": 60, "rl-presence:run-now": 60 };
const ACTIONS = {
    pages: ["recheck"], "rl-presence": ["recheck", "run-now"], "ocr-transport": ["recheck"],
    "ocr-queue": ["recheck"], "cloud-run-ocr": ["recheck"], supabase: ["recheck"],
    "mmr-api": ["recheck", "refresh-eos", "reauthorize-account", "poll-authorization", "reconnect-psynet", "repair-session", "functional-test"]
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

async function readSmallJson(response, maximumBytes = 4096) {
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (body.length > maximumBytes) throw new Error("HEALTH_RESPONSE_TOO_LARGE");
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
        state: typeof components[name]?.state === "string" ? components[name].state : null
    });
    const status = ["healthy", "degraded", "down", "unknown", "repairing"].includes(payload?.status) ? payload.status : "unknown";
    const rootCause = typeof payload?.rootCause === "string" ? payload.rootCause : null;
    const activeRepair = typeof payload?.activeRepair === "string" ? payload.activeRepair : null;
    const state = String(psynet.state || components.psynetSocket?.state || "unknown");
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
        missingConfig: Array.isArray(config.missingConfig) ? config.missingConfig.filter(value => typeof value === "string").slice(0, 20) : [],
        gameVersion: components.buildConfiguration?.gameVersion || build.gameVersion || null,
        currentBuildId: components.buildConfiguration?.derivedBuildId || build.currentBuildId || null,
        currentFeatureSet: components.buildConfiguration?.featureSet || build.currentFeatureSet || null,
        configurationGeneration: Number(components.buildConfiguration?.configurationGeneration ?? build.configurationGeneration) || 0,
        buildSource: components.buildConfiguration?.source || build.source || null,
        buildSecretConfigured: components.buildConfiguration?.buildSecretConfigured === true || build.buildSecretConfigured === true,
        buildStatus: components.buildConfiguration?.status || build.status || "unknown",
        supportsBuildUpdate: adminConfigured,
        lastAuthAttemptAt: psynet.lastAuthAttemptAt || null,
        lastAuthSuccessAt: components.psynetAuthentication?.lastSuccessAt || psynet.lastAuthSuccessAt || null,
        lastMmrRequestAt: traffic.lastRequestAt || null,
        lastMmrSuccessAt: components.mmrService?.lastSuccessAt || traffic.lastSuccessAt || null,
        lastMmrFailureAt: components.mmrService?.lastFailureAt || traffic.lastFailureAt || null,
        lastMmrFailureCode: components.mmrService?.lastFailureCode || traffic.lastFailureCode || null,
        lastRepairAction: recovery.lastRepairAction || null,
        lastRepairResult: recovery.lastRepairResult || null,
        nextScheduledVersionCheckAt: build.nextScheduledCheckAt || null,
        historical: {
            lastVersionCheckAt: build.lastVersionCheckAt || null, lastVersionCheckResult: build.lastVersionCheckResult || null,
            lastBuildValidationAt: build.lastBuildValidationAt || null, lastBuildValidationResult: build.lastBuildValidationResult || null,
            versionMismatchDetectedAt: build.versionMismatchDetectedAt || null, lastFailureCode: psynet.lastFailureCode || null,
            lastFailureStage: psynet.lastFailureStage || null, lastProviderCode: psynet.lastProviderCode || null
        },
        mmrRequests: Number(traffic.totalRequests) || 0, mmrSuccesses: Number(traffic.successfulRequests) || 0,
        mmrFailures: Number(traffic.failedRequests) || 0, emptyRequests: Number(traffic.emptyRequests) || 0,
        rateLimitedRequests: Number(traffic.rateLimitedRequests) || 0,
        normalLimitPerMinute: Number(traffic.normalLimitPerMinute) || 30, emptyLimitPerMinute: Number(traffic.emptyLimitPerMinute) || 5
    });
}

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
        return statusEntry("mmr-api", "MMR API", error?.name === "AbortError" ? "down" : "unknown", error?.name === "AbortError" ? "Readiness check timed out." : "Readiness check failed.", { actions: ["recheck"], responseTimeMs: Date.now() - startedAt, supportsBuildUpdate: adminConfigured });
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

export async function performSystemStatusAction(env, service, action, input = {}) {
    if (!ACTIONS[service]?.includes(action)) throw actionError("SYSTEM_ACTION_UNSUPPORTED", 400);
    const lockKey = `${service}:${action}`;
    if (actionLocks.has(lockKey)) throw actionError("SERVICE_ACTION_IN_PROGRESS", 409);
    const cooldown = ACTION_COOLDOWNS[lockKey] || 0;
    const cooldownKey = `admin:system-action:${lockKey}`;
    const now = Date.now();
    if (cooldown) {
        try {
            const last = Number(await env?.RL_STATS_CACHE?.get(cooldownKey));
            if (last && now - last < cooldown * 1000) { const error = actionError("SERVICE_ACTION_COOLDOWN", 429); error.retryAfterSeconds = Math.ceil(cooldown - (now - last) / 1000); throw error; }
        } catch (error) { if (error?.code === "SERVICE_ACTION_COOLDOWN") throw error; }
    }
    actionLocks.add(lockKey);
    try {
        if (cooldown) try { await env?.RL_STATS_CACHE?.put(cooldownKey, String(now), { expirationTtl: cooldown }); } catch { /* Local lock remains effective. */ }
        if (service === "mmr-api") {
            if (action === "functional-test") return await testMmrSkills(env, service, action, input);
            return await runMmrAdminAction(env, service, action);
        }
        let result;
        if (service === "pages") result = statusEntry("pages", "Pages Functions", "healthy", "Authenticated Pages API is responding.", { responseTimeMs: 0 });
        else if (service === "rl-presence") {
            if (action === "run-now") {
                const endpoint = String(env?.RL_PRESENCE_MONITOR_URL || "").trim(); const token = String(env?.PRESENCE_TRIGGER_KEY || "");
                if (!endpoint || token.length < 32) throw actionError("PRESENCE_RUN_NOT_CONFIGURED", 503);
                const response = await timedFetch(signal => fetch(new URL("/admin/run-scheduled", endpoint), { method: "POST", redirect: "manual", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ job: "presence" }) }), ACTION_TIMEOUT_MS);
                if (!response.ok) throw actionError(response.status === 409 ? "SERVICE_ACTION_IN_PROGRESS" : "PRESENCE_RUN_FAILED", response.status === 409 ? 409 : 502);
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
    } catch (cause) { throw actionError(cause?.name === "AbortError" ? "RL_BUILD_UPDATE_TIMEOUT" : "RL_BUILD_UPDATE_UNAVAILABLE", cause?.name === "AbortError" ? 504 : 502); }
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
        if (error?.code) throw error;
        throw actionError(error?.name === "AbortError" ? "MMR_ACTION_TIMEOUT" : "MMR_ACTION_UNAVAILABLE", error?.name === "AbortError" ? 504 : 502);
    }
}

async function runMmrAdminAction(env, service, action) {
    const paths = {
        recheck: "/admin/recheck", "refresh-eos": "/admin/refresh", "reauthorize-account": "/admin/bootstrap",
        "poll-authorization": "/admin/poll", "reconnect-psynet": "/admin/reconnect", "repair-session": "/admin/repair-session"
    };
    const payload = await callMmr(env, paths[action], "MMR_ADMIN_API_KEY");
    await invalidateMmrStatus(env);
    if (action === "reauthorize-account") return { success: true, service, action, result: { status: "authorization_pending", url: safeText(payload?.url, 512), interval: Math.max(5, Number(payload?.interval) || 10) } };
    if (action === "poll-authorization") return { success: true, service, action, result: { status: payload?.status === "authorized" ? "authorized" : "authorization_pending", retryAfter: Math.max(5, Number(payload?.retryAfter) || 10) } };
    const readiness = action === "recheck" ? normalizeMmrHealth(payload, null, true) : await checkMmrApi(env);
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
