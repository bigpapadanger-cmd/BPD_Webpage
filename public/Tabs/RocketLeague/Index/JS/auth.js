"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH CONTROLLER

File:
    /Tabs/RocketLeague/Index/JS/auth.js

Purpose:
    Controls Rocket League client-side authentication,
    Epic-link state, profile state, sidebar access, and
    protected-route behavior.

Access Requirements:
    Full Rocket League access requires:

        1. Active authenticated BPD account.
        2. Verified Epic Games identity linked to that account.
        3. Rocket League profile exists.
        4. Rocket League profile is complete.
        5. Required registration state has been accepted.

Description:
    - Uses Framework/Auth/auth.js as the authoritative source
      of global BPD authentication state.
    - Keeps Epic-link state separate from profile state.
    - Loads Rocket League profile state only after Epic is
      verified as linked.
    - Exposes normalized Rocket League state to the sidebar
      and page.
    - Allows public Rocket League pages without full access.
    - Redirects protected Rocket League routes to Profile
      when requirements are incomplete.
    - Preserves authentication/profile-service failures as
      distinct unavailable states.

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
    - Protected Rocket League APIs must independently enforce
      account, Epic, profile, and access requirements.
    - Browser state is never authoritative for API access.
========================================================= */

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

/* =========================================================
ROUTES
========================================================= */

const ROCKET_LEAGUE_PROFILE_PAGE =
    "/RocketLeague/Profile";

