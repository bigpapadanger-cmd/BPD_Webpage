// functions/services/rl/presence/fetch_presence.js
// Fetches Rocket League profile/presence data from the protected BPD MMR Worker.

const REQUEST_TIMEOUT_MS = 10000;

function getMmrApiUrl(env) {
    const apiUrl = String(env.MMR_API_URL || "").trim();

    if (!apiUrl) {
        throw new Error("MMR_API_URL_MISSING");
    }

    return apiUrl.replace(/\/+$/, "");
}

function getMmrApiKey(env) {
    const apiKey = String(env.MMR_API_KEY || "").trim();

    if (!apiKey) {
        throw new Error("MMR_API_KEY_MISSING");
    }

    return apiKey;
}

function normalizeEpicAccountId(value) {
    const epicAccountId = String(value || "").trim();

    if (!/^[A-Za-z0-9]{1,128}$/.test(epicAccountId)) {
        throw new Error("RL_EPIC_ACCOUNT_ID_INVALID");
    }

    return epicAccountId;
}

export async function fetchRocketLeaguePresence(env, epicAccountId) {
    const normalizedEpicAccountId =
        normalizeEpicAccountId(epicAccountId);

    const playerId =
        `Epic|${normalizedEpicAccountId}|0`;

    const url =
        new URL(
            "/get-profile",
            getMmrApiUrl(env)
        );

    url.searchParams.set(
        "playerId",
        playerId
    );

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

    let response;

    try {
        response =
            await fetch(
                url.toString(),
                {
                    method: "GET",
                    headers: {
                        Authorization:
                            `Bearer ${getMmrApiKey(env)}`,
                        Accept:
                            "application/json"
                    },
                    signal:
                        controller.signal
                }
            );
    }
    catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("RL_PRESENCE_API_TIMEOUT");
        }

        throw new Error("RL_PRESENCE_API_UNAVAILABLE");
    }
    finally {
        clearTimeout(timeout);
    }

    let payload = null;

    try {
        payload =
            await response.json();
    }
    catch {
        payload = null;
    }

    if (!response.ok) {
        const upstreamCode =
            payload?.error ||
            payload?.code ||
            `HTTP_${response.status}`;

        throw new Error(
            `RL_PRESENCE_API_FAILED:${upstreamCode}`
        );
    }

    if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload)
    ) {
        throw new Error(
            "RL_PRESENCE_API_INVALID_RESPONSE"
        );
    }

    return {
        displayName:
            String(payload.name || "").trim() ||
            null,

        state:
            String(payload.state || "").trim() ||
            "Unknown"
    };
}