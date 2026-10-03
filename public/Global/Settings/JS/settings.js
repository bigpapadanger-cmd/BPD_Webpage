"use strict";

import { setSidebarCollapsed } from "../../../Framework/Shell/JS/Sidebar/state.js";
import { applyAppearancePreferences, PREFERENCE_DEFAULTS, readPreferences, readSidebarPreference, savePreference } from "../../../Framework/Shell/JS/preferences.js";
import { BPD_AUTH_ACCOUNT_PROFILE_URL } from "../../../scripts/apiRoutes.js";
import { renderDisplayNameCooldown } from "./display_name_cooldown.js";

let savedDisplayName = "";
let changeAvailableAt = null;
let cooldownStateKnown = false;
let cooldownActive = false;
let nameSaving = false;
let cooldownTimer = null;

function parseTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function applySidebarPreference(sidebarPreference) {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebarToggle");
    if (sidebar) setSidebarCollapsed(sidebar, toggle, sidebarPreference === "collapsed");
}

function updateDisplayNameLock() {
    const input = document.getElementById("displayNameSetting");
    const save = document.getElementById("saveDisplayNameSetting");
    const status = document.getElementById("displayNameSettingStatus");
    const remaining = document.getElementById("displayNameCooldownRemaining");
    const available = document.getElementById("displayNameCooldownAvailableAt");
    if (!input || !save || !status) return;

    renderDisplayNameCooldown({ input, save, status, remaining, available }, {
        displayName: savedDisplayName,
        proposed: input.value,
        availableAt: changeAvailableAt,
        availabilityKnown: cooldownStateKnown,
        cooldownForced: cooldownActive,
        saving: nameSaving
    });
}

function scheduleCooldownRefresh() {
    if (cooldownTimer !== null) clearTimeout(cooldownTimer);
    if (changeAvailableAt === null || changeAvailableAt <= Date.now()) return;
    cooldownTimer = setTimeout(() => {
        if (window.location.pathname !== "/Settings") {
            cooldownTimer = null;
            return;
        }
        cooldownActive = changeAvailableAt !== null && changeAvailableAt > Date.now();
        updateDisplayNameLock();
        scheduleCooldownRefresh();
    }, Math.min(60_000, changeAvailableAt - Date.now()));
}

if (typeof document !== "undefined") {
    document.addEventListener?.("bpd:page-loaded", event => {
        if (event.detail?.routePath !== "/Settings" && cooldownTimer !== null) {
            clearTimeout(cooldownTimer);
            cooldownTimer = null;
        }
    });
}

async function loadDisplayNameSettings() {
    const section = document.getElementById("accountDisplayNameSettings");
    if (!section) return;
    try {
        const { getAuthState } = await import("../../../Framework/Auth/auth.js");
        const state = await getAuthState({ force: true });
        section.hidden = state?.authenticated !== true;
        if (state?.authenticated !== true) return;
        savedDisplayName = typeof state.displayName === "string" ? state.displayName : "";
        cooldownStateKnown = Object.hasOwn(state, "displayNameChangeAvailableAt")
            && (state.displayNameChangeAvailableAt === null || parseTimestamp(state.displayNameChangeAvailableAt) !== null);
        changeAvailableAt = parseTimestamp(state.displayNameChangeAvailableAt);
        cooldownActive = changeAvailableAt !== null && changeAvailableAt > Date.now();
        const input = document.getElementById("displayNameSetting");
        if (input) input.value = savedDisplayName;
        updateDisplayNameLock();
        scheduleCooldownRefresh();
    } catch {
        section.hidden = true;
    }
}

