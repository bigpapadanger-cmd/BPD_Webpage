"use strict";

/* =========================================================
BPD GAMING NETWORK
CENTRALIZED CLIENT AUTH SERVICE

File:
    /Framework/Auth/auth.js

Purpose:
    Provides the centralized client-side authentication and
    authorization state service for the BPD Gaming Network.

Description:
    - Loads the global BPD session.
    - Loads current Discord-backed Admin authorization for
      authenticated active accounts.
    - Normalizes all public authentication state.
    - Keeps global account roles separate from Admin
      responsibility roles.
    - Caches current authentication state.
    - Deduplicates simultaneous refresh requests.
    - Distinguishes signed-out state from service failure.
    - Distinguishes ordinary non-Admin users from Admin
      authorization-service failure.
    - Exposes account, provider, Admin, and route helpers.
    - Dispatches one canonical auth-state change event.
    - Provides explicit refresh and invalidation controls.

Security:
    - This module is NOT a security boundary.
    - Client-side authorization controls navigation and UI.
    - Protected APIs MUST independently enforce authorization.
    - Global account roles and Admin responsibility roles are
      separate authorization domains.
    - Admin authorization is accepted only from:
          GET /api/auth/admin/access
    - Browser-derived role information is never authoritative.
    - Admin access is fail-closed in the UI.

Global Session Endpoint:
    BPD_AUTH_SESSION_URL
        /api/auth/session

Admin Access Endpoint:
    ADMIN_ACCESS_URL
        /api/auth/admin/access

Important:
    - authenticated:false is a confirmed signed-out state.
    - Session HTTP/network failure is NOT treated as logout.
    - Admin 401/403 means authenticated user is not currently
      authorized for Admin.
    - Admin HTTP 5xx/network failure means Admin authorization
      is unavailable, not that the BPD session is invalid.
    - This module is the only client module that should load
      /api/auth/session directly.
    - Admin responsibility roles:
          owner
          database
          security
          ui
    - state.role is the GLOBAL BPD account role.
    - state.admin.roles are Admin responsibility roles.
========================================================= */

import {
    BPD_AUTH_SESSION_URL,
    ROCKET_LEAGUE_SESSION_URL,
    ADMIN_ACCESS_URL
} from "/scripts/apiRoutes.js";

/* =========================================================
CONSTANTS
========================================================= */

const AUTH_STATE_EVENT =
    "bpd:auth-state-changed";

const DEFAULT_CACHE_TTL_MS =
    15_000;

const ADMIN_RESPONSIBILITY_ROLES =
    Object.freeze([
        "owner",
        "database",
        "security",
        "ui"
    ]);

const ADMIN_RESPONSIBILITY_ROLE_SET =
    new Set(
        ADMIN_RESPONSIBILITY_ROLES
    );

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
    return typeof value ===
        "string"
        ? value.trim()
        : "";
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

function normalizePermissionList(
    permissions
) {
    if (
        !Array.isArray(
            permissions
        )
    ) {
        return [];
    }

    const normalized =
        [];

    for (
        const permission
        of permissions
    ) {
        const value =
            normalizeString(
                permission
            );

        if (
            !value
            || normalized.includes(
                value
            )
        ) {
            continue;
        }

        normalized.push(
            value
        );
    }

    return normalized;
}

function normalizeAdminRoleList(
    roles
) {
    if (
        !Array.isArray(
            roles
        )
    ) {
        return [];
    }

    const roleSet =
        new Set();

    for (
        const role
        of roles
    ) {
        const normalizedRole =
            normalizeRole(
                role
            );

        if (
            ADMIN_RESPONSIBILITY_ROLE_SET.has(
                normalizedRole
            )
        ) {
            roleSet.add(
                normalizedRole
            );
        }
    }

    /*
     * Return roles in one deterministic order regardless of
     * server/database ordering.
     */
    return ADMIN_RESPONSIBILITY_ROLES.filter(
        role =>
            roleSet.has(
                role
            )
    );
}

