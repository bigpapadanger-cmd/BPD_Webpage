"use strict";

/* =========================================================
BPD GAMING NETWORK
BACKGROUND AUTOMATION WORKER

File:
    workers/rl-presence-monitor/src/index.js

Purpose:
    Entry point for BPD background automation.

Routes:
    GET  /health
    POST /wake

Schedules:
    - Every 15 minutes:
          Rocket League presence monitoring.

    - Every Saturday:
          Inactive-player MMR refresh.

    - Once per day:
          Admin Taskboard aggregate summary.

Important:
    - /wake requires PRESENCE_TRIGGER_KEY.
    - Background jobs remain isolated in separate modules.
========================================================= */

import {
    runPresenceCycle
} from "./presence_cycle.js";

import {
    runScheduledMmrRefresh
} from "./scheduled_mmr.js";

import {
    runTaskboardSummary
} from "./taskboard_summary.js";

const activeJobs = new Set();
const PRESENCE_STATUS_KEY = "admin:service-status:rl-presence";

async function recordPresenceRun(env, summary, startedAt, failed = false) {
    if (!env?.SERVICE_STATUS) return;
    let prior = {};
    try { prior = await env.SERVICE_STATUS.get(PRESENCE_STATUS_KEY, "json") || {}; } catch { /* Best effort. */ }
    const now = new Date().toISOString();
    const succeeded = !failed && summary?.success !== false;
    const lastSummary = Object.fromEntries(["success", "skipped", "reason", "candidateCount", "checked", "failed", "anyOnline", "dormant"].filter(key => summary?.[key] !== undefined).map(key => [key, summary[key]]));
    try { await env.SERVICE_STATUS.put(PRESENCE_STATUS_KEY, JSON.stringify({ lastInvocationAt: now, lastSuccessAt: succeeded ? now : prior.lastSuccessAt || null, lastFailureAt: succeeded ? prior.lastFailureAt || null : now, lastDurationMs: Date.now() - startedAt, lastSummary }), { expirationTtl: 2592000 }); } catch { /* Telemetry must not change job behavior. */ }
}

/* =========================================================
CRON DEFINITIONS
========================================================= */

const PRESENCE_CRON =
    "*/15 * * * *";

const MMR_REFRESH_CRON =
    "5 11 * * SAT";

/*
Set this to the single UTC time you want the Taskboard
summary delivered each day.

Example:
    "0 12 * * *"
        12:00 UTC daily.
*/
const TASKBOARD_SUMMARY_CRON =
    "0 12 * * *";

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

/* =========================================================
WAKE AUTHORIZATION
========================================================= */

function isWakeAuthorized(
    request,
    env
) {
    const expected =
        normalizeString(
            env?.PRESENCE_TRIGGER_KEY
        );

    if (
        !expected
    ) {
        return false;
    }

    const provided =
        normalizeString(
            request.headers.get(
                "Authorization"
            )
        );

    return provided ===
        `Bearer ${expected}`;
}

function getJobRunner(job, env) {
    if (job === "presence") {
        return () => runPresenceCycle(env, { force: true });
    }
    if (job === "mmr") {
        return () => runScheduledMmrRefresh(env);
    }
    if (job === "taskboard") {
        return () => runTaskboardSummary(env);
    }
    return null;
}

function summarizeJobResult(job, result) {
    if (job === "presence") {
        return Object.fromEntries(
            ["success", "skipped", "reason", "candidateCount", "checked", "failed", "anyOnline", "dormant"]
                .filter(key => result?.[key] !== undefined)
                .map(key => [key, result[key]])
        );
    }
    if (job === "mmr") {
        return Object.fromEntries(
            ["success", "candidateCount", "processedCount", "refreshedCount", "skippedCount", "failedCount"]
                .filter(key => result?.[key] !== undefined)
                .map(key => [key, result[key]])
        );
    }
    if (job === "taskboard") {
        return {
            success: result?.success === true,
            ...(result?.summary ? { summary: result.summary } : {})
        };
    }
    return { success: false };
}

async function executeJob(job, env) {
    const run = getJobRunner(job, env);
    if (!run) {
        throw new Error("UNKNOWN_BACKGROUND_JOB");
    }
    if (activeJobs.has(job)) {
        const error = new Error("BACKGROUND_JOB_ALREADY_RUNNING");
        error.code = "BACKGROUND_JOB_ALREADY_RUNNING";
        throw error;
    }

    activeJobs.add(job);
    const startedAt = Date.now();
    console.info("BPD BACKGROUND WORKER: Job started.", { job });
    try {
        const result = await run();
        const summary = summarizeJobResult(job, result);
        if (job === "presence") await recordPresenceRun(env, summary, startedAt);
        console.info("BPD BACKGROUND WORKER: Job completed.", {
            job,
            durationMs: Date.now() - startedAt,
            ...summary
        });
        return summary;
    }
    catch (error) {
        if (job === "presence") await recordPresenceRun(env, { success: false, failed: 1 }, startedAt, true);
        console.error("BPD BACKGROUND WORKER: Job failed.", {
            job,
            durationMs: Date.now() - startedAt,
            code: error?.code || "BACKGROUND_JOB_FAILED",
            status: Number.isInteger(error?.status) ? error.status : null
        });
        throw error;
    }
    finally {
        activeJobs.delete(job);
    }
}

