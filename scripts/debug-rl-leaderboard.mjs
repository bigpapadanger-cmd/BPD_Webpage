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
        const invalid = () => failure("LEADERBOARD_DEBUG_RESPONSE_INVALID");
        const validatePlatformRows = (board, { stats = false } = {}) => {
            if (typeof board?.leaderboardId !== "string" || !Number.isSafeInteger(board.totalEntries)
                || board.totalEntries < 0 || board.totalEntries > 20000 || !Array.isArray(board.platforms) || board.platforms.length > 16) throw invalid();
            const platforms = board.platforms.map(group => {
                if (!/^[A-Za-z0-9_-]{1,32}$/.test(group?.platform || "") || !Number.isSafeInteger(group.entryCount)
                    || group.entryCount < 0 || !Array.isArray(group.samples) || group.samples.length > 5) throw invalid();
                if (stats ? typeof group.rankFieldPresent !== "boolean" || typeof group.rankAscending !== "boolean"
                    : typeof group.mmrDescending !== "boolean") throw invalid();
                return { platform: group.platform, entryCount: group.entryCount,
                    ...(stats ? { rankFieldPresent: group.rankFieldPresent, rankAscending: group.rankAscending } : { mmrDescending: group.mmrDescending }),
                    samples: group.samples.map(row => {
                        if (typeof row?.name !== "string" || row.name.length > 200 || !Number.isFinite(row.value ?? row.mmr)
                            || (stats ? !Number.isSafeInteger(row.providerRank) || row.providerRank < 0
                                : !(row.providerValue === null || Number.isSafeInteger(row.providerValue)))) throw invalid();
                        return stats ? { name: row.name, value: row.value, providerRank: row.providerRank }
                            : { name: row.name, mmr: row.mmr, providerValue: row.providerValue };
                    }) };
            });
            if (platforms.reduce((sum, group) => sum + group.entryCount, 0) !== board.totalEntries) throw invalid();
            return { leaderboardId: board.leaderboardId, totalEntries: board.totalEntries, platforms };
        };
        if (data?.success !== true || !Array.isArray(data.skills) || data.skills.length !== 3
            || ![10, 11, 13].every((playlist, index) => data.skills[index]?.playlist === playlist
                && data.skills[index]?.positionSemanticsVerified === false
                && data.skills[index]?.paginationParametersDocumented === false)
            || typeof data.stats?.stat !== "string" || typeof data.stats?.userCheck?.valueForUserMatchesLeaderboard !== "boolean"
            || !Array.isArray(data.requestShape?.skillLeaderboardPaginationFields) || data.requestShape.skillLeaderboardPaginationFields.length
            || !Array.isArray(data.requestShape?.statsLeaderboardPaginationFields) || data.requestShape.statsLeaderboardPaginationFields.length) throw invalid();
        const skills = data.skills.map(board => ({ playlist: board.playlist, ...validatePlatformRows(board) }));
        const stats = { stat: data.stats.stat, ...validatePlatformRows(data.stats, { stats: true }), userCheck: data.stats.userCheck };
        if (!data.skillValueCheck || typeof data.skillValueCheck.valueForUserMatchesLeaderboard !== "boolean"
            || typeof data.skillValueCheck.rankForUsersValueMatchesLeaderboard !== "boolean") throw invalid();
        return { skills, skillValueCheck: data.skillValueCheck, stats,
            requestShape: { skillLeaderboardPaginationFields: [], statsLeaderboardPaginationFields: [], resultLimit: String(data.requestShape.resultLimit || "Unknown") } };
    }, 75000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (!args.length || args[0] === "--help") {
        console.log("Manual contract diagnostic: node --env-file=.dev.vars scripts/debug-rl-leaderboard.mjs run\nRuns 3 protected Skills leaderboards (playlists 10/11/13), one Skill value/rank cross-check and one Wins stats leaderboard/value/rank check: at most 8 PsyNet calls, no retries, writes or personal-ID input. Requires deployment of the separately reviewed Worker update. Run once only.");
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
