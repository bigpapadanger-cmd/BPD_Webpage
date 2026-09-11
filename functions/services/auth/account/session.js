"use strict";

/* =========================================================
BPD GAMING NETWORK
GLOBAL AUTH SESSION SERVICE

File:
    functions/services/auth/account/session.js

Purpose:
    Returns the normalized global BPD authentication state
    for the current browser session.

Description:
    - Reads the centralized BPD session context.
    - Returns the canonical global account identity.
    - Returns normalized provider authentication state.
    - Returns safe session timing information.
    - Never exposes raw Cloudflare KV session data.
    - Never exposes provider access tokens or secrets.

Identity:
    user.userId = identity.accounts.id

Important:
    - authenticated means a valid BPD browser session exists.
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
SAFE PROVIDER
========================================================= */

function sanitizeProvider(
    provider
) {
    if (
        !provider
        || typeof provider !== "object"
        || Array.isArray(
            provider
        )
    ) {
        return null;
    }

    return {
        provider:
            typeof provider.provider === "string"
                ? provider.provider
                : null,

        linked:
            provider.linked === true,

        authenticated:
            provider.authenticated === true,

        accountId:
            typeof provider.accountId === "string"
                ? provider.accountId
                : null,

        displayName:
            typeof provider.displayName === "string"
                ? provider.displayName
                : null,

        preferredUsername:
            typeof provider.preferredUsername === "string"
                ? provider.preferredUsername
                : null,

        email:
            typeof provider.email === "string"
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
        || typeof providers !== "object"
        || Array.isArray(
            providers
        )
    ) {
        return {};
    }

    const safeProviders = {};

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
            session.authenticated !== true
        ) {
            return json(
                createUnauthenticatedResponse()
            );
        }

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
                     * This corresponds directly to:
                     * identity.accounts.id
                     */
                    userId:
                        session.userId,

                    role:
                        session.role,

                    active:
                        session.active === true
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