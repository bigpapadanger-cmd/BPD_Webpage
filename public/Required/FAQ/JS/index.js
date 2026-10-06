"use strict";
import { answerCard, faqRequest, matchFaqs } from "./shared.js";
import { showVerificationOutcome } from "../../../scripts/verificationNotice.js";
const instances = new WeakMap();
export async function initializePage() {
    const form = document.getElementById("faqAskForm");
    if (!form) return;
    const state = { ready: false, busy: false, reviewed: false, key: null, faqs: [], version: 0 };
    instances.set(form, state);
    const question = document.getElementById("faqQuestion"), check = document.getElementById("faqCheck");
    const submit = document.getElementById("faqSubmit"), none = document.getElementById("faqNone");
    const results = document.getElementById("faqMatches"), status = document.getElementById("faqAskStatus");
    const published = document.getElementById("faqPublished"), retry = document.getElementById("faqRetry");
    const current = () => instances.get(form) === state && form.isConnected !== false;
    const controls = () => {
        check.disabled = state.busy || !state.ready || !question.value.trim();
        none.disabled = state.busy;
        submit.disabled = state.busy || !state.ready || !state.reviewed;
    };
    const report = (message, kind = "info", anchor = check) => {
        status.textContent = message; status.dataset.state = kind;
        showVerificationOutcome(anchor, message, { state: kind });
    };
    const invalidate = () => {
        state.version++; state.reviewed = false; state.key = null;
        submit.hidden = true; none.hidden = true; results.replaceChildren(); controls();
    };
    question.oninput = invalidate;
    form.onsubmit = event => event.preventDefault();
    check.onclick = () => {
        if (!state.ready || state.busy || !question.value.trim() || question.value.length > 500) return;
        const matches = matchFaqs(question.value, state.faqs);
        state.reviewed = false; submit.hidden = true;
        results.replaceChildren(...matches.map(answerCard));
        report(matches.length ? "You may find your answer here. Review the suggested answers below."
            : "No likely answers found. Confirm below if you still want to submit.");
        none.hidden = false; controls();
    };
    none.onclick = () => {
        if (state.busy || !state.ready) return;
        state.reviewed = true; submit.hidden = false; controls();
        report("Still unresolved? Sign in if needed, then submit for review.");
    };
    submit.onclick = async () => {
        if (state.busy || !state.reviewed || !state.ready) return;
        state.busy = true; question.disabled = true; controls();
        const version = state.version;
        try {
            state.key ||= crypto.randomUUID();
            const result = await faqRequest("/api/faq/questions", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question.value.trim(), idempotencyKey: state.key }) });
            if (!current() || version !== state.version) return;
            report(result.question.reused ? "This question was already submitted for review." : "Your question was submitted for review.", "success", submit);
            state.reviewed = false; submit.hidden = true; none.hidden = true;
        } catch (error) {
            if (current()) report(error.message, error.code === "FAQ_SUBMISSION_RATE_LIMITED" ? "warning" : "error", submit);
        } finally { if (current()) { state.busy = false; question.disabled = false; controls(); } }
    };
    async function load() {
        if (state.busy) return;
        state.busy = true; state.ready = false; retry.disabled = true; controls();
        status.textContent = "Loading published answers…";
        try {
            const result = await faqRequest("/api/faq");
            if (!current()) return;
            if (!Array.isArray(result.faqs)) throw new Error("Published answers are unavailable.");
            const curated = [...document.querySelectorAll("#faqCurated .faq-item")].map(card => ({
                question: card.querySelector("summary").textContent, answer: card.querySelector("p").textContent
            }));
            const seen = new Set(curated.map(faq => faq.question.toLowerCase().trim()));
            const additions = result.faqs.filter(faq => !seen.has(faq.question.toLowerCase().trim()));
            state.faqs = [...curated, ...additions];
            published.replaceChildren(...additions.map(answerCard));
            state.ready = true; status.textContent = "Review likely answers before submitting a new question.";
        } catch (error) { if (current()) report(error.message, "error"); }
        finally { if (current()) { state.busy = false; retry.disabled = false; controls(); } }
    }
    retry.onclick = () => { invalidate(); void load(); };
    invalidate(); await load();
}
