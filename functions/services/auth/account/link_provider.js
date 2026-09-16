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

Provider Engines:
    Google
        -> Supabase Auth

    Discord
        -> Supabase Auth

    Epic
        -> Direct Epic Games OAuth

Flow:
    Authenticated BPD session
        ↓
    Central server authorization
        ↓
    Resolve identity.accounts.id
        ↓
    Validate provider
        ↓
    Verify provider is not already linked
        ↓
    Start provider-specific OAuth flow
        ↓
    Provider callback
        ↓
    Link provider identity to existing BPD account

Security:
    - Requires an authenticated active canonical BPD account.
    - identity.accounts.id comes only from trusted session
      authorization.
    - Browser input never determines the target account ID.
    - Google/Discord link mode stores trusted account context
      in short-lived HttpOnly cookies.
    - Epic receives the trusted account ID through its
      server-created OAuth context.
    - Provider ownership is finalized only after successful
      provider authentication in the callback.
    - SUPABASE_AUTH is never exposed to the browser.

Supabase OAuth:
    - Supabase origin comes from env.SUPABASE_URL.
    - Public authorize API key comes from env.SB_PUB_KEY.
    - Callback URL is derived from the current request.
    - No static callback/authorize URL configuration is
      required.

Important:
    - This service NEVER creates identity.accounts.
    - Email is never used to determine account ownership.
    - OAuth verifier/state values must never be logged.
========================================================= */

import {
    verifyAccountProviderIdentity
} from "../providers/provider_identity.js";

import {
    json,
    redirect
} from "../../common_helpers/responses.js";

import {
    createCookie
} from "../sessions/session.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../authorization.js";

import {
    startEpicAuthorization
} from "../providers/epic/login.js";

import {
    OAUTH_MODE_COOKIE,
    OAUTH_PROVIDER_COOKIE,
    OAUTH_ACCOUNT_COOKIE,
    OAUTH_RETURN_COOKIE,
    OAUTH_COOKIE_MAX_AGE_SECONDS,
    OAUTH_PKCE_COOKIE
} from "../../config/api_vars.js";

/* =========================================================
CONSTANTS
========================================================= */

const OAUTH_MODE_LINK =
    "link";

const DEFAULT_RETURN_TO =
    "/Account";

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
                "epic"
        }
    });

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

/* =========================================================
RETURN DESTINATION
========================================================= */

function normalizeReturnTo(
    value
) {
    const returnTo =
        normalizeString(
            value
        );

    if (
        !returnTo
        || !returnTo.startsWith(
            "/"
        )
        || returnTo.startsWith(
            "//"
        )
    ) {
        return DEFAULT_RETURN_TO;
    }

    return returnTo;
}

