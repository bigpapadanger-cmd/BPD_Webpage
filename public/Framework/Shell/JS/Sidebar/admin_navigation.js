import { subscribeToAuthState, hasAuthorizedProvider } from "/Framework/Auth/auth.js";
let authSubscriptionStarted = false;
let accessCheckVersion = 0;

"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN SIDEBAR NAVIGATION

File:
    /Framework/Shell/JS/Sidebar/admin_navigation.js

Purpose:
    Controls visibility of the Admin sidebar navigation item.

Responsibilities:
    - Starts the Admin navigation item hidden.
    - Verifies Admin/staff access server-side.
    - Shows the Admin item only for authorized accounts.
    - Fails closed when authorization cannot be verified.
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

/* =========================================================
SET VISIBILITY
========================================================= */

function setAdminNavigationVisible(
    adminNavItem,
    visible
) {
    if (
        !adminNavItem
    ) {
        return;
    }

    adminNavItem.hidden =
        visible !== true;
}

/* =========================================================
INITIALIZE ADMIN NAVIGATION
========================================================= */

export async function setupAdminNavigation(state) {
    const checkVersion = ++accessCheckVersion;
    if (!authSubscriptionStarted) {
        authSubscriptionStarted = true;
        subscribeToAuthState(nextState => { void setupAdminNavigation(nextState); });
    }
    const adminNavItem =
        document.getElementById(
            "adminNavItem"
        );

    if (
        !adminNavItem
    ) {
        return;
    }

    /*
     * Fail closed.
     *
     * The Admin item remains hidden until the server explicitly
     * confirms that the current account is authorized.
     */
    setAdminNavigationVisible(
        adminNavItem,
        false
    );

    if (state && (state.available !== true || state.authenticated !== true
        || state.active !== true || !hasAuthorizedProvider("discord", state))) return;

    try {
        const response =
            await fetch(
                ADMIN_ACCESS_URL,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    headers: {
                        "Accept":
                            "application/json"
                    },

                    cache:
                        "no-store"
                }
            );

        if (
            !response.ok
        ) {
            return;
        }

        const result =
            await response
                .json()
                .catch(
                    () => null
                );

        if (
            result?.success !==
                true
            || result?.authorized !==
                true
        ) {
            return;
        }

        if (checkVersion !== accessCheckVersion || document.getElementById("adminNavItem") !== adminNavItem) return;

        setAdminNavigationVisible(
            adminNavItem,
            true
        );
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN NAVIGATION ACCESS CHECK FAILED:",
            error
        );
    }
}