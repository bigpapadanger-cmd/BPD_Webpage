"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PRESENCE CYCLE

File:
    workers/rl-presence-monitor/src/presence_cycle.js

Purpose:
    Checks Rocket League presence for eligible opted-in
    players.

Behavior:
    - Dormant cycles exit before calling the MMR API.
    - /wake may force an immediate cycle.
    - Eligible players are processed in batches of 5.
    - Batches are separated by 15 seconds.
    - Any known-online player keeps monitoring active.
    - A cycle becomes dormant only when every candidate was
      checked successfully and all were offline.
    - Partial or complete lookup failures do NOT incorrectly
      mark the monitor dormant.
========================================================= */

const BATCH_SIZE =
    5;

const BATCH_DELAY_MS =
    15000;

const REQUEST_TIMEOUT_MS =
    15000;

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
MONITOR STATE
========================================================= */

async function getMonitorState(
    env
) {
    const rows =
        await callRpc(
            env,
            "get_rl_presence_monitor_state"
        );

    const row =
        Array.isArray(
            rows
        )
            ? rows[0]
                || null
            : rows;

    return {
        active:
            row?.active ===
            true,

        activatedAt:
            normalizeString(
                row?.activated_at
            )
            || null,

        lastCycleAt:
            normalizeString(
                row?.last_cycle_at
            )
            || null,

        dormantAt:
            normalizeString(
                row?.dormant_at
            )
            || null
    };
}

/* =========================================================
CANDIDATES
========================================================= */

async function getCandidates(
    env
) {
    const rows =
        await callRpc(
            env,
            "get_rl_presence_candidates"
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
MMR API PRESENCE
========================================================= */

async function fetchPresence(
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
            "/get-profile",
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
                    `MMR profile request failed: ${response.status}`
                );

            error.code =
                "MMR_PROFILE_FAILED";

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
                    "MMR profile response was invalid."
                );

            error.code =
                "MMR_PROFILE_INVALID";

            throw error;
        }

        return {
            displayName:
                normalizeString(
                    payload?.name
                )
                || null,

            state:
                normalizeString(
                    payload?.state
                )
                || "Unknown"
        };
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

/* =========================================================
PRESENCE STORAGE
========================================================= */

async function savePresence(
    env,
    player,
    presence
) {
    await callRpc(
        env,
        "save_rl_player_presence",
        {
            p_player_id:
                player.rlPlayerId,

            p_display_name:
                presence.displayName,

            p_presence_state:
                presence.state,

            p_checked_at:
                new Date()
                    .toISOString()
        }
    );
}

async function finishCycle(
    env,
    anyOnline
) {
    return callRpc(
        env,
        "finish_rl_presence_cycle",
        {
            p_any_online:
                anyOnline ===
                true
        }
    );
}

/* =========================================================
STATE HELPERS
========================================================= */

function isOnlineState(
    value
) {
    const normalized =
        normalizeString(
            value
        )
            .toLowerCase();

    return normalized ===
        "online";
}

/* =========================================================
PRESENCE CYCLE
========================================================= */

export async function runPresenceCycle(
    env,
    {
        force = false
    } = {}
) {
    if (
        force !==
        true
    ) {
        const monitorState =
            await getMonitorState(
                env
            );

        if (
            monitorState.active !==
            true
        ) {
            return {
                success:
                    true,

                skipped:
                    true,

                reason:
                    "MONITOR_DORMANT"
            };
        }
    }

    const candidates =
        await getCandidates(
            env
        );

    if (
        candidates.length ===
        0
    ) {
        await finishCycle(
            env,
            false
        );

        return {
            success:
                true,

            skipped:
                false,

            candidateCount:
                0,

            checked:
                0,

            failed:
                0,

            anyOnline:
                false,

            dormant:
                true
        };
    }

    let checked =
        0;

    let failed =
        0;

    let anyOnline =
        false;

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
                    async player => {
                        const presence =
                            await fetchPresence(
                                env,
                                player.epicAccountId
                            );

                        await savePresence(
                            env,
                            player,
                            presence
                        );

                        return {
                            player,
                            presence
                        };
                    }
                )
            );

        for (
            let offset = 0;
            offset < settled.length;
            offset += 1
        ) {
            const result =
                settled[offset];

            const player =
                batch[offset];

            if (
                result.status ===
                "fulfilled"
            ) {
                checked +=
                    1;

                if (
                    isOnlineState(
                        result.value
                            .presence
                            .state
                    )
                ) {
                    anyOnline =
                        true;
                }

                continue;
            }

            failed +=
                1;

            console.error(
                "RL PRESENCE: Player check failed.",
                {
                    accountId:
                        player.accountId,

                    rlPlayerId:
                        player.rlPlayerId,

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

    /*
     * Any confirmed online player keeps the monitor active.
     */
    if (
        anyOnline ===
        true
    ) {
        await finishCycle(
            env,
            true
        );

        return {
            success:
                true,

            skipped:
                false,

            candidateCount:
                candidates.length,

            checked,

            failed,

            anyOnline:
                true,

            dormant:
                false
        };
    }

    /*
     * Only mark the monitor dormant if EVERY candidate
     * completed successfully and all were offline.
     *
     * If one or more checks failed, leave the current
     * monitor state unchanged so the next cron can retry.
     */
    if (
        failed ===
        0
        && checked ===
            candidates.length
    ) {
        await finishCycle(
            env,
            false
        );

        return {
            success:
                true,

            skipped:
                false,

            candidateCount:
                candidates.length,

            checked,

            failed:

                0,

            anyOnline:
                false,

            dormant:
                true
        };
    }

    return {
        success:
            false,

        skipped:
            false,

        candidateCount:
            candidates.length,

        checked,

        failed,

        anyOnline:
            false,

        dormant:
            false,

        reason:
            "PRESENCE_CHECK_INCOMPLETE"
    };
}