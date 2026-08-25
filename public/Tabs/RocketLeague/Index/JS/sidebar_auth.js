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

    sidebar
        .querySelectorAll("[data-auth]")
        .forEach(function(element) {
            const requiredState =
                element.dataset.auth;

            if (
                requiredState ===
                "authenticated"
            ) {
                element.hidden =
                    !authenticated;

                return;
            }

            if (requiredState === "guest") {
                element.hidden =
                    authenticated;
            }
        });

    sidebar.dataset.authenticated =
        String(authenticated);
}