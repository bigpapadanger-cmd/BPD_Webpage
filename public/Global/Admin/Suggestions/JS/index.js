"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";
import { ADMIN_SUGGESTIONS_API_URL, adminSuggestionReviewApiUrl } from "/scripts/apiRoutes.js";
import { initializeAdminAccordions, setAdminAccordionSummary } from "../../Shared/JS/accordion.js";
const REQUIRED_PERMISSION = "admin.suggestions.manage";
const loadGenerations = new WeakMap();

export async function requestSuggestionReview(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options,
            headers: { Accept: "application/json", ...options.headers }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok || result?.success !== true) throw new Error("REVIEW_UNAVAILABLE");
        return result;
    } finally { clearTimeout(timer); }
}

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text ?? "");
    if (className) element.className = className;
    return element;
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleString();
}

export async function initializePage() {
    const status = document.getElementById("suggestionReviewStatus");
    const list = document.getElementById("suggestionReviewList");
    if (!status || !list) return;
    const section = document.getElementById("suggestionReviewSection");
    const count = document.getElementById("suggestionReviewCount");
    const refresh = document.getElementById("suggestionReviewRefresh");
    const generation = (loadGenerations.get(list) || 0) + 1;
    loadGenerations.set(list, generation);
    initializeAdminAccordions();
    section.hidden = true;
    list.hidden = true;
    if (refresh) { refresh.hidden = true; refresh.onclick = null; }

    try {
        const auth = await getAuthState({ force: true });
        if (loadGenerations.get(list) !== generation) return;
        if (!hasAdminPermission(REQUIRED_PERMISSION, auth)) {
            status.textContent = "You do not have permission to review suggestions.";
            return;
        }
        section.hidden = false;
        if (refresh) {
            refresh.hidden = false;
            refresh.onclick = () => { if (!refresh.disabled) void loadPending(status, list, count, generation); };
        }
        await loadPending(status, list, count, generation);
    } catch {
        if (loadGenerations.get(list) !== generation) return;
        status.textContent = "Suggestion review is unavailable. Please retry later.";
    }
}

async function loadPending(status, list, count, generation) {
    const refresh = document.getElementById("suggestionReviewRefresh");
    if (refresh) refresh.disabled = true;
    status.textContent = "Loading pending suggestions…";
    list.replaceChildren();
    try {
        const result = await requestSuggestionReview(ADMIN_SUGGESTIONS_API_URL);
        if (loadGenerations.get(list) !== generation) return;
        if (!Array.isArray(result.suggestions)) throw new Error("PENDING_RESPONSE_INVALID");
        const suggestions = result.suggestions;
        status.textContent = suggestions.length ? "" : "There are no suggestions awaiting review.";
        list.hidden = false;
        for (const suggestion of suggestions) list.append(createReviewCard(suggestion, status, list, count, generation));
        setAdminAccordionSummary(count, `${suggestions.length} pending loaded`);
    } catch {
        if (loadGenerations.get(list) !== generation) return;
        status.textContent = "Pending suggestions could not be loaded. Please retry later.";
        setAdminAccordionSummary(count, "Pending list unavailable");
    } finally { if (refresh && loadGenerations.get(list) === generation) refresh.disabled = false; }
}

function createReviewCard(suggestion, status, list, count, generation) {
    const card = node("article", undefined, "admin-suggestion-card");
    let pending = false;
    const title = node("h2", suggestion.title);
    const meta = node("p", `${suggestion.creator_display_name || "BPD member"} · Submitted ${formatDate(suggestion.created_at)} · ${Number(suggestion.upvotes) || 0} votes`, "admin-suggestion-meta");
    const description = node("p", suggestion.description);
    const noteLabel = node("label", "Optional reviewer note");
    const note = node("textarea");
    note.maxLength = 1000;
    note.rows = 2;
    noteLabel.append(note);
    const actions = node("div", undefined, "admin-suggestion-actions");
    for (const action of ["approved", "rejected"]) {
        const button = node("button", action === "approved" ? "Approve and publish" : "Reject");
        button.type = "button";
        button.dataset.review = action;
        button.addEventListener("click", async () => {
            if (pending || loadGenerations.get(list) !== generation) return;
            pending = true;
            for (const item of actions.querySelectorAll("button")) item.disabled = true;
            status.textContent = action === "approved" ? "Approving suggestion…" : "Rejecting suggestion…";
            try {
                await requestSuggestionReview(adminSuggestionReviewApiUrl(suggestion.id), {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ status: action, reviewNote: note.value.trim() })
                });
                if (loadGenerations.get(list) !== generation) return;
                card.remove();
                setAdminAccordionSummary(count, `${list.children.length} pending loaded`);
                status.textContent = "Suggestion reviewed.";
                if (!list.children.length) status.textContent = "There are no suggestions awaiting review.";
            } catch {
                if (loadGenerations.get(list) !== generation) return;
                status.textContent = "The suggestion could not be reviewed. Refresh and try again.";
                for (const item of actions.querySelectorAll("button")) item.disabled = false;
            } finally { pending = false; }
        });
        actions.append(button);
    }
    card.append(title, meta, description, noteLabel, actions);
    return card;
}
