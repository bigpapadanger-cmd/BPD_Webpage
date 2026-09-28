"use strict";

const DEFAULTS = Object.freeze({
    theme: "blue",
    animations: "on",
    sidebar: "open"
});

const STORAGE_KEYS = Object.freeze({
    theme: "bpdTheme",
    animations: "bpdAnimations",
    sidebar: "bpdSidebar"
});

function readPreferences() {
    try {
        return {
            theme: ["blue", "orange", "purple", "green"].includes(localStorage.getItem(STORAGE_KEYS.theme))
                ? localStorage.getItem(STORAGE_KEYS.theme)
                : DEFAULTS.theme,
            animations: localStorage.getItem(STORAGE_KEYS.animations) === "off" ? "off" : DEFAULTS.animations,
            sidebar: localStorage.getItem(STORAGE_KEYS.sidebar) === "collapsed" ? "collapsed" : DEFAULTS.sidebar
        };
    } catch {
        return { ...DEFAULTS };
    }
}

function writePreference(key, value) {
    try {
        localStorage.setItem(STORAGE_KEYS[key], value);
        return true;
    } catch {
        return false;
    }
}

function applyPreferences(preferences) {
    document.body.dataset.theme = preferences.theme;
    document.body.dataset.animations = preferences.animations;
    document.body.classList.toggle("animations-off", preferences.animations === "off");
}

export async function initializePage() {
    const theme = document.getElementById("themeSetting");
    const animations = document.getElementById("animationSetting");
    const sidebar = document.getElementById("sidebarSetting");
    const reset = document.getElementById("resetSettings");
    const privacy = document.getElementById("privacySettings");
    const privacyStatus = document.getElementById("privacySettingsStatus");
    const preferences = readPreferences();

    applyPreferences(preferences);
    if (theme) theme.value = preferences.theme;
    if (animations) {
        animations.textContent = preferences.animations === "on" ? "On" : "Off";
        animations.setAttribute("aria-pressed", String(preferences.animations === "on"));
    }
    if (sidebar) {
        sidebar.textContent = preferences.sidebar === "open" ? "Open" : "Collapsed";
        sidebar.setAttribute("aria-pressed", String(preferences.sidebar === "open"));
    }

    theme?.addEventListener("change", () => {
        if (writePreference("theme", theme.value)) {
            preferences.theme = theme.value;
            applyPreferences(preferences);
        }
    });

    animations?.addEventListener("click", () => {
        preferences.animations = preferences.animations === "on" ? "off" : "on";
        writePreference("animations", preferences.animations);
        applyPreferences(preferences);
        animations.textContent = preferences.animations === "on" ? "On" : "Off";
        animations.setAttribute("aria-pressed", String(preferences.animations === "on"));
    });

    sidebar?.addEventListener("click", () => {
        preferences.sidebar = preferences.sidebar === "open" ? "collapsed" : "open";
        writePreference("sidebar", preferences.sidebar);
        sidebar.textContent = preferences.sidebar === "open" ? "Open" : "Collapsed";
        sidebar.setAttribute("aria-pressed", String(preferences.sidebar === "open"));
    });

    reset?.addEventListener("click", () => {
        for (const [key, value] of Object.entries(DEFAULTS)) writePreference(key, value);
        Object.assign(preferences, DEFAULTS);
        applyPreferences(preferences);
        if (theme) theme.value = DEFAULTS.theme;
        if (animations) {
            animations.textContent = "On";
            animations.setAttribute("aria-pressed", "true");
        }
        if (sidebar) {
            sidebar.textContent = "Open";
            sidebar.setAttribute("aria-pressed", "true");
        }
    });

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
