"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PROVIDER UNLINK SERVICE

File:
    functions/services/auth/account/unlink_provider.js

Purpose:
    Removes an authentication provider from the currently
    authenticated global BPD account.

Description:
    - Uses centralized server-side account authorization.
    - Resolves identity.accounts.id from the trusted BPD
      session.
    - Validates the requested provider.
    - Removes the provider identity through Supabase.
    - Synchronizes the centralized Cloudflare KV session.
    - Invalidates the browser session if KV synchronization
      fails after the authoritative database unlink.

Database RPC:
    api.unlink_account_identity

Flow:
    Browser request
        ↓
    authorizeRequest({
        account: true
    })
        ↓
    identity.accounts.id from trusted session
        ↓
    Validate provider
        ↓
    api.unlink_account_identity
        ↓
    Database verifies:
        - provider belongs to account
        - another login identity remains
        - provider can safely be removed
        ↓
    Remove provider from centralized KV session

Security:
    - Account ID is NEVER accepted from the browser.
    - authorization.accountId is the authoritative target
      identity.accounts.id.
    - Provider unlink is authoritative in Supabase first.
    - Client-side provider state is never trusted.
    - If session synchronization fails after database unlink,
      the current session is invalidated to prevent stale
      provider state from remaining trusted.

Important:
    - Unlinking does NOT delete identity.accounts.
    - Unlinking does NOT detach core.rl_players.
    - Unlinking Google removes its Supabase auth bridge
      through the database RPC.
========================================================= */

import {
    json
} from "../../common_helpers/responses.js";

import {
    removeProviderFromSession,
    deleteSession,
    clearSessionCookie
} from "../sessions/session.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../authorization.js";

/* =========================================================
SUPPORTED PROVIDERS
========================================================= */