const PROTECTED_ROCKET_LEAGUE_ROUTES =
    Object.freeze([
        "/RocketLeague/WeeklyMatches",
        "/RocketLeague/MyMatches",
        "/RocketLeague/PrivateMatches",
        "/RocketLeague/SubmitMatchResults"
    ]);

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeObject(
    value
) {
    if (
        !value
        || typeof value !==
            "object"
        || Array.isArray(
            value
        )
    ) {
        return {};
    }

    return value;
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

/* =========================================================
PROTECTED ROUTE CHECK
========================================================= */

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

/* =========================================================
EPIC PROVIDER STATE
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
PROFILE EXISTENCE

profile.js will explicitly return profileExists after the
next revision.

Compatibility checks are retained temporarily so existing
profiles continue working during the transition.
========================================================= */

function resolveProfileExists(
    profileResult
) {
    if (
        profileResult?.profileExists ===
        true
    ) {
        return true;
    }

    if (
        profileResult?.profileComplete ===
        true
    ) {
        return true;
    }

    const profile =
        normalizeObject(
            profileResult?.profile
        );

    return Object.keys(
        profile
    ).length > 0;
}

/* =========================================================
GLOBAL AUTH -> ROCKET LEAGUE SESSION

Creates the normalized state consumed by Rocket League UI.

Important distinction:

    authenticated
        BPD account session exists.

    epicLinked
        BPD account has a verified Epic identity.

    profileExists
        Rocket League player/profile record exists.

    profileComplete
        Required profile setup has been completed.

    rocketLeagueAccess
        Server has authorized full Rocket League access.
========================================================= */

function createRocketLeagueSession(
    authState,
    {
        epicLinked = false,
        profileExists = false,
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

        epicLinked:
            epicLinked ===
            true,

        profileExists:
            profileExists ===
            true,

        profileComplete:
            profileComplete ===
            true,

        registrationAccepted:
            registrationAccepted ===
            true,

        rocketLeagueAccess:
            rocketLeagueAccess ===
            true
    };
}

/* =========================================================
BODY STATE
========================================================= */

function applyRocketLeagueBodyState(
    rocketLeagueSession
) {
    document.body.dataset.authenticated =
        String(
            rocketLeagueSession
                ?.authenticated ===
            true
        );

    document.body.dataset.rlEpicLinked =
        String(
            rocketLeagueSession
                ?.epicLinked ===
            true
        );

    document.body.dataset.rlProfileExists =
        String(
            rocketLeagueSession
                ?.profileExists ===
            true
        );

    document.body.dataset.rlProfileComplete =
        String(
            rocketLeagueSession
                ?.profileComplete ===
            true
        );

    document.body.dataset.rlRegistrationAccepted =
        String(
            rocketLeagueSession
                ?.registrationAccepted ===
            true
        );

    document.body.dataset.rlAccess =
        String(
            rocketLeagueSession
                ?.rocketLeagueAccess ===
            true
        );
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

    const epicLinked =
        rocketLeagueSession
            ?.epicLinked ===
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

    /*
     * The player-profile/rank area only makes sense once a
     * verified Epic identity is linked.
     *
     * An authenticated Google/Discord-only account should
     * not see an empty Rocket League profile shell.
     */
    if (
        playerProfile
    ) {
        playerProfile.hidden =
            !authenticated
            || !epicLinked;
    }

    /*
     * The access callout remains visible until full Rocket
     * League access has been granted.
     *
     * We can later adjust its text depending on whether the
     * missing requirement is Epic or profile completion.
     */
    if (
        accessCallout
    ) {
        accessCallout.hidden =
            rocketLeagueAccess;
    }

    applyRocketLeagueBodyState(
        rocketLeagueSession
    );

    applySidebarAuthState(
        rocketLeagueSession
    );

    return rocketLeagueSession;
}

/* =========================================================
AUTH UNAVAILABLE VIEW
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

    document.body.dataset.rlEpicLinked =
        "unknown";

    document.body.dataset.rlProfileExists =
        "unknown";

    document.body.dataset.rlProfileComplete =
        "unknown";

    document.body.dataset.rlRegistrationAccepted =
        "unknown";

    document.body.dataset.rlAccess =
        "false";

    renderUnavailableRanks(
        "Authentication status is currently unavailable."
    );
}

/* =========================================================
PROTECTED ROUTE REDIRECT
========================================================= */

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
        void window.BPDRouter.navigate(
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

/* =========================================================
SIGNED-OUT STATE
========================================================= */

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

    redirectProtectedRouteToProfile();

    return session;
}

/* =========================================================
INVALID ACCOUNT STATE
========================================================= */

function applyInvalidAccountState(
    authState
) {
    const session =
        applyRocketLeagueAuthView(
            createRocketLeagueSession(
                authState
            )
        );

    document.body.dataset.authAvailable =
        "true";

    renderUnavailableRanks(
        "Your BPD account is unavailable or inactive."
    );

    redirectProtectedRouteToProfile();

    return session;
}

/* =========================================================
BASE AUTHENTICATED STATE
========================================================= */

function createAuthenticatedBaseSession(
    authState,
    epicLinked
) {
    return createRocketLeagueSession(
        authState,
        {
            epicLinked:
                epicLinked ===
                true
        }
    );
}

/* =========================================================
LOAD ROCKET LEAGUE PROFILE
========================================================= */

async function loadProfileState(
    authState
) {
    const profileResult =
        await loadRocketLeagueProfile(
            {
                userId:
                    normalizeString(
                        authState?.userId
                    )
                    || null,

                displayName:
                    normalizeString(
                        authState?.displayName
                    )
                    || null,

                role:
                    normalizeString(
                        authState?.role
                    )
                    || null,

                active:
                    authState?.active ===
                    true
            }
        );

    const profileExists =
        resolveProfileExists(
            profileResult
        );

    return createRocketLeagueSession(
        authState,
        {
            epicLinked:
                true,

            profileExists,

            profileComplete:
                profileExists
                && profileResult
                    ?.profileComplete ===
                    true,

            registrationAccepted:
                profileExists
                && profileResult
                    ?.registrationAccepted ===
                    true,

            /*
             * Access remains server-derived.
             *
             * The client additionally fails closed if either
             * Epic or profile state is inconsistent.
             */
            rocketLeagueAccess:
                profileExists
                && profileResult
                    ?.profileComplete ===
                    true
                && profileResult
                    ?.registrationAccepted ===
                    true
                && profileResult
                    ?.rocketLeagueAccess ===
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

        /* =====================================================
        AUTH SERVICE UNAVAILABLE
        ===================================================== */

        if (
            !authState
            || authState.available !==
                true
            || authState.status ===
                "unavailable"
        ) {
            applyRocketLeagueUnavailableView();

            return null;
        }

        document.body.dataset.authAvailable =
            "true";

        /* =====================================================
        SIGNED OUT
        ===================================================== */

        if (
            authState.authenticated !==
            true
        ) {
            return applySignedOutState(
                authState
            );
        }

        /* =====================================================
        ACTIVE ACCOUNT
        ===================================================== */

        if (
            !hasActiveAccount(
                authState
            )
        ) {
            return applyInvalidAccountState(
                authState
            );
        }

        /* =====================================================
        EPIC LINK STATE
        ===================================================== */

        const epicLinked =
            hasRocketLeagueProvider(
                authState
            );

        /*
         * Apply the authenticated state immediately so the
         * page/sidebar can reflect account and Epic state before
         * waiting on the profile request.
         */
        const baseSession =
            applyRocketLeagueAuthView(
                createAuthenticatedBaseSession(
                    authState,
                    epicLinked
                )
            );

        /* =====================================================
        EPIC NOT LINKED

        Do not infer Epic ownership from an existing Rocket
        League profile.

        Epic identity must originate from verified Epic OAuth.

        Server-side reconciliation can attach an existing
        Rocket League profile after Epic OAuth proves that the
        returned Epic account ID matches the profile.
        ===================================================== */

        if (
            !epicLinked
        ) {
            redirectProtectedRouteToProfile();

            return baseSession;
        }

        /* =====================================================
        ROCKET LEAGUE PROFILE
        ===================================================== */

        try {
            const rocketLeagueSession =
                await loadProfileState(
                    authState
                );

            applyRocketLeagueAuthView(
                rocketLeagueSession
            );

            /*
             * Full access requires:
             *
             *     Epic linked
             *     + profile exists
             *     + profile complete
             *     + registration accepted
             *     + server-authorized RL access
             */

            if (
                rocketLeagueSession
                    .rocketLeagueAccess !==
                true
            ) {
                redirectProtectedRouteToProfile();

                return rocketLeagueSession;
            }

            return rocketLeagueSession;
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

            const unavailableSession =
                createRocketLeagueSession(
                    authState,
                    {
                        epicLinked:
                            true
                    }
                );

            applyRocketLeagueAuthView(
                unavailableSession
            );

            renderUnavailableRanks(
                profileError?.message
                || "Profile data unavailable."
            );

            /*
             * Public pages remain available during profile
             * service failures.
             *
             * Protected routes fail closed.
             */
            redirectProtectedRouteToProfile();

            return unavailableSession;
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

        return null;
    }
}