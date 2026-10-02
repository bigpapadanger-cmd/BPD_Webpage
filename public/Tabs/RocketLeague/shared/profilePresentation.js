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
