import { sanitizeLogMetadata } from "../../http/diagnostics.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE MMR FETCH SERVICE

File:
    functions/services/rl/stats/fetch_mmr.js

Purpose:
    Fetches Rocket League playlist MMR data from the
    protected BPD MMR Worker.

Important:
    - Server-side only.
    - Uses MMR_API_URL and MMR_API_KEY.
    - Never logs MMR_API_KEY.
    - Uses Epic account ID as the upstream player identity.
========================================================= */

const REQUEST_TIMEOUT_MS =
    15000;

/* =========================================================
CONFIGURATION
========================================================= */

function getMmrApiUrl(
    env
) {
    const apiUrl =
        String(
            env?.MMR_API_URL
            || ""
        )
            .trim();

    if (
        !apiUrl
    ) {
        const error =
            new Error(
                "MMR API URL is not configured."
            );

        error.code =
            "MMR_API_URL_MISSING";

        error.status =
            500;

        throw error;
    }

    return apiUrl.replace(
        /\/+$/,
        ""
    );
}

function getMmrApiKey(
    env
) {
    const apiKey =
        String(
            env?.MMR_API_KEY
            || ""
        )
            .trim();

    if (
        !apiKey
    ) {
        const error =
            new Error(
                "MMR API key is not configured."
            );

        error.code =
            "MMR_API_KEY_MISSING";

        error.status =
            500;

        throw error;
    }

    return apiKey;
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeEpicAccountId(
    value
) {
    const epicAccountId =
        String(
            value
            || ""
        )
            .trim();

    if (
        !/^[A-Za-z0-9]{1,128}$/
            .test(
                epicAccountId
            )
    ) {
        const error =
            new Error(
                "Epic account ID is invalid."
            );

        error.code =
            "MMR_EPIC_ACCOUNT_ID_INVALID";

        error.status =
            400;

        throw error;
    }

    return epicAccountId;
}

function normalizePlaylist(
    playlist
) {
    if (
        !playlist
        || typeof playlist !==
            "object"
    ) {
        return null;
    }

    const id =
        Number(
            playlist.id
        );

    const mmr =
        Number(
            playlist.mmr
        );

    const tier =
        playlist.tier ==
            null
            ? null
            : Number(
                playlist.tier
            );

    const division =
        playlist.division ==
            null
            ? null
            : Number(
                playlist.division
            );

    if (
        !Number.isInteger(
            id
        )
        || !Number.isFinite(
            mmr
        )
    ) {
        return null;
    }

    return {
        id,

        mmr:
            Math.round(
                mmr
            ),

        tier:
            Number.isFinite(
                tier
            )
                ? tier
                : null,

        division:
            Number.isFinite(
                division
            )
                ? division
                : null
    };
}

/* =========================================================
FETCH PROVIDER CAPABILITIES
========================================================= */

export async function fetchMmrProviderData(
    env,
    epicAccountId,
    capabilities = ["profile", "stats"]
) {
    const normalizedEpicAccountId = normalizeEpicAccountId(epicAccountId);
    const playerId = `Epic|${normalizedEpicAccountId}|0`;
    const url = new URL("/get-player-data", getMmrApiUrl(env));
    url.searchParams.set("playerId", playerId);
    url.searchParams.set("capabilities", capabilities.join(","));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(url.href, {
            method: "GET",
            headers: { Authorization: `Bearer ${getMmrApiKey(env)}`, Accept: "application/json" },
            signal: controller.signal
        });
    } catch (error) {
        const failure = new Error(error?.name === "AbortError" ? "Provider Worker request timed out." : "Provider Worker is unavailable.");
        failure.code = error?.name === "AbortError" ? "PROVIDER_WORKER_TIMEOUT" : "PROVIDER_WORKER_UNAVAILABLE";
        failure.status = error?.name === "AbortError" ? 504 : 502;
        throw failure;
    } finally {
        clearTimeout(timeout);
    }
    if (!response.ok) {
        const failure = new Error("Provider Worker request failed.");
        failure.code = "PROVIDER_WORKER_REQUEST_FAILED";
        failure.status = 502;
        throw failure;
    }
    let payload;
    try {
        payload = await response.json();
    } catch {
        const failure = new Error("Provider Worker response is invalid.");
        failure.code = "PROVIDER_WORKER_RESPONSE_INVALID";
        failure.status = 502;
        throw failure;
    }
    if (payload?.success !== true || !payload.capabilities || typeof payload.capabilities !== "object") {
        const failure = new Error("Provider Worker response is invalid.");
        failure.code = "PROVIDER_WORKER_RESPONSE_INVALID";
        failure.status = 502;
        throw failure;
    }
    return payload.capabilities;
}

