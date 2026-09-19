"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE STATS REFRESH SERVICE

File:
    functions/services/rl/stats/refresh.js

Purpose:
    Determines whether Rocket League stats/MMR should be
    refreshed for an authenticated BPD account during
    normal website activity.

Policy:
    - Account must be active.
    - A completed Rocket League profile must exist.
    - A valid Rocket League player UUID must exist.
    - A linked Epic account must exist.
    - Normal refresh: at most once every 24 hours.
    - Accounts not seen for more than 7 days are not
      refreshed through ordinary activity unless their
      activity timestamp has already been updated.
    - Scheduled inactive-player refreshes are handled
      exclusively by the Cloudflare background Worker.
    - All eligibility decisions are server-side.

Diagnostics:
    - Logs refresh-state resolution.
    - Logs refresh eligibility.
    - Logs Epic authorization result.
    - Logs MMR fetch start/completion.
    - Logs snapshot save completion.
    - Never logs secrets.
========================================================= */

import {
    verifyBackgroundEpicAccount
} from "../authorization.js";

import {
    getStatsRefreshState
} from "./refresh_state.js";

import {
    fetchMmrStats
} from "./fetch_mmr.js";

import {
    saveMmrStats
} from "./save_mmr.js";

/* =========================================================
CONSTANTS
========================================================= */

const DAY_MS =
    24 * 60 * 60 * 1000;

const INACTIVE_AFTER_MS =
    7 * DAY_MS;

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

/* =========================================================
REFRESH ELIGIBILITY
========================================================= */

