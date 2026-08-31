"use strict";

import {
    EPIC_LOGIN_URL,
    BPD_AUTH_LOGOUT_URL
} from "/scripts/apiRoutes.js";

function handleEpicLogin() {
    window.location.assign(
        EPIC_LOGIN_URL
    );
}

async function handleLogout() {
    const logoutButton =
        document.getElementById(
            "sidebarLogoutButton"
        );

    if (!logoutButton) {
        return;
    }

    logoutButton.disabled = true;

    try {
        const response = await fetch(
            BPD_AUTH_LOGOUT_URL,
            {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "accept": "application/json"
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                `Logout failed: ${response.status}`
            );
        }
        localStorage.removeItem(
            "bpdRocketLeagueRegistrationAccepted"
        );
        window.location.assign(
            "/RocketLeague"
        );
    } catch (error) {
        console.error(
            "AUTH BUTTONS: Logout failed.",
            error
        );

        logoutButton.disabled = false;
    }
}

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
        .filter(Boolean)
        .forEach((button) => {
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
        });

    if (
        logoutButton &&
        logoutButton.dataset.initialized !==
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