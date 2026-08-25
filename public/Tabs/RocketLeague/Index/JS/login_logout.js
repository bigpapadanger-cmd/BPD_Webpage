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

    const logoutButton =
        document.getElementById(
            "sidebarLogoutButton"
        );

    if (
        loginButton &&
        loginButton.dataset.initialized !== "true"
    ) {
        loginButton.addEventListener(
            "click",
            handleEpicLogin
        );

        loginButton.dataset.initialized =
            "true";
    }

    if (
        logoutButton &&
        logoutButton.dataset.initialized !== "true"
    ) {
        logoutButton.addEventListener(
            "click",
            handleLogout
        );

        logoutButton.dataset.initialized =
            "true";
    }
}