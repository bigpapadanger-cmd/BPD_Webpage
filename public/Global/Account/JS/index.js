import { consumeOAuthError } from "/Framework/Auth/oauthErrors.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PAGE CONTROLLER

File:
    /Global/Account/JS/index.js

Purpose:
    Controls the authenticated global BPD Gaming Network
    account page.

Description:
    - Uses Framework/Auth/auth.js as the single client-side
      authentication state source.
    - Uses /scripts/apiRoutes.js for all browser API paths.
    - Requires an authenticated global BPD account session.
    - Redirects confirmed signed-out users to /Login.
    - Preserves /Account when authentication cannot be
      verified because the network or API is unavailable.
    - Displays the canonical global BPD display name.
    - Displays account role and active status.
    - Displays linked authentication providers.
    - Displays provider-specific usernames where available.
    - Handles provider icon fallback images.
    - Detects display-name changes.
    - Saves global profile changes.
    - Starts provider linking through the generic link route.
    - Unlinks providers through the generic unlink route.
    - Provides permanent account deletion.
    - Refreshes centralized auth state after account or
      provider mutations.

Authentication State:
    /Framework/Auth/auth.js

API Routes:
    /scripts/apiRoutes.js

Security:
    - Client authentication state is UI/navigation state only.
    - Protected API routes independently enforce server-side
      authorization.
    - identity.accounts.id is never supplied by the browser.
    - Provider identities are linked identities, not the
      canonical BPD account identity.

Important:
    - /Account requires authentication.
    - Confirmed signed-out state redirects to /Login.
    - API/network failure is NOT treated as signed-out state.
    - identity.accounts.id is the canonical BPD account ID.
    - identity.accounts.display_name is the canonical BPD
      display name.
    - Provider display names remain provider-specific.
========================================================= */

import {
    getAuthState,
    refreshAuthState,
    subscribeToAuthState,
    invalidateAuthState
} from "/Framework/Auth/auth.js";