/* =========================================================
ADMIN STATE FACTORIES
========================================================= */

function createUnknownAdminState() {
    return {
        checked:
            false,

        available:
            null,

        authorized:
            false,

        staff:
            false,

        isAdmin:
            false,

        isModerator:
            false,

        isLeagueStaff:
            false,

        permissions:
            [],

        roles:
            [],

        isOwner:
            false,

        error:
            null
    };
}

function createDeniedAdminState() {
    return {
        ...createUnknownAdminState(),

        checked:
            true,

        available:
            true,

        authorized:
            false
    };
}

function createUnavailableAdminState(
    error = null
) {
    return {
        ...createUnknownAdminState(),

        checked:
            true,

        available:
            false,

        error: {
            code:
                normalizeNullableString(
                    error?.code
                )
                || "ADMIN_ACCESS_UNAVAILABLE",

            message:
                normalizeNullableString(
                    error?.message
                )
                || "Admin authorization is temporarily unavailable.",

            status:
                Number.isInteger(
                    error?.status
                )
                    ? error.status
                    : null
        }
    };
}

/* =========================================================
AUTH STATE FACTORIES
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

        admin:
            createUnknownAdminState(),

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

        /*
         * Admin authorization is conclusively unavailable
         * because there is no authenticated BPD account.
         */
        admin:
            createDeniedAdminState(),

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

        admin:
            createUnknownAdminState(),

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
        linked
        && (
            providerData
                ?.requiresReauthorization ===
                true
            || !authorized
        );

    return {
        provider:
            name,

        linked,

        authenticated,

        authorized,

        requiresReauthorization,

        reauthorizationReason:
            normalizeNullableString(
                providerData
                    ?.reauthorizationReason
            ),

        accountId:
            normalizeNullableString(
                providerData
                    ?.accountId
            ),

        displayName:
            normalizeNullableString(
                providerData
                    ?.displayName
            ),

        preferredUsername:
            normalizeNullableString(
                providerData
                    ?.preferredUsername
            ),

        email:
            normalizeNullableString(
                providerData
                    ?.email
            ),

        authenticatedAt:
            normalizeTimestamp(
                providerData
                    ?.authenticatedAt
            ),

        linkedAt:
            normalizeTimestamp(
                providerData
                    ?.linkedAt
            ),

        expiresAt:
            normalizeTimestamp(
                providerData
                    ?.expiresAt
            ),

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

    return {
        status:
            "authenticated",

        available:
            true,

        authenticated:
            true,

        userId:
            normalizeNullableString(
                data?.user?.userId
            ),

        displayName:
            normalizeNullableString(
                data?.user?.displayName
            ),

        role:
            normalizeRole(
                data?.user?.role
            )
            || null,

        active:
            data?.user?.active ===
            true,

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
                    data?.session
                        ?.absoluteExpiresAt
                )
        },

        admin:
            createUnknownAdminState(),

        error:
            null,

        loadedAt:
            Date.now()
    };
}

/* =========================================================
PUBLIC AUTH RESPONSE NORMALIZATION
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
        const error =
            new Error(
                "Authentication response was invalid."
            );

        error.code =
            "AUTH_RESPONSE_INVALID";

        throw error;
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
ADMIN RESPONSE NORMALIZATION
========================================================= */

