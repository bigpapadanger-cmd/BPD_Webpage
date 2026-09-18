"use strict";

/*
=========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH CONTROLLER

File:
    /Tabs/RocketLeague/Index/JS/auth.js

Purpose:
    Controls Rocket League client-side authentication,
    profile state, sidebar access, and protected-route
    behavior.

Description:
    - Uses Framework/Auth/auth.js as the single source of
      global BPD authentication state.
    - Allows public Rocket League pages without Epic access.
    - Loads Rocket League profile state when Epic is linked.
    - Exposes Rocket League access state to the sidebar.
    - Redirects users to /RocketLeague/Profile only when
      they attempt to access a protected Rocket League route
      without full Rocket League access.
    - Preserves authentication-service failures as a
      distinct unavailable state.

Public Rocket League Routes:
    /RocketLeague
    /RocketLeague/Leaderboards
    /RocketLeague/Leaderboards/MatchResults
    /RocketLeague/FindPlayers
    /RocketLeague/Profile

Protected Rocket League Routes:
    /RocketLeague/WeeklyMatches
    /RocketLeague/MyMatches
    /RocketLeague/PrivateMatches
    /RocketLeague/SubmitMatchResults

Security:
    - Client-side route checks control UX only.
    - Protected Rocket League APIs must independently
      enforce account/Epic/access requirements server-side.
    - Browser state is never authoritative for API access.
=========================================================
*/

import {
    getAuthState,
    hasActiveAccount,
    hasLinkedProvider
} from "/Framework/Auth/auth.js";

import {
    applySidebarAuthState
} from "../../../../Framework/Shell/JS/Sidebar/RocketLeague/sidebar_auth.js";

import {
    loadRocketLeagueProfile
} from "./profile.js";

import {
    renderUnavailableRanks
} from "./ranks.js";

/*
=========================================================
ROUTES
=========================================================
*/

const ROCKET_LEAGUE_PROFILE_PAGE =
    "/RocketLeague/Profile";

const PROTECTED_ROCKET_LEAGUE_ROUTES =
    Object.freeze([
        "/RocketLeague/WeeklyMatches",
        "/RocketLeague/MyMatches",
        "/RocketLeague/PrivateMatches",
        "/RocketLeague/SubmitMatchResults"
    ]);

/*
=========================================================
NORMALIZATION
=========================================================
*/

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizePath(
    value
) {
    let path =
        normalizeString(
            value
        )
        || "/";

    if (
        path.length > 1
        && path.endsWith(
            "/"
        )
    ) {
        path =
            path.replace(
                /\/+$/u,
                ""
            );
    }

    return path || "/";
}

/*
=========================================================
PROTECTED ROUTE CHECK
=========================================================
*/

function isProtectedRocketLeagueRoute() {
    const currentPath =
        normalizePath(
            window.location.pathname
        ).toLowerCase();

    return PROTECTED_ROCKET_LEAGUE_ROUTES.some(
        function(
            route
        ) {
            const normalizedRoute =
                normalizePath(
                    route
                ).toLowerCase();

            return (
                currentPath ===
                    normalizedRoute
                || currentPath.startsWith(
                    `${normalizedRoute}/`
                )
            );
        }
    );
}

/*
=========================================================
GLOBAL AUTH -> ROCKET LEAGUE SESSION

This converts centralized BPD auth state into the smaller
shape consumed by Rocket League-specific UI modules.
=========================================================
*/

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

/*
=========================================================
APPLY ROCKET LEAGUE AUTH VIEW
=========================================================
*/

function applyRocketLeagueAuthView(
    rocketLeagueSession
) {
    const authenticated =
        rocketLeagueSession
            ?.authenticated ===
        true;

    const rocketLeagueAccess =
        rocketLeagueSession
            ?.rocketLeagueAccess ===
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

    const accessCallout =
        document.getElementById(
            "rocketLeagueAccessCallout"
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
            !rocketLeagueAccess;
    }

    if (
        playerProfile
    ) {
        playerProfile.hidden =
            !authenticated;
    }

    /*
     * Keep the Epic/full-access CTA visible until full
     * Rocket League access is available.
     */
    if (
        accessCallout
    ) {
        accessCallout.hidden =
            rocketLeagueAccess;
    }

    document.body.dataset.authenticated =
        String(
            authenticated
        );

    document.body.dataset.rlAccess =
        String(
            rocketLeagueAccess
        );

    applySidebarAuthState(
        rocketLeagueSession
    );

    return rocketLeagueSession;
}

