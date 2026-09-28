"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";
import { ADMIN_SUGGESTIONS_API_URL, adminSuggestionReviewApiUrl } from "/scripts/apiRoutes.js";
const REQUIRED_PERMISSION = "admin.suggestions.manage";

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

    try {
        const auth = await getAuthState({ force: true });
        if (!hasAdminPermission(REQUIRED_PERMISSION, auth)) {
            status.textContent = "You do not have permission to review suggestions.";
            return;
        }
        await loadPending(status, list);
    } catch {
        status.textContent = "Suggestion review is unavailable. Please retry later.";
    }
}

async function loadPending(status, list) {
    status.textContent = "Loading pending suggestions…";
    list.replaceChildren();
    try {
        const response = await fetch(ADMIN_SUGGESTIONS_API_URL, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) throw new Error("PENDING_LOAD_FAILED");
        const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
        status.textContent = suggestions.length ? "" : "There are no suggestions awaiting review.";
        list.hidden = false;
        for (const suggestion of suggestions) list.append(createReviewCard(suggestion, status, list));
    } catch {
        status.textContent = "Pending suggestions could not be loaded. Please retry later.";
    }
}

function createReviewCard(suggestion, status, list) {
    const card = node("article", undefined, "admin-suggestion-card");
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
            for (const item of actions.querySelectorAll("button")) item.disabled = true;
            status.textContent = action === "approved" ? "Approving suggestion…" : "Rejecting suggestion…";
            try {
                const response = await fetch(adminSuggestionReviewApiUrl(suggestion.id), {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ status: action, reviewNote: note.value.trim() })
                });
                const result = await response.json();
                if (!response.ok || result.success !== true) throw new Error("REVIEW_FAILED");
                card.remove();
                status.textContent = "Suggestion reviewed.";
                if (!list.children.length) status.textContent = "There are no suggestions awaiting review.";
            } catch {
                status.textContent = "The suggestion could not be reviewed. Refresh and try again.";
                for (const item of actions.querySelectorAll("button")) item.disabled = false;
            }
        });
        actions.append(button);
    }
    card.append(title, meta, description, noteLabel, actions);
    return card;
}
