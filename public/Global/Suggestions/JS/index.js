"use strict";
import { boundedJson } from "/scripts/boundedRequest.js";

import { getAuthState, hasActiveAccount, isAuthenticated } from "/Framework/Auth/auth.js";
import { SUGGESTIONS_API_URL, suggestionVoteApiUrl } from "/scripts/apiRoutes.js";

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text ?? "");
    if (className) node.className = className;
    return node;
}

function loginUrl() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    return `/Login?returnTo=${encodeURIComponent(returnTo)}`;
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleDateString();
}

export async function initializePage() {
    const form = document.getElementById("suggestionForm");
    const formStatus = document.getElementById("suggestionFormStatus");
    const list = document.getElementById("suggestionsList");
    const listStatus = document.getElementById("suggestionsListStatus");
    const loginLink = document.getElementById("suggestionLoginLink");
    const authNotice = document.getElementById("suggestionAuthNotice");
    const refreshButton = document.getElementById("refreshSuggestions");
    if (!form || !list || !listStatus) return;
    form.bpdDispose?.();
    const lifetime = new AbortController();
    form.bpdDispose = () => lifetime.abort();
    document.addEventListener("bpd:page-loaded", () => { if (!form.isConnected) lifetime.abort(); }, { signal: lifetime.signal });
    window.addEventListener("pagehide", form.bpdDispose, { signal: lifetime.signal });

    let auth = null;
    try {
        auth = await getAuthState();
    } catch {
        // Public browsing does not depend on an available login service.
    }
    const authenticated = isAuthenticated(auth) && hasActiveAccount(auth);
    if (!authenticated) {
        authNotice.textContent = "Sign in is required to submit an idea or vote.";
        loginLink.href = loginUrl();
        loginLink.hidden = false;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!authenticated) {
            window.location.assign(loginUrl());
            return;
        }

        const submitButton = form.querySelector("button[type='submit']");
        const title = form.elements.title.value.trim();
        const description = form.elements.description.value.trim();
        submitButton.disabled = true;
        formStatus.textContent = "Submitting for staff review…";
        try {
            const { response, payload: result } = await boundedJson(SUGGESTIONS_API_URL, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ title, description }), signal: lifetime.signal
            });
            if (lifetime.signal.aborted) return;
            if (response.status === 401 || response.status === 403) {
                window.location.assign(loginUrl());
                return;
            }
            if (!response.ok || result.success !== true) throw new Error("SUBMISSION_FAILED");
            form.reset();
            formStatus.textContent = "Thanks. Your suggestion is pending staff approval and is not public yet.";
        } catch {
            formStatus.textContent = "We could not submit this suggestion. Please try again.";
        } finally {
            submitButton.disabled = false;
        }
    }, { signal: lifetime.signal });

    async function loadSuggestions() {
        refreshButton.disabled = true;
        listStatus.textContent = "Loading approved suggestions…";
        list.replaceChildren();
        try {
            const { response, payload: result } = await boundedJson(SUGGESTIONS_API_URL, {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                cache: "no-store", signal: lifetime.signal
            });
            if (lifetime.signal.aborted || !list.isConnected) return;
            if (!response.ok || result.success !== true) throw new Error("LIST_FAILED");
            const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
            if (!suggestions.length) {
                listStatus.textContent = "No approved suggestions yet.";
                return;
            }
            listStatus.textContent = "";
            for (const suggestion of suggestions) list.append(createSuggestionCard(suggestion, authenticated, loadSuggestions));
        } catch {
            listStatus.textContent = "Suggestions are unavailable right now. Please retry.";
        } finally {
            refreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener("click", loadSuggestions, { signal: lifetime.signal });
    await loadSuggestions();
}

function createSuggestionCard(suggestion, authenticated, refresh) {
    const card = element("article", undefined, "suggestion-card");
    const header = element("header", undefined, "suggestion-card-header");
    const heading = element("h3", suggestion.title);
    const vote = element("button", undefined, "suggestion-vote");
    vote.type = "button";
    vote.setAttribute("aria-pressed", suggestion.user_upvoted === true ? "true" : "false");
    vote.textContent = `${suggestion.user_upvoted === true ? "Remove vote" : "▲ Vote"} · ${Number(suggestion.upvotes) || 0}`;
    const metadata = element("p", `${suggestion.creator_display_name || "BPD member"} · ${formatDate(suggestion.created_at)}`, "suggestion-meta");
    const description = element("p", suggestion.description);
    vote.addEventListener("click", async () => {
        if (!authenticated) {
            window.location.assign(loginUrl());
            return;
        }
        vote.disabled = true;
        try {
            const { response, payload: result } = await boundedJson(suggestionVoteApiUrl(suggestion.id), {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            });
            if (response.status === 401 || response.status === 403) {
                window.location.assign(loginUrl());
                return;
            }
            if (!response.ok || result.success !== true) throw new Error("VOTE_FAILED");
            suggestion.upvotes = result.upvotes;
            suggestion.user_upvoted = result.userUpvoted;
            vote.setAttribute("aria-pressed", String(result.userUpvoted));
            vote.textContent = `${result.userUpvoted ? "Remove vote" : "▲ Vote"} · ${result.upvotes}`;
        } catch {
            await refresh();
        } finally {
            vote.disabled = false;
        }
    });
    header.append(heading, vote);
    card.append(header, metadata, description);
    return card;
}
