"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PAGE CONTROLLER

File:
    Account/JS/account.js

Purpose:
    Controls the authenticated global BPD Gaming Network
    account page.

Description:
    - Requires an authenticated global BPD account session.
    - Redirects confirmed signed-out users to /Login.
    - Preserves /Account when authentication cannot be
      verified because the network or API is unavailable.
    - Displays the user's global BPD display name.
    - Displays account role and active status.
    - Displays linked authentication providers.
    - Displays provider-specific usernames where available.
    - Handles provider icon fallback images.
    - Detects display-name changes.
    - Saves global profile changes.
    - Starts provider linking through the generic link route.
    - Unlinks providers through the generic unlink route.
    - Provides permanent account deletion.
    - Refreshes the persistent account banner when global
      account or provider state changes.

Authentication:
    GET    /api/auth/session
    POST   /api/auth/account/profile
    GET    /api/auth/link?provider={provider}
    POST   /api/auth/unlink
    DELETE /api/auth/account

Important:
    - /Account requires authentication.
    - A confirmed 401/403 redirects to /Login.
    - API/network failure is NOT treated as signed-out state.
    - identity.accounts.id is the canonical BPD account ID.
    - Global BPD display name is separate from provider names.
    - Provider identities are account linkages, not the
      canonical BPD identity.
    - The browser never supplies identity.accounts.id.
========================================================= */

import {
    BPD_AUTH_SESSION_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

/* =========================================================
CONSTANTS
========================================================= */

const LOGIN_URL =
    "/Login";

const PROFILE_UPDATE_URL =
    "/api/auth/account/profile";

const PROVIDER_LINK_URL =
    "/api/auth/link";

const PROVIDER_UNLINK_URL =
    "/api/auth/unlink";

const ACCOUNT_DELETE_URL =
    "/api/auth/account";

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
            label:
                "Steam",

            icon:
                "/Assets/images/framework_icons/steam-symbol-white.png"
        }
    });

/* =========================================================
STATE
========================================================= */

let currentSession =
    null;

let originalDisplayName =
    "";

let initialized =
    false;

let savingProfile =
    false;

let deletingAccount =
    false;

let redirectingToLogin =
    false;

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
        `${window.location.pathname}${window.location.search}${window.location.hash}`;

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

function getSessionDisplayName(
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

    return "";
}

/* =========================================================
ACCOUNT ROLE
========================================================= */

function getAccountRole(
    session
) {
    const role =
        normalizeString(
            session?.role
            || session
                ?.user
                ?.role
            || session
                ?.account
                ?.role
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
    session
) {
    if (
        typeof session?.active ===
        "boolean"
    ) {
        return session.active;
    }

    if (
        typeof session
            ?.user
            ?.active ===
        "boolean"
    ) {
        return session.user.active;
    }

    if (
        typeof session
            ?.account
            ?.active ===
        "boolean"
    ) {
        return session.account.active;
    }

    return true;
}

/* =========================================================
LINKED PROVIDERS
========================================================= */

function getLinkedProviders(
    session
) {
    const linkedProviders =
        Array.isArray(
            session?.linkedProviders
        )
            ? session.linkedProviders
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
    session,
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
        session?.providers;

    if (
        !providers
        || typeof providers !==
            "object"
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
    session,
    providerName
) {
    const provider =
        getProviderContext(
            session,
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
        provider.username,
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
    session
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

    if (
        connected
    ) {
        const providerDisplayName =
            getProviderDisplayName(
                session,
                normalizedProvider
            );

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
}

/* =========================================================
RENDER PROVIDERS
========================================================= */

function renderProviders(
    session
) {
    const linkedProviders =
        getLinkedProviders(
            session
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
            session
        );
    }
}

/* =========================================================
DISABLE ACCOUNT CONTROLS
========================================================= */

function disableAccountControls() {
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
    session
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
                session
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
                session
            );
    }
}

/* =========================================================
RENDER PROFILE
========================================================= */

function renderProfile(
    session
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
        getSessionDisplayName(
            session
        );

    displayName.value =
        originalDisplayName;

    displayName.disabled =
        false;

    saveProfileButton.disabled =
        true;
}

/* =========================================================
DANGER ZONE
========================================================= */

function renderDangerZone(
    authenticated
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

    deleteAccountButton.disabled =
        !authenticated
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
        savingProfile
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
LOAD SESSION
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
            authenticated:
                false,

            confirmedSignedOut:
                true
        };
    }

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
RENDER AUTHENTICATED ACCOUNT
========================================================= */

