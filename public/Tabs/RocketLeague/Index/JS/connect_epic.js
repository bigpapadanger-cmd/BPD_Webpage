"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH BUTTONS

File:
    /Tabs/RocketLeague/JS/connect_epic.js

Purpose:
    Controls Rocket League login and logout buttons.

Description:
    - Sends Rocket League sign-in through the global Login
      page rather than starting Epic OAuth directly.
    - Preserves Rocket League as the post-login destination.
    - Uses centralized API route constants.
    - Logs out through the global BPD logout endpoint.
    - Invalidates centralized client authentication state
      after logout.
    - Does not use localStorage as authentication or Rocket
      League registration state.

Authentication:
    Global login:
        /Login?returnTo=/RocketLeague

    Logout:
        POST /api/auth/logout

Important:
    - Epic OAuth is started by the global Login page.
    - Turnstile verification remains part of the global login
      flow.
    - This module does not directly call the Epic login API.
    - This module does not maintain independent auth state.
========================================================= */

import {
    invalidateAuthState
} from "/Framework/Auth/auth.js";

import {
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

/* =========================================================
LOGIN
========================================================= */

function handleEpicLogin() {
    const loginUrl =
        new URL(
            LOGIN_PAGE_URL,
            window.location.origin
        );

    loginUrl.searchParams.set(
        "returnTo",
        ROCKET_LEAGUE_PAGE_URL
    );

    window.location.assign(
        loginUrl.href
    );
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

        /*
         * The server session is gone. Invalidate the shared
         * client auth cache before leaving the current page.
         */
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

export function initializeButtons() {
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

    [
        loginButton,
        loginHomepageButton
    ]
        .filter(
            Boolean
        )
        .forEach(
            button => {
                if (
                    button.dataset.initialized ===
                    "true"
                ) {
                    return;
                }

                button.addEventListener(
                    "click",
                    handleEpicLogin
                );

                button.dataset.initialized =
                    "true";
            }
        );

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