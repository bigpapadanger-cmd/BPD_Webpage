import { consumeOAuthError } from "/Framework/Auth/oauthErrors.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
LOGIN PAGE CONTROLLER

File:
    /Global/Login/JS/index.js

Purpose:
    Controls the public BPD Gaming Network login page.

Description:
    - Uses Framework/Auth/auth.js as the single client-side
      authentication state source.
    - Redirects already-authenticated users.
    - Loads and renders Cloudflare Turnstile.
    - Requires successful Turnstile verification before login.
    - Starts provider authentication through server routes.
    - Uses /scripts/apiRoutes.js for all browser API paths.
    - Preserves a safe local returnTo destination.
    - Disables authentication controls while offline or while
      BPD authentication services are unavailable.
    - Subscribes to centralized authentication state changes.

Authentication State:
    /Framework/Auth/auth.js

API Routes:
    /scripts/apiRoutes.js

Security:
    - Client authentication state is UI/navigation state only.
    - Provider authentication is completed and validated by
      server-side OAuth services.
    - Turnstile verification is validated server-side.
    - Browser-controlled returnTo values are restricted to
      same-origin relative paths.

Important:
    - This page does not call /api/auth/session directly.
    - authenticated:false means confirmed signed-out state.
    - Authentication-service failure is not treated as logout.
========================================================= */

import {
    getAuthState,
    subscribeToAuthState
} from "/Framework/Auth/auth.js";

import {
    BPD_AUTH_GOOGLE_LOGIN_URL,
    BPD_AUTH_DISCORD_LOGIN_URL,
    BPD_AUTH_EPIC_LOGIN_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

/* =========================================================
PAGE / ASSET CONSTANTS
========================================================= */

const DEFAULT_AUTHENTICATED_REDIRECT =
    "/Account";

const FALLBACK_IMAGE_URL =
    "/images/bad_image/fallback.png";

const TURNSTILE_SCRIPT_URL =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const TURNSTILE_SCRIPT_ID =
    "bpdTurnstileScript";

/* =========================================================
PROVIDERS
========================================================= */

const PROVIDER_CONFIG =
    Object.freeze({
        google: {
            label:
                "Google",

            loginUrl:
                BPD_AUTH_GOOGLE_LOGIN_URL,

            icon:
                "/Assets/images/framework_icons/google-symbol-white.png"
        },

        discord: {
            label:
                "Discord",

            loginUrl:
                BPD_AUTH_DISCORD_LOGIN_URL,

            icon:
                "/Assets/images/framework_icons/discord-symbol-white.png"
        },

        epic: {
            label:
                "Epic Games",

            loginUrl:
                BPD_AUTH_EPIC_LOGIN_URL,

            icon:
                "/Assets/images/framework_icons/epic-symbol-white.svg"
        }
    });

/* =========================================================
STATE
========================================================= */

let initializedPage = null;
let callbackErrorMessage = "";

let redirecting =
    false;

let sessionReady =
    false;

let captchaToken =
    "";

let turnstileWidgetId =
    null;

let turnstileLoadingPromise =
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

function normalizeProvider(
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
                "loginPage"
            ),

        status:
            document.getElementById(
                "loginStatus"
            ),

        turnstile:
            document.getElementById(
                "loginTurnstile"
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
        page
    ) {
        page.dataset.loginState =
            state;
    }
}

/* =========================================================
STATUS
========================================================= */

