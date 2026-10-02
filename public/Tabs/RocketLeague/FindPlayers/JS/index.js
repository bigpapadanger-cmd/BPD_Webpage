"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { ROCKET_LEAGUE_PLAYER_SEARCH_URL } from "/scripts/apiRoutes.js";
import { renderPlayers, renderSearchState } from "./view.js";

const MAX_RESULTS = 20;

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

    status.textContent = "Search for a Rocket League player.";
    status.dataset.state = "ready";
    renderSearchState(document, results, "initial", "Search for a Rocket League player.");

    let activeController = null;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = queryInput.value.trim();
        if (query.length < 2 || query.length > 80) {
            status.textContent = "Enter between 2 and 80 characters to search.";
            status.dataset.state = "error";
            renderSearchState(document, results, "error", "Enter a player name between 2 and 80 characters.");
            queryInput.focus();
            return;
        }

        activeController?.abort();
        activeController = new AbortController();
        submit.disabled = true;
        status.dataset.state = "loading";
        status.textContent = "Searching opted-in profiles…";
        renderSearchState(document, results, "loading", "Searching public profiles…");

        try {
            const players = await searchPlayers(query, activeController.signal);
            renderPlayers(document, results, players);
            status.dataset.state = "ready";
            status.textContent = players.length
                ? `${players.length} player${players.length === 1 ? "" : "s"} found.`
                : "No public players found.";
        } catch (error) {
            if (error?.name === "AbortError") return;
            status.dataset.state = "error";
            status.textContent = "Player search is temporarily unavailable. Please try again later.";
            renderSearchState(document, results, "error", "Player search could not be completed. Please try again later.");
        } finally {
            if (activeController?.signal.aborted !== true) submit.disabled = false;
        }
    });
}
