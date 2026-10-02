"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { ROCKET_LEAGUE_PLAYER_SEARCH_URL } from "/scripts/apiRoutes.js";
import {
    getPublicPresenceLabel,
    getPublicProfilePageUrl
} from "../shared/profileView.js";

const MAX_RESULTS = 20;

function textElement(tagName, text, className = "") {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function addFact(container, label, value) {
    const fact = document.createElement("div");
    fact.className = "rl-player-fact";
    fact.append(
        textElement("span", label),
        textElement("strong", value || "—")
    );
    container.append(fact);
}

function formatMmr(tier, mmr) {
    const parts = [];
    if (tier) parts.push(tier);
    if (Number.isSafeInteger(mmr) && mmr >= 0) parts.push(`${mmr.toLocaleString()} MMR`);
    return parts.join(" · ") || "Unavailable";
}

function createPlayerCard(player) {
    const card = document.createElement("article");
    card.className = "rl-player-card";

    const identity = document.createElement("div");
    identity.append(textElement("h2", player.display_name || player.epic_display_name || "Rocket League player"));
    if (player.epic_display_name && player.epic_display_name !== player.display_name) {
        identity.append(textElement("p", `Epic: ${player.epic_display_name}`, "rl-player-secondary"));
    }
    card.append(identity);

    const meta = document.createElement("div");
    meta.className = "rl-player-meta";
    addFact(meta, "Platform", player.rl_platform || "Not listed");
    addFact(meta, "Presence", getPublicPresenceLabel(player));
    card.append(meta);

    const ranks = document.createElement("div");
    ranks.className = "rl-player-ranks";
    addFact(ranks, "1v1", formatMmr(player.mmr?.ones_tier, player.mmr?.ones_mmr));
    addFact(ranks, "2v2", formatMmr(player.mmr?.twos_tier, player.mmr?.twos_mmr));
    addFact(ranks, "3v3", formatMmr(player.mmr?.threes_tier, player.mmr?.threes_mmr));
    card.append(ranks);

    const profileLink = document.createElement("a");
    profileLink.href = getPublicProfilePageUrl(player.public_profile_id);
    profileLink.textContent = "View public profile";
    card.append(profileLink);
    return card;
}

function renderPlayers(container, players) {
    container.replaceChildren();
    if (!players.length) {
        container.append(textElement("p", "No opted-in players matched that search.", "rl-empty-state"));
        return;
    }
    players.slice(0, MAX_RESULTS).forEach((player) => container.append(createPlayerCard(player)));
}

async function searchPlayers(query, signal) {
    const url = new URL(ROCKET_LEAGUE_PLAYER_SEARCH_URL, window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(MAX_RESULTS));
    const response = await apiFetch(url.pathname + url.search, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true || !Array.isArray(result.players)) {
        throw new Error("Player search is temporarily unavailable.");
    }
    return result.players;
}

export async function initializePage() {
    const form = document.getElementById("playerSearchForm");
    const queryInput = document.getElementById("playerSearchQuery");
    const results = document.getElementById("playerSearchResults");
    const status = document.getElementById("playerSearchStatus");
    const submit = document.getElementById("playerSearchSubmit");
    if (!form || !queryInput || !results || !status || !submit) return;

    let activeController = null;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = queryInput.value.trim();
        if (query.length < 2 || query.length > 80) {
            status.textContent = "Enter between 2 and 80 characters to search.";
            status.dataset.state = "error";
            queryInput.focus();
            return;
        }

        activeController?.abort();
        activeController = new AbortController();
        submit.disabled = true;
        status.dataset.state = "loading";
        status.textContent = "Searching opted-in profiles…";
        results.replaceChildren();

        try {
            const players = await searchPlayers(query, activeController.signal);
            renderPlayers(results, players);
            status.dataset.state = "ready";
            status.textContent = players.length
                ? `${players.length} player${players.length === 1 ? "" : "s"} found.`
                : "No opted-in players matched that search.";
        } catch (error) {
            if (error?.name === "AbortError") return;
            status.dataset.state = "error";
            status.textContent = "Player search is temporarily unavailable. Please try again later.";
        } finally {
            if (activeController?.signal.aborted !== true) submit.disabled = false;
        }
    });
}