function renderAuthenticatedAccount(
    session
) {
    currentSession =
        session;

    renderProfile(
        session
    );

    renderProviders(
        session
    );

    renderAccountInformation(
        session
    );

    renderDangerZone(
        true
    );

    setPageState(
        "ready"
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
LOAD ACCOUNT
========================================================= */

async function loadAccount() {
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
        const session =
            await loadAccountSession();

        if (
            session?.authenticated !==
            true
        ) {
            if (
                session?.confirmedSignedOut ===
                true
            ) {
                redirectToLogin();
                return;
            }

            renderUnavailable();
            return;
        }

        renderAuthenticatedAccount(
            session
        );
    }
    catch (
        error
    ) {
        console.error(
            "ACCOUNT PAGE: Failed to load account.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        /*
         * A failed request does not prove the user is signed
         * out. Leave /Account loaded and disable controls.
         */
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
            PROFILE_UPDATE_URL,
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
    event.preventDefault();

    const {
        displayName,
        saveProfileButton
    } =
        getElements();

    if (
        !displayName
        || !saveProfileButton
        || savingProfile
        || currentSession
            ?.authenticated !==
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

        originalDisplayName =
            validation.value;

        displayName.value =
            validation.value;

        document.dispatchEvent(
            new CustomEvent(
                "bpd:auth-changed"
            )
        );

        await loadAccount();

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
        currentSession?.authenticated !==
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
            PROVIDER_LINK_URL,
            window.location.origin
        );

    linkUrl.searchParams.set(
        "provider",
        normalizedProvider
    );

    window.location.assign(
        linkUrl.href
    );
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
        return;
    }

    const response =
        await apiFetch(
            PROVIDER_UNLINK_URL,
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

    if (
        !response.ok
    ) {
        let message =
            `Provider unlink failed: ${response.status}`;

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
PROVIDER ACTION
========================================================= */

async function handleProviderAction(
    event
) {
    if (
        currentSession?.authenticated !==
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

    if (
        action ===
        "connect"
    ) {
        linkProvider(
            providerName
        );

        return;
    }

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

        document.dispatchEvent(
            new CustomEvent(
                "bpd:auth-changed"
            )
        );

        await loadAccount();

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

        await loadAccount();
    }
}

/* =========================================================
DELETE ACCOUNT REQUEST
========================================================= */

async function deleteAccount() {
    const response =
        await apiFetch(
            ACCOUNT_DELETE_URL,
            {
                method:
                    "DELETE",

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
        let message =
            `Account deletion failed: ${response.status}`;

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
DELETE ACCOUNT CONFIRMATION
========================================================= */

function confirmAccountDeletion() {
    const displayName =
        getSessionDisplayName(
            currentSession
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
    const {
        deleteAccountButton
    } =
        getElements();

    if (
        !deleteAccountButton
        || deletingAccount
        || currentSession
            ?.authenticated !==
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

    clearStatusMessage();

    try {
        await deleteAccount();

        document.dispatchEvent(
            new CustomEvent(
                "bpd:auth-changed"
            )
        );

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
AUTH STATE CHANGE
========================================================= */

function handleAuthStateChanged() {
    void loadAccount();
}

/* =========================================================
NETWORK STATE CHANGE
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
        void loadAccount();
    }
}

/* =========================================================
REGISTER GLOBAL EVENTS
========================================================= */

function registerGlobalEvents() {
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

export async function initializePage() {
    if (
        initialized
    ) {
        await loadAccount();
        return;
    }

    initializeProviderIcons();

    registerProfileEvents();

    registerProviderEvents();

    registerDangerZoneEvents();

    registerGlobalEvents();

    initialized =
        true;

    await loadAccount();
}