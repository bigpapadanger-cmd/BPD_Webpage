"use strict";

/* =========================================================
BPD GAMING NETWORK
SERVER AUTHORIZATION SERVICE

File:
    functions/services/auth/authorization.js

Purpose:
    Provides the centralized server-side authorization layer
    for protected BPD Gaming Network services.

Description:
    - Loads normalized BPD session context.
    - Verifies authenticated browser sessions.
    - Resolves canonical identity.accounts.id ownership.
    - Requires active global BPD accounts.
    - Verifies linked provider identities against Supabase.
    - Verifies provider authentication freshness against KV.
    - Enforces provider reauthorization requirements.
    - Supports global BPD account-role requirements.
    - Returns trusted server-derived authorization context.
    - Provides verified provider identities to downstream
      provider-specific authorization services.

Security Model:
    - Client-side route protection is UX only.
    - This service is part of the server-side security
      boundary.
    - identity.accounts.id comes only from trusted session
      context.
    - Provider identity ownership is verified against
      identity.account_identities through Supabase.
    - Provider authentication freshness is verified using
      trusted server-side KV state.
    - Provider subjects are never accepted from browsers.
    - Session provider state is convenience metadata only.
    - Verified provider identities come from Supabase.

Provider Authorization Model:
    - Supabase determines whether a provider is permanently
      linked to the canonical BPD account.
    - Cloudflare KV determines whether that provider must be
      authenticated again.
    - Provider authorization expires after the configured
      firm authentication lifetime.
    - A qualifying BPD login gap forces linked providers to
      individually authenticate again.

Role Model:
    - requirements.role refers ONLY to the global BPD account
      role stored in the canonical account/session context.
    - Discord guild roles are NOT handled here.
    - Discord guild authorization belongs in:
          services/auth/providers/discord/authorization.js
    - Admin/task/notification permissions belong in:
          services/admin/permissions.js

Dependency Direction:
    authorization.js
        -> provider_identity.js
        -> provider_auth_state.js

    discord/authorization.js
        -> authorization.js

    admin/permissions.js
        -> discord/authorization.js

Important:
    - A valid KV session does not automatically mean a valid
      canonical BPD account exists.
    - Protected account operations require:
          authenticated session
          + canonical userId
          + active account
    - Protected provider operations additionally require:
          active canonical provider identity in Supabase
          + valid provider authentication state in KV
    - 401 means authentication is required.
    - 403 means the authenticated account is not authorized
      or provider reauthentication is required.
    - 503 means an authoritative dependency could not be
      verified and access must fail closed.
========================================================= */

import {
    getSessionContext,
    hasRole
} from "./sessions/session_context.js";

import {
    verifyAccountProviderIdentity
} from "./providers/provider_identity.js";

import {
    getProviderAuthorizationState
} from "./providers/provider_auth_state.js";

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

