"use strict";

/* =========================================================
BPD GAMING NETWORK
SESSION CONTEXT SERVICE

Purpose:
    Converts the raw stored BPD session into a normalized,
    application-facing session context.

Responsibilities:
    - Load the stored session through the central session module.
    - Normalize core user identity.
    - Normalize provider state.
    - Expose common authentication helpers.
    - Hide the raw KV session structure from callers.

Important:
    - This file does NOT directly read/write AUTH_SESSIONS.
    - This file does NOT expose raw sessionData.
    - This file does NOT implement Rocket League access rules.
    - This file does NOT implement feature-specific authorization.
========================================================= */

import {
    getStoredSession
} from "./session.js";

/* =========================================================
CONSTANTS
========================================================= */

const SUPPORTED_AUTH_PROVIDERS = [
    "google",
    "epic",
    "discord",
    "steam",
    "xbox",
    "playstation"
];

/* =========================================================
NORMALIZATION HELPERS
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !== "string"
    ) {
        return null;
    }

    const normalized =
        value.trim();

    return normalized
        ? normalized
        : null;
}

function normalizeBoolean(
    value
) {
    return value === true;
}

function normalizeTimestamp(
    value
) {
    const timestamp =
        Number(
            value
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
}

function normalizeRole(
    value
) {
    const role =
        normalizeString(
            value
        );

    return role
        ? role.toLowerCase()
        : null;
}

/* =========================================================
PROVIDER NORMALIZATION
========================================================= */

function normalizeProviderData(
    provider,
    providerData
    ) {
    if (
        !providerData
        || typeof providerData !== "object"
        || Array.isArray(
            providerData
        )
    ) {
        return {
            provider,

            linked:
                false,

            authenticated:
                false,

            accountId:
                null,

            displayName:
                null,

            preferredUsername:
                null,

            email:
                null,

            authenticatedAt:
                null,

            linkedAt:
                null
        };
    }

    const accountId =
        normalizeString(
            providerData.AccountId
            ?? providerData.accountId
            ?? providerData.ProviderAccountId
            ?? providerData.providerAccountId
        );

    const linked =
        providerData.Linked === true
        || providerData.linked === true
        || Boolean(
            accountId
        );

    const authenticatedAt =
        normalizeTimestamp(
            providerData.AuthenticatedAt
            ?? providerData.authenticatedAt
        );

    return {
        provider,

        linked,

        authenticated:
            providerData.Authenticated === true
            || providerData.authenticated === true
            || Boolean(
                authenticatedAt
            ),

        accountId,

        displayName:
            normalizeString(
                providerData.DisplayName
                ?? providerData.displayName
            ),

        preferredUsername:
            normalizeString(
                providerData.PreferredUsername
                ?? providerData.preferredUsername
            ),

        email:
            normalizeString(
                providerData.Email
                ?? providerData.email
            ),

        authenticatedAt,

        linkedAt:
            normalizeTimestamp(
                providerData.LinkedAt
                ?? providerData.linkedAt
            )
    };
}

/* =========================================================
LEGACY PROVIDER SUPPORT
========================================================= */

function getLegacyEpicProvider(
    sessionData
) {
    const accountId =
        normalizeString(
            sessionData?.EpicUniqueId
        );

    if (
        !accountId
    ) {
        return null;
    }

    return {
        Linked:
            true,

        Authenticated:
            true,

        AccountId:
            accountId,

        DisplayName:
            normalizeString(
                sessionData?.EpicDisplayName
            ),

        PreferredUsername:
            normalizeString(
                sessionData?.EpicPreferredUsername
            ),

        AuthenticatedAt:
            normalizeTimestamp(
                sessionData?.EpicAuthenticatedAt
                ?? sessionData?.AuthenticatedAt
                ?? sessionData?.CreatedAt
            )
    };
}

/* =========================================================
PROVIDER SOURCE
========================================================= */

