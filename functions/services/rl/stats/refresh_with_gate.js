"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE GATED STATS REFRESH SERVICE

File:
    functions/services/rl/stats/refresh_with_gate.js

Purpose:
    Provides the lightweight entry point for Rocket League
    MMR refresh checks during normal website activity.

Flow:
    Request
        ↓
    Check RL_STATS_CACHE gate
        ↓
    Gate exists
        -> skip database/MMR work
        ↓
    Gate missing
        -> call refreshStats()
        ↓
    refreshStats() checks authoritative Supabase state
        ↓
    Appropriate results create a new KV gate

Important:
    - KV is an optimization only.
    - Supabase remains authoritative for actual refresh timing.
    - Missing KV never bypasses refreshStats() throttling.
    - A successful refresh receives a full refresh-window gate.
    - REFRESH_NOT_DUE receives only the remaining TTL until
      the authoritative 24-hour refresh window expires.
    - Refresh failures do not create a long-lived gate.
========================================================= */

import {
    REFRESH_GATE_TTL_SECONDS
} from "../../config/api_vars.js";

import {
    refreshStats
} from "./refresh.js";

import {
    getMmrRefreshGate,
    setMmrRefreshGate
} from "./refresh_gate.js";

/* =========================================================
CONSTANTS
========================================================= */

const MINIMUM_GATE_TTL_SECONDS =
    60;

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeTimestamp(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const numeric =
        Number(
            value
        );

    if (
        Number.isFinite(
            numeric
        )
        && numeric > 0
    ) {
        return numeric;
    }

    const parsed =
        Date.parse(
            String(
                value
            )
        );

    return Number.isFinite(
        parsed
    )
        ? parsed
        : null;
}

/* =========================================================
GATEABLE RESULT
========================================================= */

function shouldSetRefreshGate(
    result
) {
    return (
        result?.refreshed ===
            true
        || result?.reason ===
            "REFRESH_NOT_DUE"
    );
}

/* =========================================================
GATE TTL
========================================================= */

function getRefreshGateTtlSeconds(
    result,
    now = Date.now()
) {
    if (
        result?.refreshed ===
        true
    ) {
        return REFRESH_GATE_TTL_SECONDS;
    }

    if (
        result?.reason !==
        "REFRESH_NOT_DUE"
    ) {
        return null;
    }

    const lastRefreshAt =
        normalizeTimestamp(
            result?.lastRefreshAt
        );

    if (
        lastRefreshAt ===
        null
    ) {
        return null;
    }

    const refreshWindowMs =
        REFRESH_GATE_TTL_SECONDS
        * 1000;

    const refreshDueAt =
        lastRefreshAt
        + refreshWindowMs;

    const remainingMs =
        refreshDueAt
        - now;

    if (
        remainingMs <= 0
    ) {
        return null;
    }

    return Math.max(
        MINIMUM_GATE_TTL_SECONDS,
        Math.ceil(
            remainingMs
            / 1000
        )
    );
}

/* =========================================================
GATED REFRESH
========================================================= */

export async function refreshStatsWithGate(
    env,
    accountId
) {
    const existingGate =
        await getMmrRefreshGate(
            env,
            accountId
        );

    if (
        existingGate
    ) {
        console.info(
            "STATS REFRESH: KV gate active.",
            {
                accountId,

                expiresAt:
                    existingGate.expiresAt
                    || null,

                reason:
                    existingGate.reason
                    || null
            }
        );

        return {
            success:
                true,

            refreshed:
                false,

            gated:
                true,

            reason:
                "KV_GATE_ACTIVE",

            gate:
                existingGate
        };
    }

    console.info(
        "STATS REFRESH: KV gate missing.",
        {
            accountId
        }
    );

    const result =
        await refreshStats(
            env,
            accountId
        );

    if (
        shouldSetRefreshGate(
            result
        )
    ) {
        const ttlSeconds =
            getRefreshGateTtlSeconds(
                result
            );

        if (
            ttlSeconds !==
            null
        ) {
            await setMmrRefreshGate(
                env,
                accountId,
                {
                    reason:
                        result?.refreshed ===
                            true
                            ? "REFRESH_COMPLETED"
                            : result?.reason,

                    refreshedAt:
                        result?.refreshedAt
                        || result?.lastRefreshAt
                        || null,

                    ttlSeconds
                }
            );

            console.info(
                "STATS REFRESH: KV gate created.",
                {
                    accountId,

                    refreshed:
                        result?.refreshed ===
                        true,

                    reason:
                        result?.reason
                        || (
                            result?.refreshed ===
                                true
                                ? "REFRESH_COMPLETED"
                                : null
                        ),

                    ttlSeconds
                }
            );
        }
    }

    return {
        ...result,

        gated:
            false
    };
}