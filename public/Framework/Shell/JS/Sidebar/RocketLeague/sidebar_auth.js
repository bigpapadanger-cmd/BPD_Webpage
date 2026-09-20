"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SIDEBAR AUTH VIEW

File:
    /Framework/Shell/JS/Sidebar/RocketLeague/sidebar_auth.js

Purpose:
    Applies normalized Rocket League authentication,
    profile, and access state to Rocket League sidebar
    elements.

Description:
    - Consumes normalized Rocket League auth/profile state.
    - Shows or hides authenticated and guest sidebar items.
    - Shows protected Rocket League navigation normally only
      when rocketLeagueAccess is true.
    - Allows the full Rocket League sidebar to remain visible
      on Rocket League OCR routes when the user has a complete
      Rocket League profile.
    - Does not load authentication state itself.
    - Does not calculate backend authorization rules.
    - Does not use localStorage as an authorization source.

Security:
    - This module controls UI visibility only.
    - Server APIs remain authoritative for Rocket League
      access, provider freshness, and provider requirements.
========================================================= */

/* =========================================================
ROUTE NORMALIZATION
========================================================= */

function normalizePath(
    path
) {
    const normalized =
        String(
            path
            || "/"
        )
            .trim()
            .replace(
                /\/+$/,
                ""
            )
            .toLowerCase();

    return normalized
        || "/";
}

/* =========================================================
OCR ROUTE CHECK
========================================================= */

function isRocketLeagueOcrRoute() {
    const path =
        normalizePath(
            window.location.pathname
        );

    return (
        path ===
            "/rocketleague/ocr"
        || path.startsWith(
            "/rocketleague/ocr/"
        )
    );
}

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
    navigationUnlocked
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
                        !navigationUnlocked;
                }
                else if (
                    requiredState ===
                    "locked"
                ) {
                    element.hidden =
                        navigationUnlocked;
                }
            }
        );
}

/* =========================================================
SIDEBAR NAVIGATION RULE

Normal Rocket League pages:
    Full navigation requires rocketLeagueAccess.

Rocket League OCR pages:
    Full navigation is also shown when profileComplete is
    true.

This is presentation only. It does not bypass protected API
authorization.
========================================================= */

function canShowFullRocketLeagueNavigation(
    authSession
) {
    const rocketLeagueAccess =
        authSession?.rocketLeagueAccess ===
        true;

    if (
        rocketLeagueAccess
    ) {
        return true;
    }

    const profileComplete =
        authSession?.profileComplete ===
        true;

    if (
        profileComplete
        && isRocketLeagueOcrRoute()
    ) {
        return true;
    }

    return false;
}

/* =========================================================
APPLY SIDEBAR AUTH STATE
========================================================= */

export function applySidebarAuthState(
    authSession =
        null
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

    const profileLoaded =
        authSession?.profileLoaded ===
        true;

    const profileComplete =
        authSession?.profileComplete ===
        true;

    const requiresEpicLogin =
        authSession?.requiresEpicLogin ===
        true;

    const navigationUnlocked =
        canShowFullRocketLeagueNavigation(
            authSession
        );

    applyAuthenticationVisibility(
        sidebar,
        authenticated
    );

    applyRocketLeagueAccessVisibility(
        sidebar,
        navigationUnlocked
    );

    /* -----------------------------------------------------
    DEBUG / UI STATE ATTRIBUTES

    These are presentation/debug values only.
    ----------------------------------------------------- */

    sidebar.dataset.authenticated =
        String(
            authenticated
        );

    sidebar.dataset.rlAccess =
        String(
            rocketLeagueAccess
        );

    sidebar.dataset.rlProfileLoaded =
        String(
            profileLoaded
        );

    sidebar.dataset.rlProfileComplete =
        String(
            profileComplete
        );

    sidebar.dataset.rlRequiresEpicLogin =
        String(
            requiresEpicLogin
        );

    sidebar.dataset.rlNavigationUnlocked =
        String(
            navigationUnlocked
        );

    sidebar.dataset.rlOcrRoute =
        String(
            isRocketLeagueOcrRoute()
        );
}