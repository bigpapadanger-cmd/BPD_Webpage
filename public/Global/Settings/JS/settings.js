/*
=========================================================
BPD GAMING NETWORK
SETTINGS
=========================================================
Controls the user's global BPD Gaming Network preferences.

Settings stored in localStorage:

bpdTheme
bpdAnimations
bpdSidebar

The actual sidebar is controlled exclusively by sidebar.js.
This file only saves the user's sidebar preference and
updates the Settings page UI.
=========================================================
*/


/*
=========================================================
SETTINGS ELEMENTS
=========================================================
*/

const themeSetting = document.getElementById("themeSetting");
const animationSetting = document.getElementById("animationSetting");
const sidebarSetting = document.getElementById("sidebarSetting");
const resetSettings = document.getElementById("resetSettings");


/*
=========================================================
DEFAULT SETTINGS
=========================================================
*/

const DEFAULT_THEME = "blue";
const DEFAULT_ANIMATIONS = "on";
const DEFAULT_SIDEBAR = "open";


/*
=========================================================
GET SAVED SETTINGS
=========================================================
*/

function getSavedSettings() {
    return {
        theme:
            localStorage.getItem("bpdTheme") ||
            DEFAULT_THEME,
        animations:
            localStorage.getItem("bpdAnimations") ||
            DEFAULT_ANIMATIONS,
        sidebar:
            localStorage.getItem("bpdSidebar") ||
            DEFAULT_SIDEBAR
    };
}


/*
=========================================================
APPLY THEME
=========================================================
*/

function applyTheme(theme) {
    document.body.dataset.theme = theme;
}


/*
=========================================================
APPLY ANIMATIONS
=========================================================
*/

function applyAnimations(animations) {
    document.body.dataset.animations = animations;

    if (animations === "off") {
        document.body.classList.add("animations-off");
    } else {
        document.body.classList.remove("animations-off");
    }
}


/*
=========================================================
UPDATE THEME UI
=========================================================
*/

function updateThemeUI() {
    if (!themeSetting) {
        return;
    }

    const settings = getSavedSettings();

    themeSetting.value = settings.theme;
}


/*
=========================================================
UPDATE ANIMATION BUTTON
=========================================================
*/

function updateAnimationButton() {
    if (!animationSetting) {
        return;
    }

    const settings = getSavedSettings();

    const enabled =
        settings.animations === "on";

    animationSetting.classList.toggle(
        "active",
        enabled
    );

    const toggleText =
        animationSetting.querySelector(
            ".toggle-text"
        );

    if (toggleText) {
        toggleText.textContent =
            enabled ? "On" : "Off";
    }

    animationSetting.setAttribute(
        "aria-pressed",
        enabled ? "true" : "false"
    );
}


/*
=========================================================
UPDATE SIDEBAR BUTTON
=========================================================

This ONLY updates the Settings page button.

sidebar.js controls the actual sidebar.

=========================================================
*/

function updateSidebarButton() {
    if (!sidebarSetting) {
        return;
    }

    const settings = getSavedSettings();

    const sidebarOpen =
        settings.sidebar !== "collapsed";

    sidebarSetting.classList.toggle(
        "active",
        sidebarOpen
    );

    const toggleText =
        sidebarSetting.querySelector(
            ".toggle-text"
        );

    if (toggleText) {
        toggleText.textContent =
            sidebarOpen
                ? "Open"
                : "Collapsed";
    }

    sidebarSetting.setAttribute(
        "aria-pressed",
        sidebarOpen ? "true" : "false"
    );
}


/*
=========================================================
THEME SETTING
=========================================================
*/

if (themeSetting) {
    themeSetting.addEventListener(
        "change",
        () => {
            const theme =
                themeSetting.value;

            localStorage.setItem(
                "bpdTheme",
                theme
            );

            applyTheme(theme);
        }
    );
}


/*
=========================================================
ANIMATION SETTING
=========================================================
*/

if (animationSetting) {
    animationSetting.addEventListener(
        "click",
        () => {
            const settings =
                getSavedSettings();

            const newState =
                settings.animations === "on"
                    ? "off"
                    : "on";

            localStorage.setItem(
                "bpdAnimations",
                newState
            );

            applyAnimations(
                newState
            );

            updateAnimationButton();
        }
    );
}


/*
=========================================================
SIDEBAR SETTING
=========================================================

This ONLY changes the saved preference.

sidebar.js owns the actual sidebar.

=========================================================
*/

if (sidebarSetting) {
    sidebarSetting.addEventListener(
        "click",
        () => {
            const settings =
                getSavedSettings();

            const newState =
                settings.sidebar === "collapsed"
                    ? "open"
                    : "collapsed";

            localStorage.setItem(
                "bpdSidebar",
                newState
            );

            updateSidebarButton();
        }
    );
}


/*
=========================================================
RESET SETTINGS
=========================================================
*/

if (resetSettings) {
    resetSettings.addEventListener(
        "click",
        () => {
            localStorage.setItem(
                "bpdTheme",
                DEFAULT_THEME
            );

            localStorage.setItem(
                "bpdAnimations",
                DEFAULT_ANIMATIONS
            );

            localStorage.setItem(
                "bpdSidebar",
                DEFAULT_SIDEBAR
            );

            applyTheme(
                DEFAULT_THEME
            );

            applyAnimations(
                DEFAULT_ANIMATIONS
            );

            updateThemeUI();
            updateAnimationButton();
            updateSidebarButton();
        }
    );
}


/*
=========================================================
INITIALIZE SETTINGS UI
=========================================================
*/

const savedSettings =
    getSavedSettings();

applyTheme(
    savedSettings.theme
);

applyAnimations(
    savedSettings.animations
);

updateThemeUI();
updateAnimationButton();
updateSidebarButton();