async function saveDisplayName() {
    if (nameSaving) return;
    const input = document.getElementById("displayNameSetting");
    const save = document.getElementById("saveDisplayNameSetting");
    const status = document.getElementById("displayNameSettingStatus");
    const value = input?.value.trim() ?? "";
    if (!input || !save || !status || !value || value === savedDisplayName) {
        updateDisplayNameLock();
        return;
    }

    let statusMessage = "";
    nameSaving = true;
    updateDisplayNameLock();
    status.textContent = "Saving your BPD display name…";
    try {
        const { apiFetch } = await import("../../../scripts/apiConnection.js");
        const response = await apiFetch(BPD_AUTH_ACCOUNT_PROFILE_URL, {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ displayName: value })
        });
        const result = await response.json();
        if (!response.ok || result?.success !== true) {
            if (result?.code === "DISPLAY_NAME_CHANGE_COOLDOWN") {
                changeAvailableAt = parseTimestamp(result.displayNameChangeAvailableAt);
                cooldownStateKnown = Object.hasOwn(result, "displayNameChangeAvailableAt")
                    && (result.displayNameChangeAvailableAt === null || changeAvailableAt !== null);
                cooldownActive = changeAvailableAt === null || changeAvailableAt > Date.now();
            }
            const messages = {
                DISPLAY_NAME_REQUIRED: "Enter a display name.",
                DISPLAY_NAME_TOO_SHORT: "Use at least 3 characters.",
                DISPLAY_NAME_TOO_LONG: "Use no more than 32 characters.",
                DISPLAY_NAME_INVALID: "That display name contains characters that are not allowed.",
                DISPLAY_NAME_RESERVED: "That display name is reserved.",
                DISPLAY_NAME_INAPPROPRIATE: "That display name isn't allowed. Please choose another name.",
                DISPLAY_NAME_TAKEN: "That display name is already in use.",
                DISPLAY_NAME_CHANGE_COOLDOWN: "Your display name is still within its change cooldown."
            };
            statusMessage = messages[result?.code] || result?.message || "The display name could not be saved. Try again.";
            updateDisplayNameLock();
            scheduleCooldownRefresh();
            status.textContent = statusMessage;
            return;
        }

        savedDisplayName = result.displayName;
        cooldownStateKnown = Object.hasOwn(result, "displayNameChangeAvailableAt")
            && (result.displayNameChangeAvailableAt === null || parseTimestamp(result.displayNameChangeAvailableAt) !== null);
        changeAvailableAt = parseTimestamp(result.displayNameChangeAvailableAt);
        cooldownActive = changeAvailableAt !== null && changeAvailableAt > Date.now();
        input.value = savedDisplayName;
        try {
            const { notifyAuthChanged } = await import("../../../Framework/Auth/auth.js");
            void notifyAuthChanged().catch(() => {});
        } catch {}
        updateDisplayNameLock();
        scheduleCooldownRefresh();
        statusMessage = "Your BPD display name is saved.";
    } catch {
        statusMessage = "Account services are temporarily unavailable. Your name was not changed.";
    } finally {
        nameSaving = false;
        updateDisplayNameLock();
        if (statusMessage) status.textContent = statusMessage;
    }
}

export async function initializePage() {
    const theme = document.getElementById("themeSetting");
    const animations = document.getElementById("animationSetting");
    const sidebar = document.getElementById("sidebarSetting");
    const reset = document.getElementById("resetSettings");
    const privacy = document.getElementById("privacySettings");
    const privacyStatus = document.getElementById("privacySettingsStatus");
    const preferences = readPreferences();
    preferences.sidebar = readSidebarPreference() ?? (window.innerWidth <= 700 ? "collapsed" : "open");

    applyAppearancePreferences(preferences);
    if (theme) theme.value = preferences.theme;
    if (animations) {
        animations.textContent = preferences.animations === "on" ? "On" : "Off";
        animations.setAttribute("aria-pressed", String(preferences.animations === "on"));
    }
    if (sidebar) {
        sidebar.textContent = preferences.sidebar === "open" ? "Open" : "Collapsed";
        sidebar.setAttribute("aria-pressed", String(preferences.sidebar === "open"));
    }
    applySidebarPreference(preferences.sidebar);

    theme?.addEventListener("change", () => {
        if (savePreference("theme", theme.value)) {
            preferences.theme = theme.value;
            applyAppearancePreferences(preferences);
        }
    });

    animations?.addEventListener("click", () => {
        preferences.animations = preferences.animations === "on" ? "off" : "on";
        savePreference("animations", preferences.animations);
        applyAppearancePreferences(preferences);
        animations.textContent = preferences.animations === "on" ? "On" : "Off";
        animations.setAttribute("aria-pressed", String(preferences.animations === "on"));
    });

    sidebar?.addEventListener("click", () => {
        preferences.sidebar = preferences.sidebar === "open" ? "collapsed" : "open";
        savePreference("sidebar", preferences.sidebar);
        applySidebarPreference(preferences.sidebar);
        sidebar.textContent = preferences.sidebar === "open" ? "Open" : "Collapsed";
        sidebar.setAttribute("aria-pressed", String(preferences.sidebar === "open"));
    });

    reset?.addEventListener("click", () => {
        for (const [key, value] of Object.entries(PREFERENCE_DEFAULTS)) savePreference(key, value);
        Object.assign(preferences, PREFERENCE_DEFAULTS);
        applyAppearancePreferences(preferences);
        applySidebarPreference(preferences.sidebar);
        if (theme) theme.value = PREFERENCE_DEFAULTS.theme;
        if (animations) {
            animations.textContent = "On";
            animations.setAttribute("aria-pressed", "true");
        }
        if (sidebar) {
            sidebar.textContent = "Open";
            sidebar.setAttribute("aria-pressed", "true");
        }
    });

    document.getElementById("saveDisplayNameSetting")?.addEventListener("click", saveDisplayName);
    document.getElementById("displayNameSetting")?.addEventListener("input", updateDisplayNameLock);
    void loadDisplayNameSettings();

    privacy?.addEventListener("click", () => {
        const googlefc = window.googlefc;
        if (
            googlefc
            && googlefc.callbackQueue
            && typeof googlefc.showRevocationMessage === "function"
        ) {
            googlefc.callbackQueue.push(googlefc.showRevocationMessage);
            if (privacyStatus) privacyStatus.textContent = "Google’s privacy choices were opened.";
            return;
        }

        if (privacyStatus) {
            privacyStatus.textContent = "Google AdSense Privacy & Messaging is not available. The site owner must enable its consent message in AdSense.";
        }
    });
}