/* =========================================================
FETCH MMR
========================================================= */

export async function fetchMmrStats(
    env,
    epicAccountId
) {
    const normalizedEpicAccountId =
        normalizeEpicAccountId(
            epicAccountId
        );

    const apiUrl =
        getMmrApiUrl(
            env
        );

    const apiKey =
        getMmrApiKey(
            env
        );

    const playerId =
        `Epic|${normalizedEpicAccountId}|0`;

    const url =
        new URL(
            "/get-skills",
            apiUrl
        );

    url.searchParams.set(
        "playerId",
        playerId
    );

    console.info(
        "MMR FETCH: Request starting.",
        {
            playerId,

            endpoint:
                url.toString()
        }
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
                url.toString(),
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
    }
    catch (
        error
    ) {
        if (
            error?.name ===
            "AbortError"
        ) {
            console.error(
                "MMR FETCH: Request timed out.",
                {
                    playerId,

                    timeoutMs:
                        REQUEST_TIMEOUT_MS
                }
            );

            const timeoutError =
                new Error(
                    "MMR API request timed out."
                );

            timeoutError.code =
                "MMR_API_TIMEOUT";

            timeoutError.status =
                504;

            throw timeoutError;
        }

        console.error(
            "MMR FETCH: Request failed.",
            sanitizeLogMetadata({
                playerId,

                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            })
        );

        const unavailableError =
            new Error(
                "MMR API is unavailable."
            );

        unavailableError.code =
            "MMR_API_UNAVAILABLE";

        unavailableError.status =
            502;

        throw unavailableError;
    }
    finally {
        clearTimeout(
            timeout
        );
    }

    console.info(
        "MMR FETCH: Response received.",
        {
            playerId,

            status:
                response.status,

            ok:
                response.ok
        }
    );

    let payload =
        null;

    try {
        payload =
            await response.json();
    }
    catch (
        error
    ) {
        console.error(
            "MMR FETCH: Response JSON invalid.",
            sanitizeLogMetadata({
                playerId,

                status:
                    response.status,

                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            })
        );

        payload =
            null;
    }

    if (
        !response.ok
    ) {
        const upstreamCode =
            payload?.error
            || payload?.code
            || `HTTP_${response.status}`;

        console.error(
            "MMR FETCH: Upstream request failed.",
            {
                playerId,

                status:
                    response.status,

                upstreamCode
            }
        );

        const error =
            new Error(
                `MMR API request failed: ${upstreamCode}`
            );

        error.code =
            "MMR_API_FAILED";

        error.status =
            502;

        error.upstreamStatus =
            response.status;

        error.upstreamCode =
            upstreamCode;

        throw error;
    }

    if (
        payload?.playlists ===
        null
    ) {
        console.info(
            "MMR FETCH: No playlist data returned.",
            {
                playerId
            }
        );

        return {
            playerId,

            epicAccountId:
                normalizedEpicAccountId,

            playlists:
                null
        };
    }

    if (
        !Array.isArray(
            payload?.playlists
        )
    ) {
        console.error(
            "MMR FETCH: Invalid playlist payload.",
            {
                playerId,

                payloadType:
                    typeof payload?.playlists
            }
        );

        const error =
            new Error(
                "MMR API returned an invalid response."
            );

        error.code =
            "MMR_API_INVALID_RESPONSE";

        error.status =
            502;

        throw error;
    }

    const playlists =
        payload.playlists
            .map(
                normalizePlaylist
            )
            .filter(
                Boolean
            );

    console.info(
        "MMR FETCH: Playlist data normalized.",
        {
            playerId,

            playlistCount:
                playlists.length,

            playlists:
                playlists.map(
                    playlist => ({
                        id:
                            playlist.id,

                        mmr:
                            playlist.mmr,

                        tier:
                            playlist.tier,

                        division:
                            playlist.division
                    })
                )
        }
    );

    return {
        playerId,

        epicAccountId:
            normalizedEpicAccountId,

        playlists
    };
}