import {
    BPD_AUTH_ACCOUNT_PROFILE_URL,
    BPD_AUTH_ACCOUNT_URL,
    BPD_AUTH_ACCOUNT_DEACTIVATE_URL,
    BPD_AUTH_LINK_URL,
    BPD_AUTH_UNLINK_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

/* =========================================================
PAGE / ASSET CONSTANTS
========================================================= */

const LOGIN_URL =
    "/Login";

const ACCOUNT_RETURN_URL =
    "/Account";

// Enable only after the corresponding server handlers and database contracts
// exist. These UI flags never replace server authorization.
const ACCOUNT_CAPABILITIES = Object.freeze({
    updateProfile: true,
    deleteAccount: true
});

const FALLBACK_IMAGE_URL =
    "/images/bad_image/fallback.png";

/* =========================================================
PROVIDER CONFIGURATION
========================================================= */

const PROVIDER_CONFIG =
    Object.freeze({
        google: {
            label:
                "Google",

            icon:
                "/Assets/images/framework_icons/google-symbol-white.png"
        },

        epic: {
            label:
                "Epic Games",

            icon:
                "/Assets/images/framework_icons/epic-symbol-white.svg"
        },

        discord: {
            label:
                "Discord",

            icon:
                "/Assets/images/framework_icons/discord-symbol-white.png"
        },

        steam: {
            authorizationAvailable: false,
            label:
                "Steam",

            icon:
                "/Assets/images/framework_icons/steam-symbol-white.png"
        }
    });

/* =========================================================
STATE
========================================================= */

let currentAuthState =
    null;

let originalDisplayName =
    "";

let initializedPage = null;
let callbackErrorMessage = "";

let savingProfile =
    false;

let deletingAccount =
    false;

let redirectingToLogin =
    false;

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
ELEMENTS
========================================================= */

function getElements() {
    return {
        page:
            document.getElementById(
                "accountPage"
            ),

        status:
            document.getElementById(
                "accountPageStatus"
            ),

        form:
            document.getElementById(
                "accountProfileForm"
            ),

        displayName:
            document.getElementById(
                "accountDisplayName"
            ),

        saveProfileButton:
            document.getElementById(
                "accountSaveProfileButton"
            ),

        accountStatus:
            document.getElementById(
                "accountStatusValue"
            ),

        accountRole:
            document.getElementById(
                "accountRoleValue"
            ),

        deactivateAccountButton: document.getElementById("accountDeactivateButton"),

        deleteAccountButton:
            document.getElementById(
                "accountDeleteButton"
            )
    };
}

/* =========================================================
PAGE STATE
========================================================= */

function setPageState(
    state
) {
    const {
        page
    } =
        getElements();

    if (
        !page
    ) {
        return;
    }

    page.dataset.accountState =
        state;
}

/* =========================================================
STATUS MESSAGE
========================================================= */

function clearStatusMessage() {
    if (callbackErrorMessage) {
        showStatusMessage(callbackErrorMessage, "error");
        return;
    }
    const {
        status
    } =
        getElements();

    if (
        !status
    ) {
        return;
    }

    status.hidden =
        true;

    status.textContent =
        "";

    delete status.dataset.status;
}

function showStatusMessage(
    message,
    type = "info"
) {
    const {
        status
    } =
        getElements();

    if (
        !status
    ) {
        return;
    }

    status.textContent =
        message;

    status.dataset.status =
        type;

    status.hidden =
        false;
}

/* =========================================================
LOGIN REDIRECT
========================================================= */

function redirectToLogin() {
    if (
        redirectingToLogin
    ) {
        return;
    }

    redirectingToLogin =
        true;

    setPageState(
        "redirecting"
    );

    const returnTo =
        (
            window.location.pathname
            + window.location.search
            + window.location.hash
        );

    const loginUrl =
        new URL(
            LOGIN_URL,
            window.location.origin
        );

    loginUrl.searchParams.set(
        "returnTo",
        returnTo
    );

    window.location.replace(
        loginUrl.href
    );
}

/* =========================================================
DISPLAY NAME
========================================================= */

function getAccountDisplayName(
    authState
) {
    return normalizeString(
        authState?.displayName
    );
}

/* =========================================================
ACCOUNT ROLE
========================================================= */

function getAccountRole(
    authState
) {
    const role =
        normalizeString(
            authState?.role
        );

    if (
        !role
    ) {
        return "Member";
    }

    return (
        role.charAt(
            0
        ).toUpperCase()
        + role.slice(
            1
        )
    );
}

/* =========================================================
ACCOUNT ACTIVE STATE
========================================================= */

function isAccountActive(
    authState
) {
    return (
        authState?.active ===
        true
    );
}

/* =========================================================
LINKED PROVIDERS
========================================================= */

function getLinkedProviders(
    authState
) {
    const linkedProviders =
        Array.isArray(
            authState?.linkedProviders
        )
            ? authState.linkedProviders
            : [];

    return new Set(
        linkedProviders
            .map(
                normalizeProviderName
            )
            .filter(
                Boolean
            )
    );
}

/* =========================================================
PROVIDER CONTEXT
========================================================= */

function getProviderContext(
    authState,
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

    const providers =
        authState?.providers;

    if (
        !providers
        || typeof providers !==
            "object"
        || Array.isArray(
            providers
        )
    ) {
        return null;
    }

    const context =
        providers[
            normalizedProvider
        ];

    if (
        !context
        || typeof context !==
            "object"
    ) {
        return null;
    }

    return context;
}

/* =========================================================
PROVIDER DISPLAY NAME
========================================================= */

function getProviderDisplayName(
    authState,
    providerName
) {
    const provider =
        getProviderContext(
            authState,
            providerName
        );

    if (
        !provider
    ) {
        return "";
    }

    const candidates = [
        provider.displayName,
        provider.preferredUsername,
        provider.email
    ];

    for (
        const candidate
        of candidates
    ) {
        const value =
            normalizeString(
                candidate
            );

        if (
            value
        ) {
            return value;
        }
    }

    return "";
}

/* =========================================================
PROVIDER ICON FALLBACK
========================================================= */

function handleProviderIconError(
    event
) {
    const image =
        event.currentTarget;

    if (
        !(
            image instanceof
            HTMLImageElement
        )
    ) {
        return;
    }

    image.removeEventListener(
        "error",
        handleProviderIconError
    );

    image.src =
        FALLBACK_IMAGE_URL;

    image
        .closest(
            ".account-provider__icon-wrap"
        )
        ?.classList.add(
            "account-provider__icon-wrap--fallback"
        );
}

/* =========================================================
INITIALIZE PROVIDER ICONS
========================================================= */

function initializeProviderIcons() {
    const images =
        document.querySelectorAll(
            "[data-provider-icon]"
        );

    for (
        const image
        of images
    ) {
        const providerName =
            normalizeProviderName(
                image.dataset.providerIcon
            );

        const config =
            PROVIDER_CONFIG[
                providerName
            ];

        if (
            config?.icon
        ) {
            image.src =
                config.icon;
        }

        image.addEventListener(
            "error",
            handleProviderIconError
        );
    }
}

/* =========================================================
PROVIDER STATUS
========================================================= */

function setProviderStatus(
    providerName,
    connected,
    authState
) {
    const normalizedProvider =
        normalizeProviderName(
            providerName
        );

    const row =
        document.querySelector(
            `[data-provider="${normalizedProvider}"]`
        );

    const status =
        document.querySelector(
            `[data-provider-status="${normalizedProvider}"]`
        );

    const action =
        document.querySelector(
            `[data-provider-action="${normalizedProvider}"]`
        );

    if (
        !row
        || !status
        || !action
    ) {
        return;
    }

    row.dataset.connected =
        connected
            ? "true"
            : "false";

    if (PROVIDER_CONFIG[normalizedProvider]?.authorizationAvailable === false) {
        row.dataset.providerState = connected ? "verification-unavailable" : "unavailable";
        status.textContent = connected
            ? "Connected — Steam verification is not available yet"
            : "Steam connection is not available yet";
        action.textContent = connected ? "Disconnect" : "Unavailable";
        action.dataset.action = connected ? "disconnect" : "unavailable";
        action.disabled = !connected;
        return;
    }

    const providerContext =
        getProviderContext(
            authState,
            normalizedProvider
        );

    const requiresReauthorization =
        connected ===
            true
        && providerContext
            ?.requiresReauthorization ===
            true;

    row.dataset.providerState =
        !connected
            ? "disconnected"
            : requiresReauthorization
                ? "reauthorization-required"
                : "connected";

    if (
        connected
    ) {
        const providerDisplayName =
            getProviderDisplayName(
                authState,
                normalizedProvider
            );

        if (
            requiresReauthorization
        ) {
            status.textContent =
                providerDisplayName
                    ? `Connected as ${providerDisplayName} — reauthorization required`
                    : "Connected — reauthorization required";

            action.textContent =
                "Verify Again";

            action.dataset.action =
                "reauthorize";

            action.disabled =
                false;

            action.title =
                "Verify this provider account again.";

            return;
        }

        status.textContent =
            providerDisplayName
                ? `Connected as ${providerDisplayName}`
                : "Connected";

        action.textContent =
            "Disconnect";

        action.dataset.action =
            "disconnect";

        action.disabled =
            false;

        action.removeAttribute(
            "title"
        );

        return;
    }

    status.textContent =
        "Not connected";

    action.textContent =
        "Connect";

    action.dataset.action =
        "connect";

    action.disabled =
        false;

    action.removeAttribute(
        "title"
    );
}

/* =========================================================
RENDER PROVIDERS
========================================================= */

function renderProviders(
    authState
) {
    const linkedProviders =
        getLinkedProviders(
            authState
        );

    for (
        const providerName
        of Object.keys(
            PROVIDER_CONFIG
        )
    ) {
        setProviderStatus(
            providerName,
            linkedProviders.has(
                providerName
            ),
            authState
        );
    }
}

/* =========================================================
DISABLE ACCOUNT CONTROLS
========================================================= */

function disableAccountControls() {
    const deactivate = getElements().deactivateAccountButton;
    if (deactivate) deactivate.disabled = true;
    const {
        displayName,
        saveProfileButton,
        deleteAccountButton
    } =
        getElements();

    if (
        displayName
    ) {
        displayName.disabled =
            true;
    }

    if (
        saveProfileButton
    ) {
        saveProfileButton.disabled =
            true;
    }

    if (
        deleteAccountButton
    ) {
        deleteAccountButton.disabled =
            true;
    }

    for (
        const providerName
        of Object.keys(
            PROVIDER_CONFIG
        )
    ) {
        const action =
            document.querySelector(
                `[data-provider-action="${providerName}"]`
            );

        if (
            action
        ) {
            action.disabled =
                true;
        }
    }
}

/* =========================================================
RENDER ACCOUNT INFORMATION
========================================================= */

function renderAccountInformation(
    authState
) {
    const {
        accountStatus,
        accountRole
    } =
        getElements();

    if (
        accountStatus
    ) {
        const active =
            isAccountActive(
                authState
            );

        accountStatus.textContent =
            active
                ? "Active"
                : "Inactive";

        accountStatus.dataset.active =
            active
                ? "true"
                : "false";
    }

    if (
        accountRole
    ) {
        accountRole.textContent =
            getAccountRole(
                authState
            );
    }
}

/* =========================================================
RENDER PROFILE
========================================================= */

function renderProfile(
    authState
) {
    const {
        displayName,
        saveProfileButton
    } =
        getElements();

    if (
        !displayName
        || !saveProfileButton
    ) {
        return;
    }

    originalDisplayName =
        getAccountDisplayName(
            authState
        );

    displayName.value =
        originalDisplayName;

    displayName.disabled =
        !ACCOUNT_CAPABILITIES.updateProfile;

    saveProfileButton.disabled =
        true;
}

/* =========================================================
DANGER ZONE
========================================================= */

function renderDangerZone(
    enabled
) {
    const {
        deleteAccountButton
    } =
        getElements();

    if (
        !deleteAccountButton
    ) {
        return;
    }

    const deactivate = getElements().deactivateAccountButton;
    if (deactivate) deactivate.disabled = !enabled || deletingAccount;

    deleteAccountButton.disabled =
        !ACCOUNT_CAPABILITIES.deleteAccount
        || !enabled
        || deletingAccount;
}

/* =========================================================
DISPLAY NAME VALIDATION
========================================================= */

function validateDisplayName(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        normalized.length <
        3
    ) {
        return {
            valid:
                false,

            message:
                "Display name must contain at least 3 characters."
        };
    }

    if (
        normalized.length >
        32
    ) {
        return {
            valid:
                false,

            message:
                "Display name cannot exceed 32 characters."
        };
    }

    return {
        valid:
            true,

        value:
            normalized
    };
}

