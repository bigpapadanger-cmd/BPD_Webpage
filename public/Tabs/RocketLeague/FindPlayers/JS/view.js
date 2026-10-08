"use strict";

import {
    getPublicPresenceLabel,
    getPlatformDisplayName,
    getPublicProfilePageUrl
} from "../../shared/profileView.js?v=20261006-platform";
import { getRocketLeagueRankClass } from "../../shared/profilePresentation.js";

const PLAYLISTS = [
    ["ones_tier", "ones_mmr", "1v1"],
    ["twos_tier", "twos_mmr", "2v2"],
    ["threes_tier", "threes_mmr", "3v3"]
];

function textElement(documentRef, tagName, text, className = "") {
    const element = documentRef.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function getPresenceState(player) {
    if (player?.presence_shared !== true) return "private";
    const state = typeof player.presence_state === "string" ? player.presence_state.toLowerCase() : "unknown";
    return ["online", "offline"].includes(state) ? state : "unknown";
}

export function createPlayerCard(documentRef, player, { featured = false } = {}) {
    const card = documentRef.createElement("article");
    card.className = "rl-player-card";

    const header = documentRef.createElement("header");
    header.className = "rl-player-header";
    const identity = documentRef.createElement("div");
    identity.className = "rl-player-identity";
    const name = player.display_name || player.epic_display_name || "Rocket League player";
    const heading = textElement(documentRef, "h2", name, "rl-player-name");
    heading.title = name;
    identity.append(heading);
    if (player.epic_display_name && player.epic_display_name !== player.display_name) {
        const epicName = textElement(documentRef, "p", `Epic · ${player.epic_display_name}`, "rl-player-secondary");
        epicName.title = player.epic_display_name;
        identity.append(epicName);
    }

    const badges = documentRef.createElement("div");
    badges.className = "rl-player-badges";
    badges.append(textElement(documentRef, "span", getPlatformDisplayName(player.rl_platform), "rl-player-platform"));
    if (!featured && typeof player.match_percent === "number" && Number.isFinite(player.match_percent)
        && player.match_percent >= 0 && player.match_percent < 100) {
        badges.append(textElement(documentRef, "span", `${Math.round(player.match_percent)}% match`, "rl-player-platform rl-player-match"));
    }
    const presence = textElement(documentRef, "span", getPublicPresenceLabel(player), "rl-player-presence");
    presence.dataset.presence = getPresenceState(player);
    badges.append(presence);
    header.append(identity, badges);
    card.append(header);

    const ranks = documentRef.createElement("div");
    ranks.className = "rl-player-ranks";
    ranks.setAttribute("aria-label", "Competitive playlist ranks");
    for (const [tierKey, mmrKey, label] of PLAYLISTS) {
        const rank = documentRef.createElement("div");
        const tier = typeof player.mmr?.[tierKey] === "string" ? player.mmr[tierKey] : "Rank unavailable";
        rank.className = `rl-player-rank ${getRocketLeagueRankClass(tier)}`;
        rank.append(textElement(documentRef, "span", label, "rl-player-rank-label"));
        rank.append(textElement(documentRef, "strong", tier, "rl-player-rank-tier"));
        const mmr = player.mmr?.[mmrKey];
        rank.append(textElement(documentRef, "small", Number.isSafeInteger(mmr) && mmr >= 0 ? `${mmr.toLocaleString()} MMR` : "MMR unavailable", "rl-player-rank-mmr"));
        ranks.append(rank);
    }
    card.append(ranks);

    const career = Object.entries(featured ? player.stats || {} : {}).filter(([key, value]) =>
        ["wins", "goals", "assists", "saves", "shots", "mvps"].includes(key) && Number.isSafeInteger(value) && value >= 0);
    if (career.length) card.append(textElement(documentRef, "p", career.map(([key, value]) => `${value.toLocaleString()} ${key === "mvps" ? "MVPs" : key}`).join(" · "), "rl-player-career"));

    const profileLink = documentRef.createElement("a");
    profileLink.className = "rl-player-profile-link";
    profileLink.href = getPublicProfilePageUrl(player.public_profile_id);
    profileLink.textContent = "View Profile";
    profileLink.setAttribute("aria-label", `View public profile for ${name}`);
    card.append(profileLink);
    return card;
}

export function renderPlayers(documentRef, container, players) {
    container.replaceChildren();
    if (!players.length) {
        container.append(textElement(documentRef, "p", "No public players found.", "rl-search-state rl-search-state-empty"));
        return;
    }
    players.slice(0, 20).forEach(player => container.append(createPlayerCard(documentRef, player)));
}

export function renderSearchState(documentRef, container, state, message) {
    container.replaceChildren();
    if (state === "ready") return;
    const className = `rl-search-state rl-search-state-${state}`;
    container.append(textElement(documentRef, "p", message, className));
}
