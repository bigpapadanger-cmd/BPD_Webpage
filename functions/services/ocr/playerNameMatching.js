"use strict";

export const OCR_NAME_MATCH_THRESHOLDS = Object.freeze({
    // Initial tunable bands; calibrate against reviewed samples before changing.
    highConfidence: 0.9,
    reviewCandidate: 0.7
});

export function normalizePlayerNameCandidate(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]/g, "");
}

function editDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
        let diagonal = previous[0];
        previous[0] = row;
        for (let column = 1; column <= right.length; column += 1) {
            const above = previous[column];
            previous[column] = Math.min(
                previous[column] + 1,
                previous[column - 1] + 1,
                diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
            );
            diagonal = above;
        }
    }
    return previous[right.length];
}

export function suggestRosterName(ocrText, rosterCandidates) {
    const observed = String(ocrText ?? "").trim().slice(0, 64);
    const normalizedObserved = normalizePlayerNameCandidate(observed);
    const candidates = Array.isArray(rosterCandidates)
        ? rosterCandidates.slice(0, 16)
        : [];
    if (!normalizedObserved || candidates.length === 0) {
        return { status: "unresolved", candidate: null, confidence: null, matchMethod: null };
    }

    const ranked = candidates
        .filter(value => typeof value === "string" && value.trim() && value.trim().length <= 64)
        .map(candidate => {
            const normalizedCandidate = normalizePlayerNameCandidate(candidate);
            const distance = editDistance(normalizedObserved, normalizedCandidate);
            return {
                candidate: candidate.trim(),
                confidence: normalizedObserved === normalizedCandidate
                    ? 1
                    : Math.max(0, 1 - distance / Math.max(normalizedObserved.length, normalizedCandidate.length)),
                matchMethod: normalizedObserved === normalizedCandidate ? "exact-roster" : "fuzzy-roster"
            };
        })
        .sort((left, right) => right.confidence - left.confidence);

    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.confidence < OCR_NAME_MATCH_THRESHOLDS.reviewCandidate
        || (second && best.matchMethod !== "exact-roster" && best.confidence - second.confidence < 0.05)) {
        return { status: "unresolved", candidate: null, confidence: best?.confidence ?? null, matchMethod: null };
    }

    return {
        // The repository has no canonical player identity table yet. Even an
        // exact roster string is therefore a suggestion until a reviewer acts.
        status: "needs_verification",
        candidate: best.candidate,
        confidence: Math.round(best.confidence * 1000) / 1000,
        confidenceBand: best.confidence >= OCR_NAME_MATCH_THRESHOLDS.highConfidence ? "high" : "review",
        matchMethod: best.matchMethod,
        userVerified: false
    };
}

export function getTeamTotalPresentation(team) {
    const raw = team?.totalGoals;
    const total = raw !== null && raw !== undefined && String(raw).trim() !== ""
        && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0
        ? Number(raw)
        : null;
    const provenance = team?.totalGoalsProvenance;
    const userVerified = provenance?.userVerified === true;
    const requiresVerification = team?.totalGoalsRequiresVerification === true || total === null;
    const confidence = Number(team?.totalGoalsConfidence);

    return {
        total,
        userVerified,
        requiresVerification,
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
            ? confidence
            : null,
        label: userVerified
            ? "Verified by reviewer"
            : requiresVerification
                ? "Needs verification"
                : "Scoreboard header total"
    };
}
