"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { ROCKET_LEAGUE_PROFILE_URL } from "/scripts/apiRoutes.js";
import { formatRocketLeagueTimestamp } from "../../shared/profilePresentation.js";

const RANKS = [["ones", "1v1"], ["twos", "2v2"], ["threes", "3v3"]];
const CAREER = [["wins", "Wins"], ["goals", "Goals"], ["assists", "Assists"], ["saves", "Saves"], ["shots", "Shots"], ["mvps", "MVPs"]];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let profileSnapshot = null;

function setStatus(message, state = "ready") {
    const status = document.getElementById("myProfileStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "—";
}

function renderAvailability(availability = []) {
    const target = document.getElementById("myProfileAvailability");
    const byDay = new Map(availability.map(item => [item.day, item]));
    target.replaceChildren();
    for (const day of DAYS) {
        const saved = byDay.get(day);
        const row = document.createElement("div");
        row.className = "my-profile-availability-row";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.day = day;
        checkbox.checked = Boolean(saved);
        const dayName = document.createElement("span");
        dayName.textContent = day;
        label.append(checkbox, dayName);
        const start = document.createElement("input");
        Object.assign(start, { type: "time", min: "17:00", max: "23:00", step: 1800, value: saved?.start || "17:00" });
        start.dataset.start = day;
        const end = document.createElement("input");
        Object.assign(end, { type: "time", min: "17:00", max: "23:00", step: 1800, value: saved?.end || "23:00" });
        end.dataset.end = day;
        start.disabled = !checkbox.checked;
        end.disabled = !checkbox.checked;
        checkbox.addEventListener("change", () => {
            start.disabled = !checkbox.checked;
            end.disabled = !checkbox.checked;
        });
        row.append(label, start, end);
        target.append(row);
    }
}

function renderRanks(profile, latestMmr) {
    const target = document.getElementById("myProfileRanks");
    const current = latestMmr?.available === true ? latestMmr : profile.ranks?.current || {};
    target.replaceChildren();
    for (const [key, label] of RANKS) {
        const item = document.createElement("article");
        item.className = "my-profile-rank";
        const heading = document.createElement("span");
        heading.textContent = label;
        const rank = current[key] || {};
        const tier = typeof rank.tier === "object" ? rank.tier.label || rank.tier.name : rank.tier;
        const value = document.createElement("strong");
        value.textContent = [tier, Number.isSafeInteger(rank.mmr) && rank.mmr >= 0 ? `${rank.mmr.toLocaleString()} MMR` : ""].filter(Boolean).join(" · ") || "—";
        item.append(heading, value);
        target.append(item);
    }
    const freshness = formatRocketLeagueTimestamp(latestMmr?.capturedAt || current.capturedAt);
    document.getElementById("myProfileMmrFreshness").textContent = freshness ? `MMR last updated ${freshness}` : "MMR update time unavailable";
}

function renderCareer(profile) {
    const career = profile.stats?.career || {};
    const target = document.getElementById("myProfileCareer");
    target.replaceChildren();
    for (const [key, label] of CAREER) {
        const item = document.createElement("div");
        item.className = "my-profile-stat";
        const value = document.createElement("strong");
        value.textContent = safeCount(career[key]);
        const caption = document.createElement("span");
        caption.textContent = label;
        item.append(value, caption);
        target.append(item);
    }
    const freshness = formatRocketLeagueTimestamp(career.capturedAt);
    document.getElementById("myProfileCareerFreshness").textContent = freshness ? `Captured ${freshness}` : "Capture time unavailable";
}

function renderMmrProgression(progression) {
    const target = document.getElementById("myProfileProgress");
    const unavailable = document.getElementById("myProfileProgressUnavailable");
    target.replaceChildren();
    target.hidden = true;
    unavailable.hidden = false;

    if (!progression || !Array.isArray(progression.playlists)) {
        unavailable.textContent = "MMR changes are temporarily unavailable.";
        return;
    }
    if (progression.previous === null) {
        unavailable.textContent = "No previous capture yet.";
        return;
    }

    unavailable.hidden = true;
    target.hidden = false;
    const comparedAt = formatRocketLeagueTimestamp(progression.previous.capturedAt);
    document.getElementById("myProfileProgressComparedAt").textContent = comparedAt ? `Compared with ${comparedAt}` : "Compared with previous capture";
    for (const item of progression.playlists) {
        const card = document.createElement("article");
        card.className = "my-profile-progress-item";
        const label = document.createElement("span");
        label.textContent = item.label;
        const value = document.createElement("strong");
        if (item.status !== "available" || !Number.isSafeInteger(item.delta)) {
            value.textContent = "Unavailable";
        } else if (item.delta > 0) {
            value.textContent = `+${item.delta.toLocaleString()} MMR`;
            card.dataset.change = "positive";
        } else if (item.delta < 0) {
            value.textContent = `${item.delta.toLocaleString()} MMR`;
            card.dataset.change = "negative";
        } else {
            value.textContent = "No change";
            card.dataset.change = "unchanged";
        }
        card.append(label, value);
        target.append(card);
    }
}

function settingsPayload() {
    const profile = profileSnapshot.profile;
    const notificationsEnabled = document.getElementById("notificationsEnabled").checked;
    const availability = DAYS.flatMap(day => {
        if (!document.querySelector(`[data-day="${day}"]`)?.checked) return [];
        return [{ day, start: document.querySelector(`[data-start="${day}"]`).value, end: document.querySelector(`[data-end="${day}"]`).value }];
    });
    return {
        ageConsent: profile.ageConsent === true,
        policyConsent: profile.policyConsent === true,
        autoDetectRegion: document.getElementById("autoDetectRegion").checked,
        showOnlineStatus: document.getElementById("showOnlineStatus").checked,
        findProfileEnabled: document.getElementById("findProfileEnabled").checked,
        email: document.getElementById("profileEmail").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
        preferredMode: document.getElementById("preferredMode").value,
        otherMode: document.getElementById("otherMode").value.trim(),
        availability,
        notificationsEnabled,
        notificationMethod: notificationsEnabled ? document.getElementById("notificationMethod").value || null : null,
        reminderMode: notificationsEnabled ? document.getElementById("reminderMode").value || null : null
    };
}

function renderProfile(result) {
    const profile = result.profile || {};
    profileSnapshot = result;
    document.getElementById("myProfileBpdName").textContent = profile.bpdDisplayName || "BPD player";
    document.getElementById("myProfileEpicName").textContent = profile.provider?.displayUsername || profile.EpicDisplayName || profile.EpicPreferredUsername || "Not available";
    document.getElementById("myProfileVisibility").textContent = profile.findProfileEnabled === true ? "Discoverable" : "Not listed";
    document.getElementById("myProfilePresencePreference").textContent = profile.showOnlineStatus === true ? "Shared" : "Not shared";
    const providerTimestamp = formatRocketLeagueTimestamp(profile.provider?.providerUpdatedAt || profile.provider?.capturedAt);
    document.getElementById("myProfileProviderFreshness").textContent = providerTimestamp ? `Updated ${providerTimestamp}` : "Update time unavailable";
    renderRanks(profile, result.latestMmr);
    renderMmrProgression(result.mmrProgression);
    renderCareer(profile);

    const settings = profile.settings || profile;
    document.getElementById("autoDetectRegion").checked = settings.autoDetectRegion === true;
    const canEdit = typeof settings.showOnlineStatus === "boolean" && typeof settings.findProfileEnabled === "boolean";
    document.getElementById("showOnlineStatus").checked = settings.showOnlineStatus === true;
    document.getElementById("findProfileEnabled").checked = settings.findProfileEnabled === true;
    document.getElementById("preferredMode").value = settings.preferredMode || "";
    document.getElementById("otherMode").value = settings.otherMode || "";
    document.getElementById("otherModeField").hidden = settings.preferredMode !== "other";
    document.getElementById("profileEmail").value = settings.email || "";
    document.getElementById("profilePhone").value = settings.phone || "";
    document.getElementById("notificationsEnabled").checked = settings.notificationsEnabled === true;
    document.getElementById("notificationMethod").value = settings.notificationMethod || "";
    document.getElementById("reminderMode").value = settings.reminderMode || "";
    document.getElementById("notificationFields").hidden = settings.notificationsEnabled !== true;
    document.getElementById("discordSettingsNote").hidden = settings.notificationMethod !== "discord";
    renderAvailability(Array.isArray(settings.availability) ? settings.availability : []);
    const form = document.getElementById("myProfileSettingsForm");
    const settingsKnown = ["autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "notificationsEnabled"].every(key => typeof settings[key] === "boolean");
    form.hidden = !canEdit || !settingsKnown;
    if (!canEdit || !settingsKnown) setStatus("Your profile is available, but one or more saved settings could not be confirmed. Settings are locked to avoid overwriting unknown values.", "error");
    return canEdit && settingsKnown;
}

async function requestProfile(method = "GET", body) {
    const endpoint = method === "GET" ? `${ROCKET_LEAGUE_PROFILE_URL}?includePresence=false&includeMmrProgression=true` : ROCKET_LEAGUE_PROFILE_URL;
    const response = await apiFetch(endpoint, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) throw new Error("Profile request failed.");
    return result;
}

export async function initializePage() {
    const form = document.getElementById("myProfileSettingsForm");
    if (!form) return;
    const preferredMode = document.getElementById("preferredMode");
    preferredMode.addEventListener("change", () => {
        document.getElementById("otherModeField").hidden = preferredMode.value !== "other";
    });
    const notificationsEnabled = document.getElementById("notificationsEnabled");
    notificationsEnabled.addEventListener("change", () => {
        document.getElementById("notificationFields").hidden = !notificationsEnabled.checked;
    });
    document.getElementById("notificationMethod").addEventListener("change", event => {
        document.getElementById("discordSettingsNote").hidden = event.currentTarget.value !== "discord";
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const save = document.getElementById("myProfileSave");
        save.disabled = true;
        save.textContent = "Saving…";
        try {
            const result = await requestProfile("POST", settingsPayload());
            profileSnapshot = await requestProfile();
            const settingsAvailable = renderProfile(profileSnapshot);
            setStatus(result.profileSaved === true && settingsAvailable ? "Profile settings saved." : "Settings could not be confirmed.", result.profileSaved === true && settingsAvailable ? "ready" : "error");
        } catch {
            setStatus("Your settings could not be saved right now. Please try again.", "error");
        } finally {
            save.disabled = false;
            save.textContent = "Save settings";
        }
    });

    try {
        const result = await requestProfile();
        if (result.profileComplete !== true || result.rocketLeagueAccess !== true) {
            window.BPDRouter?.navigate ? await window.BPDRouter.navigate("/RocketLeague/Profile", { replace: true }) : window.location.replace("/RocketLeague/Profile");
            return;
        }
        const settingsAvailable = renderProfile(result);
        setStatus(settingsAvailable ? "Your private Rocket League profile is up to date." : "Your profile loaded; saved privacy preferences need verification before editing.", settingsAvailable ? "ready" : "error");
    } catch {
        setStatus("Your profile could not be loaded right now.", "error");
    }
}