/* =========================================================
PROFILE CHANGE STATE
========================================================= */

function updateProfileSaveState() {
    const {
        displayName,
        saveProfileButton
    } =
        getElements();

    if (
        !displayName
        || !saveProfileButton
    ) {
        return;
    }

    if (
        !ACCOUNT_CAPABILITIES.updateProfile
        || savingProfile
        || currentAuthState?.authenticated !==
            true
        || currentAuthState?.active !==
            true
    ) {
        saveProfileButton.disabled =
            true;

        return;
    }

    const normalized =
        normalizeString(
            displayName.value
        );

    const validation =
        validateDisplayName(
            normalized
        );

    saveProfileButton.disabled =
        !validation.valid
        || normalized ===
            originalDisplayName;
}

/* =========================================================
RENDER AUTHENTICATED ACCOUNT
========================================================= */

function renderAuthenticatedAccount(
    authState
) {
    currentAuthState =
        authState;

    clearStatusMessage();

    renderProfile(
        authState
    );

    renderProviders(
        authState
    );

    renderAccountInformation(
        authState
    );

    renderDangerZone(
        true
    );

    setPageState(
        "ready"
    );

    /*
     * If the Account page was opened from a flashing provider
     * icon, automatically start that provider's existing
     * authorization route.
     *
     * The server determines whether the operation is:
     *
     *     link
     *     reauthorize
     *
     * based on the authoritative Supabase identity state.
     */
    startRequestedProviderReauthorization(
        authState
    );
}
/* =========================================================
RENDER INACTIVE ACCOUNT
========================================================= */

