import { verifyBackgroundEpicAccount } from "../../../functions/services/rl/authorization.js";
import { refreshDiscordAccountEligibility, refreshDiscordBotGuildInventory } from "../../../functions/services/auth/providers/discord_matchbot/eligibility.js";

const PAGE_SIZE = 20;
const CURSOR_KEY = "rl:scheduled-refresh:cursor";
const REQUEST_TIMEOUT_MS = 30000;
const PLAYLISTS = { ones: 10, twos: 11, threes: 13 };
const TIERS = ["Unranked", "Bronze I", "Bronze II", "Bronze III", "Silver I", "Silver II", "Silver III", "Gold I", "Gold II", "Gold III", "Platinum I", "Platinum II", "Platinum III", "Diamond I", "Diamond II", "Diamond III", "Champion I", "Champion II", "Champion III", "Grand Champion I", "Grand Champion II", "Grand Champion III", "Supersonic Legend"];
const COMPONENTS = ["mmr", "provider", "club", "career_stats", "match_history", "discord"];

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function failure(code) { return Object.assign(new Error(code), { code }); }

function configuration(env) {
    const baseUrl = text(env?.SUPABASE_URL).replace(/\/+$/, "");
    const apiKey = text(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH);
    if (!baseUrl || !apiKey) throw failure("SUPABASE_CONFIGURATION_MISSING");
    return { baseUrl: /\/rest\/v1$/i.test(baseUrl) ? `${baseUrl}/` : `${baseUrl}/rest/v1/`, apiKey };
}

async function callRpc(env, rpcName, payload) {
    const { baseUrl, apiKey } = configuration(env);
    const response = await fetch(new URL(`rpc/${rpcName}`, baseUrl), {
        method: "POST",
        headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Content-Profile": "api",
            "Accept-Profile": "api"
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw failure(`SUPABASE_${rpcName.toUpperCase()}_FAILED`);
    const body = await response.text();
    if (!body) return null;
    try { return JSON.parse(body); } catch { throw failure("SUPABASE_RPC_INVALID_JSON"); }
}

function normalizeMmr(value) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isInteger(result) && result >= 0 && result <= 5000 ? result : null;
}

function skillSnapshot(data) {
    const rows = Array.isArray(data?.playlists) ? data.playlists : [];
    const get = id => rows.find(row => Number(row?.id) === id) || null;
    const mmr = key => normalizeMmr(get(PLAYLISTS[key])?.mmr);
    const tier = key => {
        const value = Number(get(PLAYLISTS[key])?.tier);
        return Number.isInteger(value) ? TIERS[value] || null : null;
    };
    const snapshot = {
        ones_mmr: mmr("ones"), twos_mmr: mmr("twos"), threes_mmr: mmr("threes"),
        ones_tier: tier("ones"), twos_tier: tier("twos"), threes_tier: tier("threes")
    };
    if (Object.values(snapshot).every(value => value === null)) throw failure("MMR_PRIMARY_PLAYLISTS_MISSING");
    return snapshot;
}

function completeStats(data) {
    const fields = ["wins", "goals", "assists", "saves", "shots", "mvps"];
    if (!data || fields.some(field => !Number.isSafeInteger(data[field]) || data[field] < 0)) return null;
    return Object.fromEntries(fields.map(field => [field, data[field]]));
}

async function fetchCapabilities(env, candidate, capabilities) {
    const baseUrl = text(env?.MMR_API_URL);
    const apiKey = text(env?.MMR_API_KEY);
    if (!baseUrl || !apiKey) throw failure("MMR_CONFIGURATION_MISSING");
    const url = new URL("/get-player-data", baseUrl);
    url.searchParams.set("playerId", `Epic|${candidate.epic_account_id}|0`);
    url.searchParams.set("capabilities", capabilities.join(","));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal: controller.signal
        });
        if (!response.ok) throw failure(`PROVIDER_WORKER_HTTP_${response.status}`);
        let payload;
        try { payload = await response.json(); } catch { throw failure("PROVIDER_WORKER_RESPONSE_INVALID"); }
        if (payload?.success !== true || !payload.capabilities || typeof payload.capabilities !== "object") throw failure("PROVIDER_WORKER_RESPONSE_INVALID");
        return payload.capabilities;
    } finally { clearTimeout(timeout); }
}

