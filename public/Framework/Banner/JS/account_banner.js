"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT BANNER CONTROLLER

File:
    Framework/Banner/JS/account_banner.js

Purpose:
    Creates and maintains the persistent global account banner.

Description:
    - Creates the banner locally without requiring an HTML fetch.
    - Uses Framework/Auth/auth.js as the single client auth source.
    - Remains visible when the internet or API is unavailable.
    - Displays the user's global BPD account state.
    - Displays icons for linked authentication providers.
    - Provides Profile, Sign In, and Logout actions.
    - Refreshes automatically when auth or network state changes.
    - Avoids making an independent /api/auth/session request.

Authentication:
    Global auth state:
        Framework/Auth/auth.js

    Logout:
        GET /api/auth/logout

Security:
    - The banner is UI only and is not a security boundary.
    - Provider linkage displayed here is session/UI state only.
    - Protected APIs independently verify authorization server-side.

Important:
    - authenticated refers to the global BPD session.
    - BPD display name is the primary displayed identity.
    - Provider identities are shown only as linked-system icons.
    - Epic linkage is provider state, not global login state.
========================================================= */

import {
    BPD_AUTH_LOGOUT_URL
} from "../../../scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../scripts/apiConnection.js";

import {
    getAuthState,
    peekAuthState,
    refreshAuthState,
    subscribeToAuthState,
    invalidateAuthState
} from "../../Auth/auth.js";

/* =========================================================
CONSTANTS
========================================================= */

const PROFILE_URL =
    "/Account";

const LOGIN_URL =
    "/Login";

const FALLBACK_IMAGE_URL =
    "/images/bad_image/fallback.png";

/* =========================================================
LOCAL BANNER MARKUP
========================================================= */

const BANNER_MARKUP = `
    <div
        class="bpd-account-banner__inner"
        data-account-banner-state="loading"
    >
        <div class="bpd-account-banner__brand">
            <span class="bpd-account-banner__network">
                BPD Gaming Network
            </span>
        </div>

        <div
            class="bpd-account-banner__status"
            id="accountBannerStatus"
            aria-live="polite"
        >
            <span class="bpd-account-banner__message">
                Loading account...
            </span>
        </div>

        <div
            class="bpd-account-banner__actions"
            id="accountBannerActions"
        >
        </div>
    </div>
`;

/* =========================================================
PROVIDER CONFIGURATION
========================================================= */

const PROVIDER_CONFIG =
    Object.freeze({
        epic: {
            label:
                "Epic Games",

            icon:
                "/Assets/images/framework_icons/epic-symbol-white.svg"
        },

        google: {
            label:
                "Google",

            icon:
                "/Assets/images/framework_icons/google-symbol-white.png"
        },

        discord: {
            label:
                "Discord",

            icon:
                "/Assets/images/framework_icons/discord-symbol-white.png"
        },

        steam: {
            label:
                "Steam",

            icon:
                "/Assets/images/framework_icons/steam-symbol-white.png"
        }
    });

/* =========================================================
STATE
========================================================= */

let initialized =
    false;

let refreshPromise =
    null;

let unsubscribeAuthState =
    null;

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