function renderInactiveAccount(
    authState
) {
    currentAuthState =
        authState;

    renderProfile(
        authState
    );

    renderProviders(
        authState
    );

    renderAccountInformation(
        authState
    );

    disableAccountControls();

    showStatusMessage(
        "This BPD account is currently inactive.",
        "error"
    );

    setPageState(
        "inactive"
    );
}

/* =========================================================
RENDER INVALID ACCOUNT
========================================================= */

function renderInvalidAccount() {
    currentAuthState =
        null;

    disableAccountControls();

    showStatusMessage(
        "The authenticated BPD account could not be resolved.",
        "error"
    );

    setPageState(
        "invalid"
    );
}

/* =========================================================
RENDER UNAVAILABLE ACCOUNT
========================================================= */

function renderUnavailable() {
    disableAccountControls();

    showStatusMessage(
        navigator.onLine ===
            false
            ? "Account information is unavailable while offline."
            : "Account information is currently unavailable.",
        "error"
    );

    setPageState(
        navigator.onLine ===
            false
            ? "offline"
            : "unavailable"
    );
}

/* =========================================================
APPLY AUTH STATE
========================================================= */

function applyAuthState(
    authState
) {
    if (!getElements().page) return;
    if (
        redirectingToLogin
    ) {
        return;
    }

    currentAuthState =
        authState
        || null;

    if (
        !authState
        || authState.status ===
            "unknown"
        || authState.status ===
            "loading"
    ) {
        setPageState(
            "loading"
        );

        return;
    }

    if (
        authState.status ===
            "unavailable"
        || authState.available !==
            true
    ) {
        renderUnavailable();
        return;
    }

    if (
        authState.authenticated !==
            true
    ) {
        redirectToLogin();
        return;
    }

    if (
        !normalizeString(
            authState.userId
        )
    ) {
        renderInvalidAccount();
        return;
    }

    if (
        authState.active !==
        true
    ) {
        renderInactiveAccount(
            authState
        );

        return;
    }

    renderAuthenticatedAccount(
        authState
    );
}

