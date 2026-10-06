"use strict";

export function getPlatformDisplayName(value) {
    const labels = { epic: "Epic", steam: "Steam", xbox: "Xbox", xboxone: "Xbox", playstation: "PlayStation",
        ps4: "PlayStation", ps5: "PlayStation", switch: "Nintendo Switch", nintendo_switch: "Nintendo Switch", psynet: "PsyNet" };
    return typeof value === "string" && value.trim() ? labels[value.trim().toLowerCase()] || value.trim() : "Platform not listed";
}

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
    return "Status unavailable";
}

export function getPublicProfilePageUrl(publicProfileId) {
    const id = typeof publicProfileId === "string" ? publicProfileId.trim() : "";
    return id ? `/RocketLeague/Player?id=${encodeURIComponent(id)}` : "/RocketLeague/FindPlayers";
}
