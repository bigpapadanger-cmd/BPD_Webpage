import { pathToFileURL } from "node:url";
import { withUpstreamDeadline, fetchBoundedResponse } from "../functions/services/http/upstream.js";

const failure = code => Object.assign(new Error(code), { code });

export async function callLeaderboardDiagnostic(env, fetcher = fetch) {
    let base;
    try {
        base = new URL(env.MMR_API_URL);
        if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error();
    } catch { throw failure("LEADERBOARD_DEBUG_URL_INVALID"); }
    if (typeof env.MMR_API_KEY !== "string" || !env.MMR_API_KEY.trim()) throw failure("LEADERBOARD_DEBUG_KEY_MISSING");
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(new URL("/get-leaderboard-diagnostic", base), {
            method: "GET", redirect: "manual", signal,
            headers: { Accept: "application/json", Authorization: `Bearer ${env.MMR_API_KEY.trim()}` }
        }, 128 * 1024, fetcher);
        if (!response.ok) throw failure(`LEADERBOARD_DEBUG_HTTP_${response.status}`);
        let data;
        try { data = await response.json(); } catch { throw failure("LEADERBOARD_DEBUG_RESPONSE_INVALID"); }
        if (data?.success !== true || data.playlist !== 10 || !Number.isSafeInteger(data.totalEntries)
            || data.totalEntries < 0 || data.totalEntries > 20000 || !Array.isArray(data.platforms) || data.platforms.length > 16) throw failure("LEADERBOARD_DEBUG_RESPONSE_INVALID");
        const platforms = data.platforms.map(group => {
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(group?.platform || "") || !Number.isSafeInteger(group.entryCount)
                || group.entryCount < 0 || !Array.isArray(group.samples) || group.samples.length > 5 || typeof group.mmrDescending !== "boolean") throw failure("LEADERBOARD_DEBUG_RESPONSE_INVALID");
            return { platform: group.platform, entryCount: group.entryCount, mmrDescending: group.mmrDescending,
                samples: group.samples.map(row => {
                    if (typeof row?.name !== "string" || row.name.length > 200 || !Number.isFinite(row.mmr)
                        || !(row.providerValue === null || Number.isSafeInteger(row.providerValue))) throw failure("LEADERBOARD_DEBUG_RESPONSE_INVALID");
                    return { name: row.name, mmr: row.mmr, providerValue: row.providerValue };
                }) };
        });
        if (platforms.reduce((sum, group) => sum + group.entryCount, 0) !== data.totalEntries) throw failure("LEADERBOARD_DEBUG_RESPONSE_INVALID");
        return { playlist: 10, totalEntries: data.totalEntries, positionSemanticsVerified: false, platforms };
    }, 40000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (!args.length || args[0] === "--help") {
        console.log("Manual contract diagnostic: node --env-file=.dev.vars scripts/debug-rl-leaderboard.mjs run\nOne protected Skills/GetSkillLeaderboard v1 read for playlist 10. No retries, writes or personal-ID input. Requires the separately approved Worker update. Do not run repeatedly.");
    } else if (args.length !== 1 || args[0] !== "run") {
        console.error("LEADERBOARD_DEBUG_ARGUMENTS_INVALID");
        process.exitCode = 1;
    } else {
        callLeaderboardDiagnostic(process.env).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
            console.error(/^(LEADERBOARD_DEBUG_[A-Z0-9_]+|UPSTREAM_[A-Z_]+)$/.test(error?.code || "") ? error.code : "LEADERBOARD_DEBUG_FAILED");
            process.exitCode = 1;
        });
    }
}
