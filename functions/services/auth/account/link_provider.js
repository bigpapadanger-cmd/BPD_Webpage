"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PROVIDER LINK SERVICE

File:
    functions/services/auth/account/link_provider.js

Purpose:
    Starts an explicit provider-linking flow for an already
    authenticated global BPD account.

Supported Providers:
    - Google
    - Discord
    - Epic Games

Flow:
    Authenticated BPD session
        ↓
    Validate target provider
        ↓
    Preserve target identity.accounts.id
        ↓
    Mark OAuth mode as "link"
        ↓
    Generate PKCE verifier + challenge
        ↓
    Store temporary OAuth context in HttpOnly cookies
        ↓
    Redirect into provider OAuth
        ↓
    Provider returns to /api/auth/_oauth/callback
        ↓
    Callback links the authenticated provider identity to
    the existing identity.accounts.id

Important:
    - This service NEVER creates identity.accounts.
    - The current BPD session determines the target account.
    - The browser never supplies identity.accounts.id.
    - Email is never used to determine account ownership.
    - OAuth verifier/state values must never be logged.
    - Provider identity ownership is finalized only after
      successful provider authentication in the callback.

Compatibility:
    - Google and Discord are intended to use Supabase Auth.
    - Epic compatibility is enabled through the same provider
      dispatch path for initial integration testing.
    - If Epic requires the existing direct Epic OAuth flow,
      only the Epic starter will need to be replaced later;
      the account-linking contract can remain unchanged.
========================================================= */

import {
    json,
    redirect
} from "../../common_helpers/responses.js";

import {
    createCookie
} from "../sessions/session.js";

import {
    getSessionContext
} from "../sessions/session_context.js";

import {
    SUPABASE_OAUTH_AUTHORIZE_URL,
    OAUTH_RETURN_URL
} from "../../config/api_vars.js";

/* =========================================================
CONSTANTS
========================================================= */

const OAUTH_MODE_LINK =
    "link";

const OAUTH_MODE_COOKIE =
    "bpd_oauth_mode";

const OAUTH_PROVIDER_COOKIE =
    "bpd_oauth_provider";

const OAUTH_ACCOUNT_COOKIE =
    "bpd_oauth_account";

const PKCE_COOKIE =
    "bpd_oauth_pkce";

const OAUTH_COOKIE_MAX_AGE_SECONDS =
    600;

/* =========================================================
SUPPORTED PROVIDERS
========================================================= */

const SUPPORTED_LINK_PROVIDERS =
    new Set([
        "google",
        "discord",
        "epic"
    ]);

/* =========================================================
PROVIDER CONFIGURATION
========================================================= */

const PROVIDER_CONFIG =
    Object.freeze({
        google: {
            provider:
                "google",

            label:
                "Google",

            authEngine:
                "supabase"
        },

        discord: {
            provider:
                "discord",

            label:
                "Discord",

            authEngine:
                "supabase"
        },

        epic: {
            provider:
                "epic",

            label:
                "Epic Games",

            authEngine:
                "supabase"
        }
    });

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

/* =========================================================
BASE64 URL
========================================================= */

function toBase64Url(
    bytes
) {
    let binary =
        "";

    for (
        const byte
        of bytes
    ) {
        binary +=
            String.fromCharCode(
                byte
            );
    }

    return btoa(
        binary
    )
        .replaceAll(
            "+",
            "-"
        )
        .replaceAll(
            "/",
            "_"
        )
        .replace(
            /=+$/g,
            ""
        );
}

/* =========================================================
PKCE
========================================================= */

function createPkceVerifier() {
    const bytes =
        new Uint8Array(
            64
        );

    crypto.getRandomValues(
        bytes
    );

    return toBase64Url(
        bytes
    );
}

async function createPkceChallenge(
    verifier
) {
    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder()
                .encode(
                    verifier
                )
        );

    return toBase64Url(
        new Uint8Array(
            digest
        )
    );
}

/* =========================================================
OAUTH CONFIGURATION
========================================================= */

function getOAuthConfiguration() {
    const authorizeUrl =
        normalizeString(
            SUPABASE_OAUTH_AUTHORIZE_URL
        );

    const returnUrl =
        normalizeString(
            OAUTH_RETURN_URL
        );

    if (
        !authorizeUrl
        || !returnUrl
    ) {
        return null;
    }

    try {
        return {
            authorizeUrl:
                new URL(
                    authorizeUrl
                ),

            returnUrl:
                new URL(
                    returnUrl
                )
                    .toString()
        };
    }
    catch {
        return null;
    }
}

/* =========================================================
REQUESTED PROVIDER
========================================================= */

function getProvider(
    request
) {
    const url =
        new URL(
            request.url
        );

    return normalizeString(
        url.searchParams.get(
            "provider"
        )
    )
        .toLowerCase();
}

/* =========================================================
PROVIDER CONFIG
========================================================= */

function getProviderConfig(
    provider
) {
    const normalizedProvider =
        normalizeString(
            provider
        )
            .toLowerCase();

    if (
        !normalizedProvider
    ) {
        return null;
    }

    return (
        PROVIDER_CONFIG[
            normalizedProvider
        ]
        || null
    );
}

/* =========================================================
CREATE OAUTH CONTEXT COOKIES
========================================================= */

