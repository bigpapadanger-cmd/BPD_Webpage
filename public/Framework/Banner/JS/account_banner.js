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
    - Remains visible when the internet or API is unavailable.
    - Loads the global BPD authentication session when available.
    - Displays the user's global BPD display name.
    - Displays icons for linked authentication providers.
    - Provides Profile, Sign In, and Logout actions.
    - Avoids displaying account data that cannot be verified.
    - Refreshes automatically when authentication or network
      availability changes.

Authentication:
    GET /api/auth/session
    GET /api/auth/logout

Important:
    - The banner itself does not depend on API availability.
    - authenticated refers to the global BPD session.
    - BPD display name is the primary displayed identity.
    - Provider identities are shown only as linked-system icons.
    - Epic linkage is provider state, not global login state.
    - No provider token or sensitive identity data is exposed.
========================================================= */

import {
    BPD_AUTH_SESSION_URL,
    BPD_AUTH_LOGOUT_URL
} from "../../../scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../scripts/apiConnection.js";

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

This markup is intentionally stored locally in the module so
the banner can render without requesting an HTML fragment.
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
    session
) {
    const directDisplayName =
        normalizeString(
            session?.displayName
        );

    if (
        directDisplayName
    ) {
        return directDisplayName;
    }

    const userDisplayName =
        normalizeString(
            session
                ?.user
                ?.displayName
        );

    if (
        userDisplayName
    ) {
        return userDisplayName;
    }

    const accountDisplayName =
        normalizeString(
            session
                ?.account
                ?.displayName
        );

    if (
        accountDisplayName
    ) {
        return accountDisplayName;
    }

    return "Profile";
}

/* =========================================================
PROVIDER ICON
========================================================= */

function createProviderIcon(
    providerName
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

    const wrapper =
        document.createElement(
            "span"
        );

    wrapper.className =
        "bpd-account-banner__provider-icon-wrap";

    wrapper.dataset.provider =
        normalizedProvider;

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
PROVIDER ICON GROUP
========================================================= */

function createProviderIcons(
    session
) {
    const container =
        document.createElement(
            "div"
        );

    container.className =
        "bpd-account-banner__providers";

    const linkedProviders =
        Array.isArray(
            session?.linkedProviders
        )
            ? session.linkedProviders
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
                normalizedProvider
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
LOCAL LOADING STATE
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

    const signInLink =
        createLink(
            "Sign In",
            LOGIN_URL
        );

    actions.appendChild(
        signInLink
    );

    setBannerState(
        "signed-out"
    );
}

/* =========================================================
SIGNED IN
========================================================= */

function renderSignedIn(
    session
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

    /* -----------------------------------------------------
    BPD DISPLAY NAME
    ----------------------------------------------------- */

    const username =
        document.createElement(
            "span"
        );

    username.className =
        "bpd-account-banner__username";

    username.textContent =
        getDisplayName(
            session
        );

    status.appendChild(
        username
    );

    /* -----------------------------------------------------
    LINKED PROVIDER ICONS
    ----------------------------------------------------- */

    const providerIcons =
        createProviderIcons(
            session
        );

    if (
        providerIcons.childElementCount >
        0
    ) {
        status.appendChild(
            providerIcons
        );
    }

    /* -----------------------------------------------------
    PROFILE
    ----------------------------------------------------- */

    const profileLink =
        createLink(
            "Profile",
            PROFILE_URL
        );

    profileLink.classList.add(
        "bpd-account-banner__profile"
    );

    actions.appendChild(
        profileLink
    );

    /* -----------------------------------------------------
    LOGOUT
    ----------------------------------------------------- */

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
SESSION LOAD
========================================================= */

async function loadAccountSession() {
    const response =
        await apiFetch(
            BPD_AUTH_SESSION_URL,
            {
                method:
                    "GET",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );

    if (
        response.status ===
        401
        || response.status ===
            403
    ) {
        return {
            available:
                true,

            authenticated:
                false
        };
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `Account session request failed: ${response.status}`
        );
    }

    const session =
        await response.json();

    return {
        ...session,

        available:
            true
    };
}

/* =========================================================
REFRESH
========================================================= */

export async function refreshAccountBanner() {
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
                try {
                    const session =
                        await loadAccountSession();

                    if (
                        session?.authenticated ===
                        true
                    ) {
                        renderSignedIn(
                            session
                        );

                        return;
                    }

                    renderSignedOut();
                }
                catch (
                    error
                ) {
                    console.error(
                        "ACCOUNT BANNER: Session load failed.",
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
        )();

    try {
        await refreshPromise;
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

function handleAuthStateChanged() {
    void refreshAccountBanner();
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
        void refreshAccountBanner();
    }
}

/* =========================================================
REGISTER EVENTS
========================================================= */

function registerAccountBannerEvents() {
    document.addEventListener(
        "bpd:auth-changed",
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
    /*
     * Banner construction is completely local.
     * It must succeed independently of network/API state.
     */
    ensureBannerMarkup();

    if (
        initialized
    ) {
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

    /*
     * Do not depend exclusively on receiving a
     * bpd:network-status event.
     *
     * The API monitor may have completed before this
     * controller registered its event listener.
     *
     * apiFetch() will verify the API connection itself when
     * necessary.
     */
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