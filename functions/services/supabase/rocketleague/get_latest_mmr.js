"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE LATEST MMR SNAPSHOT READER

File:
    functions/services/supabase/rocketleague/get_latest_mmr.js

Purpose:
    Loads the most recent Rocket League MMR snapshot for a
    canonical BPD account from Supabase.

Important:
    - Server-side only.
    - Read-only.
    - Uses api.get_latest_rl_player_mmr_snapshot.
    - Supabase remains authoritative.
    - Returns null when no snapshot exists.
========================================================= */

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

    return Number.isFinite(
        mmr
    )
        ? Math.round(
            mmr
        )
        : null;
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
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
        || !auth
    ) {
        return null;
    }

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
GET LATEST MMR SNAPSHOT
========================================================= */

export async function getLatestRocketLeagueMmrSnapshot(
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

    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        const error =
            new Error(
                "Supabase configuration is unavailable."
            );

        error.code =
            "SUPABASE_CONFIGURATION_MISSING";

        error.status =
            500;

        throw error;
    }

    const url =
        new URL(
            "rpc/get_latest_rl_player_mmr_snapshot",
            configuration.baseUrl
        );

    console.info(
        "LATEST MMR SNAPSHOT: Supabase RPC starting.",
        {
            accountId:
                normalizedAccountId
        }
    );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "POST",

                headers: {
                    apikey:
                        configuration.auth,

                    Authorization:
                        `Bearer ${configuration.auth}`,

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
                    JSON.stringify({
                        p_account_id:
                            normalizedAccountId
                    })
            }
        );

    const responseText =
        await response.text();

    console.info(
        "LATEST MMR SNAPSHOT: Supabase RPC response received.",
        {
            accountId:
                normalizedAccountId,

            status:
                response.status,

            ok:
                response.ok
        }
    );

    if (
        !response.ok
    ) {
        console.error(
            "LATEST MMR SNAPSHOT: Supabase RPC failed.",
            {
                accountId:
                    normalizedAccountId,

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
                "Latest Rocket League MMR snapshot could not be loaded."
            );

        error.code =
            "LATEST_MMR_SNAPSHOT_FAILED";

        error.status =
            response.status;

        throw error;
    }

    if (
        !responseText
    ) {
        return null;
    }

    let result;

    try {
        result =
            JSON.parse(
                responseText
            );
    }
    catch {
        const error =
            new Error(
                "Latest Rocket League MMR snapshot returned invalid JSON."
            );

        error.code =
            "LATEST_MMR_SNAPSHOT_INVALID";

        error.status =
            502;

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
    ) {
        console.info(
            "LATEST MMR SNAPSHOT: No snapshot found.",
            {
                accountId:
                    normalizedAccountId
            }
        );

        return null;
    }

    const returnedAccountId =
        normalizeNullableString(
            row.account_id
        );

    if (
        returnedAccountId
        && returnedAccountId !==
            normalizedAccountId
    ) {
        const error =
            new Error(
                "Latest MMR snapshot returned an unexpected account."
            );

        error.code =
            "LATEST_MMR_ACCOUNT_MISMATCH";

        error.status =
            502;

        throw error;
    }

    const snapshot = {
        accountId:
            returnedAccountId
            || normalizedAccountId,

        rlPlayerId:
            normalizeNullableString(
                row.rl_player_id
            ),

        epicAccountId:
            normalizeNullableString(
                row.epic_account_id
            ),

        snapshotId:
            normalizeNullableString(
                row.snapshot_id
            ),

        capturedAt:
            normalizeNullableString(
                row.captured_at
            ),

        ones: {
            mmr:
                normalizeMmr(
                    row.ones_mmr
                ),

            tier:
                normalizeNullableString(
                    row.ones_tier
                )
        },

        twos: {
            mmr:
                normalizeMmr(
                    row.twos_mmr
                ),

            tier:
                normalizeNullableString(
                    row.twos_tier
                )
        },

        threes: {
            mmr:
                normalizeMmr(
                    row.threes_mmr
                ),

            tier:
                normalizeNullableString(
                    row.threes_tier
                )
        },

        source:
            normalizeNullableString(
                row.source
            )
            || "unknown"
    };

    console.info(
        "LATEST MMR SNAPSHOT: Snapshot resolved.",
        {
            accountId:
                snapshot.accountId,

            rlPlayerId:
                snapshot.rlPlayerId,

            snapshotId:
                snapshot.snapshotId,

            capturedAt:
                snapshot.capturedAt
        }
    );

    return snapshot;
}