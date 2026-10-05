const FIELDS = {
    playersOnline: "rocketLeaguePlayersOnline",
    registeredPlayers: "rocketLeagueRegisteredPlayers",
    activeSeasons: "rocketLeagueSeasonCount",
    upcomingEvents: "rocketLeagueUpcomingCount",
    matchesPlayed: "rocketLeagueMatchesPlayed",
    scoreboardsSubmitted: "rocketLeagueScoreboardsSubmitted",
    goalsRecorded: "rocketLeagueGoalsRecorded"
};

export function renderNetworkStatistics(documentRef, statistics) {
    for (const [key, id] of Object.entries(FIELDS)) {
        const node = documentRef.getElementById(id);
        if (node) node.textContent = Number.isSafeInteger(statistics?.[key]) && statistics[key] >= 0
            ? statistics[key].toLocaleString() : "—";
    }
}

export async function initializeNetworkStatistics(documentRef = document) {
    renderNetworkStatistics(documentRef, null);
    try {
        const response = await fetch("/api/rocketleague/network-statistics", { headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok || payload?.success !== true) throw new Error("unavailable");
        renderNetworkStatistics(documentRef, payload);
    } catch { renderNetworkStatistics(documentRef, null); }
}