function createOAuthContextCookies(
    request,
    provider,
    accountId,
    verifier
) {
    const pkceCookie =
        createCookie(
            request,
            PKCE_COOKIE,
            verifier,
            OAUTH_COOKIE_MAX_AGE_SECONDS
        );

    const providerCookie =
        createCookie(
            request,
            OAUTH_PROVIDER_COOKIE,
            provider,
            OAUTH_COOKIE_MAX_AGE_SECONDS
        );

    const modeCookie =
        createCookie(
            request,
            OAUTH_MODE_COOKIE,
            OAUTH_MODE_LINK,
            OAUTH_COOKIE_MAX_AGE_SECONDS
        );

    const accountCookie =
        createCookie(
            request,
            OAUTH_ACCOUNT_COOKIE,
            accountId,
            OAUTH_COOKIE_MAX_AGE_SECONDS
        );

    if (
        !pkceCookie
        || !providerCookie
        || !modeCookie
        || !accountCookie
    ) {
        return null;
    }

    return [
        pkceCookie,
        providerCookie,
        modeCookie,
        accountCookie
    ];
}

/* =========================================================
SUPABASE PROVIDER LINK FLOW
========================================================= */

async function startSupabaseProviderLink(
    request,
    accountId,
    provider
) {
    const configuration =
        getOAuthConfiguration();

    if (
        !configuration
    ) {
        throw new Error(
            "OAuth configuration is invalid."
        );
    }

    const providerConfig =
        getProviderConfig(
            provider
        );

    if (
        !providerConfig
    ) {
        throw new Error(
            "OAuth provider configuration was not found."
        );
    }

    const verifier =
        createPkceVerifier();

    const challenge =
        await createPkceChallenge(
            verifier
        );

    if (
        !verifier
        || !challenge
    ) {
        throw new Error(
            "PKCE generation failed."
        );
    }

    const authorizeUrl =
        new URL(
            configuration
                .authorizeUrl
                .toString()
        );

    authorizeUrl.searchParams.set(
        "provider",
        providerConfig.provider
    );

    authorizeUrl.searchParams.set(
        "redirect_to",
        configuration.returnUrl
    );

    authorizeUrl.searchParams.set(
        "code_challenge",
        challenge
    );

    authorizeUrl.searchParams.set(
        "code_challenge_method",
        "s256"
    );

    const cookies =
        createOAuthContextCookies(
            request,
            providerConfig.provider,
            accountId,
            verifier
        );

    if (
        !cookies
    ) {
        throw new Error(
            "OAuth link cookies could not be created."
        );
    }

    return redirect(
        authorizeUrl.toString(),
        cookies
    );
}

/* =========================================================
START PROVIDER LINK
========================================================= */

async function startProviderLink(
    request,
    accountId,
    provider
) {
    const providerConfig =
        getProviderConfig(
            provider
        );

    if (
        !providerConfig
    ) {
        throw new Error(
            "Provider configuration was not found."
        );
    }

    if (
        providerConfig.authEngine ===
        "supabase"
    ) {
        return startSupabaseProviderLink(
            request,
            accountId,
            provider
        );
    }

    throw new Error(
        "Provider authentication engine is not supported."
    );
}

/* =========================================================
MAIN
========================================================= */

export async function handleLinkProvider(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        /* -------------------------------------------------
        AUTHENTICATED BPD SESSION
        ------------------------------------------------- */

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
                {
                    success:
                        false,

                    code:
                        "AUTH_REQUIRED",

                    message:
                        "You must be signed in to link an account provider.",

                    debugId
                },
                401
            );
        }

        /* -------------------------------------------------
        CANONICAL ACCOUNT ID
        ------------------------------------------------- */

        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            console.error(
                "LINK PROVIDER: Authenticated session has no global account ID.",
                {
                    debugId
                }
            );

            return json(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_ID_REQUIRED",

                    message:
                        "Your BPD account identity could not be resolved.",

                    debugId
                },
                409
            );
        }

        /* -------------------------------------------------
        ACCOUNT ACTIVE
        ------------------------------------------------- */

        if (
            session.active !==
            true
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "This BPD account is not active.",

                    debugId
                },
                403
            );
        }

        /* -------------------------------------------------
        PROVIDER
        ------------------------------------------------- */

        const provider =
            getProvider(
                request
            );

        if (
            !provider
            || !SUPPORTED_LINK_PROVIDERS.has(
                provider
            )
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "UNSUPPORTED_PROVIDER",

                    message:
                        "The requested account provider cannot be linked.",

                    debugId
                },
                400
            );
        }

        const providerConfig =
            getProviderConfig(
                provider
            );

        if (
            !providerConfig
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_CONFIG_MISSING",

                    message:
                        "The requested provider is not configured.",

                    debugId
                },
                500
            );
        }

        /* -------------------------------------------------
        EXISTING PROVIDER LINK
        ------------------------------------------------- */

        const existingProvider =
            session.providers
                ?.[
                    provider
                ]
            || null;

        if (
            existingProvider?.linked ===
            true
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_ALREADY_LINKED",

                    message:
                        `${providerConfig.label} is already linked to your BPD account.`,

                    debugId
                },
                409
            );
        }

        /* -------------------------------------------------
        START LINK
        ------------------------------------------------- */

        console.info(
            "LINK PROVIDER: Link flow started.",
            {
                debugId,

                provider,

                authEngine:
                    providerConfig
                        .authEngine,

                hasAccountId:
                    true
            }
        );

        return await startProviderLink(
            request,
            accountId,
            provider
        );
    }
    catch (
        error
    ) {
        console.error(
            "LINK PROVIDER: Unexpected failure.",
            {
                debugId,

                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error",

                stack:
                    error?.stack
                    || null
            }
        );

        return json(
            {
                success:
                    false,

                code:
                    "LINK_PROVIDER_FAILED",

                message:
                    "Account provider linking could not be started.",

                debugId
            },
            500
        );
    }
}