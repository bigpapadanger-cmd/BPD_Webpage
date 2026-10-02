"use strict";

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeMmr(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const timestamp = value.trim();
    return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function normalizeSnapshot(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
        capturedAt: normalizeTimestamp(value.captured_at),
        ones: normalizeMmr(value.ones_mmr),
        twos: normalizeMmr(value.twos_mmr),
        threes: normalizeMmr(value.threes_mmr)
    };
}

const REQUEST_TIMEOUT_MS = 5000;

export function buildMmrProgression(current, previous) {
    const playlists = [
        ["ones", "1v1"],
        ["twos", "2v2"],
        ["threes", "3v3"]
    ].map(([key, label]) => {
        const currentMmr = current?.[key] ?? null;
        const previousMmr = previous?.[key] ?? null;
        if (previous === null) return { key, label, delta: null, status: "no_previous" };
        if (!Number.isSafeInteger(currentMmr) || !Number.isSafeInteger(previousMmr)) {
            return { key, label, delta: null, status: "unavailable" };
        }
        return { key, label, delta: currentMmr - previousMmr, status: "available" };
    });

    return { current, previous, playlists };
}

export async function getRocketLeagueMmrProgression(env, accountId) {
    const normalizedAccountId = normalizeString(accountId);
    const baseUrl = normalizeString(env?.SUPABASE_URL).replace(/\/+$/, "");
    const auth = normalizeString(env?.SUPABASE_AUTH);
    if (!normalizedAccountId) throw Object.assign(new Error("Account ID is required."), { code: "ACCOUNT_ID_REQUIRED" });
    if (!baseUrl || !auth) throw Object.assign(new Error("Supabase configuration is unavailable."), { code: "SUPABASE_CONFIGURATION_MISSING" });

    const restUrl = /\/rest\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/rest/v1`;
    const url = new URL("rpc/get_rl_player_mmr_progression", `${restUrl}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url.href, {
            method: "POST",
            headers: {
                apikey: auth,
                Authorization: `Bearer ${auth}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: JSON.stringify({ p_account_id: normalizedAccountId }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw Object.assign(new Error("MMR progression RPC failed."), { code: "MMR_PROGRESSION_FAILED", status: response.status });
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw Object.assign(new Error("MMR progression RPC returned invalid JSON."), { code: "MMR_PROGRESSION_INVALID", status: 502 });
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)
            || !(payload.current === null || (payload.current && typeof payload.current === "object" && !Array.isArray(payload.current)))
            || !(payload.previous === null || (payload.previous && typeof payload.previous === "object" && !Array.isArray(payload.previous)))) {
            throw Object.assign(new Error("MMR progression RPC returned an invalid response."), { code: "MMR_PROGRESSION_INVALID", status: 502 });
        }

        return buildMmrProgression(normalizeSnapshot(payload.current), normalizeSnapshot(payload.previous));
    } catch (error) {
        if (error?.name === "AbortError") {
            throw Object.assign(new Error("MMR progression RPC timed out."), { code: "MMR_PROGRESSION_TIMEOUT", status: 504 });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function getRocketLeagueMmrProgressionSafely(env, accountId) {
    try {
        return await getRocketLeagueMmrProgression(env, accountId);
    } catch (error) {
        console.error("ROCKET LEAGUE MMR PROGRESSION: Supabase read unavailable.", {
            code: error?.code || "MMR_PROGRESSION_FAILED",
            status: error?.status || null
        });
        return null;
    }
}