/* =========================================================
LOAD ACCOUNT
========================================================= */

async function loadAccount(
    {
        force = false
    } = {}
) {
    if (
        redirectingToLogin
    ) {
        return;
    }

    clearStatusMessage();

    setPageState(
        "loading"
    );

    try {
        const authState =
            await getAuthState({
                force
            });

        applyAuthState(
            authState
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT PAGE: Failed to load auth state.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        renderUnavailable();
    }
}

/* =========================================================
SAVE PROFILE REQUEST
========================================================= */

async function saveProfile(
    displayName
) {
    const response =
        await apiFetch(
            BPD_AUTH_ACCOUNT_PROFILE_URL,
            {
                method:
                    "POST",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers: {
                    "Accept":
                        "application/json",

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        displayName
                    })
            }
        );

    if (
        !response.ok
    ) {
        let message =
            `Profile update failed: ${response.status}`;

        try {
            const body =
                await response.json();

            const serverMessage =
                normalizeString(
                    body?.message
                    || body?.error
                );

            if (
                serverMessage
            ) {
                message =
                    serverMessage;
            }
        }
        catch {
            // Response body is optional.
        }

        throw new Error(
            message
        );
    }

    return response.json();
}

/* =========================================================
PROFILE SUBMIT
========================================================= */