/*
=========================================================
AUTH UNAVAILABLE VIEW
=========================================================
*/

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

/*
=========================================================
PROTECTED ROUTE REDIRECT
=========================================================
*/

function redirectProtectedRouteToProfile() {
    if (
        !isProtectedRocketLeagueRoute()
    ) {
        return false;
    }

    const currentPath =
        normalizePath(
            window.location.pathname
        );

    if (
        currentPath.toLowerCase() ===
        ROCKET_LEAGUE_PROFILE_PAGE
            .toLowerCase()
    ) {
        return false;
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

        return true;
    }

    window.location.replace(
        ROCKET_LEAGUE_PROFILE_PAGE
    );

    return true;
}

/*
=========================================================
SIGNED-OUT STATE
=========================================================
*/

function applySignedOutState(
    authState
) {
    document.body.dataset.authAvailable =
        "true";

    const session =
        applyRocketLeagueAuthView(
            createRocketLeagueSession(
                authState
            )
        );

    /*
     * Public Rocket League pages remain accessible.
     * Only protected routes are redirected.
     */
    redirectProtectedRouteToProfile();

    return session;
}

/*
=========================================================
INVALID ACCOUNT STATE
=========================================================
*/

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

    redirectProtectedRouteToProfile();

    return session;
}

/*
=========================================================
EPIC REQUIREMENT
=========================================================
*/

function hasRocketLeagueProvider(
    authState
) {
    return hasLinkedProvider(
        "epic",
        authState
    );
}

/*
=========================================================
LOAD ROCKET LEAGUE PROFILE
=========================================================
*/

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

/*
=========================================================
INITIALIZE ROCKET LEAGUE AUTH VIEW
=========================================================
*/

export async function initializeRocketLeagueAuthView() {
    try {
        const authState =
            await getAuthState();

        /*
        =====================================================
        AUTH SERVICE UNAVAILABLE
        =====================================================
        */

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

        /*
        =====================================================
        SIGNED OUT
        =====================================================
        */

        if (
            authState.authenticated !==
            true
        ) {
            applySignedOutState(
                authState
            );

            return;
        }

        /*
        =====================================================
        ACTIVE ACCOUNT
        =====================================================
        */

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

        /*
        =====================================================
        BASE AUTHENTICATED STATE

        Being globally authenticated does not automatically
        mean the user has Rocket League access.
        =====================================================
        */

        const baseSession =
            applyRocketLeagueAuthView(
                createRocketLeagueSession(
                    authState
                )
            );

        /*
        =====================================================
        EPIC NOT LINKED

        This is allowed on public Rocket League routes.

        Protected routes redirect to the Rocket League
        profile/setup page.
        =====================================================
        */

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

            redirectProtectedRouteToProfile();

            return;
        }

        /*
        =====================================================
        ROCKET LEAGUE PROFILE
        =====================================================
        */

        try {
            const rocketLeagueSession =
                await loadProfileState(
                    authState
                );

            applyRocketLeagueAuthView(
                rocketLeagueSession
            );

            /*
             * Profile incomplete / access unavailable:
             *
             * Public pages remain accessible.
             * Protected pages redirect to Profile.
             */
            if (
                rocketLeagueSession
                    .rocketLeagueAccess !==
                true
            ) {
                redirectProtectedRouteToProfile();

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

                    code:
                        profileError?.code
                        || null,

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

            /*
             * Do not redirect away from a public page simply
             * because profile services are unavailable.
             *
             * Protected routes still fail closed.
             */
            redirectProtectedRouteToProfile();
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

        applyRocketLeagueUnavailableView();
    }
}