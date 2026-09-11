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
    Validates the active BPD session, removes the provider
    identity through Supabase, and synchronizes the
    centralized Cloudflare KV session.

Database RPC:
    api.unlink_account_identity

Flow:
    Authenticated BPD session
        ↓
    Resolve identity.accounts.id from session
        ↓
    Validate provider
        ↓
    Call api.unlink_account_identity
        ↓
    Database verifies:
        - provider belongs to account
        - another login identity remains
        - provider can safely be removed
        ↓
    Remove provider from centralized KV session

Important:
    - Account ID is NEVER accepted from the browser.
    - session.userId is the authoritative target account.
    - Unlinking does NOT delete identity.accounts.
    - Unlinking does NOT detach core.rl_players.
    - Unlinking Google removes its Supabase auth bridge
      through the database RPC.
    - If session synchronization fails after the database
      unlink succeeds, the current BPD session is destroyed
      and its browser cookie is cleared.
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
    getSessionContext
} from "../sessions/session_context.js";

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
        typeof value !== "string"
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
        || typeof body !== "object"
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
        env.SUPABASE_AUTH
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
            env.SUPABASE_URL
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
        || typeof record !== "object"
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
        || resolvedAccountId !== accountId
    ) {
        throw new Error(
            "Provider unlink returned an unexpected account."
        );
    }

    if (
        !resolvedProvider
        || resolvedProvider !== provider
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
            record.unlinked === true,

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
        AUTHENTICATED GLOBAL ACCOUNT
        ================================================= */

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
                        "You must be signed in to unlink an authentication provider.",

                    debugId
                },
                401
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

        const accountId =
            normalizeString(
                session.userId
            );

        const sessionId =
            normalizeString(
                session.sessionId
            );

        if (
            !accountId
            || !sessionId
        ) {
            console.error(
                "UNLINK PROVIDER: Session identity incomplete.",
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
                409
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

        The browser never supplies accountId.
        session.userId determines the target account.
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
            result.unlinked !== true
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

        Supabase has already completed the authoritative
        provider unlink.

        If KV synchronization fails, invalidate both the KV
        session and browser session cookie so stale provider
        authentication cannot remain trusted.
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