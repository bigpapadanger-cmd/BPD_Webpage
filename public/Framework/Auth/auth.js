"use strict";

/* =========================================================
BPD GAMING NETWORK
CENTRALIZED CLIENT AUTH SERVICE

File:
    /Framework/Auth/auth.js

Purpose:
    Provides one centralized client-side authentication and
    authorization state service for the BPD Gaming Network.

Description:
    - Loads the global BPD session through the centralized
      client API route registry.
    - Normalizes the public authentication response.
    - Caches the current authentication state.
    - Deduplicates simultaneous session requests.
    - Distinguishes confirmed signed-out state from
      authentication-service unavailability.
    - Exposes account, provider, and role helpers.
    - Evaluates client-side route authorization requirements.
    - Dispatches one canonical auth-state change event.
    - Provides explicit refresh and invalidation controls.

Security:
    - This module is NOT a security boundary.
    - Client-side authorization controls navigation and UI
      only.
    - Protected APIs must independently enforce authorization
      on the server.
    - Provider state exposed here may be cached session state.
    - Server-side provider authorization must verify the
      canonical provider identity against Supabase.

Session Endpoint:
    BPD_AUTH_SESSION_URL
        /api/auth/session

Session Contract:
    Authenticated:
        HTTP 200
        {
            success: true,
            authenticated: true,
            user: {
                userId,
                displayName,
                role,
                active
            },
            providers,
            linkedProviders,
            authenticatedProviders,
            session
        }

    Signed Out:
        HTTP 200
        {
            success: true,
            authenticated: false
        }

    Unavailable:
        HTTP 5xx or network failure

Important:
    - authenticated:false is a confirmed signed-out state.
    - API/network failure is NOT treated as signed out.
    - Route code must never redirect to Login merely because
      authentication could not be checked.
    - This module is the only client module that should load
      /api/auth/session directly.
========================================================= */

import {
    BPD_AUTH_SESSION_URL
} from "/scripts/apiRoutes.js";

/* =========================================================
CONSTANTS
========================================================= */

const AUTH_STATE_EVENT =
    "bpd:auth-state-changed";

const DEFAULT_CACHE_TTL_MS =
    15_000;

/* =========================================================
INTERNAL STATE
========================================================= */

let currentState =
    createUnknownAuthState();

let currentRequest =
    null;

let lastLoadedAt =
    0;

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

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
}

