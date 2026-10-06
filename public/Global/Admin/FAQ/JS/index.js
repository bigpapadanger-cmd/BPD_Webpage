"use strict";
import { initializeAdminAccordions, setAdminAccordionSummary } from "../../Shared/JS/accordion.js";
import { faqRequest, matchFaqs, node, answerCard } from "../../../../Required/FAQ/JS/shared.js";
import { showVerificationOutcome } from "../../../../scripts/verificationNotice.js";
const instances = new WeakMap();
export function availableReviewActions(status) {
    return status === "pending" ? ["approve", "duplicate", "reject"]
        : status === "approved" ? ["answer", "duplicate", "reject"]
            : status === "answered" ? ["publish"] : [];
}
export async function initializePage() {
    const root = document.getElementById("adminFaqPage");
    if (!root) return;
    const byId = id => document.getElementById(id);
    const state = { page: 1, busy: false, list: null, published: null };
    instances.set(root, state);
    initializeAdminAccordions(root);
    const current = () => instances.get(root) === state && root.isConnected !== false;
    function status(message, kind = "info", anchor = byId("adminFaqRefresh")) {
        byId("adminFaqStatus").textContent = message;
        byId("adminFaqStatus").dataset.state = kind;
        showVerificationOutcome(anchor, message, { state: kind });
    }
    function busy(value) {
        state.busy = value;
        root.querySelectorAll("button, select, textarea").forEach(control => { control.disabled = value; });
        if (!value) {
            byId("adminFaqPrevious").disabled = !state.list || state.page <= 1;
            byId("adminFaqNext").disabled = state.list?.hasMore !== true;
            root.querySelectorAll('[data-needs-published="true"]').forEach(control => { control.disabled = !state.published?.length; });
        }
    }
    async function load() {
        if (state.busy) return;
        busy(true); state.list = null; state.published = null;
        byId("adminFaqList").replaceChildren();
        status("Loading questions…");
        try {
            const result = await faqRequest(`/api/admin/faq?status=${encodeURIComponent(byId("adminFaqFilter").value)}&page=${state.page}`);
            if (!current()) return;
            if (!Array.isArray(result.rows) || typeof result.permissions?.canReview !== "boolean") throw new Error("Question review returned an invalid response.");
            state.list = result;
            let publishedError = false;
            try {
                const published = await faqRequest("/api/faq");
                if (!Array.isArray(published.faqs)) throw new Error("Invalid answers");
                if (!current()) return;
                state.published = published.faqs;
            } catch { publishedError = true; }
            if (!current()) return;
            render();
            status(publishedError ? "Questions loaded. Published answers are unavailable; duplicate selection is disabled."
                : result.rows.length ? "Questions loaded." : "No questions match this status.", publishedError ? "warning" : "success");
        } catch (error) {
            if (current()) { status(error.message, "error"); setAdminAccordionSummary(byId("adminFaqCount"), "Unavailable"); }
        } finally { if (current()) busy(false); }
    }
    function render() {
        const result = state.list;
        byId("adminFaqList").replaceChildren(...result.rows.map(card));
        setAdminAccordionSummary(byId("adminFaqCount"), `${result.total} questions`);
        byId("adminFaqPageNumber").textContent = `Page ${result.page} · 30 per page`;
        initializeAdminAccordions(root);
    }
    function card(row) {
        const article = node("article", undefined, "admin-faq-card");
        article.append(node("h2", row.question), node("p", `${row.submitterDisplayName || "BPD member"} · ${row.status} · Revision ${row.revision}`),
            node("p", `Created ${new Date(row.createdAt).toLocaleString()} · Updated ${new Date(row.updatedAt).toLocaleString()}`));
        const matches = matchFaqs(row.question, state.published || []);
        const suggestions = node("details");
        suggestions.dataset.adminAccordion = "";
        suggestions.append(node("summary", `Possible duplicate answers (${matches.length})`));
        const answers = node("div"); answers.append(...matches.map(answerCard)); suggestions.append(answers); article.append(suggestions);
        if (!state.list.permissions.canReview) { article.append(node("p", "Read only")); return article; }
        const actions = availableReviewActions(row.status);
        if (!actions.length) return article;
        const noteLabel = node("label", "Private review note (optional)"), note = node("textarea");
        note.maxLength = 4000; note.rows = 2; noteLabel.append(note); article.append(noteLabel);
        let answer = null, duplicate = null;
        if (actions.includes("answer")) {
            const label = node("label", "Answer (plain text; saved as draft)"); answer = node("textarea");
            answer.maxLength = 10000; answer.rows = 5; label.append(answer); article.append(label);
        }
        if (actions.includes("duplicate")) {
            const label = node("label", "Existing published FAQ"); duplicate = node("select");
            duplicate.dataset.needsPublished = "true";
            const empty = node("option", "Select a published answer"); empty.value = ""; duplicate.append(empty);
            for (const faq of state.published || []) { const option = node("option", faq.question); option.value = faq.id; duplicate.append(option); }
            label.append(duplicate); article.append(label);
        }
        const buttons = node("div", undefined, "admin-faq-actions");
        for (const action of actions) {
            const button = node("button", { approve: "Approve", answer: "Save draft answer", duplicate: "Mark Duplicate", reject: "Reject", publish: "Publish answer" }[action]);
            button.type = "button";
            if (action === "duplicate") button.dataset.needsPublished = "true";
            button.onclick = async () => {
                if (state.busy || !current()) return;
                if (action === "answer" && !answer.value.trim()) { status("Enter an answer first.", "warning", button); return; }
                if (action === "duplicate" && !duplicate.value) { status("Select a published answer first.", "warning", button); return; }
                busy(true); status("Saving review…");
                let reload = false;
                try {
                    await faqRequest(`/api/admin/faq/${encodeURIComponent(row.id)}/review`, {
                        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action,
                            answer: action === "answer" ? answer.value.trim() : null, duplicateFaqId: action === "duplicate" ? duplicate.value : null,
                            reviewNote: note.value.trim() || null, expectedRevision: row.revision })
                    });
                    reload = true;
                    if (current()) status("Review saved.", "success", button);
                } catch (error) {
                    if (current()) status(error.message, "error", button);
                    reload = error.code === "FAQ_QUESTION_REVISION_CONFLICT";
                } finally { if (current()) busy(false); }
                if (reload && current()) {
                    await load();
                    if (current()) status("Current question state reloaded. Review the updated revision before another action.");
                }
            };
            buttons.append(button);
        }
        article.append(buttons); return article;
    }
    byId("adminFaqRefresh").onclick = () => void load();
    byId("adminFaqFilter").onchange = () => { state.page = 1; void load(); };
    byId("adminFaqPrevious").onclick = () => { if (!state.busy && state.page > 1) { state.page--; void load(); } };
    byId("adminFaqNext").onclick = () => { if (!state.busy && state.list?.hasMore) { state.page++; void load(); } };
    await load();
}
