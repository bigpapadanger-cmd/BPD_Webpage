"use strict";

/* =========================================================
BPD GAMING NETWORK
SCHEDULED ROCKET LEAGUE MMR REFRESH

File:
    workers/rl-presence-monitor/src/scheduled_mmr.js

Purpose:
    Performs the Saturday MMR refresh for eligible Rocket
    League players who have not been seen for at least
    seven days.

Policy:
    - BPD account must be active.
    - Rocket League player must be active.
    - Registration must be complete.
    - Epic identity must be active and match the RL player.
    - Account must have been inactive for at least 7 days.
    - MMR must not have refreshed within the last 24 hours.
    - Candidate eligibility is checked again before each
      MMR API request.
    - Players are processed in batches of 5.
    - Batches are separated by 30 seconds to preserve
      MMR API rate-limit headroom for presence requests.
========================================================= */

const BATCH_SIZE =
    5;

const BATCH_DELAY_MS =
    30000;

const REQUEST_TIMEOUT_MS =
    15000;

const DAY_MS =
    24 * 60 * 60 * 1000;

const INACTIVE_AFTER_MS =
    7 * DAY_MS;

const PLAYLIST_IDS = {
    ones:
        10,

    twos:
        11,

    threes:
        13
};

const TIER_NAMES = {
    0: "Unranked",
    1: "Bronze I",
    2: "Bronze II",
    3: "Bronze III",
    4: "Silver I",
    5: "Silver II",
    6: "Silver III",
    7: "Gold I",
    8: "Gold II",
    9: "Gold III",
    10: "Platinum I",
    11: "Platinum II",
    12: "Platinum III",
    13: "Diamond I",
    14: "Diamond II",
    15: "Diamond III",
    16: "Champion I",
    17: "Champion II",
    18: "Champion III",
    19: "Grand Champion I",
    20: "Grand Champion II",
    21: "Grand Champion III",
    22: "Supersonic Legend"
};

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
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