export async function persistCapability(env, candidate, component, capabilities) {
    const capturedAt = new Date().toISOString();
    if (component === "mmr") {
        const result = capabilities?.skills;
        if (result?.status !== "success") throw failure(result?.error?.code || "MMR_CAPABILITY_UNAVAILABLE");
        const snapshot = skillSnapshot(result.data);
        const persisted = await callRpc(env, "save_rl_player_mmr_snapshot_v2", {
            p_account_id: candidate.account_id,
            p_epic_account_id: candidate.epic_account_id,
            p_captured_at: capturedAt,
            p_ones_mmr: snapshot.ones_mmr,
            p_twos_mmr: snapshot.twos_mmr,
            p_threes_mmr: snapshot.threes_mmr,
            p_ones_tier: snapshot.ones_tier,
            p_twos_tier: snapshot.twos_tier,
            p_threes_tier: snapshot.threes_tier,
            p_source: "mmr-api-v2"
        });
        if (typeof persisted?.saved !== "boolean") throw failure("MMR_SNAPSHOT_RESPONSE_INVALID");
        return { changed: persisted.saved };
    }
    if (component === "provider") {
        const result = capabilities?.profile;
        const name = text(result?.data?.display_username);
        if (result?.status !== "success" || !name) throw failure(result?.error?.code || "PROVIDER_PROFILE_UNAVAILABLE");
        await callRpc(env, "save_rl_player_provider_profile", {
            p_account_id: candidate.account_id,
            p_display_username: name,
            p_level: null,
            p_xp: null,
            p_creator_code: null,
            p_provider_updated_at: null
        });
        return;
    }
    if (component === "career_stats") {
        const result = capabilities?.stats;
        if (result?.status !== "success") throw failure(result?.error?.code || (result?.status === "incomplete" ? "RL_CAREER_STATS_INCOMPLETE" : "CAREER_STATS_UNAVAILABLE"));
        const stats = completeStats(result.data);
        if (!stats) throw failure("RL_CAREER_STATS_INVALID");
        await callRpc(env, "save_rl_player_stats", {
            p_account_id: candidate.account_id,
            p_wins: stats.wins,
            p_goals: stats.goals,
            p_assists: stats.assists,
            p_saves: stats.saves,
            p_shots: stats.shots,
            p_mvps: stats.mvps,
            p_captured_at: result.captured_at || capturedAt
        });
        return;
    }
    if (component === "club") {
        const result = capabilities?.club;
        if (result?.status !== "success" || !result.data) throw failure(result?.error?.code || "CLUB_CAPABILITY_UNAVAILABLE");
        const data = result.data;
        if (!Number.isSafeInteger(data.club_id) || data.club_id < 0 || !text(data.club_name)) throw failure("RL_CLUB_DATA_INVALID");
        await callRpc(env, "save_rl_player_club", {
            p_account_id: candidate.account_id,
            p_club_id: data.club_id,
            p_club_name: data.club_name,
            p_club_tag: data.club_tag ?? null,
            p_primary_color: data.primary_color ?? null,
            p_accent_color: data.accent_color ?? null,
            p_equipped_title: data.equipped_title ?? null,
            p_owner_player_id: data.owner_player_id ?? null,
            p_verified: data.verified ?? null,
            p_club_created_at: data.club_created_at ?? null,
            p_club_last_updated_at: data.club_last_updated_at ?? null,
            p_club_name_last_updated_at: data.club_name_last_updated_at ?? null,
            p_club_deleted_at: data.club_deleted_at ?? null,
            p_provider_payload: null,
            p_captured_at: capturedAt
        });
        return;
    }
    throw failure("REFRESH_COMPONENT_UNSUPPORTED");
}

async function recordComponent(env, candidate, component, success, errorCode = null) {
    await callRpc(env, "record_rl_player_refresh_result", {
        p_account_id: candidate.account_id,
        p_component: component,
        p_success: success,
        p_error_code: success ? null : String(errorCode || "REFRESH_FAILED").slice(0, 80)
    });
}

function requestedCapabilities(candidate) {
    const capabilities = [];
    if (candidate.mmr_due === true) capabilities.push("skills");
    if (candidate.provider_due === true) capabilities.push("profile");
    if (candidate.club_due === true) capabilities.push("club");
    if (candidate.career_stats_due === true) capabilities.push("stats");
    return capabilities;
}

