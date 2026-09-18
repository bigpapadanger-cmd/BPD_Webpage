"use strict";

/* =========================================================
BPD GAMING NETWORK
CENTRAL AUTHENTICATION COMPLETION SERVICE

File:
    functions/services/auth/authentication.js

Purpose:
    Centralizes successful external-provider authentication
    completion.

Responsibilities:
    - Record successful provider authentication freshness.
    - Optionally record an actual BPD login event.
    - Use one shared server-generated timestamp for the
      complete authentication event.
    - Keep provider callbacks from duplicating auth-policy
      state management.

Important:
    Provider authentication and BPD login are separate events.

    Provider authentication:
        Epic / Google / Discord / Steam successfully proves
        ownership again.

    BPD login:
        A provider authentication establishes or re-establishes
        the user's BPD browser login.

    Linking or reauthorizing a provider while an existing BPD
    session is active MUST NOT update the BPD login timestamp.

Authentication Event Ordering:
    1. Generate one trusted server-side event timestamp.
    2. Record provider authentication using that timestamp.
    3. If this was a real BPD login, record the account login
       using the same timestamp.

Why provider authentication is written first:
    - If provider-state persistence fails, account login state
      remains unchanged.
    - If account-login persistence fails afterward, the
      provider authentication still truthfully occurred.
    - Shared timestamps guarantee that a provider used to
      establish a BPD login is not considered older than the
      providerReauthAfter cutoff.
========================================================= */

import {
    completeProviderAuthentication
} from "./providers/provider_authentication.js";

import {
    recordAccountLogin
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

function normalizeProvider(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

/* =========================================================
AUTHENTICATION ERROR
========================================================= */

export class AuthenticationCompletionError extends Error {
    constructor(
        code,
        message,
        cause = null
    ) {
        super(
            message
        );

        this.name =
            "AuthenticationCompletionError";

        this.code =
            normalizeString(
                code
            )
            || "AUTHENTICATION_COMPLETION_FAILED";

        this.cause =
            cause;
    }
}

/* =========================================================
COMPLETE AUTHENTICATION
========================================================= */

export async function completeAuthentication(
    env,
    {
        accountId,
        provider,
        recordLogin = false
    } = {}
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !normalizedAccountId
    ) {
        throw new AuthenticationCompletionError(
            "ACCOUNT_ID_REQUIRED",
            "A canonical BPD account ID is required."
        );
    }

    if (
        !normalizedProvider
    ) {
        throw new AuthenticationCompletionError(
            "PROVIDER_REQUIRED",
            "An authentication provider is required."
        );
    }

    /*
     * One exact server-generated timestamp represents this
     * successful external-provider authentication event.
     *
     * If the event also establishes a new BPD browser login,
     * the provider-auth record and account-login record use
     * this exact same timestamp.
     */
    const authenticationEventAt =
        Date.now();

    /* =====================================================
    PROVIDER AUTHENTICATION

    Record this first.

    If this write fails, no BPD login timestamp is changed.
    ===================================================== */

    let providerState;

    try {
        providerState =
            await completeProviderAuthentication(
                env,
                normalizedAccountId,
                normalizedProvider,
                authenticationEventAt
            );
    }
    catch (
        error
    ) {
        throw new AuthenticationCompletionError(
            "PROVIDER_AUTH_STATE_WRITE_FAILED",
            "Provider authentication state could not be recorded.",
            error
        );
    }

    /* =====================================================
    BPD LOGIN

    Only true browser-login establishment reaches this block.

    Provider linking or reauthorization while an existing
    BPD session is active passes recordLogin = false and
    therefore does not alter lastLoginAt.
    ===================================================== */

    let loginState =
        null;

    if (
        recordLogin ===
        true
    ) {
        try {
            loginState =
                await recordAccountLogin(
                    env,
                    normalizedAccountId,
                    authenticationEventAt
                );
        }
        catch (
            error
        ) {
            throw new AuthenticationCompletionError(
                "ACCOUNT_LOGIN_STATE_WRITE_FAILED",
                "Account login state could not be recorded.",
                error
            );
        }
    }

    /* =====================================================
    RESULT
    ===================================================== */

    return {
        success:
            true,

        accountId:
            normalizedAccountId,

        provider:
            normalizedProvider,

        authenticationEventAt:
            new Date(
                authenticationEventAt
            )
                .toISOString(),

        providerState,

        loginRecorded:
            recordLogin ===
            true,

        loginState
    };
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isAuthenticationCompletionError(
    error
) {
    return (
        error instanceof
            AuthenticationCompletionError
        || error?.name ===
            "AuthenticationCompletionError"
    );
}