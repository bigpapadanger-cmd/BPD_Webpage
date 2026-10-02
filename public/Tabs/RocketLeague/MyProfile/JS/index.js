"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { ROCKET_LEAGUE_PROFILE_URL } from "/scripts/apiRoutes.js";
import { buildSettingsPayload, getConfirmedSettings } from "./settings_view.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let profileSnapshot = null;

function setStatus(message, state = "ready") {
    const status = document.getElementById("myProfileStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function renderAvailability(availability) {
    const target = document.getElementById("myProfileAvailability");
    const byDay = new Map(availability.map(item => [String(item.day || "").toLowerCase(), item]));
    target.replaceChildren();
    for (const day of DAYS) {
        const saved = byDay.get(day.toLowerCase());
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

function displayLocation(settings, settingsAvailability, key) {
    if (settingsAvailability?.[key] !== true) return "Not confirmed";
    return settings[key] === null ? "Not recorded" : settings[key] || "Not recorded";
}

function renderProfile(result) {
    const profile = result.profile || {};
    const settings = profile.settings || {};
    profileSnapshot = result;

    const region = displayLocation(settings, profile.settingsAvailability, "region");
    const country = displayLocation(settings, profile.settingsAvailability, "countryCode");
    document.getElementById("myProfileRegion").textContent = country !== "Not recorded" && country !== "Not confirmed" ? `${region} (${country})` : region;
    document.getElementById("myProfileTimezone").textContent = displayLocation(settings, profile.settingsAvailability, "displayTimezone");
    document.getElementById("myProfileConsent").textContent = profile.ageConsent === true && profile.policyConsent === true ? "Confirmed" : "Not confirmed";

    document.getElementById("autoDetectRegion").checked = settings.autoDetectRegion === true;
    document.getElementById("showOnlineStatus").checked = settings.showOnlineStatus === true;
    document.getElementById("findProfileEnabled").checked = settings.findProfileEnabled === true;
    document.getElementById("preferredMode").value = typeof settings.preferredMode === "string" ? settings.preferredMode : "";
    document.getElementById("otherMode").value = typeof settings.otherMode === "string" ? settings.otherMode : "";
    document.getElementById("otherModeField").hidden = settings.preferredMode !== "other";
    document.getElementById("profileEmail").value = typeof settings.email === "string" ? settings.email : "";
    document.getElementById("profilePhone").value = typeof settings.phone === "string" ? settings.phone : "";
    document.getElementById("notificationsEnabled").checked = settings.notificationsEnabled === true;
    document.getElementById("notificationMethod").value = typeof settings.notificationMethod === "string" ? settings.notificationMethod : "";
    document.getElementById("reminderMode").value = typeof settings.reminderMode === "string" ? settings.reminderMode : "";
    document.getElementById("notificationFields").hidden = settings.notificationsEnabled !== true;
    document.getElementById("discordSettingsNote").hidden = settings.notificationMethod !== "discord";
    renderAvailability(Array.isArray(settings.availability) ? settings.availability : []);

    const confirmedSettings = getConfirmedSettings(profile);
    const form = document.getElementById("myProfileSettingsForm");
    form.hidden = !confirmedSettings;
    document.getElementById("myProfileSave").disabled = !confirmedSettings;
    if (!confirmedSettings) setStatus("Some saved settings could not be confirmed. Editing is locked so unknown values are not overwritten.", "error");
    return Boolean(confirmedSettings);
}

function settingsPayload() {
    const profile = profileSnapshot.profile;
    const settings = profile.settings;
    const notificationsEnabled = document.getElementById("notificationsEnabled").checked;
    const availability = DAYS.flatMap(day => {
        if (!document.querySelector(`[data-day="${day}"]`)?.checked) return [];
        return [{ day, start: document.querySelector(`[data-start="${day}"]`).value, end: document.querySelector(`[data-end="${day}"]`).value }];
    });
    return buildSettingsPayload(profile, {
        autoDetectRegion: document.getElementById("autoDetectRegion").checked,
        showOnlineStatus: document.getElementById("showOnlineStatus").checked,
        findProfileEnabled: document.getElementById("findProfileEnabled").checked,
        email: document.getElementById("profileEmail").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
        preferredMode: document.getElementById("preferredMode").value,
        otherMode: document.getElementById("otherMode").value.trim(),
        availability,
        notificationsEnabled,
        notificationMethod: document.getElementById("notificationMethod").value || "",
        reminderMode: document.getElementById("reminderMode").value || ""
    });
}

async function requestProfile(method = "GET", body) {
    const response = await apiFetch(ROCKET_LEAGUE_PROFILE_URL, {
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

function lockSettings() {
    profileSnapshot = null;
    const form = document.getElementById("myProfileSettingsForm");
    form.hidden = true;
    document.getElementById("myProfileSave").disabled = true;
}

export async function initializePage() {
    const form = document.getElementById("myProfileSettingsForm");
    if (!form) return;
    document.getElementById("myProfileSave").textContent = "Update Profile";
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
            const saved = await requestProfile("POST", settingsPayload());
            const refreshed = await requestProfile();
            const settingsConfirmed = renderProfile(refreshed);
            setStatus(saved.profileSaved === true && settingsConfirmed ? "Profile settings updated." : "The saved settings could not be confirmed; editing is locked.", saved.profileSaved === true && settingsConfirmed ? "ready" : "error");
            if (saved.profileSaved !== true || !settingsConfirmed) lockSettings();
        } catch {
            lockSettings();
            setStatus("Your settings could not be confirmed after saving. Editing is locked until the profile can be reloaded.", "error");
        } finally {
            save.textContent = "Update Profile";
            if (!form.hidden && profileSnapshot) save.disabled = false;
        }
    });

    try {
        const result = await requestProfile();
        if (result.profileComplete !== true || result.rocketLeagueAccess !== true) {
            window.BPDRouter?.navigate ? await window.BPDRouter.navigate("/RocketLeague/Profile", { replace: true }) : window.location.replace("/RocketLeague/Profile");
            return;
        }
        const confirmed = renderProfile(result);
        setStatus(confirmed ? "Manage your Rocket League profile settings and privacy." : "Saved settings need verification before they can be edited.", confirmed ? "ready" : "error");
    } catch {
        lockSettings();
        setStatus("Your profile could not be loaded right now. Settings remain locked.", "error");
    }
}
