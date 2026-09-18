"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SIDEBAR AUTH VIEW

File:
    /Framework/Shell/JS/Sidebar/RocketLeague/sidebar_auth.js

Purpose:
    Applies normalized Rocket League authentication and
    access state to Rocket League sidebar elements.

Description:
    - Consumes normalized Rocket League auth/profile state.
    - Shows or hides authenticated and guest sidebar items.
    - Shows protected Rocket League navigation only when
      rocketLeagueAccess is true.
    - Does not load authentication state itself.
    - Does not calculate Rocket League business rules.
    - Does not use localStorage as an authorization source.

Security:
    - This module controls UI visibility only.
    - Server APIs remain authoritative for Rocket League
      access and provider requirements.
========================================================= */

/* =========================================================
AUTHENTICATION VISIBILITY
========================================================= */

function applyAuthenticationVisibility(
    sidebar,
    authenticated
) {
    sidebar
        .querySelectorAll(
            "[data-auth]"
        )
        .forEach(
            function(
                element
            ) {
                const requiredState =
                    element.dataset.auth;

                if (
                    requiredState ===
                    "authenticated"
                ) {
                    element.hidden =
                        !authenticated;
                }
                else if (
                    requiredState ===
                    "guest"
                ) {
                    element.hidden =
                        authenticated;
                }
            }
        );
}

/* =========================================================
ROCKET LEAGUE ACCESS VISIBILITY
========================================================= */

function applyRocketLeagueAccessVisibility(
    sidebar,
    rocketLeagueAccess
) {
    sidebar
        .querySelectorAll(
            "[data-rl-access]"
        )
        .forEach(
            function(
                element
            ) {
                const requiredState =
                    element.dataset.rlAccess;

                if (
                    requiredState ===
                        "required"
                    || requiredState ===
                        "unlocked"
                ) {
                    element.hidden =
                        !rocketLeagueAccess;
                }
                else if (
                    requiredState ===
                    "locked"
                ) {
                    element.hidden =
                        rocketLeagueAccess;
                }
            }
        );
}

/* =========================================================
APPLY SIDEBAR AUTH STATE
========================================================= */

export function applySidebarAuthState(
    authSession = null
) {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (
        !sidebar
    ) {
        return;
    }

    const authenticated =
        authSession?.authenticated ===
        true;

    const rocketLeagueAccess =
        authSession?.rocketLeagueAccess ===
        true;

    applyAuthenticationVisibility(
        sidebar,
        authenticated
    );

    applyRocketLeagueAccessVisibility(
        sidebar,
        rocketLeagueAccess
    );

    sidebar.dataset.authenticated =
        String(
            authenticated
        );

    sidebar.dataset.rlAccess =
        String(
            rocketLeagueAccess
        );
}