async function handleProfileSubmit(
    event
) {
    callbackErrorMessage = "";
    event.preventDefault();

    if (!ACCOUNT_CAPABILITIES.updateProfile) return;

    const {
        displayName,
        saveProfileButton
    } =
        getElements();

    if (
        !displayName
        || !saveProfileButton
        || savingProfile
        || currentAuthState
            ?.authenticated !==
            true
        || currentAuthState
            ?.active !==
            true
    ) {
        return;
    }

    const validation =
        validateDisplayName(
            displayName.value
        );

    if (
        !validation.valid
    ) {
        showStatusMessage(
            validation.message,
            "error"
        );

        return;
    }

    if (
        validation.value ===
        originalDisplayName
    ) {
        return;
    }

    savingProfile =
        true;

    saveProfileButton.disabled =
        true;

    saveProfileButton.textContent =
        "Saving...";

    clearStatusMessage();

    try {
        await saveProfile(
            validation.value
        );

        const refreshedState =
            await refreshAuthState({
                force:
                    true
            });

        applyAuthState(
            refreshedState
        );

        showStatusMessage(
            "Profile updated successfully.",
            "success"
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT PAGE: Failed to save profile.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showStatusMessage(
            error?.message
            || "Profile update failed.",
            "error"
        );
    }
    finally {
        savingProfile =
            false;

        saveProfileButton.textContent =
            "Save Changes";

        updateProfileSaveState();
    }
}

/* =========================================================
LINK PROVIDER
========================================================= */

function linkProvider(
    providerName
) {
    if (
        currentAuthState?.authenticated !==
            true
        || currentAuthState?.active !==
            true
    ) {
        return;
    }

    const normalizedProvider =
        normalizeProviderName(
            providerName
        );

    if (
        !normalizedProvider
        || !PROVIDER_CONFIG[
            normalizedProvider
        ]
    ) {
        showStatusMessage(
            "This provider is not currently available.",
            "error"
        );

        return;
    }

    const linkUrl =
        new URL(
            BPD_AUTH_LINK_URL,
            window.location.origin
        );

    linkUrl.searchParams.set(
        "provider",
        normalizedProvider
    );

    linkUrl.searchParams.set(
        "returnTo",
        ACCOUNT_RETURN_URL
    );

    window.location.assign(
        linkUrl.href
    );
}
/* =========================================================
QUERY-DRIVEN PROVIDER REAUTHORIZATION
========================================================= */

function getRequestedReauthorizationProvider() {
    const url =
        new URL(
            window.location.href
        );

    const provider =
        normalizeProviderName(
            url.searchParams.get(
                "reauthorize"
            )
        );

    if (
        !provider
    ) {
        return null;
    }

    if (
        !PROVIDER_CONFIG[
            provider
        ]
    ) {
        return null;
    }

    /*
     * Steam is displayed in the account UI, but the current
     * provider authentication service only supports:
     *
     *     Google
     *     Discord
     *     Epic
     */
    if (
        ![
            "google",
            "discord",
            "epic"
        ].includes(
            provider
        )
    ) {
        return null;
    }

    return provider;
}

function clearReauthorizationQuery() {
    const url =
        new URL(
            window.location.href
        );

    if (
        !url.searchParams.has(
            "reauthorize"
        )
    ) {
        return;
    }

    url.searchParams.delete(
        "reauthorize"
    );

    const nextUrl =
        url.pathname
        + (
            url.search
            || ""
        )
        + (
            url.hash
            || ""
        );

    window.history.replaceState(
        window.history.state,
        "",
        nextUrl
    );
}

function startRequestedProviderReauthorization(
    authState
) {
    if (
        authState?.authenticated !==
            true
        || authState?.active !==
            true
    ) {
        return false;
    }

    const provider =
        getRequestedReauthorizationProvider();

    if (
        !provider
    ) {
        return false;
    }

    const providerContext =
        getProviderContext(
            authState,
            provider
        );

    /*
     * Only start the automatic flow when the provider is
     * actually still linked.
     *
     * If it is no longer linked, remove the query parameter
     * and leave the normal Account page visible.
     */
    if (
        providerContext?.linked !==
        true
    ) {
        clearReauthorizationQuery();

        showStatusMessage(
            "That provider is no longer linked to this account.",
            "error"
        );

        return false;
    }

    /*
     * If the provider no longer requires reauthorization,
     * remove the stale query parameter and remain on Account.
     */
    if (
        providerContext
            ?.requiresReauthorization !==
        true
    ) {
        clearReauthorizationQuery();

        return false;
    }

    /*
     * Prevent the same query parameter from repeatedly
     * launching OAuth if the browser returns to this page
     * before navigation completes.
     */
    clearReauthorizationQuery();

    linkProvider(
        provider
    );

    return true;
}
/* =========================================================
UNLINK PROVIDER REQUEST
========================================================= */

async function unlinkProvider(
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

    const response =
        await apiFetch(
            BPD_AUTH_UNLINK_URL,
            {
                method:
                    "POST",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers: {
                    "Accept":
                        "application/json",

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        provider:
                            normalizedProvider
                    })
            }
        );

    let body =
        null;

    try {
        body =
            await response.json();
    }
    catch {
        // Response body is optional.
    }

    if (
        !response.ok
    ) {
        const message =
            normalizeString(
                body?.message
                || body?.error
            )
            || `Provider unlink failed: ${response.status}`;

        throw new Error(
            message
        );
    }

    return body;
}

