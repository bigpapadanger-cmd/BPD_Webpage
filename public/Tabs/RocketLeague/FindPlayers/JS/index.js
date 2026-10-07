"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { boundedJson } from "/scripts/boundedRequest.js";
import { ROCKET_LEAGUE_PLAYER_SEARCH_URL } from "/scripts/apiRoutes.js";
import { renderPlayers, renderSearchState, createPlayerCard } from "./view.js";

const MAX_RESULTS = 20;

async function searchPlayers(query, signal) {
    const url = new URL(ROCKET_LEAGUE_PLAYER_SEARCH_URL, window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(MAX_RESULTS));
    const { response, payload: result } = await boundedJson(url.pathname + url.search, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal
    }, { fetcher: apiFetch });
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
    form.bpdDispose?.();
    let activeController = null;
    const lifetime = new AbortController();
    form.bpdDispose = () => { lifetime.abort(); activeController?.abort(); };
    document.addEventListener("bpd:page-loaded", () => { if (!form.isConnected) form.bpdDispose(); }, { signal: lifetime.signal });
    window.addEventListener("pagehide", form.bpdDispose, { signal: lifetime.signal });

    const featured = document.getElementById("featuredPlayerSection");
    const featuredCard = document.getElementById("featuredPlayerCard");
    if (featuredCard) {
        void (async () => {
            try {
                const { response, payload } = await boundedJson("/api/rocketleague/players/featured", { cache: "no-store", signal: lifetime.signal, headers: { accept: "application/json" } }, { fetcher: apiFetch });
                if (lifetime.signal.aborted || !form.isConnected) return;
                if (!response.ok || payload?.success !== true) throw new Error("unavailable");
                if (payload.player) featuredCard.replaceChildren(createPlayerCard(document, payload.player, { featured: true }));
                else featuredCard.textContent = "No eligible public player is available today.";
            } catch { if (!lifetime.signal.aborted) featuredCard.textContent = "Today’s featured player is temporarily unavailable."; }
        })();
    }
    queryInput.addEventListener("input", () => {
        if (!queryInput.value.trim()) {
            activeController?.abort();
            submit.disabled = false;
            if (featured) featured.hidden = false;
            status.textContent = "";
            renderSearchState(document, results, "initial", "Search above to find public players.");
        }
    }, { signal: lifetime.signal });

    status.textContent = "";
    status.dataset.state = "ready";
    renderSearchState(document, results, "initial", "Search above to find players who enabled profile discovery.");

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
        const controller = activeController;
        if (featured) featured.hidden = true;
        submit.disabled = true;
        status.dataset.state = "loading";
        status.textContent = "Searching opted-in profiles…";
        renderSearchState(document, results, "loading", "Searching public profiles…");

        try {
            const players = await searchPlayers(query, controller.signal);
            if (controller.signal.aborted || lifetime.signal.aborted || !form.isConnected) return;
            renderPlayers(document, results, players);
            status.dataset.state = "ready";
            status.textContent = players.length
                ? `${players.length} player${players.length === 1 ? "" : "s"} found.`
                : "No public players found.";
        } catch (error) {
            if (error?.name === "AbortError" || controller.signal.aborted || lifetime.signal.aborted) return;
            status.dataset.state = "error";
            status.textContent = "Player search is temporarily unavailable. Please try again later.";
            renderSearchState(document, results, "error", "Player search could not be completed. Please try again later.");
        } finally {
            if (activeController === controller && !controller.signal.aborted) submit.disabled = false;
        }
    }, { signal: lifetime.signal });
}