const SUPPORTED_UNLINK_PROVIDERS =
    new Set([
        "google",
        "epic",
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

/* =========================================================
PROVIDER INPUT
========================================================= */

async function getRequestedProvider(
    request
) {
    const url =
        new URL(
            request.url
        );

    const queryProvider =
        normalizeString(
            url.searchParams.get(
                "provider"
            )
        )
            .toLowerCase();

    if (
        queryProvider
    ) {
        return queryProvider;
    }

    const contentType =
        normalizeString(
            request.headers.get(
                "content-type"
            )
        )
            .toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        return "";
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        return "";
    }

    if (
        !body
        || typeof body !==
            "object"
        || Array.isArray(
            body
        )
    ) {
        return "";
    }

    return normalizeString(
        body.provider
    )
        .toLowerCase();
}

/* =========================================================
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseApiKey(
    env
) {
    return normalizeString(
        env?.SUPABASE_AUTH
    );
}

/* =========================================================
RPC ERROR
========================================================= */

function getRpcErrorCode(
    errorData
) {
    const message =
        normalizeString(
            errorData?.message
        );

    const knownCodes = [
        "ACCOUNT_ID_REQUIRED",
        "PROVIDER_REQUIRED",
        "UNSUPPORTED_PROVIDER",
        "ACCOUNT_NOT_FOUND",
        "PROVIDER_NOT_LINKED",
        "LAST_LOGIN_IDENTITY",
        "PROVIDER_UNLINK_FAILED"
    ];

    for (
        const code
        of knownCodes
    ) {
        if (
            message.includes(
                code
            )
        ) {
            return code;
        }
    }

    return normalizeString(
        errorData?.code
    )
        || "PROVIDER_UNLINK_FAILED";
}

/* =========================================================
DATABASE UNLINK
========================================================= */

async function unlinkAccountIdentity(
    env,
    accountId,
    provider
) {
    const supabaseUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        getSupabaseApiKey(
            env
        );

    if (
        !supabaseUrl
        || !apiKey
    ) {
        throw new Error(
            "Supabase Data API configuration is unavailable."
        );
    }

    const baseUrl =
        supabaseUrl.endsWith(
            "/"
        )
            ? supabaseUrl
            : `${supabaseUrl}/`;

    const response =
        await fetch(
            `${baseUrl}rpc/unlink_account_identity`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        apiKey,

                    "Authorization":
                        `Bearer ${apiKey}`,

                    "Content-Profile":
                        "api",

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            accountId,

                        p_provider:
                            provider
                    })
            }
        );

    if (
        !response.ok
    ) {
        let errorData =
            null;

        try {
            errorData =
                await response.json();
        }
        catch {
            // Ignore malformed upstream body.
        }

        const error =
            new Error(
                normalizeString(
                    errorData?.message
                )
                || "Provider unlink failed."
            );

        error.upstreamStatus =
            response.status;

        error.unlinkCode =
            getRpcErrorCode(
                errorData
            );

        throw error;
    }

    let data;

    try {
        data =
            await response.json();
    }
    catch {
        throw new Error(
            "Provider unlink response was invalid."
        );
    }

    const record =
        Array.isArray(
            data
        )
            ? (
                data[0]
                || null
            )
            : data;

    if (
        !record
        || typeof record !==
            "object"
        || Array.isArray(
            record
        )
    ) {
        throw new Error(
            "Provider unlink returned no result."
        );
    }

    const resolvedAccountId =
        normalizeString(
            record.account_id
            ?? record.accountId
        );

    const resolvedProvider =
        normalizeString(
            record.provider
        )
            .toLowerCase();

    if (
        !resolvedAccountId
        || resolvedAccountId !==
            accountId
    ) {
        throw new Error(
            "Provider unlink returned an unexpected account."
        );
    }

    if (
        !resolvedProvider
        || resolvedProvider !==
            provider
    ) {
        throw new Error(
            "Provider unlink returned an unexpected provider."
        );
    }

    return {
        accountId:
            resolvedAccountId,

        provider:
            resolvedProvider,

        unlinked:
            record.unlinked ===
            true,

        remainingLoginIdentities:
            Number.isFinite(
                Number(
                    record.remaining_login_identities
                    ?? record.remainingLoginIdentities
                )
            )
                ? Number(
                    record.remaining_login_identities
                    ?? record.remainingLoginIdentities
                )
                : null
    };
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
                    "You must be signed in to unlink an authentication provider.",

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
                    "SESSION_IDENTITY_INVALID",

                message:
                    "Your authenticated account could not be resolved.",

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
                "Your BPD account could not be authorized for this request.",

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
CLIENT ERROR RESPONSE
========================================================= */

function getUnlinkErrorResponse(
    code,
    debugId
) {
    switch (
        code
    ) {
        case "PROVIDER_NOT_LINKED":
            return json(
                {
                    success:
                        false,

                    code,

                    message:
                        "That provider is not linked to your BPD account.",

                    debugId
                },
                409
            );

        case "LAST_LOGIN_IDENTITY":
            return json(
                {
                    success:
                        false,

                    code,

                    message:
                        "You cannot unlink your only remaining login provider. Link another provider first.",

                    debugId
                },
                409
            );

        case "ACCOUNT_NOT_FOUND":
            return json(
                {
                    success:
                        false,

                    code,

                    message:
                        "Your BPD account could not be found.",

                    debugId
                },
                404
            );

        case "UNSUPPORTED_PROVIDER":
            return json(
                {
                    success:
                        false,

                    code,

                    message:
                        "That authentication provider cannot be unlinked.",

                    debugId
                },
                400
            );

        default:
            return json(
                {
                    success:
                        false,

                    code:
                        code
                        || "PROVIDER_UNLINK_FAILED",

                    message:
                        "The authentication provider could not be unlinked.",

                    debugId
                },
                502
            );
    }
}

/* =========================================================
MAIN
========================================================= */

