"use strict";

export function getPublicPresenceLabel(profile) {
    if (profile?.presence_shared !== true) {
        return "Presence not shared.";
    }

    const state = typeof profile.presence_state === "string"
        ? profile.presence_state.trim()
        : "";
    const normalizedState = state.toLowerCase();
    if (normalizedState === "unknown") return "Status unavailable";
    if (normalizedState === "online") return "Online";
    if (normalizedState === "offline") return "Offline";
    return state || "Status unavailable";
}

export function getPublicProfilePageUrl(publicProfileId) {
    const id = typeof publicProfileId === "string" ? publicProfileId.trim() : "";
    return id ? `/RocketLeague/Player?id=${encodeURIComponent(id)}` : "/RocketLeague/FindPlayers";
}
