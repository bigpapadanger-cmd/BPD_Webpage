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
    - Reads the centralized BPD session context.
    - Returns the canonical global account identity.
    - Loads the canonical BPD display name from
      identity.accounts.
    - Returns normalized provider authentication state.
    - Returns safe session timing information.
    - Never exposes raw Cloudflare KV session data.
    - Never exposes provider access tokens or secrets.

Identity:
    user.userId
        = identity.accounts.id

    user.displayName
        = identity.accounts.display_name

Important:
    - authenticated means a valid BPD browser session exists.
    - Global account display name is separate from provider
      usernames/display names.
    - Rocket League access is NOT determined here.
    - Epic authentication is NOT required for global BPD auth.
    - Google authentication is NOT required if another valid
      provider established the BPD session.
========================================================= */

import {
    json
} from "../../common_helpers/responses.js";

import {
    getSessionContext
} from "../sessions/session_context.js";

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
            typeof provider.provider ===
                "string"
                ? provider.provider
                : null,

        linked:
            provider.linked ===
            true,

        authenticated:
            provider.authenticated ===
            true,

        accountId:
            typeof provider.accountId ===
                "string"
                ? provider.accountId
                : null,

        displayName:
            typeof provider.displayName ===
                "string"
                ? provider.displayName
                : null,

        preferredUsername:
            typeof provider.preferredUsername ===
                "string"
                ? provider.preferredUsername
                : null,

        email:
            typeof provider.email ===
                "string"
                ? provider.email
                : null,

        authenticatedAt:
            Number.isFinite(
                Number(
                    provider.authenticatedAt
                )
            )
                ? Number(
                    provider.authenticatedAt
                )
                : null,

        linkedAt:
            Number.isFinite(
                Number(
                    provider.linkedAt
                )
            )
                ? Number(
                    provider.linkedAt
                )
                : null
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

        safeProviders[
            providerName
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

Loads the account row directly from identity.accounts using
the trusted identity.accounts.id stored in the server session.

The browser never supplies accountId.
========================================================= */

async function getCanonicalAccount(
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
            "accounts",
            configuration.url
        );
    console.log(
        "AUTH SESSION RPC REQUEST:",
        {
            url:
                url.href,

            accountId:
                normalizedAccountId
        }
    );
    url.searchParams.set(
        "id",
        `eq.${normalizedAccountId}`
    );

    url.searchParams.set(
        "select",
        "id,display_name,role,active"
    );

    url.searchParams.set(
        "limit",
        "1"
    );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "GET",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Accept":
                        "application/json",

                    "Accept-Profile":
                        "identity"
                }
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

        A valid browser session can technically exist without
        a canonical account ID during transitional OAuth
        states.

        In that case authenticated remains true, but userId
        and displayName remain null. Client account policy
        will classify that state as account_invalid.
        ================================================= */

        let account =
            null;

        if (
            session.userId
        ) {
            account =
                await getCanonicalAccount(
                    env,
                    session.userId
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
                        success:
                            false,

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
        }

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
                    /*
                     * Canonical global BPD account ID.
                     *
                     * identity.accounts.id
                     */
                    userId:
                        account?.userId
                        || session.userId
                        || null,

                    /*
                     * Canonical user-editable BPD display
                     * name.
                     *
                     * identity.accounts.display_name
                     *
                     * This is intentionally separate from
                     * provider display names.
                     */
                    displayName:
                        account?.displayName
                        || null,

                    /*
                     * Use the canonical account row when it
                     * was successfully resolved.
                     *
                     * Session values remain the fallback only
                     * for authenticated transitional sessions
                     * without userId.
                     */
                    role:
                        account?.role
                        || session.role
                        || "user",

                    active:
                        account
                            ? account.active ===
                                true
                            : session.active ===
                                true
                },

                providers:
                    sanitizeProviders(
                        session.providers
                    ),

                linkedProviders:
                    Array.isArray(
                        session.linkedProviders
                    )
                        ? [
                            ...session.linkedProviders
                        ]
                        : [],

                authenticatedProviders:
                    Array.isArray(
                        session.authenticatedProviders
                    )
                        ? [
                            ...session.authenticatedProviders
                        ]
                        : [],

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

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return json(
            {
                success:
                    false,

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
                    null,

                code:
                    "AUTH_SESSION_LOAD_FAILED",

                message:
                    "Authentication session could not be loaded.",

                debugId
            },
            500
        );
    }
}