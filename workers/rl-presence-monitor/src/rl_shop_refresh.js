import { fetchBoundedResponse, withUpstreamDeadline } from "../../../functions/services/http/upstream.js";

const REQUEST_TIMEOUT_MS = 30000;
const RPC_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function fail(code) {
    return Object.assign(new Error(code), { code });
}

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function errorCode(value, fallback) {
    const candidate = cleanString(value);
    return /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate) ? candidate : fallback;
}

function supabaseConfiguration(env) {
    const root = cleanString(env?.SUPABASE_URL).replace(/\/+$/, "");
    const key = cleanString(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_AUTH);
    if (!root || !key) throw fail("SUPABASE_CONFIGURATION_MISSING");
    return { root: /\/rest\/v1$/i.test(root) ? `${root}/` : `${root}/rest/v1/`, key };
}

async function callRpc(env, name, payload) {
    const { root, key } = supabaseConfiguration(env);
    try {
    return await withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(new URL(`rpc/${name}`, root), {
            method: "POST",
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: JSON.stringify(payload),
            signal
        }, MAX_RESPONSE_BYTES);
        if (!response.ok) throw fail(`SUPABASE_${name.toUpperCase()}_FAILED`);
        const body = await response.text();
        if (!body) return null;
        try { return JSON.parse(body); } catch { throw fail("SUPABASE_RPC_INVALID_JSON"); }
    }, RPC_TIMEOUT_MS);
    } catch (error) {
        if (error?.code) throw error;
        throw fail(`SUPABASE_${name.toUpperCase()}_FAILED`);
    }
}

async function recordGlobalResult(env, success, changed, code = null) {
    return callRpc(env, "record_rl_global_refresh_result", {
        p_refresh_key: "shop",
        p_success: success,
        p_changed: success && changed,
        p_error_code: success ? null : errorCode(code, "RL_SHOP_REFRESH_FAILED")
    });
}

async function fetchShopSnapshot(env) {
    const baseUrl = cleanString(env?.MMR_API_URL);
    const apiKey = cleanString(env?.MMR_API_KEY);
    if (!baseUrl || !apiKey) throw fail("MMR_CONFIGURATION_MISSING");
    try {
        return await withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(new URL("/get-shop-data", baseUrl), {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal
        }, MAX_RESPONSE_BYTES);
        const length = Number(response.headers.get("Content-Length"));
        if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw fail("RL_SHOP_PROVIDER_RESPONSE_TOO_LARGE");
        let body;
        try { body = await response.text(); } catch { throw fail("RL_SHOP_PROVIDER_RESPONSE_INVALID"); }
        if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw fail("RL_SHOP_PROVIDER_RESPONSE_TOO_LARGE");
        let payload;
        try { payload = JSON.parse(body); } catch { throw fail("RL_SHOP_PROVIDER_RESPONSE_INVALID"); }
        if (!response.ok) throw fail(errorCode(payload?.code, `RL_SHOP_PROVIDER_HTTP_${response.status}`));
        if (payload?.success !== true || !Array.isArray(payload.shops) || !payload.shops.length || !Array.isArray(payload.catalogues) || !payload.catalogues.length) {
            throw fail("RL_SHOP_PROVIDER_RESPONSE_INVALID");
        }
        return { shops: payload.shops, catalogues: payload.catalogues, notifications: [] };
        }, REQUEST_TIMEOUT_MS);
    } catch (error) {
        if (error?.code) throw error;
        throw fail("RL_SHOP_PROVIDER_UNAVAILABLE");
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

async function contentHash(snapshot) {
    const bytes = new TextEncoder().encode(canonicalJson(snapshot));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function runRocketLeagueShopRefresh(env) {
    let snapshot;
    let saved;
    try {
        snapshot = await fetchShopSnapshot(env);
        const hash = await contentHash(snapshot);
        saved = await callRpc(env, "save_rl_shop_snapshot", {
            p_content_hash: hash,
            p_shops: snapshot.shops,
            p_catalogues: snapshot.catalogues,
            p_notifications: snapshot.notifications,
            p_provider_schema_version: 1,
            p_captured_at: new Date().toISOString()
        });
        if (!saved || typeof saved.saved !== "boolean") throw fail("SUPABASE_SHOP_SNAPSHOT_RESPONSE_INVALID");
    } catch (error) {
        const code = errorCode(error?.code, "RL_SHOP_REFRESH_FAILED");
        try { await recordGlobalResult(env, false, false, code); } catch { /* The refresh result is best-effort if Supabase is unavailable. */ }
        return { success: false, changed: false, errorCode: code };
    }

    try {
        await recordGlobalResult(env, true, saved.saved);
    } catch {
        return { success: false, changed: saved.saved, saved: true, errorCode: "RL_SHOP_CHECKPOINT_FAILED" };
    }
    return { success: true, changed: saved.saved, capturedAt: new Date().toISOString() };
}
