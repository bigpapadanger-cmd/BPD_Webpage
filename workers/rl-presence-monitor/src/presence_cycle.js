import { verifyBackgroundEpicAccount } from "../../../functions/services/rl/authorization.js";
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
    - The schedule checks the live eligible-candidate set every 15 minutes,
      including when all opted-in players were previously offline.
    - /wake may still request an explicit immediate cycle.
    - Eligible players are processed in batches of 5.
    - Batches are separated by 15 seconds.
    - The persisted monitor state records whether a known-online player was
      seen in the last cycle; it does not gate later scheduled candidate scans.
    - An all-offline cycle may record dormant metadata while scheduled scans
      continue so an opted-in player can be found after returning online.
    - Partial or complete lookup failures do NOT incorrectly
      mark the monitor dormant.
========================================================= */

const BATCH_SIZE =
    5;

const BATCH_DELAY_MS =
    15000;

const REQUEST_TIMEOUT_MS =
    15000;

const PRESENCE_MAX_AGE_MS =
    30 * 60 * 1000;

const ALLOWED_PRESENCE_STATES = new Set(["online", "offline"]);

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

        throw error;
    }

    try {
        const responseText = await response.text();
        return responseText ? JSON.parse(responseText) : null;
    }
    catch {
        throw Object.assign(new Error("Supabase RPC returned invalid JSON."), { code: "SUPABASE_RPC_INVALID_JSON" });
    }
}

/* =========================================================
MONITOR STATE
========================================================= */

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

export async function fetchPresence(
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

    const url = new URL("/get-player-data", baseUrl);

    url.searchParams.set(
        "playerId",
        `Epic|${epicAccountId}|0`
    );
    url.searchParams.set("capabilities", "presence");

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            REQUEST_TIMEOUT_MS
        );

    try {
        const response = await fetch(url.href, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json"
            },
            signal: controller.signal
        });

        if (
            !response.ok
        ) {
            throw Object.assign(new Error("MMR presence capability request failed."), {
                code: "MMR_PRESENCE_REQUEST_FAILED",
                status: response.status
            });
        }

        let payload;

        try {
            payload = await response.json();
        }
        catch {
            throw Object.assign(new Error("MMR presence capability response was invalid."), { code: "MMR_PRESENCE_RESPONSE_INVALID" });
        }

        const result = payload?.capabilities?.presence;
        const state = normalizeString(result?.data?.state);
        const checkedAt = normalizeString(result?.data?.checked_at);
        const checkedAtMs = Date.parse(checkedAt);
        if (payload?.success !== true || result?.status !== "success" || !result?.data
            || !Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() + 60000) {
            throw Object.assign(new Error("MMR presence capability was unavailable or malformed."), { code: "MMR_PRESENCE_RESPONSE_INVALID" });
        }
        if (Date.now() - checkedAtMs > PRESENCE_MAX_AGE_MS) {
            throw Object.assign(new Error("MMR presence capability was stale."), { code: "MMR_PRESENCE_RESPONSE_STALE" });
        }
        if (state === "unknown") {
            throw Object.assign(new Error("MMR presence state is unknown."), { code: "MMR_PRESENCE_UNKNOWN" });
        }
        if (!ALLOWED_PRESENCE_STATES.has(state)) {
            throw Object.assign(new Error("MMR presence state is invalid."), { code: "MMR_PRESENCE_RESPONSE_INVALID" });
        }
        return { state, checkedAt, displayName: null };
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

export async function savePresence(
    env,
    player,
    presence
) {
    if (!ALLOWED_PRESENCE_STATES.has(presence?.state)
        || !Number.isFinite(Date.parse(presence?.checkedAt || ""))) {
        throw Object.assign(new Error("Only confirmed normalized presence can be persisted."), { code: "MMR_PRESENCE_NOT_PERSISTABLE" });
    }

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
                presence.checkedAt
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

    return normalized === "online";
}

/* =========================================================
PRESENCE CYCLE
========================================================= */

export async function runPresenceCycle(
    env
) {
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

    let skippedCount =
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
                        if (!await verifyBackgroundEpicAccount(env, player.accountId, player.epicAccountId)) {
                            return { player, skipped: true };
                        }
                        const presence = await fetchPresence(
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
                if (result.value.skipped === true) {
                    skippedCount += 1;
                    continue;
                }

                checked +=
                    1;

                if (
                    isOnlineState(
                        result.value.presence?.state
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
                    code:
                        result.reason?.code
                        || null,

                    status:
                        result.reason?.status
                        || null,
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

    /* Record whether the last completed cycle observed anyone online. */
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

            skippedCount,

            failed,

            anyOnline:
                true,

            dormant:
                false
        };
    }

    // Mark the last cycle dormant only after complete successful offline
    // results. The next cron still selects candidates and polls opt-ins.
    if (failed === 0 && skippedCount === 0 && checked === candidates.length) {
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

            skippedCount,

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

        skippedCount,

        failed,

        anyOnline:
            false,

        dormant:
            false,

        reason:
            "PRESENCE_CHECK_INCOMPLETE"
    };
}
