"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE LATEST MMR CACHE

File:
    functions/services/rl/stats/latest_cache.js

Purpose:
    Stores and retrieves the latest known Rocket League MMR
    snapshot from Cloudflare KV.

Storage:
    RL_STATS_CACHE

Key:
    mmr-latest:<accountId>

Design:
    - The latest MMR cache does NOT expire.
    - Supabase remains the authoritative persistent store.
    - KV provides fast reads and outage resilience.
    - verifiedAt records when Supabase was last successfully
      checked for the latest snapshot.
    - capturedAt records when the MMR snapshot itself was
      captured.

Important:
    - KV is not authoritative history.
    - Supabase retains all historical snapshots.
    - A Supabase outage must not delete valid cached MMR.
========================================================= */

import {
    LATEST_MMR_VERIFY_INTERVAL_SECONDS
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

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
}

function normalizeMmr(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const mmr =
        Number(
            value
        );

    if (
        !Number.isFinite(
            mmr
        )
    ) {
        return null;
    }

    return Math.round(
        mmr
    );
}

/* =========================================================
CACHE KEY
========================================================= */

function getLatestMmrKey(
    accountId
) {
    return `mmr-latest:${accountId}`;
}

/* =========================================================
CACHE AGE
========================================================= */

function getVerificationState(
    verifiedAt
) {
    const timestamp =
        Date.parse(
            normalizeString(
                verifiedAt
            )
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        return {
            verified:
                false,

            verificationDue:
                true,

            verifiedAt:
                null
        };
    }

    const ageMs =
        Date.now()
        - timestamp;

    const intervalMs =
        LATEST_MMR_VERIFY_INTERVAL_SECONDS
        * 1000;

    return {
        verified:
            true,

        verificationDue:
            ageMs >=
            intervalMs,

        verifiedAt:
            new Date(
                timestamp
            )
                .toISOString()
    };
}

/* =========================================================
GET LATEST MMR CACHE
========================================================= */

export async function getLatestMmrCache(
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
        return null;
    }

    try {
        const value =
            await env.RL_STATS_CACHE.get(
                getLatestMmrKey(
                    normalizedAccountId
                ),
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

        const verification =
            getVerificationState(
                value.verifiedAt
            );

        return {
            accountId:
                normalizedAccountId,

            rlPlayerId:
                normalizeNullableString(
                    value.rlPlayerId
                ),

            epicAccountId:
                normalizeNullableString(
                    value.epicAccountId
                ),

            capturedAt:
                normalizeNullableString(
                    value.capturedAt
                ),
            snapshotId:
                normalizeNullableString(
                    value.snapshotId
                ),
            verifiedAt:
                verification.verifiedAt,

            verificationDue:
                verification.verificationDue,

            ones: {
                mmr:
                    normalizeMmr(
                        value?.ones?.mmr
                    ),

                tier:
                    normalizeNullableString(
                        value?.ones?.tier
                    )
            },

            twos: {
                mmr:
                    normalizeMmr(
                        value?.twos?.mmr
                    ),

                tier:
                    normalizeNullableString(
                        value?.twos?.tier
                    )
            },

            threes: {
                mmr:
                    normalizeMmr(
                        value?.threes?.mmr
                    ),

                tier:
                    normalizeNullableString(
                        value?.threes?.tier
                    )
            },

            source:
                normalizeNullableString(
                    value.source
                )
                || "unknown"
        };
    }
    catch (
        error
    ) {
        console.warn(
            "LATEST MMR CACHE: KV read failed.",
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
SET LATEST MMR CACHE
========================================================= */

export async function setLatestMmrCache(
    env,
    accountId,
    {
        rlPlayerId = null,
        epicAccountId = null,
        capturedAt = null,
        snapshotId = null,
        ones = null,
        twos = null,
        threes = null,
        source = "mmr-api-v2",
        verifiedAt = null
    } = {}
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

    const payload = {
        accountId:
            normalizedAccountId,

        rlPlayerId:
            normalizeNullableString(
                rlPlayerId
            ),

        epicAccountId:
            normalizeNullableString(
                epicAccountId
            ),

        capturedAt:
            normalizeNullableString(
                capturedAt
            ),
        snapshotId:
            normalizeNullableString(
                snapshotId
            ),
        verifiedAt:
            normalizeNullableString(
                verifiedAt
            )
            || new Date()
                .toISOString(),

        ones: {
            mmr:
                normalizeMmr(
                    ones?.mmr
                ),

            tier:
                normalizeNullableString(
                    ones?.tier
                )
        },

        twos: {
            mmr:
                normalizeMmr(
                    twos?.mmr
                ),

            tier:
                normalizeNullableString(
                    twos?.tier
                )
        },

        threes: {
            mmr:
                normalizeMmr(
                    threes?.mmr
                ),

            tier:
                normalizeNullableString(
                    threes?.tier
                )
        },

        source:
            normalizeNullableString(
                source
            )
            || "mmr-api-v2"
    };

    try {
        /*
         * Deliberately no expirationTtl.
         *
         * This record remains available as the user's
         * last-known MMR during temporary upstream outages.
         */
        await env.RL_STATS_CACHE.put(
            getLatestMmrKey(
                normalizedAccountId
            ),
            JSON.stringify(
                payload
            )
        );

        console.info(
            "LATEST MMR CACHE: Cache stored.",
            {
                accountId:
                    normalizedAccountId,

                rlPlayerId:
                    payload.rlPlayerId,

                capturedAt:
                    payload.capturedAt,

                verifiedAt:
                    payload.verifiedAt
            }
        );

        return true;
    }
    catch (
        error
    ) {
        console.warn(
            "LATEST MMR CACHE: KV write failed.",
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
CLEAR LATEST MMR CACHE
========================================================= */

export async function clearLatestMmrCache(
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
            getLatestMmrKey(
                normalizedAccountId
            )
        );

        return true;
    }
    catch (
        error
    ) {
        console.warn(
            "LATEST MMR CACHE: KV delete failed.",
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