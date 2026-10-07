"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { getRocketLeaguePublicProfileUrl } from "/scripts/apiRoutes.js";
import { getRocketLeagueRankClass } from "../../shared/profilePresentation.js";
import { renderMmrHistory } from "../../Index/JS/mmr_dashboard.js";
import { getPlatformDisplayName } from "../../shared/profileView.js?v=20261006-platform";

const REFRESH_MS = 300000;
let cleanup = () => {};

function formatNumber(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "—";
}

function setText(id, value, fallback = "—") {
    const element = document.getElementById(id);
    if (element) element.textContent = value || fallback;
}

function addFact(container, label, value) {
    const fact = document.createElement("div");
    fact.className = "rl-player-fact";
    const heading = document.createElement("span");
    heading.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value || "—";
    fact.append(heading, content);
    container.append(fact);
}

function formatRank(tier, mmr) {
    const values = [];
    if (typeof tier === "string" && tier.trim()) values.push(tier.trim());
    if (Number.isSafeInteger(mmr) && mmr >= 0) values.push(`${mmr.toLocaleString()} MMR`);
    return values.join(" · ") || "Unavailable";
}

function formatDate(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function renderProfile(profile) {
    setText("publicProfileName", profile.displayName || profile.epicDisplayName, "Rocket League player");

    const epicName = document.getElementById("publicProfileEpicName");
    if (epicName) {
        epicName.textContent = profile.epicDisplayName ? `Epic: ${profile.epicDisplayName}` : "";
        epicName.hidden = !profile.epicDisplayName || profile.epicDisplayName === profile.displayName;
    }

    setText("publicProfilePlatform", getPlatformDisplayName(profile.primaryPlatform));

    const ranks = document.getElementById("publicProfileRanks");
    ranks?.replaceChildren();
    if (ranks) {
        for (const [label, tier, mmr] of [
            ["1v1", profile.currentMmr?.ones.tier, profile.currentMmr?.ones.mmr],
            ["2v2", profile.currentMmr?.twos.tier, profile.currentMmr?.twos.mmr],
            ["3v3", profile.currentMmr?.threes.tier, profile.currentMmr?.threes.mmr]
        ]) {
            const fact = document.createElement("div");
            fact.className = `rl-player-fact ${getRocketLeagueRankClass(tier)}`;
            const heading = document.createElement("span");
            heading.textContent = label;
            const content = document.createElement("strong");
            content.textContent = formatRank(tier, mmr);
            fact.append(heading, content);
            ranks.append(fact);
        }
    }

    const rankAt = formatDate(profile.currentMmr?.capturedAt);
    const rankAtElement = document.getElementById("publicRankCapturedAt");
    if (rankAtElement) {
        rankAtElement.textContent = rankAt ? `Last updated ${rankAt}` : "";
        rankAtElement.hidden = !rankAt;
    }
    // Adapt database daily averages to the existing chart, without re-averaging.
    const history = profile.mmrHistory.map(point => ({ capturedAt: `${point.date}T00:00:00Z`,
        ones: { mmr: point.ones }, twos: { mmr: point.twos }, threes: { mmr: point.threes } }));
    renderMmrHistory(history, document, {
        graphId: "publicMmrHistoryGraph",
        statusId: "publicMmrHistoryStatus",
        days: 14,
        dailyAverages: true
    });

    const stats = document.getElementById("publicProfileStats");
    stats?.replaceChildren();
    if (stats) {
        for (const key of ["wins", "goals", "assists", "saves", "shots", "mvps"]) {
            addFact(stats, key, formatNumber(profile.stats?.[key]));
        }
    }

    const card = document.getElementById("publicProfileContent");
    if (card) card.hidden = false;
}

async function loadPublicProfile(publicProfileId, signal) {
    const response = await apiFetch(getRocketLeaguePublicProfileUrl(publicProfileId), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }, signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true || !result.player || !Array.isArray(result.player.mmrHistory)) {
        throw Object.assign(new Error("PROFILE_UNAVAILABLE"), { status: response.status });
    }
    return result.player;
}

export async function initializePage() {
    cleanup();
    const status = document.getElementById("publicProfileStatus");
    const id = new URLSearchParams(window.location.search).get("id") || "";
    if (!status) return;

    if (!id) {
        status.textContent = "This player profile is unavailable.";
        status.dataset.state = "error";
        return;
    }

    const listeners = new AbortController();
    let request = null;
    let lastAttempt = 0;
    let rendered = false;
    let stopped = false;
    const refresh = async () => {
        if (stopped || request || document.hidden) return;
        if (!status.isConnected) { cleanup(); return; }
        lastAttempt = Date.now();
        request = new AbortController();
        const deadline = setTimeout(() => request?.abort(), 10000);
        try {
            const profile = await loadPublicProfile(id, request.signal);
            if (stopped || !status.isConnected) return;
            renderProfile(profile);
            rendered = true;
            status.textContent = "";
            status.hidden = true;
        } catch (error) {
            if (stopped || !status.isConnected) return;
            // A definitive privacy/not-found result revokes the visible card;
            // transient provider failures preserve the last successful render.
            if (error.status === 404) {
                document.getElementById("publicProfileContent").hidden = true;
                rendered = false;
            }
            status.textContent = rendered
                ? "Refresh unavailable. Showing the last loaded player data."
                : "This player profile is unavailable. Please try again later.";
            status.dataset.state = "error";
            status.hidden = false;
        } finally {
            clearTimeout(deadline);
            request = null;
        }
    };
    const timer = setInterval(refresh, REFRESH_MS);
    const observer = new MutationObserver(() => { if (!status.isConnected) cleanup(); });
    if (status.closest(".public-profile-page")?.parentNode) observer.observe(status.closest(".public-profile-page").parentNode, { childList: true });
    cleanup = () => {
        stopped = true;
        clearInterval(timer);
        request?.abort();
        listeners.abort();
        observer.disconnect();
    };
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && Date.now() - lastAttempt >= REFRESH_MS) void refresh();
    }, { signal: listeners.signal });
    window.addEventListener("pagehide", cleanup, { once: true, signal: listeners.signal });
    await refresh();
}