function normalizeDate(
    value
) {
    if (
        !value
    ) {
        return null;
    }

    const timestamp =
        Date.parse(
            value
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
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

    const number =
        Number(
            value
        );

    if (
        !Number.isFinite(
            number
        )
    ) {
        return null;
    }

    const rounded =
        Math.round(
            number
        );

    if (
        rounded < 0
        || rounded > 5000
    ) {
        return null;
    }

    return rounded;
}

function normalizeTier(
    value
) {
    const number =
        Number(
            value
        );

    if (
        !Number.isInteger(
            number
        )
    ) {
        return null;
    }

    return TIER_NAMES[number]
        || null;
}

function sleep(
    milliseconds
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}

/* =========================================================
SUPABASE
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const url =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !url
        || !apiKey
    ) {
        const error =
            new Error(
                "Supabase configuration is unavailable."
            );

        error.code =
            "SUPABASE_CONFIGURATION_MISSING";

        throw error;
    }

    return {
        url:
            url.endsWith("/")
                ? url
                : `${url}/`,

        apiKey
    };
}

async function callRpc(
    env,
    rpcName,
    body = {}
) {
    const configuration =
        getSupabaseConfiguration(
            env
        );

    const url =
        new URL(
            `rpc/${rpcName}`,
            configuration.url
        );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "POST",

                headers: {
                    apikey:
                        configuration.apiKey,

                    Authorization:
                        `Bearer ${configuration.apiKey}`,

                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept-Profile":
                        "api"
                },

                body:
                    JSON.stringify(
                        body
                    )
            }
        );

    const responseText =
        await response.text();

    if (
        !response.ok
    ) {
        const error =
            new Error(
                `Supabase RPC failed: ${rpcName}`
            );

        error.code =
            "SUPABASE_RPC_FAILED";

        error.rpc =
            rpcName;

        error.status =
            response.status;

        error.response =
            responseText
                .replace(
                    /\s+/g,
                    " "
                )
                .slice(
                    0,
                    300
                );

        throw error;
    }

    if (
        !responseText
    ) {
        return null;
    }

    try {
        return JSON.parse(
            responseText
        );
    }
    catch {
        const error =
            new Error(
                `Supabase RPC returned invalid JSON: ${rpcName}`
            );

        error.code =
            "SUPABASE_RPC_INVALID_JSON";

        throw error;
    }
}

/* =========================================================
CANDIDATES
========================================================= */

async function getScheduledCandidates(
    env
) {
    const rows =
        await callRpc(
            env,
            "get_scheduled_mmr_refresh_accounts"
        );

    if (
        !Array.isArray(
            rows
        )
    ) {
        return [];
    }

    return rows
        .map(
            row => ({
                accountId:
                    normalizeString(
                        row?.account_id
                    ),

                rlPlayerId:
                    normalizeString(
                        row?.rl_player_id
                    ),

                epicAccountId:
                    normalizeString(
                        row?.epic_account_id
                    ),

                lastSeenAt:
                    normalizeNullableString(
                        row?.last_seen_at
                    ),

                lastRefreshAt:
                    normalizeNullableString(
                        row?.last_refresh_at
                    )
            })
        )
        .filter(
            row =>
                row.accountId
                && row.rlPlayerId
                && row.epicAccountId
        );
}

/* =========================================================
SECONDARY ELIGIBILITY CHECK
========================================================= */

async function getRefreshState(
    env,
    accountId
) {
    const rows =
        await callRpc(
            env,
            "get_stats_refresh_state",
            {
                p_account_id:
                    accountId
            }
        );

    const row =
        Array.isArray(
            rows
        )
            ? rows[0]
                || null
            : rows;

    if (
        !row
    ) {
        return null;
    }

    return {
        accountId:
            normalizeString(
                row.account_id
            ),

        rlPlayerId:
            normalizeString(
                row.rl_player_id
            ),

        active:
            row.active ===
            true,

        lastSeenAt:
            normalizeNullableString(
                row.last_seen_at
            ),

        lastRefreshAt:
            normalizeNullableString(
                row.last_refresh_at
            ),

        epicAccountId:
            normalizeString(
                row.epic_account_id
            )
    };
}

function getEligibility(
    candidate,
    state,
    now = Date.now()
) {
    if (
        !state
    ) {
        return {
            allowed:
                false,

            reason:
                "REFRESH_STATE_NOT_FOUND"
        };
    }

    if (
        state.active !==
        true
    ) {
        return {
            allowed:
                false,

            reason:
                "ACCOUNT_INACTIVE"
        };
    }

    if (
        state.accountId !==
        candidate.accountId
    ) {
        return {
            allowed:
                false,

            reason:
                "ACCOUNT_ID_MISMATCH"
        };
    }

    if (
        state.rlPlayerId !==
        candidate.rlPlayerId
    ) {
        return {
            allowed:
                false,

            reason:
                "RL_PLAYER_ID_MISMATCH"
        };
    }

    if (
        state.epicAccountId !==
        candidate.epicAccountId
    ) {
        return {
            allowed:
                false,

            reason:
                "EPIC_ACCOUNT_ID_MISMATCH"
        };
    }

    const lastSeenAt =
        normalizeDate(
            state.lastSeenAt
        );

    if (
        lastSeenAt ===
        null
    ) {
        return {
            allowed:
                false,

            reason:
                "LAST_SEEN_UNKNOWN"
        };
    }

    if (
        (
            now -
            lastSeenAt
        ) <
        INACTIVE_AFTER_MS
    ) {
        return {
            allowed:
                false,

            reason:
                "RECENTLY_ACTIVE"
        };
    }

    const lastRefreshAt =
        normalizeDate(
            state.lastRefreshAt
        );

    if (
        lastRefreshAt !==
            null
        && (
            now -
            lastRefreshAt
        ) <
            DAY_MS
    ) {
        return {
            allowed:
                false,

            reason:
                "REFRESH_NOT_DUE"
        };
    }

    return {
        allowed:
            true,

        reason:
            "REFRESH_DUE"
    };
}

/* =========================================================
MMR FETCH
========================================================= */

async function fetchMmrStats(
    env,
    epicAccountId
) {
    const baseUrl =
        normalizeString(
            env?.MMR_API_URL
        );

    const apiKey =
        normalizeString(
            env?.MMR_API_KEY
        );

    if (
        !baseUrl
        || !apiKey
    ) {
        const error =
            new Error(
                "MMR configuration is unavailable."
            );

        error.code =
            "MMR_CONFIGURATION_MISSING";

        throw error;
    }

    const url =
        new URL(
            "/get-skills",
            baseUrl
        );

    url.searchParams.set(
        "playerId",
        `Epic|${epicAccountId}|0`
    );

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            REQUEST_TIMEOUT_MS
        );

    try {
        const response =
            await fetch(
                url.href,
                {
                    method:
                        "GET",

                    headers: {
                        Authorization:
                            `Bearer ${apiKey}`,

                        Accept:
                            "application/json"
                    },

                    signal:
                        controller.signal
                }
            );

        const responseText =
            await response.text();

        if (
            !response.ok
        ) {
            const error =
                new Error(
                    `MMR skills request failed: ${response.status}`
                );

            error.code =
                "MMR_API_FAILED";

            error.status =
                response.status;

            error.response =
                responseText
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .slice(
                        0,
                        300
                    );

            throw error;
        }

        let payload;

        try {
            payload =
                responseText
                    ? JSON.parse(
                        responseText
                    )
                    : {};
        }
        catch {
            const error =
                new Error(
                    "MMR skills response was invalid."
                );

            error.code =
                "MMR_RESPONSE_INVALID";

            throw error;
        }

        return payload;
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

/* =========================================================
PLAYLIST NORMALIZATION
========================================================= */

function getPlaylist(
    payload,
    playlistId
) {
    const playlists =
        Array.isArray(
            payload?.playlists
        )
            ? payload.playlists
            : [];

    return playlists.find(
        item =>
            Number(
                item?.id
            ) ===
            playlistId
    )
        || null;
}

function buildSnapshot(
    payload
) {
    const ones =
        getPlaylist(
            payload,
            PLAYLIST_IDS.ones
        );

    const twos =
        getPlaylist(
            payload,
            PLAYLIST_IDS.twos
        );

    const threes =
        getPlaylist(
            payload,
            PLAYLIST_IDS.threes
        );

    const snapshot = {
        onesMmr:
            normalizeMmr(
                ones?.mmr
            ),

        twosMmr:
            normalizeMmr(
                twos?.mmr
            ),

        threesMmr:
            normalizeMmr(
                threes?.mmr
            ),

        onesTier:
            normalizeTier(
                ones?.tier
            ),

        twosTier:
            normalizeTier(
                twos?.tier
            ),

        threesTier:
            normalizeTier(
                threes?.tier
            )
    };

    if (
        snapshot.onesMmr ===
            null
        && snapshot.twosMmr ===
            null
        && snapshot.threesMmr ===
            null
    ) {
        const error =
            new Error(
                "Primary competitive playlists were missing."
            );

        error.code =
            "MMR_PRIMARY_PLAYLISTS_MISSING";

        throw error;
    }

    return snapshot;
}

/* =========================================================
SNAPSHOT SAVE
========================================================= */

async function saveSnapshot(
    env,
    candidate,
    snapshot
) {
    const capturedAt =
        new Date()
            .toISOString();

    const result =
        await callRpc(
            env,
            "save_rl_player_mmr_snapshot",
            {
                p_account_id:
                    candidate.accountId,

                p_epic_account_id:
                    candidate.epicAccountId,

                p_captured_at:
                    capturedAt,

                p_ones_mmr:
                    snapshot.onesMmr,

                p_twos_mmr:
                    snapshot.twosMmr,

                p_threes_mmr:
                    snapshot.threesMmr,

                p_ones_tier:
                    snapshot.onesTier,

                p_twos_tier:
                    snapshot.twosTier,

                p_threes_tier:
                    snapshot.threesTier,

                p_source:
                    "mmr-api-v2"
            }
        );

    const row =
        Array.isArray(
            result
        )
            ? result[0]
                || null
            : result;

    return {
        snapshotId:
            row?.id
            || null,

        playerId:
            row?.player_id
            || candidate.rlPlayerId,

        capturedAt:
            row?.captured_at
            || capturedAt
    };
}

/* =========================================================
PLAYER REFRESH
========================================================= */

async function refreshCandidate(
    env,
    candidate
) {
    const state =
        await getRefreshState(
            env,
            candidate.accountId
        );

    const eligibility =
        getEligibility(
            candidate,
            state
        );

    if (
        eligibility.allowed !==
        true
    ) {
        return {
            success:
                true,

            refreshed:
                false,

            reason:
                eligibility.reason
        };
    }

    const payload =
        await fetchMmrStats(
            env,
            candidate.epicAccountId
        );

    const snapshot =
        buildSnapshot(
            payload
        );

    const saved =
        await saveSnapshot(
            env,
            candidate,
            snapshot
        );

    return {
        success:
            true,

        refreshed:
            true,

        snapshotId:
            saved.snapshotId,

        playerId:
            saved.playerId,

        capturedAt:
            saved.capturedAt
    };
}

/* =========================================================
SCHEDULED MMR JOB
========================================================= */

export async function runScheduledMmrRefresh(
    env
) {
    const candidates =
        await getScheduledCandidates(
            env
        );

    const results =
        [];

    for (
        let index = 0;
        index < candidates.length;
        index += BATCH_SIZE
    ) {
        const batch =
            candidates.slice(
                index,
                index + BATCH_SIZE
            );

        const settled =
            await Promise.allSettled(
                batch.map(
                    candidate =>
                        refreshCandidate(
                            env,
                            candidate
                        )
                )
            );

        for (
            let offset = 0;
            offset < settled.length;
            offset += 1
        ) {
            const candidate =
                batch[offset];

            const result =
                settled[offset];

            if (
                result.status ===
                "fulfilled"
            ) {
                results.push({
                    accountId:
                        candidate.accountId,

                    rlPlayerId:
                        candidate.rlPlayerId,

                    ...result.value
                });

                continue;
            }

            console.error(
                "SCHEDULED MMR: Player refresh failed.",
                {
                    accountId:
                        candidate.accountId,

                    rlPlayerId:
                        candidate.rlPlayerId,

                    code:
                        result.reason?.code
                        || null,

                    status:
                        result.reason?.status
                        || null,

                    message:
                        result.reason?.message
                        || "Unknown error"
                }
            );

            results.push({
                accountId:
                    candidate.accountId,

                rlPlayerId:
                    candidate.rlPlayerId,

                success:
                    false,

                refreshed:
                    false,

                reason:
                    result.reason?.code
                    || "MMR_REFRESH_FAILED"
            });
        }

        const hasAnotherBatch =
            index + BATCH_SIZE <
            candidates.length;

        if (
            hasAnotherBatch
        ) {
            await sleep(
                BATCH_DELAY_MS
            );
        }
    }

    return {
        success:
            true,

        candidateCount:
            candidates.length,

        processedCount:
            results.length,

        refreshedCount:
            results.filter(
                result =>
                    result.refreshed ===
                    true
            ).length,

        skippedCount:
            results.filter(
                result =>
                    result.success ===
                        true
                    && result.refreshed !==
                        true
            ).length,

        failedCount:
            results.filter(
                result =>
                    result.success !==
                    true
            ).length,

        results
    };
}