"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SIDEBAR AUTH VIEW

File:
    /Tabs/RocketLeague/JS/sidebar_auth.js

Purpose:
    Applies Rocket League authentication and access state to
    sidebar elements.

Description:
    - Consumes normalized Rocket League auth/profile state.
    - Shows or hides authenticated and guest sidebar items.
    - Shows or hides Rocket League locked/unlocked items.
    - Does not load authentication state itself.
    - Does not calculate Rocket League business rules.
    - Does not use localStorage as an authorization source.

Security:
    - This module controls UI visibility only.
    - Server APIs remain authoritative for Rocket League
      access and provider requirements.

Important:
    - Global authentication comes from Framework/Auth/auth.js.
    - Rocket League-specific access comes from
      /Tabs/RocketLeague/JS/auth.js.
========================================================= */

export function applySidebarAuthState(
    authSession
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

    sidebar
        .querySelectorAll(
            "[data-auth]"
        )
        .forEach(
            function(element) {
                const requiredState =
                    element.dataset.auth;

                if (
                    requiredState ===
                    "authenticated"
                ) {
                    element.hidden =
                        !authenticated;
                }

                if (
                    requiredState ===
                    "guest"
                ) {
                    element.hidden =
                        authenticated;
                }
            }
        );

    sidebar
        .querySelectorAll(
            "[data-rl-access]"
        )
        .forEach(
            function(element) {
                const requiredState =
                    element.dataset.rlAccess;

                if (
                    requiredState ===
                    "unlocked"
                ) {
                    element.hidden =
                        !rocketLeagueAccess;
                }

                if (
                    requiredState ===
                    "locked"
                ) {
                    element.hidden =
                        rocketLeagueAccess;
                }
            }
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