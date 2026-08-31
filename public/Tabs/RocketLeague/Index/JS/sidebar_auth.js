"use strict";

export function applySidebarAuthState(
    authSession
) {
    const sidebar =
        document.getElementById("sidebar");

    if (!sidebar) {
        return;
    }

    const authenticated =
        authSession?.authenticated === true;

    const registrationAccepted =
        authSession?.registrationAccepted === true ||
        localStorage.getItem(
            "bpdRocketLeagueRegistrationAccepted"
        ) === "true";

    const profileComplete =
        authSession?.profileComplete === true;

    const rocketLeagueAccess =
        authenticated &&
        (
            profileComplete ||
            registrationAccepted
        );

    sidebar
        .querySelectorAll("[data-auth]")
        .forEach(function(element) {
            const requiredState =
                element.dataset.auth;

            if (
                requiredState === "authenticated"
            ) {
                element.hidden =
                    !authenticated;
            }

            if (
                requiredState === "guest"
            ) {
                element.hidden =
                    authenticated;
            }
        });

    sidebar
        .querySelectorAll("[data-rl-access]")
        .forEach(function(element) {
            const requiredState =
                element.dataset.rlAccess;

            if (
                requiredState === "unlocked"
            ) {
                element.hidden =
                    !rocketLeagueAccess;
            }

            if (
                requiredState === "locked"
            ) {
                element.hidden =
                    rocketLeagueAccess;
            }
        });

    sidebar.dataset.authenticated =
        String(
            authenticated
        );

    sidebar.dataset.rlAccess =
        String(
            rocketLeagueAccess
        );
}