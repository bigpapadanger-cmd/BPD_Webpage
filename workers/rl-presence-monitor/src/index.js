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

    - Every hour:
          Due-aware per-player Rocket League refresh, global Shop snapshot, and
          Admin health checks for Supabase, MMR API, provider-runtime, and MatchBot.

    - Daily at noon UTC:
          Admin Taskboard aggregate summary and global ranked Leaderboard snapshots.

Important:
    - /wake requires PRESENCE_TRIGGER_KEY.
    - Background jobs remain isolated in separate modules.
========================================================= */

import {
    runPresenceCycle
} from "./presence_cycle.js";

import {
    runRocketLeagueRefreshCycle
} from "./rl_refresh_cycle.js";

import {
    runRocketLeagueShopRefresh
} from "./rl_shop_refresh.js";
import { refreshGlobalRocketLeagueLeaderboards } from "./rl_global_leaderboards.js";
import { runScheduledAdminHealthChecks } from "../../../functions/services/admin/system_status.js";


const activeJobs = new Set();
const PRESENCE_STATUS_KEY = "admin:service-status:rl-presence";

async function recordScheduledJob(env, job, summary, startedAt, failed = false) {
    if (!env?.SERVICE_STATUS || !["mmr", "shop", "leaderboards", "health"].includes(job)) return;
    const key = `admin:service-status:rl-${job}`;
    let prior = {};
    try { prior = await env.SERVICE_STATUS.get(key, "json") || {}; } catch { /* Best effort. */ }
    const now = new Date().toISOString();
    const succeeded = !failed && summary?.success !== false;
    const selected = job === "health"
        ? ["success", "checked", "healthy", "degraded", "down", "unknown"]
        : job === "shop"
            ? ["success", "changed", "saved", "errorCode"]
            : job === "leaderboards" ? ["success", "playlistCount", "succeeded", "failed", "errorCode"]
            : ["success", "candidateCount", "attempted", "succeeded", "failed", "mmrChanged", "mmrUnchanged", "discordInventoryAvailable", "discordInventoryError", "nextCursorStored"];
    const lastSummary = Object.fromEntries(selected.filter(field => summary?.[field] !== undefined).map(field => [field, summary[field]]));
    try {
        await env.SERVICE_STATUS.put(key, JSON.stringify({
            lastInvocationAt: now,
            lastSuccessAt: succeeded ? now : prior.lastSuccessAt || null,
            lastFailureAt: succeeded ? prior.lastFailureAt || null : now,
            lastDurationMs: Date.now() - startedAt,
            lastSummary
        }), { expirationTtl: 2592000 });
    } catch { /* Telemetry must not change job behavior. */ }
}

async function recordPresenceRun(env, summary, startedAt, failed = false) {
    if (!env?.SERVICE_STATUS) return;
    let prior = {};
    try { prior = await env.SERVICE_STATUS.get(PRESENCE_STATUS_KEY, "json") || {}; } catch { /* Best effort. */ }
    const now = new Date().toISOString();
    const succeeded = !failed && summary?.success !== false;
    const lastSummary = Object.fromEntries(["success", "skipped", "skippedCount", "reason", "candidateCount", "checked", "failed", "anyOnline", "dormant"].filter(key => summary?.[key] !== undefined).map(key => [key, summary[key]]));
    try { await env.SERVICE_STATUS.put(PRESENCE_STATUS_KEY, JSON.stringify({ lastInvocationAt: now, lastSuccessAt: succeeded ? now : prior.lastSuccessAt || null, lastFailureAt: succeeded ? prior.lastFailureAt || null : now, lastDurationMs: Date.now() - startedAt, lastSummary }), { expirationTtl: 2592000 }); } catch { /* Telemetry must not change job behavior. */ }
}

/* =========================================================
CRON DEFINITIONS
========================================================= */

const PRESENCE_CRON =
    "*/15 * * * *";

const ROCKET_LEAGUE_REFRESH_CRON =
    "0 * * * *";

const LEADERBOARD_REFRESH_UTC_HOUR = 12;

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

function getJobRunner(job, env, { forceDiscordInventory = false, reconcileDiscordInventory = false } = {}) {
    if (job === "presence") {
        return () => runPresenceCycle(env, { force: true });
    }
    if (job === "mmr") {
        return () => runRocketLeagueRefreshCycle(env, { forceDiscordInventory, reconcileDiscordInventory });
    }
    if (job === "shop") {
        return () => runRocketLeagueShopRefresh(env);
    }
    if (job === "leaderboards") return () => refreshGlobalRocketLeagueLeaderboards(env);
    if (job === "taskboard") {
        return () => ({ success: false, skipped: true, reason: "MOVED_TO_DISCORD_COMMUNICATIONS" });
    }
    if (job === "health") return () => runScheduledAdminHealthChecks(env);
    return null;
}

