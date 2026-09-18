"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE MMR SNAPSHOT SAVE SERVICE

File:
    functions/services/rl/stats/save_mmr.js

Purpose:
    Saves Rocket League competitive MMR snapshots to
    Supabase for:

    - Competitive 1v1
    - Competitive 2v2
    - Competitive 3v3

Important:
    - Server-side only.
    - Uses the canonical BPD account ID.
    - Uses the linked Epic account ID for integrity checks.
    - Writes through api.save_rl_player_mmr_snapshot.
    - Supports SUPABASE_URL configured either as the project
      root or as the /rest/v1/ endpoint.
========================================================= */

const PLAYLIST_1V1 =
    10;

const PLAYLIST_2V2 =
    11;

const PLAYLIST_3V3 =
    13;

const REQUEST_TIMEOUT_MS =
    15000;

const TIER_NAMES = [
    "Unranked",
    "Bronze I",
    "Bronze II",
    "Bronze III",
    "Silver I",
    "Silver II",
    "Silver III",
    "Gold I",
    "Gold II",
    "Gold III",
    "Platinum I",
    "Platinum II",
    "Platinum III",
    "Diamond I",
    "Diamond II",
    "Diamond III",
    "Champion I",
    "Champion II",
    "Champion III",
    "Grand Champion I",
    "Grand Champion II",
    "Grand Champion III",
    "Supersonic Legend"
];

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
        || mmr < 0
        || mmr > 5000
    ) {
        return null;
    }

    return Math.round(
        mmr
    );
}

function normalizeTier(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const tier =
        Number(
            value
        );

    if (
        !Number.isInteger(
            tier
        )
        || tier < 0
        || tier >=
            TIER_NAMES.length
    ) {
        return null;
    }

    return TIER_NAMES[
        tier
    ];
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfig(
    env
) {
    let baseUrl =
        normalizeString(
            env?.SUPABASE_URL
        )
            .replace(
                /\/+$/,
                ""
            );

    const auth =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !baseUrl
    ) {
        const error =
            new Error(
                "Supabase URL is not configured."
            );

        error.code =
            "SUPABASE_URL_MISSING";

        error.status =
            500;

        throw error;
    }

    if (
        !auth
    ) {
        const error =
            new Error(
                "Supabase authorization is not configured."
            );

        error.code =
            "SUPABASE_AUTH_MISSING";

        error.status =
            500;

        throw error;
    }

    /*
     * Allow either:
     *
     * https://project.supabase.co
     *
     * or:
     *
     * https://project.supabase.co/rest/v1/
     */
    if (
        !/\/rest\/v1$/i.test(
            baseUrl
        )
    ) {
        baseUrl +=
            "/rest/v1";
    }

    return {
        baseUrl:
            `${baseUrl}/`,

        auth
    };
}

/* =========================================================
PLAYLIST LOOKUP
========================================================= */

function getPlaylist(
    stats,
    playlistId
) {
    if (
        !stats
        || !Array.isArray(
            stats.playlists
        )
    ) {
        return null;
    }

    return stats.playlists.find(
        playlist =>
            Number(
                playlist?.id
            ) ===
            playlistId
    )
        || null;
}

/* =========================================================
SAVE MMR SNAPSHOT
========================================================= */

