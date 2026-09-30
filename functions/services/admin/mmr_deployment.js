"use strict";

const TARGET = Object.freeze({
    owner: "bigpapadanger-cmd",
    repo: "mmr-api-v3",
    workflow: "deploy-production.yml",
    branch: "main",
    worker: "bpd-mmr-api"
});
const STATE_KEY = "admin:mmr-deployment:v1";
const COOLDOWN_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
let triggerInFlight = false;

function deploymentError(code, status, retryAfterSeconds) {
    return Object.assign(new Error(code), { code, status, retryAfterSeconds });
}

async function readState(env) {
    try { return await env?.RL_STATS_CACHE?.get(STATE_KEY, "json"); }
    catch { return null; }
}

async function writeState(env, state) {
    await env?.RL_STATS_CACHE?.put(STATE_KEY, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 30 });
    return state;
}

function publicState(state) {
    if (!state) return { deploymentState: "idle", target: TARGET.worker, branch: TARGET.branch };
    return {
        deploymentState: state.deploymentState,
        deploymentId: state.deploymentId || null,
        triggeredAt: state.triggeredAt || null,
        triggeredByAccountId: state.triggeredByAccountId || null,
        startedAt: state.startedAt || null,
        completedAt: state.completedAt || null,
        durationMs: state.durationMs ?? null,
        result: state.result || null,
        commitSha: state.commitSha || null,
        branch: TARGET.branch,
        target: TARGET.worker,
        lastDeploymentSuccessAt: state.lastDeploymentSuccessAt || null,
        lastDeploymentFailureAt: state.lastDeploymentFailureAt || null,
        lastDeploymentFailureCode: state.lastDeploymentFailureCode || null,
        verification: state.verification || null
    };
}

async function github(env, path, init = {}) {
    const token = String(env?.MMR_DEPLOY_GITHUB_TOKEN || "").trim();
    if (!token) throw deploymentError("MMR_DEPLOY_NOT_CONFIGURED", 503);
    return fetch(`https://api.github.com/repos/${TARGET.owner}/${TARGET.repo}${path}`, {
        ...init,
        redirect: "manual",
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "BPD-DomainData-MMR-Deploy",
            ...(init.headers || {})
        }
    });
}

