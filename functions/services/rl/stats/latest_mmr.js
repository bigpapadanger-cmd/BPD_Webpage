"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE LATEST MMR SERVICE

File:
    functions/services/rl/stats/latest_mmr.js

Purpose:
    Reads the latest successful Supabase snapshot from the hourly collector.
    Cloudflare KV retains last-known data for database outages only.

Flow:
    1. Read persistent latest-MMR fallback from RL_STATS_CACHE.
    2. Query Supabase for the latest snapshot on each profile read.
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
    - Normal reads never call the provider or collect another snapshot.
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

    // The hourly scheduler persists independently of website activity. Always
    // read its latest successful snapshot; KV is outage fallback only.

    console.info(
        "LATEST MMR: Supabase verification required.",
        {

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

                code: "MMR_READ_UNAVAILABLE",

                status:
                    error?.status
                    || null,
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
