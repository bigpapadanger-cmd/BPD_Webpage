"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PROVIDER LINK SERVICE

File:
    functions/services/auth/account/link_provider.js

Purpose:
    Starts an explicit provider-linking flow for an already
    authenticated global BPD account.

Current supported provider:
    - Google

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
    Redirect to Supabase Auth / Google
        ↓
    Supabase returns to /api/auth/_oauth/callback
        ↓
    Callback uses api.link_google_identity instead of
    api.resolve_google_identity

Important:
    - This service NEVER creates identity.accounts.
    - The current BPD session determines the target account.
    - Email is never used to determine account ownership.
    - OAuth verifier/state values must never be logged.
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

const SUPPORTED_LINK_PROVIDERS =
    new Set([
        "google"
    ]);

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !== "string"
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
CONFIGURATION
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
PROVIDER
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
GOOGLE LINK FLOW
========================================================= */

async function startGoogleLink(
    request,
    accountId
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
        "google"
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
            "google",
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
        throw new Error(
            "OAuth link cookies could not be created."
        );
    }

    return redirect(
        authorizeUrl.toString(),
        [
            pkceCookie,
            providerCookie,
            modeCookie,
            accountCookie
        ]
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
        const session =
            await getSessionContext(
                request,
                env
            );

        if (
            session.authenticated !== true
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

        if (
            session.active !== true
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

        const existingProvider =
            session.providers
                ?.[
                    provider
                ]
            || null;

        if (
            existingProvider?.linked === true
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_ALREADY_LINKED",

                    message:
                        "This provider is already linked to your BPD account.",

                    debugId
                },
                409
            );
        }

        console.info(
            "LINK PROVIDER: Link flow started.",
            {
                debugId,

                provider,

                hasAccountId:
                    true
            }
        );

        if (
            provider === "google"
        ) {
            return await startGoogleLink(
                request,
                accountId
            );
        }

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

                message:
                    "Account provider linking could not be started.",

                debugId
            },
            500
        );
    }
}