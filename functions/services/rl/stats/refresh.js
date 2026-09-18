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
========================================================= */

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
    return typeof value === "string"
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

    /*
     * Normal activity does not refresh an account whose
     * stored activity timestamp is still more than seven
     * days old.
     *
     * handleAccountLastLogin() updates last_seen_at before
     * calling this service, so a genuinely returning user
     * becomes active again before MMR eligibility is checked.
     */
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

    /*
     * No account may be refreshed more than once within
     * a rolling 24-hour period.
     */
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

    const state =
        await getStatsRefreshState(
            env,
            normalizedAccountId
        );

    /*
     * The refresh-state RPC only returns completed Rocket
     * League profiles eligible for refresh consideration.
     */
    if (
        !state
    ) {
        return {
            success:
                true,

            refreshed:
                false,

            reason:
                "ROCKET_LEAGUE_PROFILE_NOT_ELIGIBLE"
        };
    }

    /*
     * Verify the state belongs to the exact canonical BPD
     * account that initiated the refresh.
     */
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

    /*
     * A canonical core.rl_players.id UUID must exist before
     * any MMR request is permitted.
     */
    if (
        !rlPlayerId
    ) {
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

    const stats =
        await fetchMmrStats(
            env,
            epicAccountId
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
            || new Date().toISOString()
    };
}