function normalizeAdminResponse(
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
        const error =
            new Error(
                "Admin authorization response was invalid."
            );

        error.code =
            "ADMIN_ACCESS_RESPONSE_INVALID";

        throw error;
    }

    /*
     * A successful Admin authorization must satisfy the
     * complete server response contract.
     *
     * Fail closed if any required condition is absent.
     */
    if (
        data.success !==
            true
        || data.authorized !==
            true
        || data?.taskboard?.member !==
            true
    ) {
        return createDeniedAdminState();
    }

    const roles =
        normalizeAdminRoleList(
            data?.taskboard?.roles
        );

    /*
     * The server contract requires at least one active
     * responsibility role for all Admin access.
     */
    if (
        roles.length ===
        0
    ) {
        return createDeniedAdminState();
    }

    return {
        checked:
            true,

        available:
            true,

        authorized:
            true,

        staff:
            data?.admin?.staff ===
            true,

        isAdmin:
            data?.admin?.isAdmin ===
            true,

        isModerator:
            data?.admin?.isModerator ===
            true,

        isLeagueStaff:
            data?.admin
                ?.isLeagueStaff ===
            true,

        permissions:
            normalizePermissionList(
                data?.admin?.permissions
            ),

        roles,

        isOwner:
            roles.includes(
                "owner"
            ),

        error:
            null
    };
}

/* =========================================================
STATE CLONE
========================================================= */

function cloneAdminState(
    admin
) {
    const source =
        admin
        && typeof admin ===
            "object"
        && !Array.isArray(
            admin
        )
            ? admin
            : createUnknownAdminState();

    return {
        ...source,

        permissions:
            Array.isArray(
                source.permissions
            )
                ? [
                    ...source.permissions
                ]
                : [],

        roles:
            Array.isArray(
                source.roles
            )
                ? [
                    ...source.roles
                ]
                : [],

        error:
            source.error
                ? {
                    ...source.error
                }
                : null
    };
}