export async function startMmrDeployment(env, accountId) {
    if (triggerInFlight) throw deploymentError("MMR_DEPLOY_IN_PROGRESS", 409);
    if (!env?.RL_STATS_CACHE) throw deploymentError("MMR_DEPLOY_STATE_UNAVAILABLE", 503);
    const previous = await readState(env);
    if (["queued", "running"].includes(previous?.deploymentState)) throw deploymentError("MMR_DEPLOY_IN_PROGRESS", 409);
    const lastTrigger = Date.parse(previous?.triggeredAt || "");
    if (Number.isFinite(lastTrigger) && Date.now() - lastTrigger < COOLDOWN_MS) {
        throw deploymentError("MMR_DEPLOY_COOLDOWN", 429, Math.ceil((COOLDOWN_MS - (Date.now() - lastTrigger)) / 1000));
    }
    triggerInFlight = true;
    const triggeredAt = new Date().toISOString();
    const requestId = crypto.randomUUID();
    try {
        const response = await github(env, `/actions/workflows/${TARGET.workflow}/dispatches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ref: TARGET.branch, inputs: { request_id: requestId } })
        });
        if (response.status !== 204) throw deploymentError("MMR_DEPLOY_TRIGGER_FAILED", 502);
        const state = {
            deploymentState: "queued",
            requestId,
            deploymentId: null,
            triggeredAt,
            triggeredByAccountId: String(accountId || "unknown"),
            startedAt: null,
            completedAt: null,
            result: "MMR_DEPLOY_STARTED",
            commitSha: null,
            lastDeploymentSuccessAt: previous?.lastDeploymentSuccessAt || null,
            lastDeploymentFailureAt: previous?.lastDeploymentFailureAt || null,
            lastDeploymentFailureCode: previous?.lastDeploymentFailureCode || null
        };
        await writeState(env, state);
        return publicState(state);
    } catch (error) {
        const failedAt = new Date().toISOString();
        await writeState(env, {
            deploymentState: "failed", requestId, deploymentId: null, triggeredAt,
            triggeredByAccountId: String(accountId || "unknown"), startedAt: null, completedAt: failedAt,
            result: "MMR_DEPLOY_TRIGGER_FAILED", commitSha: null,
            lastDeploymentSuccessAt: previous?.lastDeploymentSuccessAt || null,
            lastDeploymentFailureAt: failedAt,
            lastDeploymentFailureCode: error?.code || "MMR_DEPLOY_TRIGGER_FAILED"
        });
        throw error?.code ? error : deploymentError("MMR_DEPLOY_TRIGGER_FAILED", 502);
    } finally { triggerInFlight = false; }
}

async function verifyMmr(env) {
    const endpoint = String(env?.MMR_API_URL || "").trim();
    const lookupKey = String(env?.MMR_API_KEY || "").trim();
    if (!endpoint || !lookupKey) return { status: "unknown", code: "MMR_DEPLOY_STATUS_UNAVAILABLE" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const [health, ready] = await Promise.all([
            fetch(new URL("/health", endpoint), { signal: controller.signal, redirect: "manual" }),
            fetch(new URL("/health/ready", endpoint), { signal: controller.signal, redirect: "manual", headers: { Authorization: `Bearer ${lookupKey}` } })
        ]);
        const readiness = ready.ok ? await ready.json().catch(() => null) : null;
        return { status: health.ok && ready.ok ? "reachable" : "degraded", livenessStatus: health.status, readinessStatus: ready.status, psynetState: readiness?.psynet?.state || null, buildStatus: readiness?.build?.status || null };
    } catch { return { status: "unknown", code: "MMR_DEPLOY_STATUS_UNAVAILABLE" }; }
    finally { clearTimeout(timer); }
}

export async function getMmrDeploymentStatus(env) {
    let state = await readState(env);
    if (!state) return publicState(null);
    if (!["queued", "running"].includes(state.deploymentState)) return publicState(state);
    if (Date.now() - Date.parse(state.triggeredAt) > RUN_TIMEOUT_MS) {
        state = { ...state, deploymentState: "unknown", completedAt: new Date().toISOString(), result: "MMR_DEPLOY_STATUS_UNAVAILABLE", lastDeploymentFailureAt: new Date().toISOString(), lastDeploymentFailureCode: "MMR_DEPLOY_STATUS_UNAVAILABLE" };
        await writeState(env, state);
        return publicState(state);
    }
    let run;
    if (state.deploymentId) {
        const response = await github(env, `/actions/runs/${state.deploymentId}`);
        if (!response.ok) throw deploymentError("MMR_DEPLOY_STATUS_UNAVAILABLE", 502);
        run = await response.json();
    } else {
        const response = await github(env, `/actions/workflows/${TARGET.workflow}/runs?event=workflow_dispatch&branch=${TARGET.branch}&per_page=20`);
        if (!response.ok) throw deploymentError("MMR_DEPLOY_STATUS_UNAVAILABLE", 502);
        const payload = await response.json();
        const threshold = Date.parse(state.triggeredAt) - 5000;
        run = payload?.workflow_runs?.filter(item => Date.parse(item.created_at) >= threshold).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
        if (!run) return publicState(state);
    }
    const terminal = run.status === "completed";
    const success = terminal && run.conclusion === "success";
    state = {
        ...state,
        deploymentId: String(run.id),
        deploymentState: terminal ? (success ? "success" : run.conclusion === "cancelled" ? "cancelled" : "failed") : run.status === "queued" ? "queued" : "running",
        startedAt: run.run_started_at || run.created_at || state.startedAt,
        completedAt: terminal ? run.updated_at || new Date().toISOString() : null,
        durationMs: terminal ? Math.max(0, Date.parse(run.updated_at) - Date.parse(run.run_started_at || run.created_at)) : null,
        result: terminal ? (success ? "MMR_DEPLOY_SUCCESS" : "MMR_DEPLOY_FAILED") : "MMR_DEPLOY_STARTED",
        commitSha: typeof run.head_sha === "string" ? run.head_sha.slice(0, 40) : null,
        lastDeploymentSuccessAt: success ? run.updated_at : state.lastDeploymentSuccessAt,
        lastDeploymentFailureAt: terminal && !success ? run.updated_at : state.lastDeploymentFailureAt,
        lastDeploymentFailureCode: terminal && !success ? "MMR_DEPLOY_FAILED" : state.lastDeploymentFailureCode
    };
    if (success) state.verification = await verifyMmr(env);
    await writeState(env, state);
    return publicState(state);
}

export const MMR_DEPLOY_TARGET = TARGET;
