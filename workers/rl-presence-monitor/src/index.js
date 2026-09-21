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

        ctx.waitUntil(
            runPresenceCycle(
                env,
                {
                    force:
                        true
                }
            )
        );

        return Response.json({
            success:
                true,

            accepted:
                true
        });
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
        ctx.waitUntil(
            runPresenceCycle(
                env
            )
        );

        return;
    }

    if (
        controller.cron ===
        MMR_REFRESH_CRON
    ) {
        ctx.waitUntil(
            runScheduledMmrRefresh(
                env
            )
        );

        return;
    }

    if (
        controller.cron ===
        TASKBOARD_SUMMARY_CRON
    ) {
        ctx.waitUntil(
            runTaskboardSummary(
                env
            )
        );

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