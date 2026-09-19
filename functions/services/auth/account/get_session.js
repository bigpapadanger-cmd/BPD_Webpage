"use strict";

/* =========================================================
BPD GAMING NETWORK
GLOBAL AUTH SESSION SERVICE

File:
    functions/services/auth/account/get_session.js

Purpose:
    Returns the normalized global BPD authentication state
    for the current browser session.

Description:
    - Reads the centralized BPD browser session.
    - Loads the canonical global BPD account.
    - Loads permanent provider linkage from Supabase.
    - Loads temporary provider authentication freshness
      from Cloudflare KV.
    - Builds linkedProviders from permanent Supabase linkage.
    - Builds authenticatedProviders from current KV
      authorization freshness.
    - Returns normalized safe provider state for the client.
    - Never exposes raw Cloudflare KV session data.
    - Never exposes provider access tokens or secrets.
    - Never queries the private identity schema directly
      through PostgREST.

Provider State Model:

    linked
        Permanent provider ownership exists in Supabase.

    authenticated
        The linked provider currently satisfies the KV
        authentication-freshness policy.

    requiresReauthorization
        The provider remains permanently linked, but the
        user must authenticate it again.

Authority:

    Supabase
        Permanent account/provider ownership.

    Cloudflare KV
        Temporary provider authentication freshness.

Identity:
    user.userId
        = identity.accounts.id

    user.displayName
        = identity.accounts.display_name

Important:
    - authenticated means a valid BPD browser session exists.
    - linkedProviders must not depend on the current session's
      provider cache.
    - Logout does not remove permanent provider linkage.
    - A provider may be linked while not currently authorized.
    - Rocket League access is NOT determined here.
========================================================= */

import {
    json
} from "../../common_helpers/responses.js";

import {
    getSessionContext
} from "../sessions/session_context.js";

import {
    verifyAccountProviderIdentity
} from "../providers/provider_identity.js";

import {
    getProviderAuthorizationState
} from "../providers/provider_auth_state.js";

/* =========================================================
SUPPORTED PROVIDERS
========================================================= */

const SUPPORTED_PROVIDERS =
    Object.freeze([
        "epic",
        "google",
        "discord",
        "steam"
    ]);

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

    const numeric =
        Number(
            value
        );

    if (
        Number.isFinite(
            numeric
        )
        && numeric > 0
    ) {
        return numeric;
    }

    const parsed =
        Date.parse(
            String(
                value
            )
        );

    return Number.isFinite(
        parsed
    )
        ? parsed
        : null;
}

/* =========================================================
SAFE PROVIDER
========================================================= */

function sanitizeProvider(
    provider
) {
    if (
        !provider
        || typeof provider !==
            "object"
        || Array.isArray(
            provider
        )
    ) {
        return null;
    }

    return {
        provider:
            normalizeProviderName(
                provider.provider
            )
            || null,

        linked:
            provider.linked ===
            true,

        authenticated:
            provider.authenticated ===
            true,

        authorized:
            provider.authorized ===
            true,

        requiresReauthorization:
            provider.requiresReauthorization ===
            true,

        reauthorizationReason:
            normalizeNullableString(
                provider.reauthorizationReason
            ),

        accountId:
            normalizeNullableString(
                provider.accountId
            ),

        displayName:
            normalizeNullableString(
                provider.displayName
            ),

        preferredUsername:
            normalizeNullableString(
                provider.preferredUsername
            ),

        email:
            normalizeNullableString(
                provider.email
            ),

        authenticatedAt:
            normalizeTimestamp(
                provider.authenticatedAt
            ),

        linkedAt:
            normalizeTimestamp(
                provider.linkedAt
            ),

        expiresAt:
            normalizeTimestamp(
                provider.expiresAt
            ),

        providerReauthAfter:
            normalizeTimestamp(
                provider.providerReauthAfter
            )
    };
}

/* =========================================================
SAFE PROVIDERS
========================================================= */

function sanitizeProviders(
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

    const safeProviders =
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
        const safeProvider =
            sanitizeProvider(
                providerData
            );

        if (
            !safeProvider
        ) {
            continue;
        }

        const normalizedProvider =
            normalizeProviderName(
                safeProvider.provider
                || providerName
            );

        if (
            !normalizedProvider
        ) {
            continue;
        }

        safeProviders[
            normalizedProvider
        ] =
            safeProvider;
    }

    return safeProviders;
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const url =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !url
        || !apiKey
    ) {
        return null;
    }

    return {
        url:
            url.endsWith(
                "/"
            )
                ? url
                : `${url}/`,

        apiKey
    };
}

/* =========================================================
LOAD CANONICAL ACCOUNT

Loads safe canonical account data through:

    api.get_account_session_identity(p_account_id uuid)

The private identity schema remains unexposed through
PostgREST.

The browser never supplies accountId.
========================================================= */