export async function saveMmrStats(
    env,
    {
        accountId,
        epicAccountId,
        stats
    }
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    const normalizedEpicAccountId =
        normalizeString(
            epicAccountId
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

    if (
        !normalizedEpicAccountId
    ) {
        const error =
            new Error(
                "Epic account ID is required."
            );

        error.code =
            "EPIC_ACCOUNT_ID_REQUIRED";

        error.status =
            400;

        throw error;
    }

    if (
        !stats
        || typeof stats !==
            "object"
        || Array.isArray(
            stats
        )
    ) {
        const error =
            new Error(
                "MMR stats are required."
            );

        error.code =
            "MMR_STATS_REQUIRED";

        error.status =
            400;

        throw error;
    }

    const ones =
        getPlaylist(
            stats,
            PLAYLIST_1V1
        );

    const twos =
        getPlaylist(
            stats,
            PLAYLIST_2V2
        );

    const threes =
        getPlaylist(
            stats,
            PLAYLIST_3V3
        );

    const capturedAt =
        new Date()
            .toISOString();

    const payload = {
        p_account_id:
            normalizedAccountId,

        p_epic_account_id:
            normalizedEpicAccountId,

        p_captured_at:
            capturedAt,

        p_ones_mmr:
            normalizeMmr(
                ones?.mmr
            ),

        p_twos_mmr:
            normalizeMmr(
                twos?.mmr
            ),

        p_threes_mmr:
            normalizeMmr(
                threes?.mmr
            ),

        p_ones_tier:
            normalizeTier(
                ones?.tier
            ),

        p_twos_tier:
            normalizeTier(
                twos?.tier
            ),

        p_threes_tier:
            normalizeTier(
                threes?.tier
            ),

        p_source:
            "mmr-api-v2"
    };

    /*
     * At least one supported competitive playlist must have
     * a valid MMR value before a snapshot is stored.
     */
    if (
        payload.p_ones_mmr ===
            null
        && payload.p_twos_mmr ===
            null
        && payload.p_threes_mmr ===
            null
    ) {
        const error =
            new Error(
                "No supported competitive playlist MMR was returned."
            );

        error.code =
            "MMR_PRIMARY_PLAYLISTS_MISSING";

        error.status =
            502;

        throw error;
    }

    const {
        baseUrl,
        auth
    } =
        getSupabaseConfig(
            env
        );

    const url =
        new URL(
            "rpc/save_rl_player_mmr_snapshot",
            baseUrl
        );

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            REQUEST_TIMEOUT_MS
        );

    let response;

    try {
        response =
            await fetch(
                url.href,
                {
                    method:
                        "POST",

                    headers: {
                        apikey:
                            auth,

                        Authorization:
                            `Bearer ${auth}`,

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
                            payload
                        ),

                    signal:
                        controller.signal
                }
            );
    }
    catch (
        error
    ) {
        if (
            error?.name ===
            "AbortError"
        ) {
            const timeoutError =
                new Error(
                    "MMR snapshot save timed out."
                );

            timeoutError.code =
                "MMR_SNAPSHOT_SAVE_TIMEOUT";

            timeoutError.status =
                504;

            throw timeoutError;
        }

        const networkError =
            new Error(
                "MMR snapshot save service is unavailable."
            );

        networkError.code =
            "MMR_SNAPSHOT_SAVE_UNAVAILABLE";

        networkError.status =
            502;

        throw networkError;
    }
    finally {
        clearTimeout(
            timeout
        );
    }

    const responseText =
        await response.text();

    let result =
        null;

    if (
        responseText
    ) {
        try {
            result =
                JSON.parse(
                    responseText
                );
        }
        catch {
            result =
                null;
        }
    }

    if (
        !response.ok
    ) {
        console.error(
            "MMR SNAPSHOT SAVE: Supabase RPC failed.",
            {
                status:
                    response.status,

                response:
                    responseText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .slice(
                            0,
                            300
                        )
            }
        );

        const error =
            new Error(
                result?.message
                || "Rocket League MMR snapshot could not be saved."
            );

        error.code =
            "MMR_SNAPSHOT_SAVE_FAILED";

        error.status =
            response.status;

        error.upstreamStatus =
            response.status;

        error.upstreamCode =
            result?.code
            || null;

        throw error;
    }

    const row =
        Array.isArray(
            result
        )
            ? result[0]
                || null
            : result;

    if (
        !row
        || !row.id
        || !row.player_id
    ) {
        const error =
            new Error(
                "MMR snapshot save returned an invalid response."
            );

        error.code =
            "MMR_SNAPSHOT_SAVE_INVALID";

        error.status =
            502;

        throw error;
    }

    /*
     * The RPC resolves the canonical core.rl_players.id.
     * This is the UUID used by downstream RL relationships.
     */
    return {
        refreshedAt:
            row.captured_at
            || capturedAt,

        snapshotId:
            row.id,

        playerId:
            row.player_id
    };
}