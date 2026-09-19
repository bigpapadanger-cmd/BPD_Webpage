"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE LATEST MMR SERVICE

File:
    functions/services/rl/stats/latest_mmr.js

Purpose:
    Resolves the latest known Rocket League MMR for a BPD
    account using Cloudflare KV as the primary read cache
    and Supabase as the authoritative source.

Flow:
    1. Read persistent latest-MMR cache from RL_STATS_CACHE.
    2. If cache exists and verification is not due:
       - return KV immediately.
       - do not query Supabase.
    3. If cache is missing or verification is due:
       - query Supabase for the latest snapshot.
    4. If Supabase succeeds:
       - update KV.
       - return authoritative snapshot.
    5. If Supabase fails:
       - return existing KV as stale fallback when available.

Important:
    - Supabase remains authoritative.
    - KV is persistent last-known state.
    - Existing KV is never deleted because Supabase is
      temporarily unavailable.
    - Normal profile reads should cause at most one latest
      snapshot Supabase verification per interval.
========================================================= */

import {
    getLatestMmrCache,
    setLatestMmrCache
} from "./latest_cache.js";

import {
    getLatestRocketLeagueMmrSnapshot
} from "../../supabase/rocketleague/get_latest_mmr.js";

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
FORMAT RESULT
========================================================= */

function buildResult(
    data,
    {
        source,
        stale,
        verified
    }
) {
    if (
        !data
    ) {
        return {
            available:
                false,

            stale:
                false,

            verified:
                false,

            source:
                source
                || null,

            capturedAt:
                null,

            rlPlayerId:
                null,

            epicAccountId:
                null,

            snapshotId:
                null,

            ones: {
                mmr:
                    null,

                tier:
                    null
            },

            twos: {
                mmr:
                    null,

                tier:
                    null
            },

            threes: {
                mmr:
                    null,

                tier:
                    null
            }
        };
    }

    return {
        available:
            true,

        stale:
            stale ===
            true,

        verified:
            verified ===
            true,

        source:
            source,

        capturedAt:
            data.capturedAt
            || null,

        verifiedAt:
            data.verifiedAt
            || null,

        rlPlayerId:
            data.rlPlayerId
            || null,

        epicAccountId:
            data.epicAccountId
            || null,

        snapshotId:
            data.snapshotId
            || null,

        ones: {
            mmr:
                data?.ones?.mmr
                ?? null,

            tier:
                data?.ones?.tier
                || null
        },

        twos: {
            mmr:
                data?.twos?.mmr
                ?? null,

            tier:
                data?.twos?.tier
                || null
        },

        threes: {
            mmr:
                data?.threes?.mmr
                ?? null,

            tier:
                data?.threes?.tier
                || null
        }
    };
}

/* =========================================================
LATEST MMR
========================================================= */

export async function getLatestMmr(
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
        const error =
            new Error(
                "Account ID is required."
            );

        error.code =
            "ACCOUNT_ID_REQUIRED";

        error.status =
            400;

        throw error;
    }

    /* =====================================================
    KV CACHE
    ===================================================== */

    const cached =
        await getLatestMmrCache(
            env,
            normalizedAccountId
        );

    if (
        cached
        && cached.verificationDue !==
            true
    ) {
        console.info(
            "LATEST MMR: Returning verified KV cache.",
            {
                accountId:
                    normalizedAccountId,

                capturedAt:
                    cached.capturedAt,

                verifiedAt:
                    cached.verifiedAt
            }
        );

        return buildResult(
            cached,
            {
                source:
                    "kv-cache",

                stale:
                    false,

                verified:
                    true
            }
        );
    }

    console.info(
        "LATEST MMR: Supabase verification required.",
        {
            accountId:
                normalizedAccountId,

            cacheExists:
                Boolean(
                    cached
                ),

            verificationDue:
                cached
                    ?.verificationDue ===
                true
        }
    );

    /* =====================================================
    SUPABASE AUTHORITATIVE READ
    ===================================================== */

    try {
        const snapshot =
            await getLatestRocketLeagueMmrSnapshot(
                env,
                normalizedAccountId
            );

        if (
            !snapshot
        ) {
            /*
             * No authoritative snapshot currently exists.
             *
             * If KV already contains a historical snapshot,
             * preserve it rather than deleting useful
             * last-known data.
             */
            if (
                cached
            ) {
                console.warn(
                    "LATEST MMR: Supabase returned no snapshot; preserving KV fallback.",
                    {
                        accountId:
                            normalizedAccountId,

                        capturedAt:
                            cached.capturedAt
                    }
                );

                return buildResult(
                    cached,
                    {
                        source:
                            "kv-cache",

                        stale:
                            true,

                        verified:
                            false
                    }
                );
            }

            return buildResult(
                null,
                {
                    source:
                        "supabase",

                    stale:
                        false,

                    verified:
                        true
                }
            );
        }

        const verifiedAt =
            new Date()
                .toISOString();

        await setLatestMmrCache(
            env,
            normalizedAccountId,
            {
                rlPlayerId:
                    snapshot.rlPlayerId,

                epicAccountId:
                    snapshot.epicAccountId,

                capturedAt:
                    snapshot.capturedAt,
                snapshotId:
                    snapshot.snapshotId,
                verifiedAt,

                ones:
                    snapshot.ones,

                twos:
                    snapshot.twos,

                threes:
                    snapshot.threes,

                source:
                    snapshot.source
            }
        );

        const resolved = {
            ...snapshot,

            verifiedAt
        };

        console.info(
            "LATEST MMR: Supabase snapshot verified and cached.",
            {
                accountId:
                    normalizedAccountId,

                snapshotId:
                    snapshot.snapshotId,

                capturedAt:
                    snapshot.capturedAt,

                verifiedAt
            }
        );

        return buildResult(
            resolved,
            {
                source:
                    "supabase",

                stale:
                    false,

                verified:
                    true
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "LATEST MMR: Supabase verification failed.",
            {
                accountId:
                    normalizedAccountId,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        /* =================================================
        STALE KV FALLBACK
        ================================================= */

        if (
            cached
        ) {
            console.warn(
                "LATEST MMR: Returning stale KV fallback.",
                {
                    accountId:
                        normalizedAccountId,

                    capturedAt:
                        cached.capturedAt,

                    verifiedAt:
                        cached.verifiedAt
                }
            );

            return buildResult(
                cached,
                {
                    source:
                        "kv-cache",

                    stale:
                        true,

                    verified:
                        false
                }
            );
        }

        throw error;
    }
}