export async function getCanonicalAccount(
    env,
    accountId
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        return null;
    }

    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        throw new Error(
            "Supabase account configuration is unavailable."
        );
    }

    const url =
        new URL(
            "rpc/get_account_session_identity",
            configuration.url
        );

    const startedAt =
        Date.now();

    const response =
        await fetch(
            url.href,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept-Profile":
                        "api"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            normalizedAccountId
                    })
            }
        );

    console.log(
        "AUTH SESSION RPC RESPONSE:",
        {
            status:
                response.status,

            elapsedMs:
                Date.now()
                - startedAt
        }
    );

    if (
        !response.ok
    ) {
        const responseText =
            await response.text();

        console.error(
            "AUTH SESSION SERVICE: Canonical account lookup failed.",
            {
                status:
                    response.status,

                response:
                    responseText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .slice(
                            0,
                            300
                        )
            }
        );

        const error =
            new Error(
                "Canonical account lookup failed."
            );

        error.status =
            response.status;

        throw error;
    }

    let rows;

    try {
        rows =
            await response.json();
    }
    catch {
        throw new Error(
            "Canonical account lookup returned invalid JSON."
        );
    }

    if (
        !Array.isArray(
            rows
        )
    ) {
        throw new Error(
            "Canonical account lookup returned an invalid response."
        );
    }

    const account =
        rows[0]
        || null;

    if (
        !account
    ) {
        return null;
    }

    const resolvedAccountId =
        normalizeString(
            account.id
        );

    if (
        !resolvedAccountId
        || resolvedAccountId !==
            normalizedAccountId
    ) {
        throw new Error(
            "Canonical account lookup returned an unexpected account."
        );
    }

    return {
        userId:
            resolvedAccountId,

        displayName:
            normalizeNullableString(
                account.display_name
            ),

        role:
            normalizeString(
                account.role
            )
            || "user",

        active:
            account.active ===
            true
    };
}

/* =========================================================
SESSION PROVIDER METADATA

The current browser session may contain richer provider
display metadata from the latest OAuth callback.

It is useful for presentation only.

It does NOT determine whether the provider is permanently
linked.
========================================================= */

function getSessionProvider(
    session,
    provider
) {
    const normalizedProvider =
        normalizeProviderName(
            provider
        );

    if (
        !normalizedProvider
    ) {
        return null;
    }

    const providerData =
        session
            ?.providers
            ?.[normalizedProvider];

    if (
        !providerData
        || typeof providerData !==
            "object"
        || Array.isArray(
            providerData
        )
    ) {
        return null;
    }

    return providerData;
}

/* =========================================================
LOAD PERMANENT PROVIDER IDENTITY

Supabase is the permanent provider-link authority.

A missing/inactive identity returns null.

Operational verification errors propagate so the session
endpoint does not incorrectly claim that the provider is
unlinked.
========================================================= */

async function loadPermanentProvider(
    env,
    accountId,
    provider
) {
    return verifyAccountProviderIdentity(
        env,
        accountId,
        provider
    );
}

/* =========================================================
BUILD PROVIDER STATE
========================================================= */

async function buildProviderState(
    env,
    session,
    accountId,
    provider
) {
    const normalizedProvider =
        normalizeProviderName(
            provider
        );

    const permanentIdentity =
        await loadPermanentProvider(
            env,
            accountId,
            normalizedProvider
        );

    /*
     * No permanent provider identity means the provider is
     * not linked, regardless of anything remaining in the
     * current session provider cache.
     */
    if (
        !permanentIdentity
    ) {
        return null;
    }

    const authorizationState =
        await getProviderAuthorizationState(
            env,
            accountId,
            normalizedProvider
        );

    const sessionProvider =
        getSessionProvider(
            session,
            normalizedProvider
        );

    const authenticated =
        authorizationState
            ?.authorized ===
        true;

    return {
        provider:
            normalizedProvider,

        linked:
            true,

        authenticated,

        authorized:
            authenticated,

        requiresReauthorization:
            authorizationState
                ?.requiresReauthorization ===
            true,

        reauthorizationReason:
            normalizeNullableString(
                authorizationState
                    ?.reason
            ),

        /*
         * External provider identity.
         *
         * This value comes from authoritative Supabase
         * identity.account_identities data.
         */
        accountId:
            normalizeNullableString(
                permanentIdentity
                    .providerSubject
            ),

        /*
         * Prefer current-session presentation data when it
         * exists, then fall back to permanent provider
         * metadata from Supabase.
         */
        displayName:
            normalizeNullableString(
                sessionProvider
                    ?.displayName
            )
            || normalizeNullableString(
                permanentIdentity
                    .displayUsername
            ),

        preferredUsername:
            normalizeNullableString(
                sessionProvider
                    ?.preferredUsername
            )
            || normalizeNullableString(
                permanentIdentity
                    .displayUsername
            ),

        email:
            normalizeNullableString(
                sessionProvider
                    ?.email
            )
            || normalizeNullableString(
                permanentIdentity
                    .providerEmail
            ),

        /*
         * Provider freshness comes from KV.
         */
        authenticatedAt:
            normalizeTimestamp(
                authorizationState
                    ?.connectedAt
            ),

        expiresAt:
            normalizeTimestamp(
                authorizationState
                    ?.expiresAt
            ),

        providerReauthAfter:
            normalizeTimestamp(
                authorizationState
                    ?.providerReauthAfter
            ),

        /*
         * Permanent linkage timestamp comes from Supabase.
         */
        linkedAt:
            normalizeTimestamp(
                permanentIdentity
                    .linkedAt
            )
    };
}