function getRefreshEligibility(
    state,
    now = Date.now()
) {
    if (
        !state
        || state.active !==
            true
    ) {
        return {
            allowed:
                false,

            reason:
                "ACCOUNT_INACTIVE"
        };
    }

    const lastSeenAt =
        normalizeDate(
            state.lastSeenAt
        );

    const lastRefreshAt =
        normalizeDate(
            state.lastRefreshAt
        );

    const inactive =
        lastSeenAt !==
            null
        && (
            now -
            lastSeenAt
        ) >=
            INACTIVE_AFTER_MS;

    if (
        inactive
    ) {
        return {
            allowed:
                false,

            reason:
                "INACTIVE_ACCOUNT"
        };
    }

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
                "REFRESH_NOT_DUE",

            lastRefreshAt:
                state.lastRefreshAt
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
REFRESH STATS
========================================================= */

export async function refreshStats(
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

    console.info(
        "STATS REFRESH: Starting refresh evaluation.",
        {
            accountId:
                normalizedAccountId
        }
    );

    const state =
        await getStatsRefreshState(
            env,
            normalizedAccountId
        );

    console.info(
        "STATS REFRESH: State loaded.",
        {
            accountId:
                normalizedAccountId,

            hasState:
                Boolean(
                    state
                ),

            rlPlayerId:
                state?.rlPlayerId
                || null,

            active:
                state?.active ===
                true,

            lastSeenAt:
                state?.lastSeenAt
                || null,

            lastRefreshAt:
                state?.lastRefreshAt
                || null,

            hasEpicAccountId:
                Boolean(
                    state?.epicAccountId
                )
        }
    );

    if (
        !state
    ) {
        console.info(
            "STATS REFRESH: Profile not eligible.",
            {
                accountId:
                    normalizedAccountId,

                reason:
                    "ROCKET_LEAGUE_PROFILE_NOT_ELIGIBLE"
            }
        );

        return {
            success:
                true,

            refreshed:
                false,

            reason:
                "ROCKET_LEAGUE_PROFILE_NOT_ELIGIBLE"
        };
    }

    if (
        state.accountId
        && state.accountId !==
            normalizedAccountId
    ) {
        const error =
            new Error(
                "Stats refresh state returned an unexpected account."
            );

        error.code =
            "STATS_REFRESH_ACCOUNT_MISMATCH";

        error.status =
            502;

        throw error;
    }

    const rlPlayerId =
        normalizeString(
            state.rlPlayerId
        );

    if (
        !rlPlayerId
    ) {
        console.info(
            "STATS REFRESH: Rocket League player missing.",
            {
                accountId:
                    normalizedAccountId,

                reason:
                    "ROCKET_LEAGUE_PLAYER_NOT_FOUND"
            }
        );

        return {
            success:
                true,

            refreshed:
                false,

            reason:
                "ROCKET_LEAGUE_PLAYER_NOT_FOUND"
        };
    }

    const eligibility =
        getRefreshEligibility(
            state
        );

    console.info(
        "STATS REFRESH: Eligibility evaluated.",
        {
            accountId:
                normalizedAccountId,

            rlPlayerId,

            allowed:
                eligibility.allowed ===
                true,

            reason:
                eligibility.reason,

            lastRefreshAt:
                eligibility.lastRefreshAt
                || state.lastRefreshAt
                || null
        }
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
                eligibility.reason,

            rlPlayerId,

            lastRefreshAt:
                eligibility.lastRefreshAt
                || state.lastRefreshAt
                || null
        };
    }

    const epicAccountId =
        normalizeString(
            state.epicAccountId
        );

    if (
        !epicAccountId
    ) {
        console.info(
            "STATS REFRESH: Epic account missing.",
            {
                accountId:
                    normalizedAccountId,

                rlPlayerId,

                reason:
                    "EPIC_ACCOUNT_NOT_LINKED"
            }
        );

        return {
            success:
                true,

            refreshed:
                false,

            reason:
                "EPIC_ACCOUNT_NOT_LINKED",

            rlPlayerId
        };
    }

    console.info(
        "STATS REFRESH: Verifying Epic authorization.",
        {
            accountId:
                normalizedAccountId,

            rlPlayerId,

            epicAccountId
        }
    );

    const epicAuthorized =
        await verifyBackgroundEpicAccount(
            env,
            normalizedAccountId,
            epicAccountId
        );

    if (
        epicAuthorized !==
        true
    ) {
        console.info(
            "STATS REFRESH: Epic reauthorization required.",
            {
                accountId:
                    normalizedAccountId,

                rlPlayerId,

                reason:
                    "EPIC_REAUTHORIZATION_REQUIRED"
            }
        );

        return {
            success:
                true,

            refreshed:
                false,

            reason:
                "EPIC_REAUTHORIZATION_REQUIRED",

            rlPlayerId
        };
    }

    console.info(
        "STATS REFRESH: MMR fetch starting.",
        {
            accountId:
                normalizedAccountId,

            rlPlayerId,

            epicAccountId
        }
    );

    const stats =
        await fetchMmrStats(
            env,
            epicAccountId
        );

    console.info(
        "STATS REFRESH: MMR fetch completed.",
        {
            accountId:
                normalizedAccountId,

            rlPlayerId,

            playlistCount:
                Array.isArray(
                    stats?.playlists
                )
                    ? stats.playlists.length
                    : null
        }
    );

    const saved =
        await saveMmrStats(
            env,
            {
                accountId:
                    normalizedAccountId,

                epicAccountId,

                stats
            }
        );

    console.info(
        "STATS REFRESH: Snapshot saved.",
        {
            accountId:
                normalizedAccountId,

            rlPlayerId:
                saved?.playerId
                || rlPlayerId,

            snapshotId:
                saved?.snapshotId
                || null,

            refreshedAt:
                saved?.refreshedAt
                || null
        }
    );

    return {
        success:
            true,

        refreshed:
            true,

        accountId:
            normalizedAccountId,

        rlPlayerId:
            saved?.playerId
            || rlPlayerId,

        snapshotId:
            saved?.snapshotId
            || null,

        refreshedAt:
            saved?.refreshedAt
            || new Date()
                .toISOString()
    };
}