function normalizeProviderName(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

/* =========================================================
BANNER ROOT
========================================================= */

function getBannerRoot() {
    return document.getElementById(
        "accountBanner"
    );
}

/* =========================================================
CREATE BANNER ROOT
========================================================= */

function createBannerRoot() {
    const root =
        document.createElement(
            "div"
        );

    root.id =
        "accountBanner";

    root.className =
        "account-banner";

    const sitePage =
        document.querySelector(
            ".site-page"
        );

    const header =
        document.getElementById(
            "header"
        );

    if (
        sitePage
        && header
        && header.parentElement ===
            sitePage
    ) {
        sitePage.insertBefore(
            root,
            header
        );

        return root;
    }

    if (
        sitePage
    ) {
        sitePage.prepend(
            root
        );

        return root;
    }

    document.body.prepend(
        root
    );

    return root;
}

/* =========================================================
ENSURE BANNER ROOT
========================================================= */

function ensureBannerRoot() {
    return (
        getBannerRoot()
        || createBannerRoot()
    );
}

/* =========================================================
ENSURE BANNER MARKUP
========================================================= */

function ensureBannerMarkup() {
    const root =
        ensureBannerRoot();

    const existingInner =
        root.querySelector(
            ".bpd-account-banner__inner"
        );

    if (
        existingInner
    ) {
        return root;
    }

    root.innerHTML =
        BANNER_MARKUP;

    return root;
}

/* =========================================================
ELEMENTS
========================================================= */

function getBannerElements() {
    return {
        root:
            getBannerRoot(),

        status:
            document.getElementById(
                "accountBannerStatus"
            ),

        actions:
            document.getElementById(
                "accountBannerActions"
            )
    };
}

/* =========================================================
RENDER HELPERS
========================================================= */

function createLink(
    label,
    href
) {
    const link =
        document.createElement(
            "a"
        );

    link.className =
        "bpd-account-banner__link";

    link.href =
        href;

    link.textContent =
        label;

    return link;
}

function createButton(
    label,
    onClick
) {
    const button =
        document.createElement(
            "button"
        );

    button.type =
        "button";

    button.className =
        "bpd-account-banner__button";

    button.textContent =
        label;

    button.addEventListener(
        "click",
        onClick
    );

    return button;
}

function setBannerState(
    state
) {
    const root =
        getBannerRoot();

    const inner =
        root?.querySelector(
            ".bpd-account-banner__inner"
        );

    if (
        inner
    ) {
        inner.dataset.accountBannerState =
            state;
    }
}

/* =========================================================
DISPLAY NAME
========================================================= */

function getDisplayName(
    authState
) {
    const directDisplayName =
        normalizeString(
            authState?.displayName
        );

    if (
        directDisplayName
    ) {
        return directDisplayName;
    }

    const googleDisplayName =
        normalizeString(
            authState
                ?.providers
                ?.google
                ?.displayName
        );

    if (
        googleDisplayName
    ) {
        return googleDisplayName;
    }

    const epicDisplayName =
        normalizeString(
            authState
                ?.providers
                ?.epic
                ?.displayName
        );

    if (
        epicDisplayName
    ) {
        return epicDisplayName;
    }

    const discordDisplayName =
        normalizeString(
            authState
                ?.providers
                ?.discord
                ?.displayName
        );

    if (
        discordDisplayName
    ) {
        return discordDisplayName;
    }

    return "Profile";
}

/* =========================================================
PROVIDER ICON
========================================================= */

/* =========================================================
PROVIDER ICON
========================================================= */

function createProviderIcon(
    providerName,
    authState
) {
    const normalizedProvider =
        normalizeProviderName(
            providerName
        );

    if (
        !normalizedProvider
    ) {
        return null;
    }

    const config =
        PROVIDER_CONFIG[
            normalizedProvider
        ];

    if (
        !config
    ) {
        return null;
    }

    const providerState =
        authState
            ?.providers
            ?.[normalizedProvider]
        || null;

    const requiresReauthorization =
        providerState
            ?.linked ===
            true
        && providerState
            ?.requiresReauthorization ===
            true;

    /*
     * Normal linked providers remain passive status icons.
     *
     * A provider requiring reauthorization becomes an
     * interactive button so the user immediately has a
     * recovery action available.
     */
    const wrapper =
        document.createElement(
            requiresReauthorization
                ? "button"
                : "span"
        );

    wrapper.className =
        "bpd-account-banner__provider-icon-wrap";

    wrapper.dataset.provider =
        normalizedProvider;

    wrapper.dataset.providerState =
        requiresReauthorization
            ? "reauthorization-required"
            : "connected";

    if (
        requiresReauthorization
    ) {
        wrapper.type =
            "button";

        wrapper.classList.add(
            "bpd-account-banner__provider-icon-wrap--reauthorize"
        );

        wrapper.title =
            `${config.label} needs reauthorization. Click to verify again.`;

        wrapper.setAttribute(
            "aria-label",
            `${config.label} needs reauthorization. Click to verify again.`
        );

        wrapper.addEventListener(
            "click",
            function handleProviderReauthorizationClick() {
                handleProviderReauthorization(
                    normalizedProvider
                );
            }
        );
    }
    else {
        wrapper.title =
            `${config.label} connected`;

        wrapper.setAttribute(
            "role",
            "img"
        );

        wrapper.setAttribute(
            "aria-label",
            `${config.label} connected`
        );
    }

    const image =
        document.createElement(
            "img"
        );

    image.className =
        "bpd-account-banner__provider-icon";

    image.src =
        config.icon;

    image.alt =
        "";

    image.decoding =
        "async";

    image.addEventListener(
        "error",
        function handleProviderIconError() {
            image.removeEventListener(
                "error",
                handleProviderIconError
            );

            image.src =
                FALLBACK_IMAGE_URL;

            wrapper.classList.add(
                "bpd-account-banner__provider-icon-wrap--fallback"
            );
        }
    );

    wrapper.appendChild(
        image
    );

    return wrapper;
}

/* =========================================================
PROVIDER REAUTHORIZATION ACTION
========================================================= */

function handleProviderReauthorization(
    providerName
) {
    const provider =
        normalizeProviderName(
            providerName
        );

    if (
        !provider
    ) {
        return;
    }

    /*
     * Reauthorization is managed from the Account page.
     *
     * The provider query value allows the Account page to
     * identify which provider sent the user there once its
     * provider-management UI is updated.
     *
     * Do not start OAuth directly from the banner until the
     * server-side provider route supports reauthorization
     * for already-linked identities.
     */
    const destination =
        new URL(
            PROFILE_URL,
            window.location.origin
        );

    destination.searchParams.set(
        "reauthorize",
        provider
    );

    if (
        window.BPDRouter
        && typeof window.BPDRouter.navigate ===
            "function"
    ) {
        window.BPDRouter.navigate(
            destination.pathname
            + destination.search
        );

        return;
    }

    window.location.assign(
        destination.pathname
        + destination.search
    );
}

/* =========================================================
PROVIDER ICON GROUP
========================================================= */

/* =========================================================
PROVIDER ICON GROUP
========================================================= */

function createProviderIcons(
    authState
) {
    const container =
        document.createElement(
            "div"
        );

    container.className =
        "bpd-account-banner__providers";

    const linkedProviders =
        Array.isArray(
            authState?.linkedProviders
        )
            ? authState.linkedProviders
            : [];

    const uniqueProviders =
        new Set();

    for (
        const provider
        of linkedProviders
    ) {
        const normalizedProvider =
            normalizeProviderName(
                provider
            );

        if (
            !normalizedProvider
            || uniqueProviders.has(
                normalizedProvider
            )
        ) {
            continue;
        }

        uniqueProviders.add(
            normalizedProvider
        );

        const icon =
            createProviderIcon(
                normalizedProvider,
                authState
            );

        if (
            icon
        ) {
            container.appendChild(
                icon
            );
        }
    }

    return container;
}

/* =========================================================
LOADING STATE
========================================================= */

function renderLoading() {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const message =
        document.createElement(
            "span"
        );

    message.className =
        "bpd-account-banner__message";

    message.textContent =
        "Loading account...";

    status.appendChild(
        message
    );

    setBannerState(
        "loading"
    );
}

/* =========================================================
SIGNED OUT
========================================================= */

function renderSignedOut() {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const message =
        document.createElement(
            "span"
        );

    message.className =
        "bpd-account-banner__message";

    message.textContent =
        "Not signed in";

    status.appendChild(
        message
    );

    actions.appendChild(
        createLink(
            "Sign In",
            LOGIN_URL
        )
    );

    setBannerState(
        "signed-out"
    );
}

/* =========================================================
SIGNED IN
========================================================= */

function renderSignedIn(
    authState
) {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const username =
        document.createElement(
            "span"
        );

    username.className =
        "bpd-account-banner__username";

    username.textContent =
        getDisplayName(
            authState
        );

    status.appendChild(
        username
    );

    const providerIcons =
        createProviderIcons(
            authState
        );

    if (
        providerIcons.childElementCount >
        0
    ) {
        status.appendChild(
            providerIcons
        );
    }

    const profileLink =
        createLink(
            "Profile",
            PROFILE_URL
        );

    profileLink.classList.add(
        "bpd-account-banner__profile"
    );

    /*
     * Let the global router intercept this anchor naturally
     * when data-router-link is present.
     */
    profileLink.dataset.routerLink =
        "";

    actions.appendChild(
        profileLink
    );

    actions.appendChild(
        createButton(
            "Logout",
            handleLogout
        )
    );

    setBannerState(
        "signed-in"
    );
}

/* =========================================================
OFFLINE STATE
========================================================= */

function renderOffline() {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const message =
        document.createElement(
            "span"
        );

    message.className =
        "bpd-account-banner__message";

    message.textContent =
        "Offline";

    status.appendChild(
        message
    );

    setBannerState(
        "offline"
    );
}

/* =========================================================
API UNAVAILABLE STATE
========================================================= */

function renderUnavailable() {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const message =
        document.createElement(
            "span"
        );

    message.className =
        "bpd-account-banner__message";

    message.textContent =
        "Account status unavailable";

    status.appendChild(
        message
    );

    setBannerState(
        "unavailable"
    );
}

/* =========================================================
AUTH STATE RENDER
========================================================= */

function renderAuthState(
    authState
) {
    if (
        navigator.onLine !==
        true
    ) {
        renderOffline();
        return;
    }

    if (
        !authState
        || authState.status ===
            "unknown"
        || authState.status ===
            "loading"
    ) {
        renderLoading();
        return;
    }

    if (
        authState.available !==
        true
    ) {
        renderUnavailable();
        return;
    }

    if (
        authState.authenticated ===
        true
    ) {
        renderSignedIn(
            authState
        );

        return;
    }

    renderSignedOut();
}

/* =========================================================
REFRESH
========================================================= */

export async function refreshAccountBanner(
    {
        force = false
    } = {}
) {
    ensureBannerMarkup();

    if (
        refreshPromise
    ) {
        return refreshPromise;
    }

    if (
        navigator.onLine !==
        true
    ) {
        renderOffline();
        return;
    }

    refreshPromise =
        (
            async () => {
                const authState =
                    await getAuthState({
                        force
                    });

                renderAuthState(
                    authState
                );
            }
        )();

    try {
        await refreshPromise;
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT BANNER: Auth refresh failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            navigator.onLine !==
            true
        ) {
            renderOffline();
        }
        else {
            renderUnavailable();
        }
    }
    finally {
        refreshPromise =
            null;
    }
}