function getProviderSource(
    sessionData
) {
    const providers = {};

    const storedProviders =
        sessionData?.Providers;

    if (
        storedProviders
        && typeof storedProviders === "object"
        && !Array.isArray(
            storedProviders
        )
    ) {
        for (
            const [
                provider,
                providerData
            ]
            of Object.entries(
                storedProviders
            )
        ) {
            const normalizedProvider =
                normalizeString(
                    provider
                )
                    ?.toLowerCase();

            if (
                !normalizedProvider
            ) {
                continue;
            }

            providers[
                normalizedProvider
            ] =
                providerData;
        }
    }

    /*
    Temporary compatibility for existing Epic sessions.

    This allows old KV records containing:
        EpicUniqueId
        EpicDisplayName
        EpicPreferredUsername

    to appear to callers as:
        providers.epic
    */

    if (
        !providers.epic
    ) {
        const legacyEpic =
            getLegacyEpicProvider(
                sessionData
            );

        if (
            legacyEpic
        ) {
            providers.epic =
                legacyEpic;
        }
    }

    return providers;
}

/* =========================================================
NORMALIZE PROVIDERS
========================================================= */

function normalizeProviders(
    sessionData
) {
    const providerSource =
        getProviderSource(
            sessionData
        );

    const providers = {};

    for (
        const provider
        of SUPPORTED_AUTH_PROVIDERS
    ) {
        providers[
            provider
        ] =
            normalizeProviderData(
                provider,
                providerSource[
                    provider
                ]
            );
    }

    /*
    Preserve unknown providers so future provider additions
    do not immediately require changes here.
    */

    for (
        const [
            provider,
            providerData
        ]
        of Object.entries(
            providerSource
        )
    ) {
        const normalizedProvider =
            normalizeString(
                provider
            )
                ?.toLowerCase();

        if (
            !normalizedProvider
            || providers[
                normalizedProvider
            ]
        ) {
            continue;
        }

        providers[
            normalizedProvider
        ] =
            normalizeProviderData(
                normalizedProvider,
                providerData
            );
    }

    return providers;
}

/* =========================================================
PROVIDER LIST HELPERS
========================================================= */

function getLinkedProviders(
    providers
) {
    return Object.values(
        providers
    )
        .filter(
            provider =>
                provider.linked ===
                true
        )
        .map(
            provider =>
                provider.provider
        );
}

function getAuthenticatedProviders(
    providers
) {
    return Object.values(
        providers
    )
        .filter(
            provider =>
                provider.authenticated ===
                true
        )
        .map(
            provider =>
                provider.provider
        );
}

/* =========================================================
EMPTY CONTEXT
========================================================= */

export function createEmptySessionContext() {
    const providers =
        normalizeProviders(
            {}
        );

    return {
        authenticated:
            false,

        sessionId:
            null,

        userId:
            null,

        role:
            null,

        active:
            false,

        createdAt:
            null,

        lastSeenAt:
            null,

        absoluteExpiresAt:
            null,

        providers,

        linkedProviders:
            [],

        authenticatedProviders:
            []
    };
}

/* =========================================================
SESSION CONTEXT
========================================================= */

