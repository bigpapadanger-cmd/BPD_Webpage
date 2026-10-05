"use strict";

import { fetchBoundedResponse, withUpstreamDeadline } from "../../../functions/services/http/upstream.js";

const PLAYLISTS = Object.freeze([{ id: 10, mode: "1v1" }, { id: 11, mode: "2v2" }, { id: 13, mode: "3v3" }]);
const REQUEST_TIMEOUT_MS = 30000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const PLAYER_ID = /^(Epic|Steam|PS4|PS5|XboxOne|Switch|PsyNet)\|[A-Za-z0-9_.:@ -]{1,128}\|\d{1,3}$/;
const PLATFORMS = new Set(["Epic", "Steam", "PS4", "PS5", "XboxOne", "Switch", "PsyNet"]);

function fail(code) { return Object.assign(new Error(code), { code }); }
function text(value) { return typeof value === "string" ? value.trim() : ""; }

function configuration(env) {
    const root = text(env?.SUPABASE_URL).replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    const key = text(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH);
    try { if (!key || new URL(root).protocol !== "https:") throw new Error("configuration"); }
    catch { throw fail("SUPABASE_CONFIGURATION_MISSING"); }
    return { root, key };
}

async function rpc(env, name, payload) {
    const { root, key } = configuration(env);
    try {
        return await withUpstreamDeadline(async signal => {
            const response = await fetchBoundedResponse(new URL(`/rest/v1/rpc/${name}`, root), {
                method: "POST",
                headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
                    Accept: "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
                body: JSON.stringify(payload), signal
            }, 1024 * 1024);
            if (!response.ok) throw fail(`SUPABASE_${name.toUpperCase()}_FAILED`);
            try { return await response.json(); } catch { throw fail("SUPABASE_RESPONSE_INVALID"); }
        }, REQUEST_TIMEOUT_MS);
    } catch (error) {
        if (error?.code === "UPSTREAM_TIMEOUT") throw fail("SUPABASE_TIMEOUT");
        throw error?.code ? error : fail("SUPABASE_UNAVAILABLE");
    }
}

function normalizeProviderResponse(value, playlistId) {
    if (!value || value.success !== true || value.playlistId !== playlistId || !Array.isArray(value.entries) || value.entries.length > 20000) {
        throw fail("RL_LEADERBOARD_RESPONSE_INVALID");
    }
    const identities = new Set();
    const entries = value.entries.map(row => {
        if (!row || typeof row !== "object" || Array.isArray(row)
            || !PLATFORMS.has(row.platform) || typeof row.providerAccountId !== "string"
            || !PLAYER_ID.test(row.providerAccountId) || !row.providerAccountId.startsWith(`${row.platform}|`)
            || typeof row.displayName !== "string" || !row.displayName.trim() || row.displayName.length > 120
            || typeof row.mmr !== "number" || !Number.isFinite(row.mmr) || row.mmr < 0 || row.mmr > 5000
            || !(row.providerValue === null || row.providerValue === undefined || Number.isSafeInteger(row.providerValue))) {
            throw fail("RL_LEADERBOARD_ENTRY_INVALID");
        }
        const identity = `${row.platform}\0${row.providerAccountId}`;
        if (identities.has(identity)) throw fail("RL_LEADERBOARD_DUPLICATE_IDENTITY");
        identities.add(identity);
        return { provider_account_id: row.providerAccountId, platform: row.platform,
            display_name: row.displayName.trim(), mmr: row.mmr,
            provider_value: Number.isSafeInteger(row.providerValue) ? row.providerValue : null };
    });
    if (!entries.length) throw fail("RL_LEADERBOARD_EMPTY");
    return entries;
}

async function fetchPlaylist(env, playlistId) {
    const base = text(env?.MMR_API_URL);
    const key = text(env?.MMR_API_KEY);
    try { if (!key || new URL(base).protocol !== "https:") throw new Error("configuration"); }
    catch { throw fail("MMR_CONFIGURATION_MISSING"); }
    const url = new URL("/get-global-leaderboard", base);
    url.searchParams.set("playlistId", String(playlistId));
    try {
        return await withUpstreamDeadline(async signal => {
            const response = await fetchBoundedResponse(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal }, MAX_PROVIDER_RESPONSE_BYTES);
            if (!response.ok) throw fail("PROVIDER_LEADERBOARD_UNAVAILABLE");
            let result;
            try { result = await response.json(); } catch { throw fail("RL_LEADERBOARD_RESPONSE_INVALID"); }
            return normalizeProviderResponse(result, playlistId);
        }, REQUEST_TIMEOUT_MS);
    } catch (error) {
        if (error?.code === "UPSTREAM_TIMEOUT") throw fail("PROVIDER_LEADERBOARD_TIMEOUT");
        throw error?.code ? error : fail("PROVIDER_LEADERBOARD_UNAVAILABLE");
    }
}

export async function refreshGlobalRocketLeagueLeaderboards(env) {
    const results = [];
    for (const playlist of PLAYLISTS) {
        let snapshotId = null;
        try {
            const capturedAt = new Date().toISOString();
            const started = await rpc(env, "begin_rl_global_leaderboard_snapshot", { p_playlist_id: playlist.id, p_captured_at: capturedAt });
            if (started?.started !== true || typeof started.snapshotId !== "string") {
                results.push({ playlistId: playlist.id, success: started?.reason === "ALREADY_COMPLETE", skipped: true, reason: started?.reason || "SNAPSHOT_NOT_STARTED" });
                continue;
            }
            snapshotId = started.snapshotId;
            const entries = await fetchPlaylist(env, playlist.id);
            const completed = await rpc(env, "complete_rl_global_leaderboard_snapshot", {
                p_snapshot_id: snapshotId, p_entries: entries, p_source_entry_count: entries.length
            });
            if (completed?.success !== true || completed.entryCount !== entries.length) throw fail("RL_LEADERBOARD_PERSISTENCE_INVALID");
            results.push({ playlistId: playlist.id, gameMode: playlist.mode, success: true, changed: true, entryCount: entries.length });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "RL_LEADERBOARD_REFRESH_FAILED";
            if (snapshotId) {
                try { await rpc(env, "fail_rl_global_leaderboard_snapshot", { p_snapshot_id: snapshotId, p_error_code: code }); }
                catch { /* Keep processing later playlists; current completed snapshots remain untouched. */ }
            }
            results.push({ playlistId: playlist.id, gameMode: playlist.mode, success: false, errorCode: code });
        }
    }
    const succeeded = results.filter(item => item.success).length;
    const failed = results.filter(item => !item.success && !item.skipped).length;
    return { success: failed === 0, playlistCount: PLAYLISTS.length, succeeded, failed, results };
}