function clearStatus() {
    if (callbackErrorMessage) {
        showOAuthCallbackError();
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

function showStatus(
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
RETURN DESTINATION
========================================================= */

function getReturnTo() {
    const url =
        new URL(
            window.location.href
        );

    const requested =
        normalizeString(
            url.searchParams.get(
                "returnTo"
            )
        );

    if (
        !requested
        || !requested.startsWith(
            "/"
        )
        || /[\\\u0000-\u0020\u007f]/u.test(requested)
        || requested.startsWith(
            "//"
        )
    ) {
        return DEFAULT_AUTHENTICATED_REDIRECT;
    }

    return requested;
}

/* =========================================================
AUTHENTICATED REDIRECT
========================================================= */

function redirectAuthenticatedUser() {
    if (
        redirecting
    ) {
        return;
    }

    redirecting =
        true;

    sessionReady =
        false;

    setProviderButtonsEnabled(
        false
    );

    setPageState(
        "redirecting"
    );

    window.location.replace(
        getReturnTo()
    );
}

/* =========================================================
PROVIDER BUTTON STATE
========================================================= */

function setProviderButtonsEnabled(
    enabled
) {
    const buttons =
        document.querySelectorAll(
            "[data-login-provider]"
        );

    for (
        const button
        of buttons
    ) {
        button.disabled =
            !enabled;
    }
}

function updateProviderButtonState() {
    const enabled =
        sessionReady ===
            true
        && captchaToken.length >
            0
        && redirecting ===
            false
        && navigator.onLine !==
            false;

    setProviderButtonsEnabled(
        enabled
    );
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
}

/* =========================================================
INITIALIZE PROVIDER ICONS
========================================================= */

function initializeProviderIcons() {
    const images =
        document.querySelectorAll(
            "[data-login-provider-icon]"
        );

    for (
        const image
        of images
    ) {
        const provider =
            normalizeProvider(
                image.dataset.loginProviderIcon
            );

        const config =
            PROVIDER_CONFIG[
                provider
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
TURNSTILE SITE KEY
========================================================= */

function getTurnstileSiteKey() {
    const {
        turnstile
    } =
        getElements();

    if (
        !turnstile
    ) {
        return "";
    }

    return normalizeString(
        turnstile.dataset.siteKey
    );
}

/* =========================================================
LOAD TURNSTILE SCRIPT
========================================================= */

function loadTurnstileScript() {
    if (
        window.turnstile
        && typeof window.turnstile.render ===
            "function"
    ) {
        return Promise.resolve(
            window.turnstile
        );
    }

    if (
        turnstileLoadingPromise
    ) {
        return turnstileLoadingPromise;
    }

    turnstileLoadingPromise =
        new Promise(
            (
                resolve,
                reject
            ) => {
                let script =
                    document.getElementById(
                        TURNSTILE_SCRIPT_ID
                    );

                const handleLoaded =
                    () => {
                        if (
                            window.turnstile
                            && typeof window.turnstile.render ===
                                "function"
                        ) {
                            resolve(
                                window.turnstile
                            );

                            return;
                        }

                        reject(
                            new Error(
                                "TURNSTILE_API_UNAVAILABLE"
                            )
                        );
                    };

                const handleError =
                    () => {
                        reject(
                            new Error(
                                "TURNSTILE_SCRIPT_LOAD_FAILED"
                            )
                        );
                    };

                if (
                    script
                ) {
                    script.addEventListener(
                        "load",
                        handleLoaded,
                        {
                            once:
                                true
                        }
                    );

                    script.addEventListener(
                        "error",
                        handleError,
                        {
                            once:
                                true
                        }
                    );

                    return;
                }

                script =
                    document.createElement(
                        "script"
                    );

                script.id =
                    TURNSTILE_SCRIPT_ID;

                script.src =
                    TURNSTILE_SCRIPT_URL;

                script.async =
                    true;

                script.defer =
                    true;

                script.addEventListener(
                    "load",
                    handleLoaded,
                    {
                        once:
                            true
                    }
                );

                script.addEventListener(
                    "error",
                    handleError,
                    {
                        once:
                            true
                    }
                );

                document.head.appendChild(
                    script
                );
            }
        )
            .catch(
                error => {
                    turnstileLoadingPromise =
                        null;

                    throw error;
                }
            );

    return turnstileLoadingPromise;
}

/* =========================================================
TURNSTILE CALLBACKS
========================================================= */

function handleTurnstileSuccess(
    token
) {
    captchaToken =
        normalizeString(
            token
        );

    if (
        !captchaToken
    ) {
        handleTurnstileExpired();
        return;
    }

    clearStatus();

    setPageState(
        "ready"
    );

    updateProviderButtonState();
    continueRequestedEpicLogin();
}

function continueRequestedEpicLogin() {
    if (!sessionReady || !captchaToken || redirecting || callbackErrorMessage || !getElements().page) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("provider") !== "epic") return;
    // Consume the request before starting so verification retries cannot loop.
    url.searchParams.delete("provider");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    redirecting = true;
    setProviderButtonsEnabled(false);
    void startProviderLogin("epic");
}

function handleTurnstileExpired() {
    captchaToken =
        "";

    setProviderButtonsEnabled(
        false
    );

    if (
        sessionReady
    ) {
        showStatus(
            "Verification expired. Please verify again to continue.",
            "info"
        );

        setPageState(
            "verification-required"
        );
    }
}

function handleTurnstileError() {
    captchaToken =
        "";

    setProviderButtonsEnabled(
        false
    );

    showStatus(
        "Human verification could not be completed. Please try again.",
        "error"
    );

    setPageState(
        "verification-error"
    );
}

/* =========================================================
INITIALIZE TURNSTILE
========================================================= */

async function initializeTurnstile() {
    const {
        turnstile
    } =
        getElements();

    if (
        !turnstile
    ) {
        throw new Error(
            "TURNSTILE_ELEMENT_MISSING"
        );
    }

    const siteKey =
        getTurnstileSiteKey();

    if (
        !siteKey
    ) {
        throw new Error(
            "TURNSTILE_SITE_KEY_MISSING"
        );
    }

    const api =
        await loadTurnstileScript();

    if (
        turnstileWidgetId !==
        null
    ) {
        return;
    }

    turnstileWidgetId =
        api.render(
            turnstile,
            {
                sitekey:
                    siteKey,

                theme:
                    "auto",

                size:
                    turnstile.clientWidth < 300 ? "compact" : "normal",

                appearance:
                    "always",

                callback:
                    handleTurnstileSuccess,

                "expired-callback":
                    handleTurnstileExpired,

                "timeout-callback":
                    handleTurnstileExpired,

                "error-callback":
                    handleTurnstileError
            }
        );
}

/* =========================================================
RESET TURNSTILE
========================================================= */

function resetTurnstile() {
    captchaToken =
        "";

    if (
        turnstileWidgetId !==
            null
        && window.turnstile
        && typeof window.turnstile.reset ===
            "function"
    ) {
        window.turnstile.reset(
            turnstileWidgetId
        );
    }

    updateProviderButtonState();
}

/* =========================================================
READ JSON RESPONSE
========================================================= */

async function readJsonResponse(
    response
) {
    const contentType =
        normalizeString(
            response.headers.get(
                "content-type"
            )
        )
            .toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        return null;
    }

    try {
        return await response.json();
    }
    catch {
        return null;
    }
}

/* =========================================================
START PROVIDER LOGIN
========================================================= */

async function startProviderLogin(
    providerName
) {
    callbackErrorMessage = "";
    const provider =
        normalizeProvider(
            providerName
        );

    const config =
        PROVIDER_CONFIG[
            provider
        ];

    if (
        !config
        || !config.loginUrl
    ) {
        redirecting =
            false;

        showStatus(
            "This login provider is not currently available.",
            "error"
        );

        updateProviderButtonState();

        return;
    }

    if (
        !captchaToken
    ) {
        redirecting =
            false;

        showStatus(
            "Complete the verification before signing in.",
            "error"
        );

        setPageState(
            "verification-required"
        );

        updateProviderButtonState();

        return;
    }

    const submittedCaptchaToken =
        captchaToken;

    captchaToken =
        "";

    setProviderButtonsEnabled(
        false
    );

    clearStatus();

    setPageState(
        "redirecting"
    );

    try {
        const response =
            await apiFetch(
                config.loginUrl,
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
                            captchaToken:
                                submittedCaptchaToken,

                            returnTo:
                                getReturnTo()
                        })
                }
            );

        const data =
            await readJsonResponse(
                response
            );

        if (
            !response.ok
        ) {
            const errorCode =
                normalizeString(
                    data?.error
                    || data?.code
                );

            switch (
                errorCode
            ) {
                case "CAPTCHA_REQUIRED":
                case "CAPTCHA_INVALID":
                    throw new Error(
                        "LOGIN_VERIFICATION_FAILED"
                    );

                case "CAPTCHA_NOT_CONFIGURED":
                case "CAPTCHA_SERVICE_UNAVAILABLE":
                    throw new Error(
                        "LOGIN_VERIFICATION_UNAVAILABLE"
                    );

                case "SB_PUB_KEY_MISSING":
                case "SUPABASE_URL_MISSING":
                case "EPIC_CLIENT_ID_MISSING":
                case "EPIC_CLIENT_SECRET_MISSING":
                    throw new Error(
                        "LOGIN_PROVIDER_CONFIGURATION_ERROR"
                    );

                default:
                    throw new Error(
                        errorCode
                        || `LOGIN_PROVIDER_HTTP_${response.status}`
                    );
            }
        }

        if (
            data?.success !==
            true
        ) {
            throw new Error(
                normalizeString(
                    data?.error
                    || data?.code
                )
                || "LOGIN_PROVIDER_START_FAILED"
            );
        }

        const redirectUrl =
            normalizeString(
                data?.redirectUrl
            );

        if (
            !redirectUrl
        ) {
            throw new Error(
                "LOGIN_PROVIDER_REDIRECT_MISSING"
            );
        }

        window.location.assign(
            redirectUrl
        );
    }
    catch (
        error
    ) {
        redirecting =
            false;

        const errorCode =
            normalizeString(
                error?.message
            );

        console.error(
            "LOGIN PAGE: Failed to start provider authentication.",
            {
                provider,

                message:
                    errorCode
                    || "Unknown error"
            }
        );

        let message =
            "Sign in could not be started. Please verify again and retry.";

        if (
            navigator.onLine ===
            false
        ) {
            message =
                "You are offline. Sign in is unavailable.";
        }
        else if (
            errorCode ===
            "LOGIN_VERIFICATION_FAILED"
        ) {
            message =
                "Human verification failed. Please verify again.";
        }
        else if (
            errorCode ===
            "LOGIN_VERIFICATION_UNAVAILABLE"
        ) {
            message =
                "Human verification is currently unavailable.";
        }
        else if (
            errorCode ===
            "LOGIN_PROVIDER_CONFIGURATION_ERROR"
        ) {
            message =
                `${config.label} sign in is temporarily unavailable due to a configuration error.`;
        }
        else if (
            errorCode ===
            "LOGIN_PROVIDER_REDIRECT_MISSING"
        ) {
            message =
                `${config.label} sign in could not be started. Please try again.`;
        }

        showStatus(
            message,
            "error"
        );

        setPageState(
            navigator.onLine ===
                false
                ? "offline"
                : "verification-required"
        );

        resetTurnstile();
    }
}

/* =========================================================
OAUTH CALLBACK ERROR
========================================================= */

function showOAuthCallbackError() {
    if (callbackErrorMessage && getElements().page) {
        showStatus(callbackErrorMessage, "error");
    }
}

/* =========================================================
PROVIDER CLICK
========================================================= */

function handleProviderClick(
    event
) {
    if (
        redirecting
    ) {
        return;
    }

    const provider =
        normalizeProvider(
            event.currentTarget
                ?.dataset
                ?.loginProvider
        );

    if (
        !provider
    ) {
        return;
    }

    redirecting =
        true;

    setProviderButtonsEnabled(
        false
    );

    void startProviderLogin(
        provider
    );
}

/* =========================================================
REGISTER PROVIDER EVENTS
========================================================= */

function registerProviderEvents() {
    const buttons =
        document.querySelectorAll(
            "[data-login-provider]"
        );

    for (
        const button
        of buttons
    ) {
        button.addEventListener(
            "click",
            handleProviderClick
        );
    }
}

/* =========================================================
APPLY AUTH STATE
========================================================= */

async function applyAuthState(
    authState
) {
    if (!getElements().page) return;
    if (
        redirecting
    ) {
        return;
    }

    if (
        !authState
        || authState.status ===
            "unknown"
        || authState.status ===
            "loading"
    ) {
        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        setPageState(
            "loading"
        );

        return;
    }

    if (
        authState.available !==
            true
        || authState.status ===
            "unavailable"
    ) {
        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        showStatus(
            navigator.onLine ===
                false
                ? "You are offline. Sign in is unavailable."
                : "BPD authentication services are currently unavailable.",
            "error"
        );

        setPageState(
            navigator.onLine ===
                false
                ? "offline"
                : "unavailable"
        );

        return;
    }

    if (
        authState.authenticated ===
        true
    ) {
        redirectAuthenticatedUser();
        return;
    }

    /*
     * At this point auth.js has positively confirmed:
     *
     *     available: true
     *     authenticated: false
     *
     * Login can safely be enabled.
     */
    sessionReady =
        true;

    redirecting =
        false;

    setPageState(
        "verification-required"
    );

    try {
        await initializeTurnstile();

        updateProviderButtonState();
        continueRequestedEpicLogin();
    }
    catch (
        error
    ) {
        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        if (
            error?.message ===
            "TURNSTILE_SITE_KEY_MISSING"
        ) {
            showStatus(
                "Sign in verification is not configured correctly.",
                "error"
            );

            setPageState(
                "unavailable"
            );

            return;
        }

        if (
            error?.message ===
                "TURNSTILE_ELEMENT_MISSING"
            || error?.message ===
                "TURNSTILE_SCRIPT_LOAD_FAILED"
            || error?.message ===
                "TURNSTILE_API_UNAVAILABLE"
        ) {
            showStatus(
                "Human verification is currently unavailable.",
                "error"
            );

            setPageState(
                "unavailable"
            );

            return;
        }

        throw error;
    }
}

/* =========================================================
LOAD LOGIN STATE
========================================================= */

async function loadLoginState(
    {
        force = false
    } = {}
) {
    if (
        redirecting
    ) {
        return;
    }

    clearStatus();

    sessionReady =
        false;

    setProviderButtonsEnabled(
        false
    );

    setPageState(
        "loading"
    );

    if (
        navigator.onLine ===
        false
    ) {
        showStatus(
            "You are offline. Sign in is unavailable.",
            "error"
        );

        setPageState(
            "offline"
        );

        return;
    }

    try {
        const authState =
            await getAuthState({
                force
            });

        await applyAuthState(
            authState
        );
    }
    catch (
        error
    ) {
        console.error(
            "LOGIN PAGE: Failed to load authentication state.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        showStatus(
            navigator.onLine ===
                false
                ? "You are offline. Sign in is unavailable."
                : "BPD authentication services are currently unavailable.",
            "error"
        );

        setPageState(
            navigator.onLine ===
                false
                ? "offline"
                : "unavailable"
        );
    }
}

/* =========================================================
CENTRAL AUTH STATE CHANGE
========================================================= */

function handleAuthStateChanged(
    authState
) {
    void applyAuthState(
        authState
    );
}

/* =========================================================
NETWORK STATUS
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
    ) {
        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        showStatus(
            "You are offline. Sign in is unavailable.",
            "error"
        );

        setPageState(
            "offline"
        );

        return;
    }

    if (
        online ===
            true
        && apiReady ===
            false
    ) {
        sessionReady =
            false;

        setProviderButtonsEnabled(
            false
        );

        showStatus(
            "BPD authentication services are currently unavailable.",
            "error"
        );

        setPageState(
            "unavailable"
        );

        return;
    }

    if (
        online ===
            true
        && apiReady ===
            true
    ) {
        void loadLoginState({
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
        if (turnstileWidgetId !== null && window.turnstile?.remove) {
            window.turnstile.remove(turnstileWidgetId);
        }
        turnstileWidgetId = null;
        captchaToken = "";
        redirecting = false;
        initializedPage = page;
        initializeProviderIcons();
        registerProviderEvents();
        if (!unsubscribeAuthState) registerGlobalEvents();
    }
    await loadLoginState();
    showOAuthCallbackError();
}