/* =========================================================
PROVIDER ACTION
========================================================= */

async function handleProviderAction(
    event
) {
    callbackErrorMessage = "";
    if (
        currentAuthState?.authenticated !==
            true
        || currentAuthState?.active !==
            true
    ) {
        return;
    }

    const button =
        event.currentTarget;

    const providerName =
        normalizeProviderName(
            button.dataset.providerAction
        );

    const action =
        normalizeString(
            button.dataset.action
        );

    if (
        !providerName
        || !action
    ) {
        return;
    }

    /* =====================================================
    CONNECT
    ===================================================== */

    if (
        action ===
        "connect"
    ) {
        linkProvider(
            providerName
        );

        return;
    }

    /* =====================================================
    REAUTHORIZE
    ===================================================== */

    if (
        action ===
        "reauthorize"
    ) {
        /*
         * The generic provider authorization route checks
         * authoritative Supabase linkage.
         *
         * Because this provider is already linked, the server
         * automatically starts mode = reauthorize rather than
         * mode = link.
         */
        button.disabled =
            true;

        button.textContent =
            "Opening...";

        clearStatusMessage();

        linkProvider(
            providerName
        );

        return;
    }

    /* =====================================================
    DISCONNECT
    ===================================================== */

    if (
        action !==
        "disconnect"
    ) {
        return;
    }

    const config =
        PROVIDER_CONFIG[
            providerName
        ];

    const confirmed =
        window.confirm(
            `Disconnect ${config?.label || providerName} from your BPD account?`
        );

    if (
        !confirmed
    ) {
        return;
    }

    button.disabled =
        true;

    button.textContent =
        "Disconnecting...";

    clearStatusMessage();

    try {
        await unlinkProvider(
                providerName
            );

        const refreshedState =
            await refreshAuthState({
                force:
                    true
            });

        if (
            refreshedState?.available === true
            && refreshedState.authenticated === false
        ) {
            redirectToLogin();
            return;
        }

        applyAuthState(
            refreshedState
        );

        if (refreshedState?.available !== true) return;

        showStatusMessage(
            `${config?.label || providerName} disconnected successfully.`,
            "success"
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT PAGE: Provider unlink failed.",
            {
                provider:
                    providerName,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showStatusMessage(
            error?.message
            || "Provider unlink failed.",
            "error"
        );

        const refreshedState =
            await refreshAuthState({
                force:
                    true
            });

        applyAuthState(
            refreshedState
        );
    }
}

/* =========================================================
DELETE ACCOUNT REQUEST
========================================================= */

async function deleteAccount() {
    return removeAccount(BPD_AUTH_ACCOUNT_URL, "DELETE", "DELETE");
}

async function removeAccount(url, method, confirmation) {
    const response = await apiFetch(url, {
        method, credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation })
    });
    let body = null;
    try { body = await response.json(); } catch { /* Fail closed below. */ }
    if (!response.ok || body?.success !== true) {
        throw new Error(body?.message || "Account change failed. Please try again.");
    }
    return body;
}

async function handleDeactivateAccount() {
    if (deletingAccount || currentAuthState?.authenticated !== true || currentAuthState?.active !== true) return;
    if (!window.confirm("Deactivate your BPD account? Access will be disabled. This action is reversible; your provider links and history will be retained.")) return;
    callbackErrorMessage = "";
    deletingAccount = true;
    renderDangerZone(false);
    clearStatusMessage();
    try {
        await removeAccount(BPD_AUTH_ACCOUNT_DEACTIVATE_URL, "POST", "DEACTIVATE");
        invalidateAuthState();
        window.location.assign("/");
    } catch (error) {
        showStatusMessage(error?.message || "Account deactivation failed.", "error");
        deletingAccount = false;
        renderDangerZone(currentAuthState?.authenticated === true && currentAuthState?.active === true);
    }
}

/* =========================================================
DELETE ACCOUNT CONFIRMATION
========================================================= */