export async function refreshCandidate(env, candidate, { discordInventory = null } = {}) {
    const due = COMPONENTS.filter(component => ({
        mmr: candidate.mmr_due,
        provider: candidate.provider_due,
        club: candidate.club_due,
        career_stats: candidate.career_stats_due,
        match_history: candidate.match_history_due,
        discord: candidate.discord_due
    })[component] === true);
    if (!due.length) return { attempted: 0, succeeded: 0, failed: 0, mmrChanged: 0, mmrUnchanged: 0 };

    const requested = requestedCapabilities(candidate);
    let capabilities = {};
    let sharedFailure = null;
    if (requested.length) {
        try {
            if (!await verifyBackgroundEpicAccount(env, candidate.account_id, candidate.epic_account_id)) throw failure("EPIC_AUTHORIZATION_REQUIRED");
            capabilities = await fetchCapabilities(env, candidate, requested);
        } catch (error) { sharedFailure = error?.code || "PROVIDER_REFRESH_FAILED"; }
    }

    let succeeded = 0;
    let failed = 0;
    let mmrChanged = 0;
    let mmrUnchanged = 0;
    for (const component of due) {
        let errorCode = sharedFailure;
        let success = false;
        if (component === "match_history") errorCode = "RL_MATCH_HISTORY_AUTHENTICATED_PLAYER_ONLY";
        else if (component === "discord") {
            try {
                if (!discordInventory?.complete) throw failure("DISCORD_INVENTORY_UNAVAILABLE");
                await refreshDiscordAccountEligibility(env, candidate.account_id, { inventory: discordInventory });
                success = true;
            } catch (error) { errorCode = error?.code || "DISCORD_PROVIDER_UNAVAILABLE"; }
        }
        else if (!errorCode) {
            try {
                const persisted = await persistCapability(env, candidate, component, capabilities);
                if (component === "mmr" && typeof persisted?.changed === "boolean") {
                    if (persisted.changed) mmrChanged += 1;
                    else mmrUnchanged += 1;
                }
                success = true;
            }
            catch (error) { errorCode = error?.code || "REFRESH_PERSIST_FAILED"; }
        }
        try { await recordComponent(env, candidate, component, success, errorCode); }
        catch { success = false; errorCode = "REFRESH_CHECKPOINT_FAILED"; }
        if (success) succeeded += 1;
        else failed += 1;
    }
    return { attempted: due.length, succeeded, failed, mmrChanged, mmrUnchanged };
}

export async function runRocketLeagueRefreshCycle(env, { forceDiscordInventory = false, reconcileDiscordInventory = false } = {}) {
    const kv = env?.SERVICE_STATUS;
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") throw failure("REFRESH_CURSOR_STORAGE_UNAVAILABLE");
    let discordInventory = null;
    let discordInventoryError = null;
    if (reconcileDiscordInventory) {
        try { discordInventory = await refreshDiscordBotGuildInventory(env, { force: forceDiscordInventory }); }
        catch (error) { discordInventoryError = error?.code || "DISCORD_INVENTORY_UNAVAILABLE"; }
    }
    const afterPlayerId = text(await kv.get(CURSOR_KEY));
    const rows = await callRpc(env, "get_rl_refresh_candidates", {
        p_after_player_id: afterPlayerId || null,
        p_limit: PAGE_SIZE
    });
    if (!Array.isArray(rows)) throw failure("REFRESH_CANDIDATES_INVALID");
    if (!rows.length) {
        await kv.delete?.(CURSOR_KEY);
        return { success: !discordInventoryError, candidateCount: 0, attempted: 0, succeeded: 0, failed: 0, mmrChanged: 0, mmrUnchanged: 0, discordInventoryAvailable: reconcileDiscordInventory ? discordInventory !== null : null, discordInventoryError, cursorReset: true };
    }
    const hasDiscordDue = rows.some(candidate => candidate?.discord_due === true);
    if (hasDiscordDue && !discordInventory && !reconcileDiscordInventory) {
        try { discordInventory = await refreshDiscordBotGuildInventory(env, { force: forceDiscordInventory }); }
        catch (error) { discordInventoryError = error?.code || "DISCORD_INVENTORY_UNAVAILABLE"; }
    }
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let mmrChanged = 0;
    let mmrUnchanged = 0;
    for (const candidate of rows) {
        if (!text(candidate?.account_id) || !text(candidate?.player_id) || !text(candidate?.epic_account_id)) {
            failed += 1;
            continue;
        }
        try {
            const result = await refreshCandidate(env, candidate, { discordInventory });
            attempted += result.attempted;
            succeeded += result.succeeded;
            failed += result.failed;
            mmrChanged += result.mmrChanged;
            mmrUnchanged += result.mmrUnchanged;
        } catch { failed += 1; }
    }
    await kv.put(CURSOR_KEY, text(rows.at(-1)?.player_id), { expirationTtl: 7 * 24 * 60 * 60 });
    return { success: failed === 0 && !discordInventoryError, candidateCount: rows.length, attempted, succeeded, failed, mmrChanged, mmrUnchanged, discordInventoryAvailable: reconcileDiscordInventory || hasDiscordDue ? discordInventory !== null : null, discordInventoryError, nextCursorStored: true };
}