function cloneAuthState(
    state
) {
    const source =
        state
        && typeof state ===
            "object"
        && !Array.isArray(
            state
        )
            ? state
            : createUnknownAuthState();

    return {
        ...source,

        providers: {
            ...(
                source.providers
                || {}
            )
        },

        linkedProviders: [
            ...(
                Array.isArray(
                    source.linkedProviders
                )
                    ? source.linkedProviders
                    : []
            )
        ],

        authenticatedProviders: [
            ...(
                Array.isArray(
                    source.authenticatedProviders
                )
                    ? source
                        .authenticatedProviders
                    : []
            )
        ],

        session: {
            ...(
                source.session
                || {}
            )
        },

        admin:
            cloneAdminState(
                source.admin
            ),

        error:
            source.error
                ? {
                    ...source.error
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
        cloneAuthState(
            state
        );

    if (
        Number.isFinite(
            currentState
                ?.loadedAt
        )
    ) {
        lastLoadedAt =
            currentState.loadedAt;
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
LOAD GLOBAL SESSION
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
        cause
    ) {
        const error =
            new Error(
                "Authentication service is unavailable."
            );

        error.code =
            "AUTH_NETWORK_ERROR";

        error.cause =
            cause;

        throw error;
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
LOAD ADMIN ACCESS

Every fresh authenticated account load performs this check.

The Admin endpoint is responsible for:
    - Live Discord identity/guild verification.
    - Current Discord staff authorization.
    - Current responsibility-role evaluation.
    - Synchronizing responsibility roles into Supabase.
    - Requiring active responsibility membership.

401 / 403:
    Valid authoritative denial.

5xx / network:
    Admin authorization unavailable.

Neither result invalidates an otherwise valid global BPD
session.
========================================================= */

async function loadAdminAccessFromServer() {
    let response;

    try {
        response =
            await fetch(
                ADMIN_ACCESS_URL,
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
        cause
    ) {
        return createUnavailableAdminState({
            code:
                "ADMIN_ACCESS_NETWORK_ERROR",

            message:
                "Admin authorization is temporarily unavailable.",

            cause
        });
    }

    let data =
        null;

    try {
        data =
            await response.json();
    }
    catch {
        return createUnavailableAdminState({
            code:
                "ADMIN_ACCESS_RESPONSE_INVALID",

            message:
                "Admin authorization returned an invalid response.",

            status:
                response.status
        });
    }

    /*
     * 401 and 403 are normal authoritative denial states.
     *
     * Do not log them as application failures and do not
     * mark global authentication unavailable.
     */
    if (
        response.status ===
            401
        || response.status ===
            403
    ) {
        return createDeniedAdminState();
    }

    if (
        !response.ok
    ) {
        return createUnavailableAdminState({
            code:
                normalizeNullableString(
                    data?.error
                )
                || "ADMIN_ACCESS_REQUEST_FAILED",

            message:
                "Admin authorization is temporarily unavailable.",

            status:
                response.status
        });
    }

    try {
        return normalizeAdminResponse(
            data
        );
    }
    catch (
        error
    ) {
        return createUnavailableAdminState({
            code:
                error?.code
                || "ADMIN_ACCESS_RESPONSE_INVALID",

            message:
                error?.message
                || "Admin authorization returned an invalid response.",

            status:
                response.status
        });
    }
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
     * All callers share one complete refresh operation:
     *
     *     global session
     *         +
     *     Admin authorization when applicable
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
                    let nextState =
                        await loadSessionFromServer();

                    /*
                     * Only an authenticated active canonical
                     * account can possibly have Admin access.
                     *
                     * Do not waste a Discord/Admin request for
                     * signed-out or inactive accounts.
                     */
                    if (
                        nextState.authenticated ===
                            true
                        && nextState.active ===
                            true
                        && normalizeString(
                            nextState.userId
                        )
                    ) {
                        const adminState =
                            await loadAdminAccessFromServer();

                        nextState = {
                            ...nextState,

                            admin:
                                adminState,

                            /*
                             * loadedAt represents completion
                             * of the complete global client
                             * authorization refresh.
                             */
                            loadedAt:
                                Date.now()
                        };
                    }

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
    return state?.available ===
        true;
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
GLOBAL ACCOUNT ROLE HELPERS

These helpers operate ONLY on the global BPD account role.

They MUST NOT be used for Discord/Admin responsibility roles.
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

    return normalizeRole(
        state?.role
    ) === expectedRole;
}

/* =========================================================
ADMIN HELPERS
========================================================= */

export function isAdminAccessAvailable(
    state =
        currentState
) {
    return (
        hasActiveAccount(
            state
        )
        && state?.admin?.checked ===
            true
        && state?.admin?.available ===
            true
    );
}

export function hasAdminAccess(
    state =
        currentState
) {
    return (
        isAdminAccessAvailable(
            state
        )
        && state?.admin?.authorized ===
            true
    );
}

export function hasAdminPermission(
    permission,
    state =
        currentState
) {
    const expectedPermission =
        normalizeString(
            permission
        );

    if (
        !expectedPermission
        || !hasAdminAccess(
            state
        )
    ) {
        return false;
    }

    return state
        ?.admin
        ?.permissions
        ?.includes(
            expectedPermission
        ) === true;
}

export function hasAdminResponsibilityRole(
    role,
    state =
        currentState
) {
    const expectedRole =
        normalizeRole(
            role
        );

    if (
        !ADMIN_RESPONSIBILITY_ROLE_SET.has(
            expectedRole
        )
        || !hasAdminAccess(
            state
        )
    ) {
        return false;
    }

    return state
        ?.admin
        ?.roles
        ?.includes(
            expectedRole
        ) === true;
}

export function getAdminResponsibilityRoles(
    state =
        currentState
) {
    if (
        !hasAdminAccess(
            state
        )
    ) {
        return [];
    }

    return [
        ...state.admin.roles
    ];
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

    return state?.providers
        ?.[providerName]
        || null;
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
            ) ===
                true
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

    const context =
        getProvider(
            provider,
            state
        );

    const expiresAt =
        normalizeTimestamp(
            context?.expiresAt
        );

    return (
        context?.linked ===
            true
        && context?.authorized ===
            true
        && context
            ?.requiresReauthorization !==
            true
        && expiresAt !==
            null
        && expiresAt >
            Date.now()
    );
}

export function requiresProviderReauthorization(
    provider,
    state =
        currentState
) {
    return (
        hasActiveAccount(
            state
        )
        && hasLinkedProvider(
            provider,
            state
        )
        && !hasAuthorizedProvider(
            provider,
            state
        )
    );
}

export function hasAuthenticatedProvider(
    provider,
    state =
        currentState
) {
    return hasAuthorizedProvider(
        provider,
        state
    );
}

export function hasProfileAuthorization(
    state =
        currentState
) {
    return [
        "epic",
        "google",
        "discord"
    ]
        .some(
            provider =>
                hasAuthorizedProvider(
                    provider,
                    state
                )
        );
}

/* =========================================================
ROUTE AUTH REQUIREMENTS
========================================================= */

function normalizeRouteAuthRequirements(
    requirements
) {
    const input =
        requirements ===
            true
            ? {
                required:
                    true
            }
            : requirements
                || {};

    return {
        required:
            input.required ===
            true,

        provider:
            normalizeProviderName(
                input.provider
            )
            || null,

        role:
            normalizeRole(
                input.role
            )
            || null,

        recovery:
            input.recovery ===
            true,

        rocketLeague:
            input.rocketLeague ===
            true
    };
}

/* =========================================================
ROUTE AUTH EVALUATION

Important:
    This evaluates global BPD route requirements.

    Admin routes should additionally require:
        hasAdminAccess(state) === true

    Server APIs remain authoritative.
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
        policy.recovery
        && state?.available !==
            true
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
        policy.recovery
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

    if (
        policy.provider
        && !hasAuthorizedProvider(
            policy.provider,
            state
        )
    ) {
        return {
            allowed:
                false,

            status:
                "provider_reauthorization_required",

            requiredProvider:
                policy.provider,

            reason:
                "Provider verification is required.",

            policy
        };
    }

    if (
        !policy.recovery
        && !hasProfileAuthorization(
            state
        )
    ) {
        return {
            allowed:
                false,

            status:
                "profile_provider_required",

            reason:
                "Verify an Epic, Google, or Discord provider.",

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

    let evaluation =
        evaluateRouteAuth(
            requirements,
            state
        );

    if (
        evaluation.allowed
        && requirements?.rocketLeague ===
            true
    ) {
        try {
            const response =
                await fetch(
                    ROCKET_LEAGUE_SESSION_URL,
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

            let result;

            try {
                result =
                    await response.json();
            }
            catch {
                throw new Error(
                    "Rocket League authorization returned an invalid response."
                );
            }

            if (
                response.status >=
                    500
                || result?.available ===
                    false
                || result?.profileError
            ) {
                throw new Error(
                    "Rocket League authorization is unavailable."
                );
            }

            if (
                result?.authenticated ===
                false
            ) {
                evaluation = {
                    allowed:
                        false,

                    status:
                        "signed_out"
                };
            }
            else if (
                result
                    ?.requiresEpicReauthorization
            ) {
                evaluation = {
                    allowed:
                        false,

                    status:
                        "provider_reauthorization_required",

                    requiredProvider:
                        "epic"
                };
            }
            else if (
                result?.requiresEpicLogin
            ) {
                evaluation = {
                    allowed:
                        false,

                    status:
                        "provider_required",

                    requiredProvider:
                        "epic"
                };
            }
            else if (
                !response.ok
                || result
                    ?.rocketLeagueAccess !==
                    true
            ) {
                evaluation = {
                    allowed:
                        false,

                    status:
                        "rl_registration_required"
                };
            }
        }
        catch {
            evaluation = {
                allowed:
                    false,

                status:
                    "unavailable",

                reason:
                    "Rocket League authorization is unavailable. Please retry."
            };
        }
    }

    return {
        state,
        evaluation
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

A forced refresh now refreshes BOTH:

    global BPD session
    Admin authorization

Therefore login/provider changes automatically re-evaluate
current Discord-backed Admin access.
========================================================= */

export async function notifyAuthChanged() {
    lastLoadedAt =
        0;

    return refreshAuthState({
        force:
            true
    });
}