function normalizeProviderName(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

function normalizeRole(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

function normalizeTimestamp(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    if (
        typeof value ===
        "number"
        && Number.isFinite(
            value
        )
    ) {
        return value;
    }

    const stringValue =
        normalizeString(
            String(
                value
            )
        );

    if (
        !stringValue
    ) {
        return null;
    }

    /*
     * Preserve numeric timestamp strings.
     */
    const numericValue =
        Number(
            stringValue
        );

    if (
        Number.isFinite(
            numericValue
        )
    ) {
        return numericValue;
    }

    /*
     * Support ISO timestamps returned by provider auth state.
     */
    const parsedValue =
        Date.parse(
            stringValue
        );

    return Number.isFinite(
        parsedValue
    )
        ? parsedValue
        : null;
}

/* =========================================================
STATE FACTORIES
========================================================= */

function createUnknownAuthState() {
    return {
        status:
            "unknown",

        available:
            null,

        authenticated:
            null,

        userId:
            null,

        displayName:
            null,

        role:
            null,

        active:
            false,

        providers:
            {},

        linkedProviders:
            [],

        authenticatedProviders:
            [],

        session: {
            createdAt:
                null,

            lastSeenAt:
                null,

            absoluteExpiresAt:
                null
        },

        error:
            null,

        loadedAt:
            null
    };
}

function createLoadingAuthState(
    previousState
) {
    return {
        ...previousState,

        status:
            "loading",

        error:
            null
    };
}

function createSignedOutAuthState() {
    return {
        status:
            "signed_out",

        available:
            true,

        authenticated:
            false,

        userId:
            null,

        displayName:
            null,

        role:
            null,

        active:
            false,

        providers:
            {},

        linkedProviders:
            [],

        authenticatedProviders:
            [],

        session: {
            createdAt:
                null,

            lastSeenAt:
                null,

            absoluteExpiresAt:
                null
        },

        error:
            null,

        loadedAt:
            Date.now()
    };
}

function createUnavailableAuthState(
    error = null
) {
    return {
        status:
            "unavailable",

        available:
            false,

        authenticated:
            null,

        userId:
            null,

        displayName:
            null,

        role:
            null,

        active:
            false,

        providers:
            {},

        linkedProviders:
            [],

        authenticatedProviders:
            [],

        session: {
            createdAt:
                null,

            lastSeenAt:
                null,

            absoluteExpiresAt:
                null
        },

        error: {
            code:
                normalizeNullableString(
                    error?.code
                )
                || "AUTH_UNAVAILABLE",

            message:
                normalizeNullableString(
                    error?.message
                )
                || "Authentication status is temporarily unavailable.",

            status:
                Number.isInteger(
                    error?.status
                )
                    ? error.status
                    : null
        },

        loadedAt:
            Date.now()
    };
}

/* =========================================================
PROVIDER NORMALIZATION
========================================================= */

function normalizeProvider(
    providerName,
    providerData
) {
    const name =
        normalizeProviderName(
            providerData?.provider
            || providerName
        );

    if (
        !name
    ) {
        return null;
    }

    const linked =
        providerData?.linked ===
        true;

    const authenticated =
        providerData?.authenticated ===
        true;

    const authorized =
        providerData?.authorized ===
        true;

    const requiresReauthorization =
        linked ===
            true
        && providerData
            ?.requiresReauthorization ===
            true;

    return {
        provider:
            name,

        /*
         * Permanent linkage.
         *
         * Source:
         * Supabase identity.account_identities
         */
        linked,

        /*
         * Current temporary provider authentication state.
         *
         * Source:
         * Cloudflare KV freshness policy.
         */
        authenticated,

        authorized,

        requiresReauthorization,

        reauthorizationReason:
            normalizeNullableString(
                providerData
                    ?.reauthorizationReason
            ),

        /*
         * External provider subject / account identifier.
         */
        accountId:
            normalizeNullableString(
                providerData?.accountId
            ),

        displayName:
            normalizeNullableString(
                providerData?.displayName
            ),

        preferredUsername:
            normalizeNullableString(
                providerData
                    ?.preferredUsername
            ),

        email:
            normalizeNullableString(
                providerData?.email
            ),

        /*
         * Successful provider authentication timestamp.
         */
        authenticatedAt:
            normalizeTimestamp(
                providerData
                    ?.authenticatedAt
            ),

        /*
         * Permanent provider-link timestamp.
         */
        linkedAt:
            normalizeTimestamp(
                providerData?.linkedAt
            ),

        /*
         * Firm provider authentication expiration.
         */
        expiresAt:
            normalizeTimestamp(
                providerData?.expiresAt
            ),

        /*
         * Account-wide login-gap cutoff.
         */
        providerReauthAfter:
            normalizeTimestamp(
                providerData
                    ?.providerReauthAfter
            )
    };
}

function normalizeProviders(
    providers
) {
    if (
        !providers
        || typeof providers !==
            "object"
        || Array.isArray(
            providers
        )
    ) {
        return {};
    }

    const normalized =
        {};

    for (
        const [
            providerName,
            providerData
        ]
        of Object.entries(
            providers
        )
    ) {
        const provider =
            normalizeProvider(
                providerName,
                providerData
            );

        if (
            !provider
        ) {
            continue;
        }

        normalized[
            provider.provider
        ] =
            provider;
    }

    return normalized;
}

/* =========================================================
PROVIDER LIST NORMALIZATION
========================================================= */

function normalizeProviderList(
    providers
) {
    if (
        !Array.isArray(
            providers
        )
    ) {
        return [];
    }

    const normalized =
        [];

    for (
        const provider
        of providers
    ) {
        const providerName =
            normalizeProviderName(
                provider
            );

        if (
            !providerName
            || normalized.includes(
                providerName
            )
        ) {
            continue;
        }

        normalized.push(
            providerName
        );
    }

    return normalized;
}

/* =========================================================
AUTHENTICATED RESPONSE NORMALIZATION
========================================================= */

function normalizeAuthenticatedResponse(
    data
) {
    const providers =
        normalizeProviders(
            data?.providers
        );

    const linkedProviders =
        normalizeProviderList(
            data?.linkedProviders
        );

    const authenticatedProviders =
        normalizeProviderList(
            data?.authenticatedProviders
        );

    const userId =
        normalizeNullableString(
            data?.user?.userId
        );

    const displayName =
        normalizeNullableString(
            data?.user?.displayName
        );

    const role =
        normalizeRole(
            data?.user?.role
        )
        || null;

    const active =
        data?.user?.active ===
        true;

    return {
        status:
            "authenticated",

        available:
            true,

        authenticated:
            true,

        userId,

        displayName,

        role,

        active,

        providers,

        linkedProviders,

        authenticatedProviders,

        session: {
            createdAt:
                normalizeTimestamp(
                    data?.session?.createdAt
                ),

            lastSeenAt:
                normalizeTimestamp(
                    data?.session?.lastSeenAt
                ),

            absoluteExpiresAt:
                normalizeTimestamp(
                    data?.session?.absoluteExpiresAt
                )
        },

        error:
            null,

        loadedAt:
            Date.now()
    };
}

/* =========================================================
PUBLIC RESPONSE NORMALIZATION
========================================================= */

function normalizeAuthResponse(
    data
) {
    if (
        !data
        || typeof data !==
            "object"
        || Array.isArray(
            data
        )
    ) {
        throw new Error(
            "Authentication response was invalid."
        );
    }

    if (
        data.success !==
        true
    ) {
        const error =
            new Error(
                normalizeString(
                    data.message
                )
                || "Authentication status could not be loaded."
            );

        error.code =
            normalizeString(
                data.code
            )
            || "AUTH_SESSION_LOAD_FAILED";

        throw error;
    }

    if (
        data.authenticated !==
        true
    ) {
        return createSignedOutAuthState();
    }

    return normalizeAuthenticatedResponse(
        data
    );
}

/* =========================================================
STATE CLONE
========================================================= */

function cloneAuthState(
    state
) {
    return {
        ...state,

        providers: {
            ...state.providers
        },

        linkedProviders: [
            ...state.linkedProviders
        ],

        authenticatedProviders: [
            ...state.authenticatedProviders
        ],

        session: {
            ...state.session
        },

        error:
            state.error
                ? {
                    ...state.error
                }
                : null
    };
}

/* =========================================================
STATE EVENT
========================================================= */

function dispatchAuthStateChanged() {
    document.dispatchEvent(
        new CustomEvent(
            AUTH_STATE_EVENT,
            {
                detail: {
                    state:
                        cloneAuthState(
                            currentState
                        )
                }
            }
        )
    );
}

/* =========================================================
SET STATE
========================================================= */

function setAuthState(
    state,
    {
        dispatch = true
    } = {}
) {
    currentState =
        state;

    if (
        Number.isFinite(
            state?.loadedAt
        )
    ) {
        lastLoadedAt =
            state.loadedAt;
    }

    if (
        dispatch
    ) {
        dispatchAuthStateChanged();
    }

    return cloneAuthState(
        currentState
    );
}

/* =========================================================
CACHE
========================================================= */

function isCacheFresh(
    maxAge =
        DEFAULT_CACHE_TTL_MS
) {
    if (
        !lastLoadedAt
    ) {
        return false;
    }

    if (
        currentState.status ===
        "unknown"
        || currentState.status ===
            "loading"
    ) {
        return false;
    }

    return (
        Date.now()
        - lastLoadedAt
    ) < maxAge;
}

/* =========================================================
LOAD SESSION
========================================================= */

async function loadSessionFromServer() {
    let response;

    try {
        response =
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
    }
    catch (
        error
    ) {
        const networkError =
            new Error(
                "Authentication service is unavailable."
            );

        networkError.code =
            "AUTH_NETWORK_ERROR";

        networkError.cause =
            error;

        throw networkError;
    }

    let data =
        null;

    try {
        data =
            await response.json();
    }
    catch {
        const error =
            new Error(
                "Authentication service returned an invalid response."
            );

        error.code =
            "AUTH_RESPONSE_INVALID";

        error.status =
            response.status;

        throw error;
    }

    /*
     * /api/auth/session uses HTTP 200 for:
     *
     *     authenticated
     *     signed out
     *
     * A non-2xx response therefore means authentication
     * status is unavailable. It must not be treated as a
     * confirmed logout.
     */
    if (
        !response.ok
    ) {
        const error =
            new Error(
                normalizeString(
                    data?.message
                )
                || "Authentication service is unavailable."
            );

        error.code =
            normalizeString(
                data?.code
            )
            || "AUTH_SESSION_REQUEST_FAILED";

        error.status =
            response.status;

        throw error;
    }

    return normalizeAuthResponse(
        data
    );
}

/* =========================================================
REFRESH AUTH STATE
========================================================= */

export async function refreshAuthState(
    {
        force = false,
        dispatchLoading = false
    } = {}
) {
    if (
        !force
        && isCacheFresh()
    ) {
        return cloneAuthState(
            currentState
        );
    }

    /*
     * If another caller is already refreshing auth, reuse
     * that exact request.
     */
    if (
        currentRequest
    ) {
        return currentRequest;
    }

    if (
        dispatchLoading
    ) {
        setAuthState(
            createLoadingAuthState(
                currentState
            )
        );
    }

    currentRequest =
        (
            async () => {
                try {
                    const nextState =
                        await loadSessionFromServer();

                    return setAuthState(
                        nextState
                    );
                }
                catch (
                    error
                ) {
                    console.error(
                        "BPD AUTH: Session load failed.",
                        {
                            code:
                                error?.code
                                || null,

                            status:
                                error?.status
                                || null,

                            message:
                                error?.message
                                || "Unknown error"
                        }
                    );

                    return setAuthState(
                        createUnavailableAuthState(
                            error
                        )
                    );
                }
                finally {
                    currentRequest =
                        null;
                }
            }
        )();

    return currentRequest;
}

/* =========================================================
GET AUTH STATE
========================================================= */

export async function getAuthState(
    {
        force = false,
        maxAge =
            DEFAULT_CACHE_TTL_MS
    } = {}
) {
    if (
        !force
        && isCacheFresh(
            maxAge
        )
    ) {
        return cloneAuthState(
            currentState
        );
    }

    return refreshAuthState({
        force
    });
}

/* =========================================================
PEEK AUTH STATE
========================================================= */

export function peekAuthState() {
    return cloneAuthState(
        currentState
    );
}

/* =========================================================
INVALIDATE AUTH STATE
========================================================= */

export function invalidateAuthState(
    {
        refresh = false
    } = {}
) {
    lastLoadedAt =
        0;

    if (
        refresh
    ) {
        return refreshAuthState({
            force:
                true
        });
    }

    return cloneAuthState(
        currentState
    );
}

/* =========================================================
RESET AUTH STATE
========================================================= */

export function resetAuthState() {
    currentRequest =
        null;

    lastLoadedAt =
        0;

    return setAuthState(
        createUnknownAuthState()
    );
}

/* =========================================================
AUTHENTICATION HELPERS
========================================================= */

export function isAuthAvailable(
    state =
        currentState
) {
    return (
        state?.available ===
        true
    );
}

export function isAuthenticated(
    state =
        currentState
) {
    return (
        state?.available ===
        true
        && state?.authenticated ===
            true
    );
}

export function hasActiveAccount(
    state =
        currentState
) {
    return (
        isAuthenticated(
            state
        )
        && Boolean(
            normalizeString(
                state?.userId
            )
        )
        && state?.active ===
            true
    );
}

/* =========================================================
ROLE HELPERS
========================================================= */

export function hasRole(
    role,
    state =
        currentState
) {
    const expectedRole =
        normalizeRole(
            role
        );

    if (
        !expectedRole
        || !hasActiveAccount(
            state
        )
    ) {
        return false;
    }

    return (
        normalizeRole(
            state?.role
        )
        === expectedRole
    );
}

/* =========================================================
PROVIDER HELPERS
========================================================= */

export function getProvider(
    provider,
    state =
        currentState
) {
    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        return null;
    }

    return (
        state?.providers
            ?.[
                providerName
            ]
        || null
    );
}

export function hasLinkedProvider(
    provider,
    state =
        currentState
) {
    if (
        !hasActiveAccount(
            state
        )
    ) {
        return false;
    }

    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        return false;
    }

    const providerContext =
        getProvider(
            providerName,
            state
        );

    return (
        providerContext?.linked ===
            true
        || state
            ?.linkedProviders
            ?.includes(
                providerName
            )
    );
}

