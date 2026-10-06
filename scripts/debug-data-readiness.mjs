import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { fetchBoundedResponse, withUpstreamDeadline } from "../functions/services/http/upstream.js";

const READS = [
    ["list_published_faqs", {}],
    ["get_rl_global_leaderboard", { p_playlist_id: 10, p_page: 1, p_page_size: 50,
        p_members_only: false, p_query: null, p_min_rank: null, p_max_rank: null }]
];
const SAFE_CODES = new Set(["PGRST202", "PGRST301", "42501", "42883", "UPSTREAM_TIMEOUT", "UPSTREAM_RESPONSE_TOO_LARGE"]);

// Fixed read-only calls, one attempt each. Never print keys, provider bodies,
// account/player records or SQL messages. This is not an HTTP proxy endpoint.
export async function checkDataReadiness(env, fetcher = fetch) {
    const root = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    const url = new URL(root);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("DATA_READINESS_CONFIG_INVALID");
    const results = [];
    for (const credential of ["SUPABASE_AUTH", "SUPABASE_SERVICE_ROLE_KEY"]) {
        const key = typeof env[credential] === "string" ? env[credential].trim() : "";
        if (!key) { results.push({ credential, configured: false }); continue; }
        for (const [rpc, args] of READS) {
            let httpStatus = null;
            try {
                const result = await withUpstreamDeadline(async signal => {
                    const response = await fetchBoundedResponse(`${root}/rest/v1/rpc/${rpc}`, {
                        method: "POST", signal, redirect: "error",
                        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
                            "Content-Profile": "api", "Accept-Profile": "api" }, body: JSON.stringify(args)
                    }, 512 * 1024, fetcher);
                    httpStatus = response.status;
                    const body = await response.json();
                    const collection = rpc === "list_published_faqs" ? body?.faqs : body?.rows;
                    const missingFunction = !response.ok && body?.code === "42883" && typeof body.message === "string"
                        ? body.message.match(/^function ((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\(/i)?.[1] || null : null;
                    return { credential, rpc, httpStatus, httpOk: response.ok,
                        code: response.ok ? null : SAFE_CODES.has(body?.code) ? body.code : "RPC_REJECTED",
                        contractValid: response.ok && body?.success === true && Array.isArray(collection),
                        rowCount: response.ok && Array.isArray(collection) ? collection.length : null,
                        ...(missingFunction ? { missingFunction } : {}) };
                }, 8000);
                results.push(result);
            } catch (error) {
                results.push({ credential, rpc, httpStatus, httpOk: false, contractValid: false,
                    code: SAFE_CODES.has(error?.code) ? error.code : "RPC_READ_UNAVAILABLE" });
            }
        }
    }
    return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 2) throw new Error("DATA_READINESS_ARGUMENTS_INVALID");
        const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
        const env = { ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || config.vars?.SUPABASE_URL };
        console.log(JSON.stringify(await checkDataReadiness(env), null, 2));
    } catch {
        console.error("DATA_READINESS_CONFIG_INVALID: use node --env-file=.dev.vars scripts/debug-data-readiness.mjs");
        process.exitCode = 1;
    }
}