function confirmAccountDeletion() {
    const displayName =
        getAccountDisplayName(
            currentAuthState
        );

    const firstConfirmation =
        window.confirm(
            "Delete your BPD Gaming Network account permanently?\n\nThis action cannot be undone."
        );

    if (
        !firstConfirmation
    ) {
        return false;
    }

    const confirmationValue =
        window.prompt(
            displayName
                ? `Type DELETE to permanently delete ${displayName}.`
                : "Type DELETE to permanently delete your account."
        );

    return (
        normalizeString(
            confirmationValue
        )
            .toUpperCase() ===
        "DELETE"
    );
}

/* =========================================================
DELETE ACCOUNT ACTION
========================================================= */

async function handleDeleteAccount() {
    if (!ACCOUNT_CAPABILITIES.deleteAccount) return;
    callbackErrorMessage = "";
    const {
        deleteAccountButton
    } =
        getElements();

    if (
        !deleteAccountButton
        || deletingAccount
        || currentAuthState
            ?.authenticated !==
            true
        || currentAuthState
            ?.active !==
            true
    ) {
        return;
    }

    const confirmed =
        confirmAccountDeletion();

    if (
        !confirmed
    ) {
        return;
    }

    deletingAccount =
        true;

    deleteAccountButton.disabled =
        true;

    deleteAccountButton.textContent =
        "Deleting...";
    renderDangerZone(false);

    clearStatusMessage();

    try {
        await deleteAccount();

        invalidateAuthState();

        window.location.assign(
            "/"
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT PAGE: Account deletion failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showStatusMessage(
            error?.message
            || "Account deletion failed.",
            "error"
        );

        deletingAccount =
            false;

        deleteAccountButton.textContent =
            "Delete Account";

        renderDangerZone(
            currentAuthState
                ?.authenticated ===
                true
            && currentAuthState
                ?.active ===
                true
        );
    }
}

/* =========================================================
REGISTER PROFILE EVENTS
========================================================= */

function registerProfileEvents() {
    const {
        form,
        displayName
    } =
        getElements();

    form?.addEventListener(
        "submit",
        handleProfileSubmit
    );

    displayName?.addEventListener(
        "input",
        updateProfileSaveState
    );
}

/* =========================================================
REGISTER PROVIDER EVENTS
========================================================= */

function registerProviderEvents() {
    const buttons =
        document.querySelectorAll(
            "[data-provider-action]"
        );

    for (
        const button
        of buttons
    ) {
        button.addEventListener(
            "click",
            handleProviderAction
        );
    }
}

/* =========================================================
REGISTER DANGER ZONE EVENTS
========================================================= */

function registerDangerZoneEvents() {
    getElements().deactivateAccountButton?.addEventListener("click", handleDeactivateAccount);
    const {
        deleteAccountButton
    } =
        getElements();

    deleteAccountButton?.addEventListener(
        "click",
        handleDeleteAccount
    );
}

/* =========================================================
CENTRAL AUTH STATE CHANGE
========================================================= */

function handleAuthStateChanged(
    authState
) {
    applyAuthState(
        authState
    );
}

/* =========================================================
NETWORK STATE CHANGE
========================================================= */

function handleNetworkStatus(
    event
) {
    if (!getElements().page) return;
    const online =
        event?.detail?.online;

    const apiReady =
        event?.detail?.apiReady;

    if (
        online ===
        false
        || apiReady ===
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
        void loadAccount({
            force:
                true
        });
    }
}

/* =========================================================
REGISTER GLOBAL EVENTS
========================================================= */

function registerGlobalEvents() {
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

export async function initializePage() {
    const page = getElements().page;
    if (!page) return;
    callbackErrorMessage = consumeOAuthError() || (page === initializedPage ? callbackErrorMessage : "");
    if (page !== initializedPage) {
        initializedPage = page;
        redirectingToLogin = false;
        initializeProviderIcons();
        registerProfileEvents();
        registerProviderEvents();
        registerDangerZoneEvents();
        if (!unsubscribeAuthState) registerGlobalEvents();
    }
    await loadAccount();
    if (callbackErrorMessage) showStatusMessage(callbackErrorMessage, "error");
}