export function hasAuthorizedProvider(
    provider,
    state =
        currentState
) {
    if (
        !hasActiveAccount(
            state
        )
    ) {
        return false;
    }

    const providerContext =
        getProvider(
            provider,
            state
        );

    return (
        providerContext?.linked ===
            true
        && providerContext?.authorized ===
            true
        && providerContext
            ?.requiresReauthorization !==
            true
    );
}

export function requiresProviderReauthorization(
    provider,
    state =
        currentState
) {
    if (
        !hasActiveAccount(
            state
        )
    ) {
        return false;
    }

    const providerContext =
        getProvider(
            provider,
            state
        );

    return (
        providerContext?.linked ===
            true
        && providerContext
            ?.requiresReauthorization ===
            true
    );
}

export function hasAuthenticatedProvider(
    provider,
    state =
        currentState
) {
    if (
        !hasActiveAccount(
            state
        )
    ) {
        return false;
    }

    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        return false;
    }

    const providerContext =
        getProvider(
            providerName,
            state
        );

    return (
        providerContext
            ?.authenticated ===
            true
        || state
            ?.authenticatedProviders
            ?.includes(
                providerName
            )
    );
}

/* =========================================================
ROUTE AUTH REQUIREMENTS
========================================================= */

function normalizeRouteAuthRequirements(
    requirements
) {
    if (
        requirements ===
        true
    ) {
        return {
            required:
                true,

            provider:
                null,

            role:
                null
        };
    }

    if (
        !requirements
        || typeof requirements !==
            "object"
        || Array.isArray(
            requirements
        )
    ) {
        return {
            required:
                false,

            provider:
                null,

            role:
                null
        };
    }

    return {
        required:
            requirements.required ===
            true,

        provider:
            normalizeProviderName(
                requirements.provider
            )
            || null,

        role:
            normalizeRole(
                requirements.role
            )
            || null
    };
}

