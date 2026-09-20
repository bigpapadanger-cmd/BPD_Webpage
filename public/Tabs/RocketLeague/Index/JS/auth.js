"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH CONTROLLER

File:
    /Tabs/RocketLeague/Index/JS/auth.js

Purpose:
    Controls Rocket League client-side authentication,
    Epic-link state, Epic authorization freshness, profile
    state, sidebar access, and protected-route behavior.

Access Requirements:
    Full Rocket League access requires:

        1. Active authenticated BPD account.
        2. Epic Games identity permanently linked.
        3. Epic Games identity currently authorized.
        4. Rocket League profile exists.
        5. Rocket League profile is complete.
        6. Required registration state has been accepted.
        7. Server has authorized Rocket League access.

Important Provider Distinction:
    epicLinked
        Permanent Epic identity exists for the BPD account.

    epicAuthorized
        Linked Epic identity currently satisfies provider
        authentication freshness requirements.

    requiresEpicReauthorization
        Epic remains permanently linked, but the current
        provider authentication proof is stale or missing.

Description:
    - Uses Framework/Auth/auth.js as the authoritative source
      of global BPD authentication state.
    - Keeps Epic linkage separate from Epic authorization.
    - Does not treat stale Epic authorization as disconnected.
    - Prevents stale Epic authorization from granting full
      Rocket League access.
    - Loads Rocket League profile state only after Epic is
      linked and currently authorized.
    - Exposes normalized Rocket League state to the sidebar
      and page.
    - Allows public Rocket League pages without full access.
    - Redirects protected Rocket League routes when access
      requirements are incomplete.
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
      account, Epic authorization, profile, and access
      requirements.
    - Browser state is never authoritative for API access.
========================================================= */

