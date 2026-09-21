"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE AUTH CONTROLLER

File:
    /Tabs/RocketLeague/Index/JS/auth.js

Purpose:
    Controls Rocket League client-side authentication,
    Epic-link state, Epic authorization freshness, profile
    state, sidebar access, protected-route behavior, and the
    homepage access CTA.

Access Requirements:
    Full Rocket League access requires:

        1. Active authenticated BPD account.
        2. Epic Games identity permanently linked.
        3. Epic Games identity currently authorized.
        4. Rocket League profile exists.
        5. Rocket League profile is complete.
        6. Required registration state has been accepted.
        7. Server has authorized Rocket League access.

CTA State Contract:
    validating
        Authentication/profile state is still being resolved.
        The button is disabled and cannot be used.

    epic-login
        Epic must be connected/authenticated.

    epic-reauthorize
        Epic remains permanently linked but authorization
        freshness must be restored.

    create-profile
        Epic is linked and authorized, and the server has
        confirmed Rocket League profile/setup is incomplete.

    unavailable
        Authentication/profile validation could not be
        completed. The button remains disabled.

Important:
    - Never expose create-profile until the profile request
      has completed successfully.
    - Do not infer a missing profile from a failed profile
      request.
    - Client-side state controls UI only.
    - Server APIs remain authoritative.
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
MAIN ACCESS BUTTON
========================================================= */

function getRocketLeagueAccessButton() {
    return document.getElementById(
        "mainRLLoginButton"
    );
}

function getRocketLeagueAccessButtonText(
    button
) {
    if (
        !button
    ) {
        return null;
    }

    return button.querySelector(
        "span:last-child"
    );
}

/* =========================================================
ACCESS BUTTON — VALIDATING
========================================================= */

export function setRocketLeagueAccessButtonValidating() {
    const button =
        getRocketLeagueAccessButton();

    if (
        !button
    ) {
        return;
    }

    const buttonText =
        getRocketLeagueAccessButtonText(
            button
        );

    button.disabled =
        true;

    button.dataset.action =
        "validating";

    delete button.dataset.reauthorizeUrl;

    button.setAttribute(
        "aria-label",
        "Validating Rocket League access"
    );

    button.setAttribute(
        "aria-busy",
        "true"
    );

    if (
        buttonText
    ) {
        buttonText.textContent =
            "Validating...";
    }
}

/* =========================================================
ACCESS BUTTON — UNAVAILABLE
========================================================= */

function setRocketLeagueAccessButtonUnavailable(
    message =
        "Rocket League access temporarily unavailable"
) {
    const button =
        getRocketLeagueAccessButton();

    if (
        !button
    ) {
        return;
    }

    const buttonText =
        getRocketLeagueAccessButtonText(
            button
        );

    button.disabled =
        true;

    button.dataset.action =
        "unavailable";

    delete button.dataset.reauthorizeUrl;

    button.removeAttribute(
        "aria-busy"
    );

    button.setAttribute(
        "aria-label",
        message
    );

    if (
        buttonText
    ) {
        buttonText.textContent =
            message;
    }
}

/* =========================================================
ACCESS BUTTON — FINAL STATE
========================================================= */

