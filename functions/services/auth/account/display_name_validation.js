"use strict";

import { BLOCKED_DISPLAY_NAME_TERMS, RESERVED_DISPLAY_NAME_FORMS } from "./display_name_policy.js";

const LEET_TRANSLATIONS = Object.freeze({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s" });
const BLOCKED_TERMS = new Set(BLOCKED_DISPLAY_NAME_TERMS.map(normalizeLetters));
const RESERVED_FORMS = new Set(RESERVED_DISPLAY_NAME_FORMS.flatMap(value => [normalizeLetters(value), normalizeObfuscated(value)]));

function normalizeLetters(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]/g, "");
}

function normalizeObfuscated(value) {
    return normalizeLetters(value)
        .replace(/[0134578@$]/g, character => LEET_TRANSLATIONS[character] || character)
        .replace(/([a-z])\1+/g, "$1");
}

function buildComparisonForms(value) {
    const folded = String(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US");
    const plain = folded.replace(/[^a-z0-9]/g, "");
    const obfuscated = plain
        .replace(/[0134578@$]/g, character => LEET_TRANSLATIONS[character] || character)
        .replace(/([a-z])\1+/g, "$1");
    const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
    const tokenForms = tokens.flatMap(token => [token, normalizeObfuscated(token)]);
    return { plain, obfuscated, tokenForms, candidates: new Set([plain, obfuscated, ...tokenForms]) };
}

function editDistanceWithinOne(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        const next = [i];
        let rowMinimum = i;
        for (let j = 1; j <= right.length; j += 1) {
            next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
            rowMinimum = Math.min(rowMinimum, next[j]);
        }
        if (rowMinimum > 1) return false;
        row = next;
    }
    return row[right.length] <= 1;
}

function hasBlockedTerm({ candidates }) {
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (BLOCKED_TERMS.has(candidate)) return true;

        // Embedded matching is limited to longer terms to avoid short-substring
        // false positives in ordinary names and words.
        for (const term of BLOCKED_TERMS) {
            if (term.length >= 6 && candidate.length > term.length && candidate.includes(term)) return true;
        }

        // Fuzzy matching is restricted to terms of at least eight letters and
        // one edit, so short words never trigger approximate matching.
        for (const term of BLOCKED_TERMS) {
            if (term.length >= 8 && Math.abs(candidate.length - term.length) <= 1 && editDistanceWithinOne(candidate, term)) return true;
        }
    }
    return false;
}

function hasReservedImpersonation({ plain, obfuscated, tokenForms }) {
    const forms = new Set([plain, obfuscated, ...tokenForms]);
    for (const form of [...tokenForms, plain, obfuscated]) {
        if (!form) continue;
        forms.add(form);
        for (const other of tokenForms) forms.add(`${form}${other}`);
    }
    return [...forms].some(form => RESERVED_FORMS.has(form));
}

export function validateDisplayNameAppropriateness(displayName) {
    if (typeof displayName !== "string" || !displayName.trim()) return { valid: false, code: "DISPLAY_NAME_REQUIRED" };
    const value = displayName.trim();
    if (value.length < 3) return { valid: false, code: "DISPLAY_NAME_TOO_SHORT" };
    if (value.length > 32) return { valid: false, code: "DISPLAY_NAME_TOO_LONG" };
    if (/[\u0000-\u001f\u007f]/.test(value)) return { valid: false, code: "DISPLAY_NAME_INVALID" };
    const comparisonForms = buildComparisonForms(value);
    if (hasReservedImpersonation(comparisonForms)) return { valid: false, code: "DISPLAY_NAME_RESERVED" };
    if (hasBlockedTerm(comparisonForms)) return { valid: false, code: "DISPLAY_NAME_INAPPROPRIATE" };
    return { valid: true, displayName: value };
}