/* =========================================================
LOGOUT
========================================================= */

async function handleLogout() {
    if (
        navigator.onLine !==
        true
    ) {
        renderOffline();
        return;
    }

    try {
        const response =
            await apiFetch(
                BPD_AUTH_LOGOUT_URL,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    redirect:
                        "follow"
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Logout failed: ${response.status}`
            );
        }

        /*
         * The server has destroyed the session.
         * Invalidate the shared client auth cache before
         * navigating away.
         */
        invalidateAuthState();

        await refreshAuthState({
            force:
                true
        });

        window.location.assign(
            "/"
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT BANNER: Logout failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            navigator.onLine !==
            true
        ) {
            renderOffline();
            return;
        }

        renderUnavailable();
    }
}

/* =========================================================
AUTH STATE EVENTS
========================================================= */

function handleAuthStateChanged(
    authState
) {
    renderAuthState(
        authState
    );
}

/* =========================================================
NETWORK STATE EVENTS
========================================================= */

function handleNetworkStatus(
    event
) {
    const online =
        event?.detail?.online;

    const apiReady =
        event?.detail?.apiReady;

    if (
        online ===
        false
    ) {
        renderOffline();
        return;
    }

    if (
        online ===
        true
        && apiReady ===
            false
    ) {
        renderUnavailable();
        return;
    }

    if (
        online ===
        true
        && apiReady ===
            true
    ) {
        void refreshAccountBanner({
            force:
                true
        });
    }
}

/* =========================================================
REGISTER EVENTS
========================================================= */

function registerAccountBannerEvents() {
    unsubscribeAuthState =
        subscribeToAuthState(
            handleAuthStateChanged
        );

    document.addEventListener(
        "bpd:network-status",
        handleNetworkStatus
    );
}

/* =========================================================
INITIALIZATION
========================================================= */

export async function initializeAccountBanner() {
    ensureBannerMarkup();

    if (
        initialized
    ) {
        renderAuthState(
            peekAuthState()
        );

        void refreshAccountBanner();

        return;
    }

    registerAccountBannerEvents();

    initialized =
        true;

    if (
        navigator.onLine !==
        true
    ) {
        renderOffline();
        return;
    }

    renderWaitingForConnection();

    renderAuthState(
        peekAuthState()
    );

    void refreshAccountBanner();
}

/* =========================================================
WAITING FOR CONNECTION
========================================================= */

function renderWaitingForConnection() {
    const {
        status,
        actions
    } =
        getBannerElements();

    if (
        !status
        || !actions
    ) {
        return;
    }

    status.innerHTML =
        "";

    actions.innerHTML =
        "";

    const message =
        document.createElement(
            "span"
        );

    message.className =
        "bpd-account-banner__message";

    message.textContent =
        "Checking account...";

    status.appendChild(
        message
    );

    setBannerState(
        "loading"
    );
}