function getReturnTo(
    request
) {
    const url =
        new URL(
            request.url
        );

    return normalizeReturnTo(
        url.searchParams.get(
            "returnTo"
        )
    );
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
            /=+$/u,
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
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const configuredUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    const publishableKey =
        normalizeString(
            env?.SB_PUB_KEY
        );

    if (
        !configuredUrl
    ) {
        throw new Error(
            "SUPABASE_URL_MISSING"
        );
    }

    if (
        !publishableKey
    ) {
        throw new Error(
            "SB_PUB_KEY_MISSING"
        );
    }

    let origin;

    try {
        origin =
            new URL(
                configuredUrl
            ).origin;
    }
    catch {
        throw new Error(
            "SUPABASE_URL_INVALID"
        );
    }

    return {
        origin,
        publishableKey
    };
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
SUPABASE CALLBACK URL
========================================================= */

function getSupabaseCallbackUrl(
    request
) {
    return new URL(
        "/api/auth/_oauth/callback",
        request.url
    ).href;
}

/* =========================================================
CREATE SUPABASE OAUTH CONTEXT COOKIES
========================================================= */

function createSupabaseOAuthContextCookies(
    request,
    provider,
    accountId,
    verifier,
    returnTo
) {
    const pkceCookie =
        createCookie(
            request,
            OAUTH_PKCE_COOKIE,
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

    const returnCookie =
        createCookie(
            request,
            OAUTH_RETURN_COOKIE,
            returnTo,
            OAUTH_COOKIE_MAX_AGE_SECONDS
        );

    if (
        !pkceCookie
        || !providerCookie
        || !modeCookie
        || !accountCookie
        || !returnCookie
    ) {
        return null;
    }

    return [
        pkceCookie,
        providerCookie,
        modeCookie,
        accountCookie,
        returnCookie
    ];
}

/* =========================================================
BUILD SUPABASE AUTHORIZE URL
========================================================= */

function buildSupabaseAuthorizeUrl(
    request,
    env,
    provider,
    challenge
) {
    const {
        origin,
        publishableKey
    } =
        getSupabaseConfiguration(
            env
        );

    const callbackUrl =
        getSupabaseCallbackUrl(
            request
        );

    const authorizeUrl =
        new URL(
            `${origin}/auth/v1/authorize`
        );

    authorizeUrl.searchParams.set(
        "provider",
        provider
    );

    authorizeUrl.searchParams.set(
        "redirect_to",
        callbackUrl
    );

    authorizeUrl.searchParams.set(
        "code_challenge",
        challenge
    );

    authorizeUrl.searchParams.set(
        "code_challenge_method",
        "s256"
    );

    /*
     * Supabase Auth requires the public project key for
     * authorize requests.
     *
     * SB_PUB_KEY is intentionally browser-visible.
     *
     * Never use SUPABASE_AUTH here.
     */
    authorizeUrl.searchParams.set(
        "apikey",
        publishableKey
    );

    return authorizeUrl;
}

/* =========================================================
SUPABASE PROVIDER LINK FLOW
========================================================= */

async function startSupabaseProviderLink(
    request,
    env,
    accountId,
    provider,
    returnTo
) {
    const providerConfig =
        getProviderConfig(
            provider
        );

    if (
        !providerConfig
        || providerConfig.authEngine !==
            "supabase"
    ) {
        throw new Error(
            "SUPABASE_PROVIDER_CONFIG_INVALID"
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
            "PKCE_GENERATION_FAILED"
        );
    }

    const authorizeUrl =
        buildSupabaseAuthorizeUrl(
            request,
            env,
            providerConfig.provider,
            challenge
        );

    const cookies =
        createSupabaseOAuthContextCookies(
            request,
            providerConfig.provider,
            accountId,
            verifier,
            returnTo
        );

    if (
        !cookies
    ) {
        throw new Error(
            "OAUTH_LINK_COOKIE_CREATION_FAILED"
        );
    }

    return redirect(
        authorizeUrl.href,
        cookies
    );
}

/* =========================================================
EPIC PROVIDER LINK FLOW
========================================================= */

function startEpicProviderLink(
    request,
    env,
    accountId,
    returnTo
) {
    /*
     * accountId originates from authorizeRequest().
     *
     * It is never accepted from the browser.
     */

    const authorization =
        startEpicAuthorization(
            request,
            env,
            {
                mode:
                    OAUTH_MODE_LINK,

                accountId,

                returnTo
            }
        );

    return redirect(
        authorization.redirectUrl,
        authorization.cookies
    );
}

/* =========================================================
START PROVIDER LINK
========================================================= */

async function startProviderLink(
    request,
    env,
    accountId,
    provider,
    returnTo
) {
    const providerConfig =
        getProviderConfig(
            provider
        );

    if (
        !providerConfig
    ) {
        throw new Error(
            "PROVIDER_CONFIG_MISSING"
        );
    }

    if (
        providerConfig.authEngine ===
        "supabase"
    ) {
        return startSupabaseProviderLink(
            request,
            env,
            accountId,
            provider,
            returnTo
        );
    }

    if (
        providerConfig.authEngine ===
        "epic"
    ) {
        return startEpicProviderLink(
            request,
            env,
            accountId,
            returnTo
        );
    }

    throw new Error(
        "PROVIDER_AUTH_ENGINE_UNSUPPORTED"
    );
}

/* =========================================================
AUTHORIZATION ERROR RESPONSE
========================================================= */

function getAuthorizationErrorResponse(
    error,
    debugId
) {
    if (
        error.code ===
        "AUTH_REQUIRED"
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

    if (
        error.code ===
        "ACCOUNT_INACTIVE"
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

    if (
        error.code ===
        "ACCOUNT_IDENTITY_MISSING"
    ) {
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
            401
        );
    }

    return json(
        {
            success:
                false,

            code:
                error.code
                || "AUTHORIZATION_FAILED",

            message:
                "Your BPD account could not be authorized for provider linking.",

            debugId
        },
        Number.isInteger(
            error.status
        )
            ? error.status
            : 403
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
        /* =================================================
        CENTRAL ACCOUNT AUTHORIZATION
        ================================================= */

        let authorization;

        try {
            authorization =
                await authorizeRequest(
                    request,
                    env,
                    {
                        account:
                            true
                    }
                );
        }
        catch (
            error
        ) {
            if (
                isAuthorizationError(
                    error
                )
            ) {
                return getAuthorizationErrorResponse(
                    error,
                    debugId
                );
            }

            throw error;
        }

        const accountId =
            normalizeString(
                authorization.accountId
            );

        if (
            !accountId
        ) {
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
                500
            );
        }

        /* =================================================
        PROVIDER
        ================================================= */

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

        /* =================================================
        AUTHORITATIVE EXISTING PROVIDER CHECK

        Supabase is authoritative for linked identities.

        Session provider state is intentionally not trusted
        as the final linkage decision.
        ================================================= */

        let existingProviderIdentity =
            null;

        try {
            existingProviderIdentity =
                await verifyAccountProviderIdentity(
                    env,
                    accountId,
                    provider
                );
        }
        catch (
            error
        ) {
            console.error(
                "LINK PROVIDER: Existing provider verification failed.",
                {
                    debugId,

                    provider,

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

            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_VERIFICATION_UNAVAILABLE",

                    message:
                        "The current provider linkage could not be verified.",

                    debugId
                },
                503
            );
        }

        if (
            existingProviderIdentity
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

        /* =================================================
        RETURN DESTINATION
        ================================================= */

        const returnTo =
            getReturnTo(
                request
            );

        /* =================================================
        START LINK
        ================================================= */

        console.info(
            "LINK PROVIDER: Link flow started.",
            {
                debugId,

                provider,

                authEngine:
                    providerConfig.authEngine,

                hasAccountId:
                    true,

                returnTo
            }
        );

        return await startProviderLink(
            request,
            env,
            accountId,
            provider,
            returnTo
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

        let code =
            "LINK_PROVIDER_FAILED";

        if (
            error?.message ===
            "SUPABASE_URL_MISSING"
        ) {
            code =
                "SUPABASE_URL_MISSING";
        }
        else if (
            error?.message ===
            "SB_PUB_KEY_MISSING"
        ) {
            code =
                "SB_PUB_KEY_MISSING";
        }
        else if (
            error?.message ===
            "SUPABASE_URL_INVALID"
        ) {
            code =
                "SUPABASE_URL_INVALID";
        }

        return json(
            {
                success:
                    false,

                code,

                message:
                    "Account provider linking could not be started.",

                debugId
            },
            500
        );
    }
}