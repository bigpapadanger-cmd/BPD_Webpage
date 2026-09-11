"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT BANNER CONTROLLER

File:
    Framework/Banner/JS/account_banner.js

Purpose:
    Loads and maintains the persistent global account banner.

Description:
    - Loads the banner HTML fragment.
    - Loads the global BPD authentication session.
    - Displays signed-in or signed-out state.
    - Provides Account, Sign In, and Logout actions.
    - Remains independent of route-specific header rendering.

Authentication:
    GET /api/auth/session
    GET /api/auth/logout

Important:
    - authenticated refers to the global BPD session.
    - Epic linkage is provider state, not global login state.
    - No provider token or sensitive identity data is exposed.
========================================================= */

import {
    BPD_AUTH_SESSION_URL,
    BPD_AUTH_LOGOUT_URL
} from "../../Shell/JS/api_urls.js";

/* =========================================================
CONSTANTS
========================================================= */

const BANNER_HTML_URL =
    "/Framework/Banner/HTML/account_banner.html";

const ACCOUNT_URL =
    "/Account";

const LOGIN_URL =
    "/Login";

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
        typeof value !== "string"
    ) {
        return "";
    }

    return value.trim();
}

/* =========================================================
ELEMENTS
========================================================= */

function getBannerRoot() {
    return document.getElementById(
        "accountBanner"
    );
}

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
HTML LOADER
========================================================= */

async function loadBannerMarkup() {
    const root =
        getBannerRoot();

    if (
        !root
    ) {
        throw new Error(
            "Account banner mount point was not found."
        );
    }

    const response =
        await fetch(
            BANNER_HTML_URL,
            {
                cache:
                    "no-cache"
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            `Account banner markup failed to load: ${response.status}`
        );
    }

    root.innerHTML =
        await response.text();
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

function getDisplayName(
    session
) {
    const providers =
        session?.providers
        && typeof session.providers === "object"
            ? session.providers
            : {};

    const epic =
        providers.epic;

    if (
        epic
        && typeof epic === "object"
    ) {
        const epicName =
            normalizeString(
                epic.preferredUsername
                || epic.displayName
            );

        if (
            epicName
        ) {
            return epicName;
        }
    }

    const google =
        providers.google;

    if (
        google
        && typeof google === "object"
    ) {
        const googleName =
            normalizeString(
                google.displayName
            );

        if (
            googleName
        ) {
            return googleName;
        }
    }

    return "Account";
}

function getProviderLabel(
    session
) {
    const linkedProviders =
        Array.isArray(
            session?.linkedProviders
        )
            ? session.linkedProviders
            : [];

    if (
        linkedProviders.length === 0
    ) {
        return "";
    }

    return linkedProviders
        .map(
            (
                provider
            ) =>
                normalizeString(
                    provider
                )
        )
        .filter(
            Boolean
        )
        .map(
            (
                provider
            ) =>
                provider.charAt(
                    0
                ).toUpperCase()
                + provider.slice(
                    1
                )
        )
        .join(
            " + "
        );
}

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

    const providerLabel =
        getProviderLabel(
            session
        );

    if (
        providerLabel
    ) {
        const providers =
            document.createElement(
                "span"
            );

        providers.className =
            "bpd-account-banner__provider";

        providers.textContent =
            providerLabel;

        status.appendChild(
            providers
        );
    }

    actions.appendChild(
        createLink(
            "Account",
            ACCOUNT_URL
        )
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
ERROR STATE
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

    actions.appendChild(
        createLink(
            "Sign In",
            LOGIN_URL
        )
    );

    setBannerState(
        "error"
    );
}

/* =========================================================
SESSION LOAD
========================================================= */

async function loadAccountSession() {
    const response =
        await fetch(
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
        !response.ok
    ) {
        throw new Error(
            `Account session request failed: ${response.status}`
        );
    }

    return response.json();
}

/* =========================================================
REFRESH
========================================================= */

export async function refreshAccountBanner() {
    if (
        refreshPromise
    ) {
        return refreshPromise;
    }

    refreshPromise =
        (
            async () => {
                try {
                    const session =
                        await loadAccountSession();

                    if (
                        session?.authenticated === true
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
    try {
        const response =
            await fetch(
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
    }
}

/* =========================================================
AUTH STATE EVENTS
========================================================= */

function handleAuthStateChanged() {
    /*
     * Always reload the authoritative global session rather
     * than relying on the event payload.
     *
     * This ensures provider/link state is also refreshed.
     */
    void refreshAccountBanner();
}

function registerAccountBannerEvents() {
    document.addEventListener(
        "bpd:auth-changed",
        handleAuthStateChanged
    );
}

/* =========================================================
INITIALIZATION
========================================================= */

export async function initializeAccountBanner() {
    if (
        initialized
    ) {
        await refreshAccountBanner();
        return;
    }

    try {
        await loadBannerMarkup();

        registerAccountBannerEvents();

        initialized =
            true;

        await refreshAccountBanner();
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT BANNER: Initialization failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );
    }
}