import {
    getAuthState,
    hasActiveAccount,
    hasLinkedProvider,
    hasAuthorizedProvider,
    requiresProviderReauthorization
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

const EPIC_REAUTHORIZATION_PAGE =
    "/Account?reauthorize=epic";

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

function hasAuthorizedRocketLeagueProvider(
    authState
) {
    return hasAuthorizedProvider(
        "epic",
        authState
    );
}

function requiresRocketLeagueProviderReauthorization(
    authState
) {
    return requiresProviderReauthorization(
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
        BPD account has a permanent Epic identity.

    epicAuthorized
        Epic identity currently satisfies provider
        authorization freshness requirements.

    requiresEpicReauthorization
        Epic remains linked but must be authenticated again.

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
        epicAuthorized = false,
        requiresEpicReauthorization = false,
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

        epicAuthorized:
            epicAuthorized ===
            true,

        requiresEpicReauthorization:
            requiresEpicReauthorization ===
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
            epicAuthorized ===
                true
            && rocketLeagueAccess ===
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

    document.body.dataset.rlEpicAuthorized =
        String(
            rocketLeagueSession
                ?.epicAuthorized ===
            true
        );

    document.body.dataset.rlEpicReauthorizationRequired =
        String(
            rocketLeagueSession
                ?.requiresEpicReauthorization ===
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

    const epicAuthorized =
        rocketLeagueSession
            ?.epicAuthorized ===
        true;

    const requiresEpicReauthorization =
        rocketLeagueSession
            ?.requiresEpicReauthorization ===
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

    const accessButton =
        document.getElementById(
            "mainRLLoginButton"
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
            !authenticated
            || !epicLinked
            || !epicAuthorized;
    }

    /* =====================================================
    ACCESS CTA

    Epic not linked:
        Login with Epic for Full Access

    Epic linked but authorization stale:
        Verify Epic Again for Full Access

    Epic authorized but RL registration incomplete:
        Create Rocket League Profile for Full Access

    Full access:
        Hide CTA
    ===================================================== */

    if (accessButton) {
        accessButton.disabled = false;
        const buttonText =
            accessButton.querySelector(
                "span:last-child"
            );

        if (
            authenticated
            && epicLinked
            && requiresEpicReauthorization
        ) {
            if (
                buttonText
            ) {
                buttonText.textContent =
                    "Verify Epic Again for Full Access";
            }

            accessButton.setAttribute(
                "aria-label",
                "Reauthorize Epic Games for full Rocket League access"
            );

            accessButton.dataset.action =
                "epic-reauthorize";

            accessButton.dataset.reauthorizeUrl =
                EPIC_REAUTHORIZATION_PAGE;
        }
        else if (
            authenticated
            && epicLinked
            && epicAuthorized
            && !rocketLeagueAccess
        ) {
            if (
                buttonText
            ) {
                buttonText.textContent =
                    "Create Rocket League Profile for Full Access";
            }

            accessButton.setAttribute(
                "aria-label",
                "Create Rocket League Profile for full access"
            );

            accessButton.dataset.action =
                "create-profile";

            delete accessButton.dataset.reauthorizeUrl;
        }
        else {
            if (
                buttonText
            ) {
                buttonText.textContent =
                    authenticated ? "Connect Epic for Full Access" : "Login with Epic for Full Access";
            }

            accessButton.setAttribute(
                "aria-label",
                "Login with Epic Games for full Rocket League access"
            );

            accessButton.dataset.action =
                "epic-login";

            delete accessButton.dataset.reauthorizeUrl;
        }
    }

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
    const accessButton = document.getElementById("mainRLLoginButton");
    if (accessButton) {
        accessButton.disabled = true;
        const label = accessButton.querySelector("span:last-child");
        if (label) label.textContent = "Authorization temporarily unavailable";
    }
    const sidebar = document.getElementById("sidebar");
    sidebar?.querySelectorAll("[data-rl-access='required'], [data-rl-access='unlocked'], [data-auth]")
        .forEach(element => { element.hidden = true; });

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

    document.body.dataset.rlEpicAuthorized =
        "unknown";

    document.body.dataset.rlEpicReauthorizationRequired =
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
PROTECTED ROUTE -> EPIC REAUTHORIZATION

Used only when Epic is permanently linked but the provider
authorization is stale or missing.

Public Rocket League pages remain available.
========================================================= */

function redirectProtectedRouteToEpicReauthorization() {
    if (
        !isProtectedRocketLeagueRoute()
    ) {
        return false;
    }

    if (
        window.BPDRouter
        && typeof window.BPDRouter.navigate ===
            "function"
    ) {
        void window.BPDRouter.navigate(
            EPIC_REAUTHORIZATION_PAGE,
            {
                replace:
                    true
            }
        );

        return true;
    }

    window.location.replace(
        EPIC_REAUTHORIZATION_PAGE
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
    {
        epicLinked = false,
        epicAuthorized = false,
        requiresEpicReauthorization = false
    } = {}
) {
    return createRocketLeagueSession(
        authState,
        {
            epicLinked:
                epicLinked ===
                true,

            epicAuthorized:
                epicAuthorized ===
                true,

            requiresEpicReauthorization:
                requiresEpicReauthorization ===
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

            epicAuthorized:
                true,

            requiresEpicReauthorization:
                false,

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
        EPIC PROVIDER STATE
        ===================================================== */

        const epicLinked =
            hasRocketLeagueProvider(
                authState
            );

        const epicAuthorized =
            epicLinked
            && hasAuthorizedRocketLeagueProvider(
                authState
            );

        const requiresEpicReauthorization =
            epicLinked
            && !epicAuthorized
            && requiresRocketLeagueProviderReauthorization(
                authState
            );

        /*
         * Apply the provider state immediately so the UI can
         * distinguish permanent linkage from current provider
         * authorization before profile loading begins.
         */
        const baseSession =
            applyRocketLeagueAuthView(
                createAuthenticatedBaseSession(
                    authState,
                    {
                        epicLinked,
                        epicAuthorized,
                        requiresEpicReauthorization
                    }
                )
            );

        /* =====================================================
        EPIC NOT LINKED

        Public Rocket League routes remain available.

        Protected routes redirect to Rocket League Profile.
        ===================================================== */

        if (
            !epicLinked
        ) {
            redirectProtectedRouteToProfile();

            return baseSession;
        }

        /* =====================================================
        EPIC NOT CURRENTLY AUTHORIZED

        Epic remains permanently linked.

        Do not treat the provider as disconnected.

        Public Rocket League routes remain accessible.

        Personal/protected Rocket League functionality fails
        closed until Epic ownership is proven again.
        ===================================================== */

        if (
            !epicAuthorized
        ) {
            document.body.dataset.rlAccess =
                "false";

            renderUnavailableRanks(
                requiresEpicReauthorization
                    ? "Epic Games reauthorization is required before your Rocket League account data can be used."
                    : "Epic Games authorization is currently unavailable."
            );

            if (
                requiresEpicReauthorization
            ) {
                redirectProtectedRouteToEpicReauthorization();
            }
            else {
                applyRocketLeagueUnavailableView();
            }
            return baseSession;
        }

        /* =====================================================
        ROCKET LEAGUE PROFILE

        This point is reached only when Epic is both linked
        and currently authorized.
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
             *     + Epic currently authorized
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
                            true,

                        epicAuthorized:
                            true,

                        requiresEpicReauthorization:
                            false
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