/* =========================================================
ROUTE AUTH EVALUATION

Result statuses:
    allowed
    signed_out
    account_invalid
    provider_required
    role_required
    unavailable

Important:
    This is client navigation logic only.

    Server APIs must independently enforce the equivalent
    authorization policy.
========================================================= */

export function evaluateRouteAuth(
    requirements,
    state =
        currentState
) {
    const policy =
        normalizeRouteAuthRequirements(
            requirements
        );

    if (
        policy.required !==
            true
        && !policy.provider
        && !policy.role
    ) {
        return {
            allowed:
                true,

            status:
                "allowed",

            reason:
                null,

            policy
        };
    }

    if (
        state?.available !==
        true
    ) {
        return {
            allowed:
                false,

            status:
                "unavailable",

            reason:
                "Authentication status is unavailable.",

            policy
        };
    }

    if (
        state.authenticated !==
        true
    ) {
        return {
            allowed:
                false,

            status:
                "signed_out",

            reason:
                "Authentication is required.",

            policy
        };
    }

    if (
        !hasActiveAccount(
            state
        )
    ) {
        return {
            allowed:
                false,

            status:
                "account_invalid",

            reason:
                "The authenticated BPD account is unavailable or inactive.",

            policy
        };
    }

    if (
        policy.role
        && !hasRole(
            policy.role,
            state
        )
    ) {
        return {
            allowed:
                false,

            status:
                "role_required",

            reason:
                "The required account role is not available.",

            requiredRole:
                policy.role,

            policy
        };
    }

    if (
        policy.provider
        && !hasLinkedProvider(
            policy.provider,
            state
        )
    ) {
        return {
            allowed:
                false,

            status:
                "provider_required",

            reason:
                `A linked ${policy.provider} account is required.`,

            requiredProvider:
                policy.provider,

            policy
        };
    }

    return {
        allowed:
            true,

        status:
            "allowed",

        reason:
            null,

        policy
    };
}

