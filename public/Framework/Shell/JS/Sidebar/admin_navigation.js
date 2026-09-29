"use strict";

import { subscribeToAuthState, hasAdminAccess, peekAuthState } from "/Framework/Auth/auth.js";

let authSubscriptionStarted = false;

/* =========================================================
BPD GAMING NETWORK
ADMIN SIDEBAR NAVIGATION

File:
    /Framework/Shell/JS/Sidebar/admin_navigation.js

Purpose:
    Controls visibility of Admin shortcuts in the sidebar and
    main menu.

Responsibilities:
    - Starts the Admin navigation item hidden.
    - Reuses Admin/staff access verified by the shared auth module.
    - Shows the Admin item only for authorized accounts.
    - Fails closed when authorization cannot be verified.
========================================================= */

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

Reuse the canonical authorization state already fetched by
the shared auth module. This keeps navigation fail-closed
without issuing a second Admin access request per page.
========================================================= */

export function setupAdminNavigation(state) {
    if (!authSubscriptionStarted) {
        authSubscriptionStarted = true;
        subscribeToAuthState(nextState => { void setupAdminNavigation(nextState); });
    }
    const adminNavItems = [
        document.getElementById("adminNavItem"),
        document.getElementById("adminHomeCard")
    ].filter(Boolean);

    if (!adminNavItems.length) {
        return;
    }

    /*
     * Fail closed.
     *
     * The Admin item remains hidden until the server explicitly
     * confirms that the current account is authorized.
     */
    adminNavItems.forEach(item => setAdminNavigationVisible(item, false));

    const authState = state || peekAuthState();
    if (authState?.available !== true || authState?.authenticated !== true || authState?.active !== true) return;

    if (hasAdminAccess(authState)) {
        for (const item of adminNavItems) {
            if (item.isConnected !== false) setAdminNavigationVisible(item, true);
        }
    }
}