function summarizeJobResult(job, result) {
    if (job === "presence") {
        return Object.fromEntries(
            ["success", "skipped", "skippedCount", "reason", "candidateCount", "checked", "failed", "anyOnline", "dormant"]
                .filter(key => result?.[key] !== undefined)
                .map(key => [key, result[key]])
        );
    }
    if (job === "mmr") {
        return Object.fromEntries(
            ["success", "candidateCount", "attempted", "succeeded", "failed", "mmrChanged", "mmrUnchanged", "discordInventoryAvailable", "discordInventoryError", "cursorReset", "nextCursorStored"]
                .filter(key => result?.[key] !== undefined)
                .map(key => [key, result[key]])
        );
    }
    if (job === "shop") {
        return Object.fromEntries(
            ["success", "changed", "saved", "errorCode"]
                .filter(key => result?.[key] !== undefined)
                .map(key => [key, result[key]])
        );
    }
    if (job === "leaderboards") {
        return { success: result?.success === true, playlistCount: result?.playlistCount || 0,
            succeeded: result?.succeeded || 0, failed: result?.failed || 0 };
    }
    if (job === "taskboard") {
        return {
            success: result?.success === true,
            ...(result?.summary ? { summary: result.summary } : {})
        };
    }
    if (job === "health") return {
        success: result?.success === true,
        checked: Number(result?.checked) || 0,
        healthy: Number(result?.healthy) || 0,
        degraded: Number(result?.degraded) || 0,
        down: Number(result?.down) || 0,
        unknown: Number(result?.unknown) || 0
    };
    return { success: false };
}

async function executeJob(job, env, options = {}) {
    const run = getJobRunner(job, env, options);
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
        await recordScheduledJob(env, job, summary, startedAt);
        console.info("BPD BACKGROUND WORKER: Job completed.", {
            job,
            durationMs: Date.now() - startedAt,
            ...summary
        });
        return summary;
    }
    catch (error) {
        if (job === "presence") await recordPresenceRun(env, { success: false, failed: 1 }, startedAt, true);
        await recordScheduledJob(env, job, { success: false, errorCode: error?.code || "BACKGROUND_JOB_FAILED" }, startedAt, true);
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

function runInBackground(job, env, ctx, options = {}) {
    ctx.waitUntil(
        executeJob(job, env, options).catch(() => undefined)
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
        const scheduledJobs = {};
        for (const job of ["mmr", "shop", "leaderboards", "health"]) {
            try { scheduledJobs[job] = await env?.SERVICE_STATUS?.get(`admin:service-status:rl-${job}`, "json") || null; }
            catch { scheduledJobs[job] = null; }
        }
        const lastSuccessAt = state?.lastSuccessAt || null;
        const lastFailureAt = state?.lastFailureAt || null;
        return Response.json({ success: true, service: "bpd-rl-presence-monitor", status: !state ? "unknown" : lastFailureAt && (!lastSuccessAt || lastFailureAt >= lastSuccessAt) ? "degraded" : "healthy", checkedAt: new Date().toISOString(), lastInvocationAt: state?.lastInvocationAt || null, lastSuccessAt, lastFailureAt, lastDurationMs: Number.isFinite(state?.lastDurationMs) ? state.lastDurationMs : null, lastSummary: state?.lastSummary || null, scheduledJobs, configuration: { supabaseUrlPresent: Boolean(String(env?.SUPABASE_URL || "").trim()), supabaseCredentialPresent: Boolean(String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH || "").trim()), mmrApiUrlPresent: Boolean(String(env?.MMR_API_URL || "").trim()) } }, { headers: { "Cache-Control": "no-store" } });
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
        if (!["presence", "mmr", "shop", "leaderboards", "taskboard"].includes(job)) {
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
        ROCKET_LEAGUE_REFRESH_CRON
    ) {
        runInBackground("mmr", env, ctx, { forceDiscordInventory: true, reconcileDiscordInventory: true });
        runInBackground("shop", env, ctx);
        runInBackground("health", env, ctx);

        const scheduledAt = Number(controller.scheduledTime);
        if (Number.isFinite(scheduledAt) && new Date(scheduledAt).getUTCHours() === LEADERBOARD_REFRESH_UTC_HOUR) {
            runInBackground("leaderboards", env, ctx);
        }

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
