"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH CONTROLLER

File:
    /Tabs/RocketLeague/JS/auth.js

Purpose:
    Controls Rocket League client-side authentication and
    profile-access state.

Description:
    - Uses Framework/Auth/auth.js as the single source of
      global BPD authentication state.
    - Requires an active canonical BPD account.
    - Checks whether Epic is linked for Rocket League UI
      access.
    - Loads Rocket League-specific profile state separately.
    - Applies Rocket League sidebar authentication state.
    - Redirects authenticated users without completed Rocket
      League access to the Rocket League profile page.
    - Preserves authentication-service unavailability as a
      distinct state instead of treating it as signed out.

Authentication State:
    /Framework/Auth/auth.js

Rocket League State:
    /Tabs/RocketLeague/JS/profile.js

Security:
    - Client-side authentication checks control UI/navigation
      only.
    - Epic linkage reported by Framework/Auth/auth.js is
      client convenience state only.
    - Rocket League APIs must independently enforce account
      and Epic authorization on the server.
    - Client code never supplies the canonical account ID.

Important:
    - This file does not call /api/auth/session directly.
    - This file does not call the legacy Rocket League
      session endpoint.
    - This file does not use window.BPDAuth.
    - This file does not dispatch bpd:auth-changed.
    - API/network failure is NOT treated as signed out.
========================================================= */

import {
    getAuthState,
    hasActiveAccount,
    hasLinkedProvider
} from "/Framework/Auth/auth.js";

import {
    applySidebarAuthState
} from "./sidebar_auth.js";

import {
    loadRocketLeagueProfile
} from "./profile.js";

import {
    renderUnavailableRanks
} from "./ranks.js";

/* =========================================================
PAGE CONSTANTS
========================================================= */

const ROCKET_LEAGUE_PROFILE_PAGE =
    "/RocketLeague/Profile";

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return "";
    }

    return value.trim();
}

/* =========================================================
GLOBAL AUTH -> ROCKET LEAGUE SESSION SHAPE

Converts centralized BPD auth state into the smaller shape
used by existing Rocket League UI modules.

This does not create a new authentication source.
========================================================= */

function createRocketLeagueSession(
    authState,
    {
        registrationAccepted = false,
        profileComplete = false,
        rocketLeagueAccess = false
    } = {}
) {
    return {
        authenticated:
            authState?.authenticated ===
            true,

        user: (
            authState?.authenticated ===
                true
            ? {
                userId:
                    normalizeString(
                        authState.userId
                    )
                    || null,

                displayName:
                    normalizeString(
                        authState.displayName
                    )
                    || null,

                role:
                    normalizeString(
                        authState.role
                    )
                    || null,

                active:
                    authState.active ===
                    true
            }
            : null
        ),

        registrationAccepted:
            registrationAccepted ===
            true,

        profileComplete:
            profileComplete ===
            true,

        rocketLeagueAccess:
            rocketLeagueAccess ===
            true
    };
}

/* =========================================================
APPLY ROCKET LEAGUE AUTH VIEW
========================================================= */

function applyRocketLeagueAuthView(
    rocketLeagueSession
) {
    const authenticated =
        rocketLeagueSession
            ?.authenticated ===
        true;

    const loggedOutContent =
        document.getElementById(
            "rocketLeagueLoggedOut"
        );

    const authenticatedContent =
        document.getElementById(
            "rocketLeagueAuthenticatedContent"
        );

    const playerProfile =
        document.getElementById(
            "rocketLeaguePlayerProfile"
        );

    if (
        loggedOutContent
    ) {
        loggedOutContent.hidden =
            authenticated;
    }

    if (
        authenticatedContent
    ) {
        authenticatedContent.hidden =
            !authenticated;
    }

    if (
        playerProfile
    ) {
        playerProfile.hidden =
            !authenticated;
    }

    document.body.dataset.authenticated =
        String(
            authenticated
        );

    applySidebarAuthState(
        rocketLeagueSession
    );

    return rocketLeagueSession;
}

/* =========================================================
APPLY AUTH UNAVAILABLE VIEW

An unavailable auth service does not prove that the user is
signed out, so do not display the confirmed logged-out view.
========================================================= */

function applyRocketLeagueUnavailableView() {
    const loggedOutContent =
        document.getElementById(
            "rocketLeagueLoggedOut"
        );

    const authenticatedContent =
        document.getElementById(
            "rocketLeagueAuthenticatedContent"
        );

    const playerProfile =
        document.getElementById(
            "rocketLeaguePlayerProfile"
        );

    if (
        loggedOutContent
    ) {
        loggedOutContent.hidden =
            true;
    }

    if (
        authenticatedContent
    ) {
        authenticatedContent.hidden =
            true;
    }

    if (
        playerProfile
    ) {
        playerProfile.hidden =
            true;
    }

    document.body.dataset.authenticated =
        "unknown";

    document.body.dataset.authAvailable =
        "false";

    document.body.dataset.rlAccess =
        "false";

    renderUnavailableRanks(
        "Authentication status is currently unavailable."
    );
}

