"use strict";

export const PREFERENCE_DEFAULTS = Object.freeze({
    theme: "blue",
    animations: "on",
    sidebar: "open"
});

const KEYS = Object.freeze({
    theme: "bpdTheme",
    animations: "bpdAnimations",
    sidebar: "bpdSidebar"
});

export function readPreferences() {
    try {
        const theme = localStorage.getItem(KEYS.theme);
        return {
            theme: ["blue", "orange", "purple", "green"].includes(theme) ? theme : PREFERENCE_DEFAULTS.theme,
            animations: localStorage.getItem(KEYS.animations) === "off" ? "off" : PREFERENCE_DEFAULTS.animations,
            sidebar: readSidebarPreference() ?? PREFERENCE_DEFAULTS.sidebar
        };
    } catch {
        return { ...PREFERENCE_DEFAULTS };
    }
}

export function readSidebarPreference() {
    try {
        const value = localStorage.getItem(KEYS.sidebar);
        return value === "collapsed" || value === "open" ? value : null;
    } catch {
        return null;
    }
}

export function savePreference(name, value) {
    if (!Object.hasOwn(KEYS, name)) return false;
    try {
        localStorage.setItem(KEYS[name], value);
        return true;
    } catch {
        return false;
    }
}

export function applyAppearancePreferences(preferences = readPreferences()) {
    document.body.dataset.theme = preferences.theme;
    document.body.dataset.animations = preferences.animations;
    document.body.classList.toggle("animations-off", preferences.animations === "off");
}
