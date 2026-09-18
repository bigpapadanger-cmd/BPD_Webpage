// functions/services/rl/stats/fetch_mmr.js
// Fetches Rocket League playlist MMR data from the protected BPD MMR Worker.

const REQUEST_TIMEOUT_MS = 15000;

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
        throw new Error("MMR_EPIC_ACCOUNT_ID_INVALID");
    }

    return epicAccountId;
}

function normalizePlaylist(playlist) {
    if (!playlist || typeof playlist !== "object") {
        return null;
    }

    const id = Number(playlist.id);
    const mmr = Number(playlist.mmr);
    const tier = playlist.tier == null ? null : Number(playlist.tier);
    const division = playlist.division == null ? null : Number(playlist.division);

    if (!Number.isInteger(id) || !Number.isFinite(mmr)) {
        return null;
    }

    return {
        id,
        mmr: Math.round(mmr),
        tier: Number.isFinite(tier) ? tier : null,
        division: Number.isFinite(division) ? division : null
    };
}

export async function fetchMmrStats(env, epicAccountId) {
    const normalizedEpicAccountId = normalizeEpicAccountId(epicAccountId);
    const apiUrl = getMmrApiUrl(env);
    const apiKey = getMmrApiKey(env);

    const playerId = `Epic|${normalizedEpicAccountId}|0`;
    const url = new URL("/get-skills", apiUrl);

    url.searchParams.set("playerId", playerId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json"
            },
            signal: controller.signal
        });
    }
    catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("MMR_API_TIMEOUT");
        }

        throw new Error("MMR_API_UNAVAILABLE");
    }
    finally {
        clearTimeout(timeout);
    }

    let payload = null;

    try {
        payload = await response.json();
    }
    catch {
        payload = null;
    }

    if (!response.ok) {
        const upstreamCode =
            payload?.error ||
            payload?.code ||
            `HTTP_${response.status}`;

        throw new Error(`MMR_API_FAILED:${upstreamCode}`);
    }

    if (payload?.playlists === null) {
        return {
            playerId,
            epicAccountId: normalizedEpicAccountId,
            playlists: null
        };
    }

    if (!Array.isArray(payload?.playlists)) {
        throw new Error("MMR_API_INVALID_RESPONSE");
    }

    const playlists = payload.playlists
        .map(normalizePlaylist)
        .filter(Boolean);

    return {
        playerId,
        epicAccountId: normalizedEpicAccountId,
        playlists
    };
}