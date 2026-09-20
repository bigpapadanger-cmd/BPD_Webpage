"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH BUTTONS

File:
    /Tabs/RocketLeague/Index/JS/connect_epic.js

Purpose:
    Controls Rocket League login, profile-setup, and logout
    buttons.

Description:
    - Sends Rocket League sign-in through the global Login
      page rather than starting Epic OAuth directly.
    - Preserves Rocket League as the post-login destination.
    - Sends Epic-linked users with incomplete Rocket League
      access to the Rocket League Profile page.
    - Uses centralized API route constants.
    - Logs out through the global BPD logout endpoint.
    - Invalidates centralized client authentication state
      after logout.
    - Does not use localStorage as authentication or Rocket
      League registration state.

Authentication:
    Global login:
        /Login?returnTo=/RocketLeague

    Rocket League profile:
        /RocketLeague/Profile

    Logout:
        POST /api/auth/logout

Important:
    - Epic OAuth is started by the global Login page.
    - Turnstile verification remains part of the global login
      flow.
    - This module does not directly call the Epic login API.
    - This module does not maintain independent auth state.
    - mainRLLoginButton uses data-action set by auth.js:
          epic-login
          create-profile
========================================================= */

import {
    getAuthState,
    invalidateAuthState
} from "/Framework/Auth/auth.js";

import {
    BPD_AUTH_LINK_URL,
    BPD_AUTH_LOGOUT_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../../scripts/apiConnection.js";

/* =========================================================
PAGE CONSTANTS
========================================================= */

const LOGIN_PAGE_URL =
    "/Login";

const ROCKET_LEAGUE_PAGE_URL =
    "/RocketLeague";

const ROCKET_LEAGUE_PROFILE_PAGE_URL =
    "/RocketLeague/Profile";

/* =========================================================
NAVIGATION
========================================================= */

function navigateTo(
    path
) {
    if (
        window.BPDRouter
        && typeof window.BPDRouter.navigate ===
            "function"
    ) {
        void window.BPDRouter.navigate(
            path
        );

        return;
    }

    window.location.assign(
        path
    );
}

/* =========================================================
EPIC LOGIN
========================================================= */

let epicStartPending = false;
async function handleEpicLogin(event) {
    const button = event?.currentTarget;
    if (epicStartPending) return;
    epicStartPending = true;
    if (button) button.disabled = true;
    try {
        const state = await getAuthState();
        if (!state || state.available !== true) throw new Error("Authentication is temporarily unavailable. Please try again.");
        if (state.authenticated === true) {
            if (state.active !== true) {
                window.location.assign("/Account");
                return;
            }
            const url = new URL(BPD_AUTH_LINK_URL, window.location.origin);
            url.searchParams.set("provider", "epic");
            url.searchParams.set("returnTo", ROCKET_LEAGUE_PAGE_URL);
            window.location.assign(url.href);
            return;
        }
        const url = new URL(LOGIN_PAGE_URL, window.location.origin);
        url.searchParams.set("provider", "epic");
        url.searchParams.set("returnTo", ROCKET_LEAGUE_PAGE_URL);
        window.location.assign(url.href);
    } catch (error) {
        window.alert(error?.message || "Epic sign-in could not be started. Please try again.");
    } finally {
        epicStartPending = false;
        if (button) button.disabled = false;
    }
}

function handleCreateProfile() {
    navigateTo(
        ROCKET_LEAGUE_PROFILE_PAGE_URL
    );
}

/* =========================================================
MAIN ROCKET LEAGUE CTA
========================================================= */

function handleMainRocketLeagueAction(
    event
) {
    const button =
        event.currentTarget;

    const action =
        button?.dataset?.action
        || "epic-login";

    if (action === "epic-reauthorize") {
        void handleEpicLogin(event);
        return;
    }
    if (
        action === "create-profile"
    ) {
        handleCreateProfile();

        return;
    }

    void handleEpicLogin(event);
}

/* =========================================================
LOGOUT
========================================================= */

async function handleLogout() {
    const logoutButton =
        document.getElementById(
            "sidebarLogoutButton"
        );

    if (
        !logoutButton
    ) {
        return;
    }

    logoutButton.disabled =
        true;

    try {
        const response =
            await apiFetch(
                BPD_AUTH_LOGOUT_URL,
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Logout failed: ${response.status}`
            );
        }

        invalidateAuthState();

        window.location.assign(
            ROCKET_LEAGUE_PAGE_URL
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE AUTH BUTTONS: Logout failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        logoutButton.disabled =
            false;
    }
}

/* =========================================================
INITIALIZATION
========================================================= */

export function initializeEpicConnection() {
    const loginButton =
        document.getElementById(
            "sidebarLoginButton"
        );

    const loginHomepageButton =
        document.getElementById(
            "mainRLLoginButton"
        );

    const logoutButton =
        document.getElementById(
            "sidebarLogoutButton"
        );

    /*
     * Sidebar login is always a global login/Epic-link action.
     */
    if (
        loginButton
        && loginButton.dataset.initialized !==
            "true"
    ) {
        loginButton.addEventListener(
            "click",
            handleEpicLogin
        );

        loginButton.dataset.initialized =
            "true";
    }

    /*
     * Homepage CTA is dynamic.
     *
     * auth.js sets:
     *
     *     data-action="epic-login"
     *
     * or:
     *
     *     data-action="create-profile"
     */
    if (
        loginHomepageButton
        && loginHomepageButton.dataset.initialized !==
            "true"
    ) {
        loginHomepageButton.addEventListener(
            "click",
            handleMainRocketLeagueAction
        );

        loginHomepageButton.dataset.initialized =
            "true";
    }

    if (
        logoutButton
        && logoutButton.dataset.initialized !==
            "true"
    ) {
        logoutButton.addEventListener(
            "click",
            handleLogout
        );

        logoutButton.dataset.initialized =
            "true";
    }
}