/* =========================================================
ROUTE AUTH LOAD + EVALUATION
========================================================= */

export async function authorizeRoute(
    requirements,
    {
        force = false
    } = {}
) {
    const state =
        await getAuthState({
            force
        });

    return {
        state,

        evaluation:
            evaluateRouteAuth(
                requirements,
                state
            )
    };
}

/* =========================================================
AUTH EVENT SUBSCRIPTION
========================================================= */

export function subscribeToAuthState(
    listener
) {
    if (
        typeof listener !==
        "function"
    ) {
        return () => {};
    }

    const handler =
        event => {
            listener(
                event?.detail?.state
                || peekAuthState()
            );
        };

    document.addEventListener(
        AUTH_STATE_EVENT,
        handler
    );

    return () => {
        document.removeEventListener(
            AUTH_STATE_EVENT,
            handler
        );
    };
}

/* =========================================================
NOTIFY AUTH CHANGED

Use after a successful operation that changes authentication
or account identity state when the caller wants the shared
state refreshed immediately.

Examples:
    login completion
    provider link
    provider unlink
    profile/account mutation

This function does not emit a separate command event.
refreshAuthState() updates the canonical state and then emits
the normal bpd:auth-state-changed state event.
========================================================= */

export async function notifyAuthChanged() {
    lastLoadedAt =
        0;

    return refreshAuthState({
        force:
            true
    });
}