function normalizeRole(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

/* =========================================================
AUTHORIZATION ERROR
========================================================= */

export class AuthorizationError extends Error {
    constructor(
        code,
        message,
        status = 403,
        details = null
    ) {
        super(
            message
        );

        this.name =
            "AuthorizationError";

        this.code =
            normalizeString(
                code
            )
            || "AUTHORIZATION_FAILED";

        this.status =
            Number.isInteger(
                status
            )
                ? status
                : 403;

        this.details =
            details;
    }
}

/* =========================================================
AUTHORIZATION CONTEXT
========================================================= */

function createAuthorizationContext(
    sessionContext
) {
    return {
        authorized:
            true,

        sessionId:
            normalizeString(
                sessionContext?.sessionId
            )
            || null,

        accountId:
            normalizeString(
                sessionContext?.userId
            )
            || null,

        /*
         * Global BPD account role.
         *
         * This is NOT a Discord guild role.
         */
        role:
            normalizeRole(
                sessionContext?.role
            )
            || null,

        active:
            sessionContext?.active ===
            true,

        providers:
            (
                sessionContext?.providers
                && typeof sessionContext.providers ===
                    "object"
                && !Array.isArray(
                    sessionContext.providers
                )
            )
                ? {
                    ...sessionContext.providers
                }
                : {},

        linkedProviders:
            Array.isArray(
                sessionContext
                    ?.linkedProviders
            )
                ? [
                    ...sessionContext
                        .linkedProviders
                ]
                : [],

        authenticatedProviders:
            Array.isArray(
                sessionContext
                    ?.authenticatedProviders
            )
                ? [
                    ...sessionContext
                        .authenticatedProviders
                ]
                : [],

        /*
         * Provider identities that have been authoritatively
         * verified against Supabase AND confirmed as currently
         * authorized through provider-auth KV state.
         */
        verifiedProviders:
            {},

        /*
         * Convenience reference to the most recently required
         * verified and currently authorized provider.
         */
        provider:
            null,

        sessionContext
    };
}

/* =========================================================
LOAD AUTHORIZATION CONTEXT
========================================================= */

export async function getAuthorizationContext(
    request,
    env
) {
    const sessionContext =
        await getSessionContext(
            request,
            env
        );

    return createAuthorizationContext(
        sessionContext
    );
}

/* =========================================================
SESSION REQUIREMENT
========================================================= */

export function requireAuthenticatedSession(
    authorization
) {
    if (
        authorization
            ?.sessionContext
            ?.authenticated !==
        true
    ) {
        throw new AuthorizationError(
            "AUTH_REQUIRED",
            "Authentication is required.",
            401
        );
    }

    return authorization;
}

/* =========================================================
GLOBAL ACCOUNT REQUIREMENT
========================================================= */

export function requireActiveAccount(
    authorization
) {
    requireAuthenticatedSession(
        authorization
    );

    if (
        !normalizeString(
            authorization?.accountId
        )
    ) {
        throw new AuthorizationError(
            "ACCOUNT_IDENTITY_MISSING",
            "The authenticated BPD account identity could not be resolved.",
            401
        );
    }

    if (
        authorization.active !==
        true
    ) {
        throw new AuthorizationError(
            "ACCOUNT_INACTIVE",
            "This BPD account is not active.",
            403
        );
    }

    return authorization;
}

/* =========================================================
GLOBAL BPD ROLE REQUIREMENT

This checks the canonical BPD account role only.

Do not use this function for Discord guild roles.
========================================================= */

export function requireRole(
    authorization,
    role
) {
    requireActiveAccount(
        authorization
    );

    const expectedRole =
        normalizeRole(
            role
        );

    if (
        !expectedRole
    ) {
        throw new AuthorizationError(
            "ROLE_CONFIGURATION_INVALID",
            "The required authorization role is invalid.",
            500
        );
    }

    if (
        !hasRole(
            authorization.sessionContext,
            expectedRole
        )
    ) {
        throw new AuthorizationError(
            "ROLE_REQUIRED",
            "Your account does not have permission to perform this action.",
            403,
            {
                requiredRole:
                    expectedRole
            }
        );
    }

    return authorization;
}

/* =========================================================
VERIFIED PROVIDER LOOKUP

Returns a provider identity only if it was authoritatively
verified during this authorization request.

A provider must be:
    - Active in Supabase.
    - Currently authorized under provider-auth KV policy.

Session-provider metadata is intentionally ignored here.
========================================================= */

export function getVerifiedProvider(
    authorization,
    provider
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

    const verifiedProvider =
        authorization
            ?.verifiedProviders
            ?.[providerName];

    if (
        !verifiedProvider
        || verifiedProvider.active !==
            true
        || verifiedProvider.authorized !==
            true
        || verifiedProvider
            .requiresReauthorization ===
            true
    ) {
        return null;
    }

    return verifiedProvider;
}

/* =========================================================
AUTHORITATIVE PROVIDER REQUIREMENT
========================================================= */

export async function requireProvider(
    authorization,
    env,
    provider
) {
    requireActiveAccount(
        authorization
    );

    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        throw new AuthorizationError(
            "PROVIDER_CONFIGURATION_INVALID",
            "The required authentication provider is invalid.",
            500
        );
    }

    /*
     * If this provider has already been verified and its KV
     * authorization state confirmed during the current
     * authorization chain, reuse the trusted result.
     */
    const existingProvider =
        getVerifiedProvider(
            authorization,
            providerName
        );

    if (
        existingProvider
    ) {
        return {
            ...authorization,

            provider:
                existingProvider
        };
    }

    /* =====================================================
    VERIFY PERMANENT PROVIDER LINKAGE
    ===================================================== */

    let providerIdentity;

    try {
        providerIdentity =
            await verifyAccountProviderIdentity(
                env,
                authorization.accountId,
                providerName
            );
    }
    catch (
        error
    ) {
        console.error(
            "AUTHORIZATION: Provider identity verification failed.",
            {
                provider:
                    providerName,

                status:
                    error?.status
                    || null,

                upstreamCode:
                    error?.upstreamCode
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        throw new AuthorizationError(
            "PROVIDER_VERIFICATION_UNAVAILABLE",
            "The required authentication provider could not be verified.",
            503,
            {
                provider:
                    providerName
            }
        );
    }

    /*
     * No Supabase identity means the provider is genuinely
     * not linked to this canonical BPD account.
     */
    if (
        !providerIdentity
    ) {
        throw new AuthorizationError(
            "PROVIDER_REQUIRED",
            `A linked ${providerName} account is required.`,
            403,
            {
                provider:
                    providerName,

                linked:
                    false,

                requiresReauthorization:
                    false
            }
        );
    }

    /* =====================================================
    VERIFY PROVIDER AUTHENTICATION FRESHNESS
    ===================================================== */

    let providerAuthState;

    try {
        providerAuthState =
            await getProviderAuthorizationState(
                env,
                authorization.accountId,
                providerName
            );
    }
    catch (
        error
    ) {
        console.error(
            "AUTHORIZATION: Provider authentication state verification failed.",
            {
                provider:
                    providerName,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        throw new AuthorizationError(
            "PROVIDER_AUTH_STATE_UNAVAILABLE",
            "The provider authentication state could not be verified.",
            503,
            {
                provider:
                    providerName,

                linked:
                    true
            }
        );
    }

    /*
     * The permanent Supabase identity still exists, but the
     * provider authentication proof has expired or was
     * invalidated by the configured login-gap policy.
     */
    if (
        providerAuthState
            ?.authorized !==
        true
    ) {
        throw new AuthorizationError(
            "PROVIDER_REAUTHORIZATION_REQUIRED",
            `Your ${providerName} account must be authenticated again.`,
            403,
            {
                provider:
                    providerName,

                linked:
                    true,

                authorized:
                    false,

                requiresReauthorization:
                    true,

                reason:
                    normalizeString(
                        providerAuthState
                            ?.reason
                    )
                    || "PROVIDER_REAUTHORIZATION_REQUIRED",

                connectedAt:
                    providerAuthState
                        ?.connectedAt
                    ?? null,

                expiresAt:
                    providerAuthState
                        ?.expiresAt
                    ?? null,

                providerReauthAfter:
                    providerAuthState
                        ?.providerReauthAfter
                    ?? null
            }
        );
    }

    /* =====================================================
    BUILD VERIFIED PROVIDER
    ===================================================== */

    const verifiedProvider = {
        name:
            normalizeProviderName(
                providerIdentity.provider
            ),

        subject:
            normalizeString(
                providerIdentity.providerSubject
            ),

        displayUsername:
            normalizeString(
                providerIdentity.displayUsername
            )
            || null,

        providerEmail:
            normalizeString(
                providerIdentity.providerEmail
            )
            || null,

        providerEmailVerified:
            providerIdentity
                .providerEmailVerified ===
            true,

        linkedAt:
            providerIdentity.linkedAt
            ?? null,

        /*
         * Supabase's durable identity authentication metadata.
         */
        lastAuthenticatedAt:
            providerIdentity
                .lastAuthenticatedAt
            ?? null,

        lastSyncedAt:
            providerIdentity.lastSyncedAt
            ?? null,

        active:
            providerIdentity.active ===
            true,

        /*
         * Current provider authorization state.
         */
        authorized:
            true,

        requiresReauthorization:
            false,

        connectedAt:
            providerAuthState
                ?.connectedAt
            ?? null,

        expiresAt:
            providerAuthState
                ?.expiresAt
            ?? null,

        providerReauthAfter:
            providerAuthState
                ?.providerReauthAfter
            ?? null,

        /*
         * Identity ownership comes from Supabase.
         * Authorization freshness comes from KV.
         */
        source:
            "database+kv"
    };

    /*
     * Defense in depth.
     *
     * The provider identity service already checks the
     * database identity, and provider_auth_state.js already
     * checks freshness. Authorization still refuses to retain
     * malformed provider context if either dependency changes
     * later.
     */
    if (
        verifiedProvider.name !==
        providerName
        || !verifiedProvider.subject
        || verifiedProvider.active !==
            true
        || verifiedProvider.authorized !==
            true
        || verifiedProvider
            .requiresReauthorization ===
            true
    ) {
        throw new AuthorizationError(
            "PROVIDER_IDENTITY_INVALID",
            "The required authentication provider returned invalid authorization data.",
            503,
            {
                provider:
                    providerName
            }
        );
    }

    return {
        ...authorization,

        verifiedProviders: {
            ...authorization
                .verifiedProviders,

            [providerName]:
                verifiedProvider
        },

        provider:
            verifiedProvider
    };
}

/* =========================================================
COMBINED AUTHORIZATION

Supported Requirements:

    {
        session: true
    }

    {
        account: true
    }

    {
        account: true,
        provider: "epic"
    }

    {
        account: true,
        provider: "discord"
    }

    {
        account: true,
        role: "admin"
    }

    {
        account: true,
        provider: "epic",
        role: "admin"
    }

Important:
    requirements.role is the GLOBAL BPD ACCOUNT ROLE.

    Discord guild roles are evaluated separately by:
        providers/discord/authorization.js
========================================================= */

export async function authorizeRequest(
    request,
    env,
    requirements = {}
) {
    let authorization =
        await getAuthorizationContext(
            request,
            env
        );

    if (
        requirements?.session ===
        true
    ) {
        requireAuthenticatedSession(
            authorization
        );
    }

    if (
        requirements?.account ===
        true
    ) {
        requireActiveAccount(
            authorization
        );
    }

    const role =
        normalizeRole(
            requirements?.role
        );

    if (
        role
    ) {
        requireRole(
            authorization,
            role
        );
    }

    const provider =
        normalizeProviderName(
            requirements?.provider
        );

    if (
        provider
    ) {
        authorization =
            await requireProvider(
                authorization,
                env,
                provider
            );
    }

    return authorization;
}

/* =========================================================
AUTHORIZATION ERROR CHECK
========================================================= */

export function isAuthorizationError(
    error
) {
    return (
        error instanceof
            AuthorizationError
        || error?.name ===
            "AuthorizationError"
    );
}