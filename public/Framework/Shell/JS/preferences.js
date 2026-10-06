"use strict";

export const PREFERENCE_DEFAULTS = Object.freeze({
    theme: "blue",
    animations: "on",
    sidebar: "open",
    backgroundColor: "#0d0f13",
    hoverTextColor: "#ffffff"
});

const KEYS = Object.freeze({
    theme: "bpdTheme",
    animations: "bpdAnimations",
    sidebar: "bpdSidebar",
    backgroundColor: "bpdBackgroundColor",
    hoverTextColor: "bpdHoverTextColor"
});

// Color pickers use six-digit hex; never accept declarations or CSS expressions.
export function isValidPreferenceColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function readColorPreference(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
            ? value.toLowerCase()
            : fallback;
    } catch {
        return fallback;
    }
}

function channelLuminance(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
    const luminance = color => {
        const channels = color.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
        return channels.reduce((sum, channel, index) => sum + channelLuminance(channel) * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

export function hasReadableContrast(color, background) {
    return typeof color === "string"
        && typeof background === "string"
        && /^#[0-9a-f]{6}$/i.test(color)
        && /^#[0-9a-f]{6}$/i.test(background)
        && contrastRatio(color, background) >= 4.5;
}

export function readPreferences() {
    try {
        const theme = localStorage.getItem(KEYS.theme);
        const backgroundColor = readColorPreference(KEYS.backgroundColor, PREFERENCE_DEFAULTS.backgroundColor);
        const savedHoverTextColor = readColorPreference(KEYS.hoverTextColor, PREFERENCE_DEFAULTS.hoverTextColor);
        return {
            theme: ["blue", "orange", "purple", "green", "cyan", "emerald"].includes(theme) ? theme : PREFERENCE_DEFAULTS.theme,
            animations: localStorage.getItem(KEYS.animations) === "off" ? "off" : PREFERENCE_DEFAULTS.animations,
            sidebar: readSidebarPreference() ?? PREFERENCE_DEFAULTS.sidebar,
            backgroundColor,
            hoverTextColor: savedHoverTextColor
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
    const backgroundColor = isValidPreferenceColor(preferences.backgroundColor)
        ? preferences.backgroundColor
        : PREFERENCE_DEFAULTS.backgroundColor;
    const hoverTextColor = isValidPreferenceColor(preferences.hoverTextColor)
        ? preferences.hoverTextColor
        : PREFERENCE_DEFAULTS.hoverTextColor;
    document.documentElement.style.setProperty("--bpd-user-background", backgroundColor);
    document.documentElement.style.setProperty("--bpd-hover-text-color", hoverTextColor);
}