/* =========================================================
LOAD ACCOUNT PROVIDERS

All supported providers are independently verified against
Supabase.

This intentionally does NOT use session.linkedProviders as
the ownership source.
========================================================= */

async function loadAccountProviders(
    env,
    session,
    accountId
) {
    const results =
        await Promise.all(
            SUPPORTED_PROVIDERS.map(
                async provider => ({
                    provider,

                    state:
                        await buildProviderState(
                            env,
                            session,
                            accountId,
                            provider
                        )
                })
            )
        );

    const providers =
        {};

    const linkedProviders =
        [];

    const authenticatedProviders =
        [];

    for (
        const result
        of results
    ) {
        const providerState =
            result.state;

        if (
            !providerState
        ) {
            continue;
        }

        providers[
            result.provider
        ] =
            providerState;

        linkedProviders.push(
            result.provider
        );

        if (
            providerState.authenticated ===
            true
        ) {
            authenticatedProviders.push(
                result.provider
            );
        }
    }

    return {
        providers:
            sanitizeProviders(
                providers
            ),

        linkedProviders,

        authenticatedProviders
    };
}

/* =========================================================
UNAUTHENTICATED RESPONSE
========================================================= */

function createUnauthenticatedResponse() {
    return {
        success:
            true,

        authenticated:
            false,

        user:
            null,

        providers:
            {},

        linkedProviders:
            [],

        authenticatedProviders:
            [],

        session:
            null
    };
}

/* =========================================================
MAIN
========================================================= */

export async function handleAuthSession(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        const session =
            await getSessionContext(
                request,
                env
            );

        if (
            session.authenticated !==
            true
        ) {
            return json(
                createUnauthenticatedResponse()
            );
        }

        /* =================================================
        CANONICAL ACCOUNT
        ================================================= */

        const sessionAccountId =
            normalizeString(
                session.userId
            );

        if (
            !sessionAccountId
        ) {
            return json(
                {
                    success: false,
                    authenticated: null,
                    available: false,

                    user:
                        null,

                    providers:
                        {},

                    linkedProviders:
                        [],

                    authenticatedProviders:
                        [],

                    session:
                        null,

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    message:
                        "The authenticated session has no canonical BPD account identity.",

                    debugId
                },
                500
            );
        }

        const account =
            await getCanonicalAccount(
                env,
                sessionAccountId
            );

        if (
            !account
        ) {
            console.error(
                "AUTH SESSION SERVICE: Session references a missing canonical account.",
                {
                    debugId
                }
            );

            return json(
                {
                    success: false,
                    authenticated: null,
                    available: false,

                    user:
                        null,

                    providers:
                        {},

                    linkedProviders:
                        [],

                    authenticatedProviders:
                        [],

                    session:
                        null,

                    code:
                        "ACCOUNT_NOT_FOUND",

                    message:
                        "The authenticated account could not be resolved.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        PERMANENT PROVIDER LINKAGE + AUTH FRESHNESS
        ================================================= */

        const providerState =
            await loadAccountProviders(
                env,
                session,
                account.userId
            );

        /* =================================================
        RESPONSE
        ================================================= */

        return json(
            {
                success:
                    true,

                authenticated:
                    true,

                user: {
                    userId:
                        account.userId,

                    displayName:
                        account.displayName,

                    role:
                        account.role
                        || session.role
                        || "user",

                    active:
                        account.active ===
                        true
                },

                /*
                 * Derived from:
                 *
                 * Supabase permanent identity linkage
                 * +
                 * KV authentication freshness
                 */
                providers:
                    providerState.providers,

                /*
                 * Permanent Supabase linkage.
                 *
                 * This is what the account banner uses.
                 */
                linkedProviders:
                    providerState
                        .linkedProviders,

                /*
                 * Linked providers whose KV authentication
                 * freshness is currently authorized.
                 */
                authenticatedProviders:
                    providerState
                        .authenticatedProviders,

                session: {
                    createdAt:
                        session.createdAt,

                    lastSeenAt:
                        session.lastSeenAt,

                    absoluteExpiresAt:
                        session.absoluteExpiresAt
                }
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "AUTH SESSION SERVICE: Failed.",
            {
                debugId,

                name:
                    error?.name
                    || "Error",

                status:
                    error?.status
                    || null,

                code:
                    error?.code
                    || error?.upstreamCode
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return json(
            {
                success:
                    false,

                authenticated: null,
                available: false,

                user:
                    null,

                providers:
                    {},

                linkedProviders:
                    [],

                authenticatedProviders:
                    [],

                session:
                    null,

                code:
                    "AUTH_SERVICE_UNAVAILABLE",

                message:
                    "Authentication session could not be loaded.",

                debugId
            },
            503
        );
    }
}