function runInBackground(job, env, ctx) {
    ctx.waitUntil(
        executeJob(job, env).catch(() => undefined)
    );
}

/* =========================================================
FETCH HANDLER
========================================================= */

async function handleFetch(
    request,
    env,
    ctx
) {
    const url =
        new URL(
            request.url
        );

    if (
        request.method === "GET"
        && url.pathname === "/health"
    ) {
        return Response.json({
            success:
                true,

            service:
                "bpd-rl-presence-monitor"
        });
    }

    if (request.method === "GET" && url.pathname === "/admin/health") {
        if (!isWakeAuthorized(request, env)) return Response.json({ success: false, code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        let state = null;
        try { state = await env?.SERVICE_STATUS?.get(PRESENCE_STATUS_KEY, "json") || null; } catch { /* Safe unknown fallback. */ }
        const lastSuccessAt = state?.lastSuccessAt || null;
        const lastFailureAt = state?.lastFailureAt || null;
        return Response.json({ success: true, service: "bpd-rl-presence-monitor", status: !state ? "unknown" : lastFailureAt && (!lastSuccessAt || lastFailureAt >= lastSuccessAt) ? "degraded" : "healthy", checkedAt: new Date().toISOString(), lastInvocationAt: state?.lastInvocationAt || null, lastSuccessAt, lastFailureAt, lastDurationMs: Number.isFinite(state?.lastDurationMs) ? state.lastDurationMs : null, lastSummary: state?.lastSummary || null, configuration: { supabaseUrlPresent: Boolean(String(env?.SUPABASE_URL || "").trim()), supabaseCredentialPresent: Boolean(String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH || "").trim()), mmrApiUrlPresent: Boolean(String(env?.MMR_API_URL || "").trim()) } }, { headers: { "Cache-Control": "no-store" } });
    }

    if (
        request.method === "POST"
        && url.pathname === "/wake"
    ) {
        if (
            !isWakeAuthorized(
                request,
                env
            )
        ) {
            return Response.json(
                {
                    success:
                        false,

                    code:
                        "UNAUTHORIZED"
                },
                {
                    status:
                        401
                }
            );
        }

        runInBackground("presence", env, ctx);

        return Response.json({
            success:
                true,

            accepted:
                true
        });
    }

    if (
        request.method === "POST"
        && url.pathname === "/admin/run-scheduled"
    ) {
        if (!isWakeAuthorized(request, env)) {
            return Response.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
        }

        const contentLength = Number(request.headers.get("Content-Length"));
        if (Number.isFinite(contentLength) && contentLength > 128) {
            return Response.json({ success: false, code: "INVALID_JOB" }, { status: 400 });
        }

        let body;
        try {
            const text = await request.text();
            if (text.length > 128) {
                throw new Error("BODY_TOO_LARGE");
            }
            body = JSON.parse(text);
        }
        catch {
            return Response.json({ success: false, code: "INVALID_JOB" }, { status: 400 });
        }

        const job = body?.job;
        if (!["presence", "mmr", "taskboard"].includes(job)) {
            return Response.json({ success: false, code: "INVALID_JOB" }, { status: 400 });
        }
        if (activeJobs.has(job)) {
            return Response.json({ success: false, code: "JOB_ALREADY_RUNNING" }, { status: 409 });
        }

        try {
            const summary = await executeJob(job, env);
            return Response.json({ success: summary.success !== false, job, summary });
        }
        catch {
            return Response.json({ success: false, job, code: "BACKGROUND_JOB_FAILED" }, { status: 502 });
        }
    }

    return Response.json(
        {
            success:
                false,

            code:
                "NOT_FOUND"
        },
        {
            status:
                404
        }
    );
}

/* =========================================================
SCHEDULED HANDLER
========================================================= */

async function handleScheduled(
    controller,
    env,
    ctx
) {
    if (
        controller.cron ===
        PRESENCE_CRON
    ) {
        runInBackground("presence", env, ctx);

        return;
    }

    if (
        controller.cron ===
        MMR_REFRESH_CRON
    ) {
        runInBackground("mmr", env, ctx);

        return;
    }

    if (
        controller.cron ===
        TASKBOARD_SUMMARY_CRON
    ) {
        runInBackground("taskboard", env, ctx);

        return;
    }

    console.warn(
        "BPD BACKGROUND WORKER: Unknown cron trigger.",
        {
            cron:
                controller.cron
        }
    );
}

/* =========================================================
WORKER EXPORT
========================================================= */

export default {
    fetch:
        handleFetch,

    scheduled:
        handleScheduled
};

export { handleFetch, handleScheduled };