function applyRocketLeagueAccessButtonState(
    rocketLeagueSession
) {
    const button =
        getRocketLeagueAccessButton();

    if (
        !button
    ) {
        return;
    }

    const buttonText =
        getRocketLeagueAccessButtonText(
            button
        );

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

    button.removeAttribute(
        "aria-busy"
    );

    /* =====================================================
    EPIC REAUTHORIZATION
    ===================================================== */

    if (
        authenticated
        && epicLinked
        && requiresEpicReauthorization
    ) {
        button.disabled =
            false;

        button.dataset.action =
            "epic-reauthorize";

        button.dataset.reauthorizeUrl =
            EPIC_REAUTHORIZATION_PAGE;

        button.setAttribute(
            "aria-label",
            "Reauthorize Epic Games for full Rocket League access"
        );

        if (
            buttonText
        ) {
            buttonText.textContent =
                "Verify Epic Again for Full Access";
        }

        return;
    }

    /* =====================================================
    PROFILE SETUP

    This state is only applied after profile validation has
    completed successfully.
    ===================================================== */

    if (
        authenticated
        && epicLinked
        && epicAuthorized
        && !rocketLeagueAccess
    ) {
        button.disabled =
            false;

        button.dataset.action =
            "create-profile";

        delete button.dataset.reauthorizeUrl;

        button.setAttribute(
            "aria-label",
            "Create Rocket League Profile for full access"
        );

        if (
            buttonText
        ) {
            buttonText.textContent =
                "Create Rocket League Profile for Full Access";
        }

        return;
    }

    /* =====================================================
    EPIC LOGIN / LINK
    ===================================================== */

    button.disabled =
        false;

    button.dataset.action =
        "epic-login";

    delete button.dataset.reauthorizeUrl;

    button.setAttribute(
        "aria-label",
        "Login with Epic Games for full Rocket League access"
    );

    if (
        buttonText
    ) {
        buttonText.textContent =
            authenticated
                ? "Connect Epic for Full Access"
                : "Login with Epic for Full Access";
    }
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
        profileResult?.profileExists ===
        false
    ) {
        return false;
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

updateAccessButton:
    true
        Apply the final actionable CTA.

    false
        Update page/sidebar/body state while preserving the
        current validating CTA.
========================================================= */

function applyRocketLeagueAuthView(
    rocketLeagueSession,
    {
        updateAccessButton =
            true
    } = {}
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
            !authenticated
            || !epicLinked
            || !epicAuthorized;
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

    if (
        updateAccessButton
    ) {
        applyRocketLeagueAccessButtonState(
            rocketLeagueSession
        );
    }

    return rocketLeagueSession;
}

/* =========================================================
AUTH UNAVAILABLE VIEW
========================================================= */

function applyRocketLeagueUnavailableView(
    message =
        "Authorization temporarily unavailable"
) {
    setRocketLeagueAccessButtonUnavailable(
        message
    );

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    sidebar
        ?.querySelectorAll(
            "[data-rl-access='required'], "
            + "[data-rl-access='unlocked'], "
            + "[data-auth]"
        )
        .forEach(
            function(
                element
            ) {
                element.hidden =
                    true;
            }
        );

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
    /*
     * Lock the CTA immediately.
     *
     * It remains locked until the state required to determine
     * its actual purpose has been resolved.
     */
    setRocketLeagueAccessButtonValidating();

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

            return null;
        }

        document.body.dataset.authAvailable =
            "true";

        /* =================================================
        SIGNED OUT

        No profile lookup is necessary.
        The CTA can now safely become Epic Login.
        ================================================= */

        if (
            authState.authenticated !==
            true
        ) {
            return applySignedOutState(
                authState
            );
        }

        /* =================================================
        ACTIVE ACCOUNT
        ================================================= */

        if (
            !hasActiveAccount(
                authState
            )
        ) {
            return applyInvalidAccountState(
                authState
            );
        }

        /* =================================================
        EPIC PROVIDER STATE
        ================================================= */

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

        const baseSession =
            createAuthenticatedBaseSession(
                authState,
                {
                    epicLinked,
                    epicAuthorized,
                    requiresEpicReauthorization
                }
            );

        /* =================================================
        EPIC NOT LINKED

        This is already a final state. No profile lookup is
        possible or required.
        ================================================= */

        if (
            !epicLinked
        ) {
            applyRocketLeagueAuthView(
                baseSession
            );

            redirectProtectedRouteToProfile();

            return baseSession;
        }

        /* =================================================
        EPIC NOT CURRENTLY AUTHORIZED

        This is also a final provider state. Profile data must
        not be loaded without current provider authorization.
        ================================================= */

        if (
            !epicAuthorized
        ) {
            applyRocketLeagueAuthView(
                baseSession
            );

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
                applyRocketLeagueUnavailableView(
                    "Epic authorization temporarily unavailable"
                );
            }

            return baseSession;
        }

        /* =================================================
        EPIC AUTHORIZED — PROFILE VALIDATION REQUIRED

        Update body/sidebar/provider state while intentionally
        preserving the disabled "Validating..." CTA.

        Do not expose create-profile yet.
        ================================================= */

        applyRocketLeagueAuthView(
            baseSession,
            {
                updateAccessButton:
                    false
            }
        );

        /* =================================================
        ROCKET LEAGUE PROFILE
        ================================================= */

        try {
            const rocketLeagueSession =
                await loadProfileState(
                    authState
                );

            /*
             * The profile request has completed successfully.
             *
             * It is now safe to expose the final CTA:
             *
             *     create-profile
             *
             * or hide/resolve it for full access.
             */
            applyRocketLeagueAuthView(
                rocketLeagueSession
            );

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

            /*
             * Preserve known account/provider state without
             * converting a profile-service failure into a
             * false "Create Profile" state.
             */
            applyRocketLeagueAuthView(
                unavailableSession,
                {
                    updateAccessButton:
                        false
                }
            );

            const unavailableMessage =
                profileError?.message
                || "Rocket League profile validation is temporarily unavailable.";

            setRocketLeagueAccessButtonUnavailable(
                "Profile validation unavailable"
            );

            renderUnavailableRanks(
                unavailableMessage
            );

            /*
             * Public Rocket League pages remain available.
             * Protected routes continue to fail closed.
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