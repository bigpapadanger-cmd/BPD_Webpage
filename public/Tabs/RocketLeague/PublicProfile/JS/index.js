"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { getRocketLeaguePublicProfileUrl } from "/scripts/apiRoutes.js";
import { getPublicPresenceLabel } from "../../shared/profileView.js";

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
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function renderProfile(profile) {
    setText("publicProfileName", profile.display_name || profile.epic_display_name, "Rocket League player");

    const epicName = document.getElementById("publicProfileEpicName");
    if (epicName && profile.epic_display_name && profile.epic_display_name !== profile.display_name) {
        epicName.textContent = `Epic: ${profile.epic_display_name}`;
        epicName.hidden = false;
    }

    setText("publicProfilePlatform", profile.rl_platform, "Platform not listed");
    setText("publicProfilePresence", getPublicPresenceLabel(profile));

    const presenceAt = formatDate(profile.presence_checked_at);
    const presenceAtElement = document.getElementById("publicPresenceCheckedAt");
    if (presenceAtElement && profile.presence_shared === true && presenceAt) {
        presenceAtElement.textContent = `Last checked ${presenceAt}`;
        presenceAtElement.hidden = false;
    }

    const ranks = document.getElementById("publicProfileRanks");
    ranks?.replaceChildren();
    if (ranks) {
        addFact(ranks, "1v1", formatRank(profile.mmr?.ones_tier, profile.mmr?.ones_mmr));
        addFact(ranks, "2v2", formatRank(profile.mmr?.twos_tier, profile.mmr?.twos_mmr));
        addFact(ranks, "3v3", formatRank(profile.mmr?.threes_tier, profile.mmr?.threes_mmr));
    }

    const rankAt = formatDate(profile.mmr?.captured_at);
    const rankAtElement = document.getElementById("publicRankCapturedAt");
    if (rankAtElement && rankAt) {
        rankAtElement.textContent = `Last updated ${rankAt}`;
        rankAtElement.hidden = false;
    }

    const provider = document.getElementById("publicProfileProvider");
    provider?.replaceChildren();
    const providerName = typeof profile.provider?.display_username === "string"
        ? profile.provider.display_username.trim()
        : "";
    if (provider && providerName) {
        addFact(provider, "Epic display name", providerName);
    }
    const providerSection = provider?.closest(".rl-profile-section");
    if (providerSection) providerSection.hidden = !providerName;

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

async function loadPublicProfile(publicProfileId) {
    const response = await apiFetch(getRocketLeaguePublicProfileUrl(publicProfileId), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true || !result.profile) return null;
    return result.profile;
}

export async function initializePage() {
    const status = document.getElementById("publicProfileStatus");
    const id = new URLSearchParams(window.location.search).get("id") || "";
    if (!status) return;

    if (!id) {
        status.textContent = "This player profile is unavailable.";
        status.dataset.state = "error";
        return;
    }

    try {
        const profile = await loadPublicProfile(id);
        if (!profile) {
            status.textContent = "This player profile is unavailable.";
            status.dataset.state = "error";
            return;
        }
        renderProfile(profile);
        status.textContent = "";
        status.hidden = true;
    } catch {
        status.textContent = "This player profile is temporarily unavailable. Please try again later.";
        status.dataset.state = "error";
    }
}
