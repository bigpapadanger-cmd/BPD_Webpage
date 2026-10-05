"use strict";

export function formatRocketLeagueTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";

    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(date);
}

export function getRocketLeagueRankClass(rankName) {
    const rank = typeof rankName === "string" ? rankName.trim().toLowerCase() : "";
    if (!rank || rank.includes("unranked")) return "rank-unranked";
    if (rank.includes("supersonic legend") || rank === "ssl") return "rank-supersonic-legend";
    if (rank.includes("grand champion") || rank.startsWith("gc ") || rank === "gc") return "rank-grand-champion";
    if (rank.includes("champion")) return "rank-champion";
    if (rank.includes("diamond")) return "rank-diamond";
    if (rank.includes("platinum")) return "rank-platinum";
    if (rank.includes("gold")) return "rank-gold";
    if (rank.includes("silver")) return "rank-silver";
    if (rank.includes("bronze")) return "rank-bronze";
    return "rank-unranked";
}