export async function getSessionContext(
    request,
    env
) {
    const storedSession =
        await getStoredSession(
            request,
            env
        );

    if (
        !storedSession
    ) {
        return createEmptySessionContext();
    }

    const sessionData =
        storedSession.sessionData;

    if (
        !sessionData
        || typeof sessionData !== "object"
        || Array.isArray(
            sessionData
        )
    ) {
        return createEmptySessionContext();
    }

    const providers =
        normalizeProviders(
            sessionData
        );

    const linkedProviders =
        getLinkedProviders(
            providers
        );

    const authenticatedProviders =
        getAuthenticatedProviders(
            providers
        );

    const userId =
        normalizeString(
            sessionData.UserId
            ?? sessionData.userId
        );

    const role =
        normalizeRole(
            sessionData.Role
            ?? sessionData.role
        );

    const activeValue =
        sessionData.Active
        ?? sessionData.active;

    const active =
        activeValue === undefined
        || activeValue === null
            ? true
            : normalizeBoolean(
                activeValue
            );

    return {
        authenticated:
            true,

        sessionId:
            storedSession.sessionId,

        userId,

        role,

        active,

        createdAt:
            normalizeTimestamp(
                sessionData.CreatedAt
                ?? sessionData.createdAt
            ),

        lastSeenAt:
            normalizeTimestamp(
                sessionData.LastSeenAt
                ?? sessionData.lastSeenAt
            ),

        absoluteExpiresAt:
            normalizeTimestamp(
                sessionData.AbsoluteExpiresAt
                ?? sessionData.absoluteExpiresAt
            ),

        providers,

        linkedProviders,

        authenticatedProviders
    };
}
/* =========================================================
COMMON SESSION HELPERS
========================================================= */

export function isAuthenticated(
    sessionContext
) {
    return (
        sessionContext?.authenticated ===
        true
    );
}

export function isActiveSession(
    sessionContext
) {
    return (
        sessionContext?.authenticated ===
        true
        && sessionContext?.active ===
        true
    );
}

export function hasUserIdentity(
    sessionContext
) {
    return Boolean(
        normalizeString(
            sessionContext?.userId
        )
    );
}

export function hasRole(
    sessionContext,
    role
) {
    const expectedRole =
        normalizeRole(
            role
        );

    if (
        !expectedRole
    ) {
        return false;
    }

    return (
        normalizeRole(
            sessionContext?.role
        )
        === expectedRole
    );
}

/* =========================================================
PROVIDER HELPERS
========================================================= */

export function getProviderContext(
    sessionContext,
    provider
) {
    const normalizedProvider =
        normalizeString(
            provider
        )
            ?.toLowerCase();

    if (
        !normalizedProvider
    ) {
        return null;
    }

    return (
        sessionContext
            ?.providers
            ?.[
                normalizedProvider
            ]
        || null
    );
}

export function hasLinkedProvider(
    sessionContext,
    provider
) {
    return (
        getProviderContext(
            sessionContext,
            provider
        )
            ?.linked ===
        true
    );
}

export function hasAuthenticatedProvider(
    sessionContext,
    provider
) {
    return (
        getProviderContext(
            sessionContext,
            provider
        )
            ?.authenticated ===
        true
    );
}

export function hasAnyAuthenticatedProvider(
    sessionContext
) {
    return (
        Array.isArray(
            sessionContext
                ?.authenticatedProviders
        )
        && sessionContext
            .authenticatedProviders
            .length > 0
    );
}

/* =========================================================
COMMON PROVIDER SHORTCUTS
========================================================= */

export function hasGoogleAccount(
    sessionContext
) {
    return hasLinkedProvider(
        sessionContext,
        "google"
    );
}

export function hasEpicAccount(
    sessionContext
) {
    return hasLinkedProvider(
        sessionContext,
        "epic"
    );
}

export function hasDiscordAccount(
    sessionContext
) {
    return hasLinkedProvider(
        sessionContext,
        "discord"
    );
}

export function hasSteamAccount(
    sessionContext
) {
    return hasLinkedProvider(
        sessionContext,
        "steam"
    );
}

/* =========================================================
AUTHORIZATION HELPERS
========================================================= */

export function isAdminSession(
    sessionContext
) {
    return (
        isActiveSession(
            sessionContext
        )
        && hasUserIdentity(
            sessionContext
        )
        && hasRole(
            sessionContext,
            "admin"
        )
    );
}

export function canUseGlobalAccountFeatures(
    sessionContext
) {
    return (
        isActiveSession(
            sessionContext
        )
        && hasUserIdentity(
            sessionContext
        )
    );
}