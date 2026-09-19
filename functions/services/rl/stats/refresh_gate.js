"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE MMR REFRESH GATE

File:
    functions/services/rl/stats/refresh_gate.js

Purpose:
    Uses Cloudflare KV to avoid unnecessary database refresh
    checks during normal Rocket League page activity.

Description:
    - Uses the dedicated RL_STATS_CACHE KV namespace.
    - Stores one temporary MMR refresh gate per BPD account.
    - Allows normal page activity to skip Supabase refresh
      checks while the gate is active.
    - Automatically allows the authoritative refresh path
      again when the KV entry expires.

Important:
    - KV is an optimization only.
    - Supabase remains authoritative for actual refresh timing.
    - Missing or unavailable KV state allows refreshStats()
      to perform its normal server-side eligibility check.
    - KV failures must not grant or deny Rocket League access.
    - This service stores no provider credentials or secrets.
========================================================= */

import {
    REFRESH_GATE_TTL_SECONDS
} from "../../config/api_vars.js";

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
GATE KEY
========================================================= */

function getGateKey(
    accountId
) {
    return `mmr-refresh-gate:${accountId}`;
}

/* =========================================================
GET REFRESH GATE
========================================================= */

export async function getMmrRefreshGate(
    env,
    accountId
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        return null;
    }

    if (
        !env?.RL_STATS_CACHE
    ) {
        return null;
    }

    const key =
        getGateKey(
            normalizedAccountId
        );

    try {
        const value =
            await env.RL_STATS_CACHE.get(
                key,
                "json"
            );

        if (
            !value
            || typeof value !==
                "object"
            || Array.isArray(
                value
            )
        ) {
            return null;
        }

        return value;
    }
    catch (
        error
    ) {
        console.warn(
            "MMR REFRESH GATE: KV read failed.",
            {
                accountId:
                    normalizedAccountId,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return null;
    }
}

/* =========================================================
HAS REFRESH GATE
========================================================= */

export async function hasMmrRefreshGate(
    env,
    accountId
) {
    const gate =
        await getMmrRefreshGate(
            env,
            accountId
        );

    return Boolean(
        gate
    );
}

/* =========================================================
SET REFRESH GATE
========================================================= */

export async function setMmrRefreshGate(
    env,
    accountId,
    {
        reason = null,
        refreshedAt = null,
        ttlSeconds = REFRESH_GATE_TTL_SECONDS
    } = {}
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        return false;
    }

    if (
        !env?.RL_STATS_CACHE
    ) {
        return false;
    }

    const normalizedTtlSeconds =
        Math.floor(
            Number(
                ttlSeconds
            )
        );

    if (
        !Number.isInteger(
            normalizedTtlSeconds
        )
        || normalizedTtlSeconds < 60
    ) {
        console.error(
            "MMR REFRESH GATE: Invalid refresh gate TTL.",
            {
                accountId:
                    normalizedAccountId,

                ttlSeconds
            }
        );

        return false;
    }

    const key =
        getGateKey(
            normalizedAccountId
        );

    const createdAt =
        Date.now();

    const expiresAt =
        createdAt
        + (
            normalizedTtlSeconds
            * 1000
        );

    const payload = {
        accountId:
            normalizedAccountId,

        createdAt,

        expiresAt,

        reason:
            normalizeString(
                reason
            )
            || null,

        refreshedAt:
            normalizeString(
                refreshedAt
            )
            || null
    };

    try {
        await env.RL_STATS_CACHE.put(
            key,
            JSON.stringify(
                payload
            ),
            {
                expirationTtl:
                    normalizedTtlSeconds
            }
        );

        console.info(
            "MMR REFRESH GATE: Gate stored.",
            {
                accountId:
                    normalizedAccountId,

                expiresAt,

                ttlSeconds:
                    normalizedTtlSeconds,

                reason:
                    payload.reason
            }
        );

        return true;
    }
    catch (
        error
    ) {
        console.warn(
            "MMR REFRESH GATE: KV write failed.",
            {
                accountId:
                    normalizedAccountId,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return false;
    }
}
/* =========================================================
CLEAR REFRESH GATE
========================================================= */

export async function clearMmrRefreshGate(
    env,
    accountId
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
        || !env?.RL_STATS_CACHE
    ) {
        return false;
    }

    try {
        await env.RL_STATS_CACHE.delete(
            getGateKey(
                normalizedAccountId
            )
        );

        console.info(
            "MMR REFRESH GATE: Gate cleared.",
            {
                accountId:
                    normalizedAccountId
            }
        );

        return true;
    }
    catch (
        error
    ) {
        console.warn(
            "MMR REFRESH GATE: KV delete failed.",
            {
                accountId:
                    normalizedAccountId,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return false;
    }
}