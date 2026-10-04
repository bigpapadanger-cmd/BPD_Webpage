"use strict";

const MAX_MMR_HISTORY_CAPTURES = 90;
const REQUEST_TIMEOUT_MS = 5000;

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeMmr(value) {
    if (value === null) return null;
    const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function normalizeTier(value) {
    if (value === null) return null;
    return typeof value === "string" ? value.trim() : undefined;
}

export function normalizeMmrHistory(payload) {
    if (!Array.isArray(payload)) {
        throw Object.assign(new Error("MMR history RPC returned an invalid response."), { code: "MMR_HISTORY_INVALID", status: 502 });
    }

    const snapshots = payload.map(row => {
        if (!row || typeof row !== "object" || Array.isArray(row)
            || typeof row.captured_at !== "string" || !Number.isFinite(Date.parse(row.captured_at))) {
            throw Object.assign(new Error("MMR history RPC returned an invalid snapshot."), { code: "MMR_HISTORY_INVALID", status: 502 });
        }

        const normalized = { capturedAt: row.captured_at };
        for (const [key, field] of [["ones", "ones"], ["twos", "twos"], ["threes", "threes"]]) {
            const mmr = normalizeMmr(row[`${field}_mmr`]);
            const tier = normalizeTier(row[`${field}_tier`]);
            if (mmr === undefined || tier === undefined) {
                throw Object.assign(new Error("MMR history RPC returned an invalid playlist value."), { code: "MMR_HISTORY_INVALID", status: 502 });
            }
            normalized[key] = { mmr, tier };
        }
        return normalized;
    });

    return snapshots
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
        .slice(0, MAX_MMR_HISTORY_CAPTURES)
        .reverse();
}

export async function getRocketLeagueMmrHistory(env, accountId) {
    const normalizedAccountId = normalizeString(accountId);
    const baseUrl = normalizeString(env?.SUPABASE_URL).replace(/\/+$/, "");
    const auth = normalizeString(env?.SUPABASE_AUTH);
    if (!normalizedAccountId) throw Object.assign(new Error("Account ID is required."), { code: "ACCOUNT_ID_REQUIRED" });
    if (!baseUrl || !auth) throw Object.assign(new Error("Supabase configuration is unavailable."), { code: "SUPABASE_CONFIGURATION_MISSING" });

    const restUrl = /\/rest\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/rest/v1`;
    const url = new URL("rpc/get_rl_player_mmr_history", `${restUrl}/`);
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
            throw Object.assign(new Error("MMR history RPC failed."), { code: "MMR_HISTORY_FAILED", status: response.status });
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw Object.assign(new Error("MMR history RPC returned invalid JSON."), { code: "MMR_HISTORY_INVALID", status: 502 });
        }
        return normalizeMmrHistory(payload);
    } catch (error) {
        if (error?.name === "AbortError") {
            throw Object.assign(new Error("MMR history RPC timed out."), { code: "MMR_HISTORY_TIMEOUT", status: 504 });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function getRocketLeagueMmrHistorySafely(env, accountId) {
    try {
        return await getRocketLeagueMmrHistory(env, accountId);
    } catch (error) {
        console.error("ROCKET LEAGUE MMR HISTORY: Supabase read unavailable.", {
            code: error?.code || "MMR_HISTORY_FAILED",
            status: error?.status || null
        });
        return null;
    }
}