export async function handleUnlinkProvider(
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

        const sessionId =
            normalizeString(
                authorization.sessionId
            );

        if (
            !accountId
            || !sessionId
        ) {
            /*
             * authorizeRequest({ account: true }) should
             * guarantee accountId. sessionId is also
             * required because the provider cache must be
             * synchronized after the database unlink.
             */
            console.error(
                "UNLINK PROVIDER: Authorization identity incomplete.",
                {
                    debugId,

                    hasAccountId:
                        Boolean(
                            accountId
                        ),

                    hasSessionId:
                        Boolean(
                            sessionId
                        )
                }
            );

            return json(
                {
                    success:
                        false,

                    code:
                        "SESSION_IDENTITY_INVALID",

                    message:
                        "Your authenticated account could not be resolved.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        PROVIDER
        ================================================= */

        const provider =
            await getRequestedProvider(
                request
            );

        if (
            !provider
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_REQUIRED",

                    message:
                        "An authentication provider is required.",

                    debugId
                },
                400
            );
        }

        if (
            !SUPPORTED_UNLINK_PROVIDERS.has(
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
                        "That authentication provider cannot be unlinked.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        DATABASE SOURCE OF TRUTH

        Browser never supplies accountId.

        authorization.accountId was resolved from the
        server-side BPD session.

        Supabase performs the authoritative provider unlink.
        ================================================= */

        let result;

        try {
            result =
                await unlinkAccountIdentity(
                    env,
                    accountId,
                    provider
                );
        }
        catch (
            error
        ) {
            console.error(
                "UNLINK PROVIDER: Database unlink failed.",
                {
                    debugId,

                    provider,

                    upstreamStatus:
                        error?.upstreamStatus
                        || null,

                    unlinkCode:
                        error?.unlinkCode
                        || null,

                    message:
                        error?.message
                        || "Unknown error"
                }
            );

            return getUnlinkErrorResponse(
                error?.unlinkCode,
                debugId
            );
        }

        if (
            result.unlinked !==
            true
        ) {
            console.error(
                "UNLINK PROVIDER: RPC did not confirm unlink.",
                {
                    debugId,

                    provider
                }
            );

            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_UNLINK_NOT_CONFIRMED",

                    message:
                        "The provider unlink could not be confirmed.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        CENTRALIZED SESSION SYNCHRONIZATION

        Supabase is authoritative and has already completed
        the provider unlink.

        If KV synchronization fails, invalidate the current
        session so stale provider state cannot remain trusted.
        ================================================= */

        try {
            await removeProviderFromSession(
                env,
                sessionId,
                provider
            );
        }
        catch (
            error
        ) {
            console.error(
                "UNLINK PROVIDER: Session synchronization failed.",
                {
                    debugId,

                    provider,

                    message:
                        error?.message
                        || "Unknown error"
                }
            );

            try {
                await deleteSession(
                    env,
                    sessionId
                );
            }
            catch (
                deleteError
            ) {
                console.error(
                    "UNLINK PROVIDER: Session invalidation also failed.",
                    {
                        debugId,

                        message:
                            deleteError?.message
                            || "Unknown error"
                    }
                );
            }

            const sessionCookie =
                clearSessionCookie(
                    request
                );

            return json(
                {
                    success:
                        true,

                    code:
                        "PROVIDER_UNLINKED_SESSION_RESET",

                    provider,

                    unlinked:
                        true,

                    sessionReset:
                        true,

                    remainingLoginIdentities:
                        result.remainingLoginIdentities,

                    message:
                        "The provider was unlinked, but your session was reset. Please sign in again.",

                    debugId
                },
                200,
                sessionCookie
                    ? {
                        "Set-Cookie":
                            sessionCookie
                    }
                    : {}
            );
        }

        /* =================================================
        COMPLETE
        ================================================= */

        console.info(
            "UNLINK PROVIDER: Provider unlinked.",
            {
                debugId,

                provider,

                remainingLoginIdentities:
                    result.remainingLoginIdentities
            }
        );

        return json(
            {
                success:
                    true,

                provider,

                unlinked:
                    true,

                sessionReset:
                    false,

                remainingLoginIdentities:
                    result.remainingLoginIdentities
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "UNLINK PROVIDER: Unexpected failure.",
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
                    "UNLINK_PROVIDER_FAILED",

                message:
                    "The authentication provider could not be unlinked.",

                debugId
            },
            500
        );
    }
}