/* =========================================================
OPEN REQUIRED PROFILE PAGE
========================================================= */

function openRequiredProfilePage() {
    if (
        window.location.pathname ===
        ROCKET_LEAGUE_PROFILE_PAGE
    ) {
        return;
    }

    if (
        window.BPDRouter
        && typeof window.BPDRouter.navigate ===
            "function"
    ) {
        window.BPDRouter.navigate(
            ROCKET_LEAGUE_PROFILE_PAGE,
            {
                replace:
                    true
            }
        );

        return;
    }

    window.location.replace(
        ROCKET_LEAGUE_PROFILE_PAGE
    );
}

/* =========================================================
SIGNED-OUT STATE
========================================================= */

function applySignedOutState(
    authState
) {
    document.body.dataset.authAvailable =
        "true";

    document.body.dataset.rlAccess =
        "false";

    return applyRocketLeagueAuthView(
        createRocketLeagueSession(
            authState
        )
    );
}

/* =========================================================
INVALID ACCOUNT STATE
========================================================= */

function applyInvalidAccountState(
    authState
) {
    const session =
        createRocketLeagueSession(
            authState
        );

    applyRocketLeagueAuthView(
        session
    );

    document.body.dataset.authAvailable =
        "true";

    document.body.dataset.rlAccess =
        "false";

    renderUnavailableRanks(
        "Your BPD account is unavailable or inactive."
    );

    return session;
}

/* =========================================================
EPIC REQUIREMENT
========================================================= */

function hasRocketLeagueProvider(
    authState
) {
    return hasLinkedProvider(
        "epic",
        authState
    );
}

/* =========================================================
LOAD ROCKET LEAGUE PROFILE
========================================================= */

async function loadProfileState(
    authState
) {
    const baseSession =
        createRocketLeagueSession(
            authState
        );

    const profileResult =
        await loadRocketLeagueProfile(
            baseSession.user
        );

    return createRocketLeagueSession(
        authState,
        {
            profileComplete:
                profileResult?.profileComplete ===
                true,

            registrationAccepted:
                profileResult?.registrationAccepted ===
                true,

            rocketLeagueAccess:
                profileResult?.rocketLeagueAccess ===
                true
        }
    );
}

/* =========================================================
INITIALIZE ROCKET LEAGUE AUTH VIEW
========================================================= */

export async function initializeRocketLeagueAuthView() {
    try {
        const authState =
            await getAuthState();

        /* =================================================
        AUTH SERVICE UNAVAILABLE
        ================================================= */

        if (
            !authState
            || authState.available !==
                true
            || authState.status ===
                "unavailable"
        ) {
            applyRocketLeagueUnavailableView();
            return;
        }

        document.body.dataset.authAvailable =
            "true";

        /* =================================================
        CONFIRMED SIGNED OUT
        ================================================= */

        if (
            authState.authenticated !==
            true
        ) {
            applySignedOutState(
                authState
            );

            return;
        }

        /* =================================================
        ACTIVE CANONICAL ACCOUNT
        ================================================= */

        if (
            !hasActiveAccount(
                authState
            )
        ) {
            applyInvalidAccountState(
                authState
            );

            return;
        }

        /* =================================================
        BASE AUTHENTICATED VIEW
        ================================================= */

        const baseSession =
            applyRocketLeagueAuthView(
                createRocketLeagueSession(
                    authState
                )
            );

        /* =================================================
        EPIC REQUIREMENT

        The centralized auth module can tell the client
        whether Epic is linked.

        Server-side Rocket League endpoints remain
        authoritative and must verify Epic independently.
        ================================================= */

        if (
            !hasRocketLeagueProvider(
                authState
            )
        ) {
            document.body.dataset.rlAccess =
                "false";

            applySidebarAuthState(
                baseSession
            );

            openRequiredProfilePage();

            return;
        }

        /* =================================================
        ROCKET LEAGUE PROFILE
        ================================================= */

        try {
            const rocketLeagueSession =
                await loadProfileState(
                    authState
                );

            applySidebarAuthState(
                rocketLeagueSession
            );

            document.body.dataset.rlAccess =
                String(
                    rocketLeagueSession
                        .rocketLeagueAccess
                );

            if (
                rocketLeagueSession
                    .rocketLeagueAccess !==
                true
            ) {
                openRequiredProfilePage();
                return;
            }
        }
        catch (
            profileError
        ) {
            console.error(
                "ROCKET LEAGUE PROFILE: Unable to load profile.",
                {
                    name:
                        profileError?.name
                        || "Error",

                    message:
                        profileError?.message
                        || "Unknown error"
                }
            );

            document.body.dataset.rlAccess =
                "false";

            renderUnavailableRanks(
                profileError?.message
                || "Profile data unavailable."
            );
        }
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE AUTH: Unable to evaluate authentication state.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        /*
         * An unexpected failure does not establish that the
         * user is signed out.
         */
        applyRocketLeagueUnavailableView();
    }
}