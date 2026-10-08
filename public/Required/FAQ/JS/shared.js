import { boundedJson } from "../../../scripts/boundedRequest.js";
"use strict";
const STOP = new Set("a an and are as at be by can do does for from how i in is it my of on or the to what when where why with your".split(" "));
export function normalizeQuestion(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
export function matchFaqs(question, faqs) {
    const normalized = normalizeQuestion(question);
    const terms = new Set(normalized.split(" ").filter(term => term.length > 1 && !STOP.has(term)));
    if (!terms.size) return [];
    return faqs.map(faq => {
        const candidate = normalizeQuestion(faq.question);
        const tokens = new Set(candidate.split(" ").filter(term => term.length > 1 && !STOP.has(term)));
        const common = [...terms].filter(term => tokens.has(term)).length;
        const score = candidate === normalized ? 1 : common / Math.max(terms.size, tokens.size, 1);
        return { ...faq, score };
    }).filter(faq => faq.score >= 0.3).sort((a, b) => b.score - a.score || a.question.localeCompare(b.question)).slice(0, 5);
}
export function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text ?? "");
    if (className) element.className = className;
    return element;
}
export function answerCard(faq) {
    const card = node("details", undefined, "faq-item");
    card.append(node("summary", faq.question), node("p", faq.answer));
    return card;
}
export async function faqRequest(path, options = {}) {
    try {
        const { response, payload: result } = await boundedJson(path, { credentials: "same-origin", cache: "no-store", ...options });
        if (!response.ok || result?.success !== true) throw Object.assign(new Error(result?.message || "FAQ services are unavailable. Please retry."), { code: result?.error });
        return result;
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("The request timed out. Please retry.");
        if (error instanceof SyntaxError) throw new Error("The FAQ response could not be read. Please retry.");
        throw error;
    }
}
