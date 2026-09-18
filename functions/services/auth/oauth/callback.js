"use strict";

/* =========================================================
BPD GAMING NETWORK
CENTRALIZED SUPABASE OAUTH CALLBACK SERVICE

File:
    functions/services/auth/oauth/callback.js

Public Route:
    GET /api/auth/_oauth/callback

API Route:
    functions/api/auth/_oauth/callback.js

Purpose:
    Completes Supabase-managed OAuth authentication,
    provider-linking, and provider-reauthorization flows.

Supported Providers:
    - Google
    - Discord

Supported OAuth Modes:
    - login
    - link
    - reauthorize

Login Flow:
    Provider authentication
        ↓
    Supabase PKCE callback
        ↓
    Resolve provider identity
        ↓
    Provider-specific identity RPC
        ↓
    Resolve or create identity.accounts
        ↓
    Establish centralized BPD session
        ↓
    Record BPD login when a new session was created
        ↓
    Record provider authentication freshness
        ↓
    Redirect to requested local destination

Link Flow:
    Existing authenticated BPD session
        ↓
    Provider authentication
        ↓
    Verify target identity.accounts.id
        ↓
    Provider-specific link RPC
        ↓
    Attach provider identity to existing account
        ↓
    Update current BPD session provider state
        ↓
    Record provider authentication freshness

Reauthorization Flow:
    Existing authenticated BPD session
        ↓
    Provider authentication
        ↓
    Verify target identity.accounts.id
        ↓
    Load permanent provider identity from Supabase
        ↓
    Require returned provider subject to match linked subject
        ↓
    Update current BPD session provider state
        ↓
    Record provider authentication freshness

Important:
    - Epic direct OAuth is handled by its own callback service.
    - Supabase access tokens are never stored in BPD sessions.
    - Supabase refresh tokens are never stored in BPD sessions.
    - Provider access tokens are never stored in BPD sessions.
    - Email never determines BPD account ownership.
    - Link mode never creates identity.accounts.
    - Reauthorize mode never creates or relinks an identity.
    - Provider ownership is based on provider subject.
========================================================= */

import {
    SUPPORTED_OAUTH_PROVIDERS,
    getProviderConfig,
    getProviderIdentity,
    validateExpectedProvider,
    normalizeString,
    normalizeNullableString
} from "./provider_helpers.js";

import {
    OAUTH_MODE_LINK,
    OAUTH_MODE_REAUTHORIZE,
    getOAuthMode,
    getOAuthProvider,
    getOAuthPkceVerifier,
    getOAuthAccountId,
    getOAuthReturnTo,
    getOAuthClearCookies,
    isOAuthExistingAccountMode
} from "./state.js";

import {
    json,
    redirect
} from "../../common_helpers/responses.js";

import {
    createSession,
    createSessionCookie,
    attachProviderToSession,
    setSessionUser,
    deleteSession
} from "../sessions/session.js";

import {
    getSessionContext
} from "../sessions/session_context.js";

import {
    verifyAccountProviderIdentity
} from "../providers/provider_identity.js";

import {
    completeAuthentication,
    isAuthenticationCompletionError
} from "../authentication.js";

/* =========================================================
CONSTANTS
========================================================= */

const NEW_ACCOUNT_RETURN_TO =
    "/Account?setup=1";

/* =========================================================
SUPABASE PROJECT ORIGIN
========================================================= */

function getSupabaseOrigin(
    env
) {
    const configuredUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    if (
        !configuredUrl
    ) {
        return null;
    }

    try {
        return new URL(
            configuredUrl
        ).origin;
    }
    catch {
        return null;
    }
}

/* =========================================================
SUPABASE SERVER KEY
========================================================= */

function getSupabaseApiKey(
    env
) {
    return normalizeString(
        env?.SUPABASE_AUTH
    );
}

/* =========================================================
SUPABASE DATA API BASE URL
========================================================= */

function getSupabaseDataBaseUrl(
    env
) {
    const supabaseUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    if (
        !supabaseUrl
    ) {
        return null;
    }

    return supabaseUrl.endsWith(
        "/"
    )
        ? supabaseUrl
        : `${supabaseUrl}/`;
}

/* =========================================================
PKCE TOKEN EXCHANGE
========================================================= */

async function exchangeSupabaseCode(
    env,
    code,
    verifier
) {
    const origin =
        getSupabaseOrigin(
            env
        );

    const apiKey =
        getSupabaseApiKey(
            env
        );

    if (
        !origin
        || !apiKey
    ) {
        throw new Error(
            "Supabase Auth configuration is unavailable."
        );
    }

    const response =
        await fetch(
            `${origin}/auth/v1/token?grant_type=pkce`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        apiKey,

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        auth_code:
                            code,

                        code_verifier:
                            verifier
                    })
            }
        );

    if (
        !response.ok
    ) {
        const error =
            new Error(
                "Supabase OAuth code exchange failed."
            );

        error.upstreamStatus =
            response.status;

        throw error;
    }

    let data;

    try {
        data =
            await response.json();
    }
    catch {
        throw new Error(
            "Supabase OAuth token response was invalid."
        );
    }

    if (
        !data
        || typeof data !==
            "object"
        || Array.isArray(
            data
        )
    ) {
        throw new Error(
            "Supabase OAuth token response was invalid."
        );
    }

    const accessToken =
        normalizeString(
            data.access_token
        );

    if (
        !accessToken
    ) {
        throw new Error(
            "Supabase OAuth token response contained no access token."
        );
    }

    return {
        accessToken
    };
}

/* =========================================================
LOAD AUTHENTICATED SUPABASE USER
========================================================= */

async function loadSupabaseAuthUser(
    env,
    accessToken
) {
    const origin =
        getSupabaseOrigin(
            env
        );

    const apiKey =
        getSupabaseApiKey(
            env
        );

    if (
        !origin
        || !apiKey
    ) {
        throw new Error(
            "Supabase Auth configuration is unavailable."
        );
    }

    const response =
        await fetch(
            `${origin}/auth/v1/user`,
            {
                method:
                    "GET",

                headers: {
                    "apikey":
                        apiKey,

                    "Authorization":
                        `Bearer ${accessToken}`,

                    "Accept":
                        "application/json"
                }
            }
        );

    if (
        !response.ok
    ) {
        const error =
            new Error(
                "Supabase authenticated user could not be validated."
            );

        error.upstreamStatus =
            response.status;

        throw error;
    }

    let user;

    try {
        user =
            await response.json();
    }
    catch {
        throw new Error(
            "Supabase authenticated user response was invalid."
        );
    }

    if (
        !user
        || typeof user !==
            "object"
        || Array.isArray(
            user
        )
        || !normalizeString(
            user.id
        )
    ) {
        throw new Error(
            "Supabase returned no authenticated user identity."
        );
    }

    return user;
}

/* =========================================================
READ RPC RESULT
========================================================= */

async function readRpcRecord(
    response,
    failureMessage
) {
    if (
        !response.ok
    ) {
        let errorCode =
            null;

        let errorMessage =
            null;

        try {
            const errorData =
                await response.json();

            errorCode =
                normalizeNullableString(
                    errorData?.code
                );

            errorMessage =
                normalizeNullableString(
                    errorData?.message
                );
        }
        catch {
            // Ignore malformed upstream error bodies.
        }

        const error =
            new Error(
                errorMessage
                || failureMessage
            );

        error.upstreamStatus =
            response.status;

        error.upstreamCode =
            errorCode;

        throw error;
    }

    let data;

    try {
        data =
            await response.json();
    }
    catch {
        throw new Error(
            "Identity RPC response was invalid."
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
            "Identity RPC returned no account."
        );
    }

    return record;
}

/* =========================================================
CALL PROVIDER RPC
========================================================= */

async function callProviderRpc(
    env,
    rpcName,
    body,
    failureMessage
) {
    const baseUrl =
        getSupabaseDataBaseUrl(
            env
        );

    const apiKey =
        getSupabaseApiKey(
            env
        );

    if (
        !baseUrl
        || !apiKey
    ) {
        throw new Error(
            "Supabase Data API configuration is unavailable."
        );
    }

    const response =
        await fetch(
            `${baseUrl}rpc/${rpcName}`,
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
                    JSON.stringify(
                        body
                    )
            }
        );

    return readRpcRecord(
        response,
        failureMessage
    );
}

/* =========================================================
NORMAL LOGIN IDENTITY RESOLUTION
========================================================= */

async function resolveProviderIdentity(
    env,
    providerIdentity
) {
    const providerConfig =
        getProviderConfig(
            providerIdentity.provider
        );

    if (
        !providerConfig
    ) {
        throw new Error(
            "Provider configuration is unavailable."
        );
    }

    const record =
        await callProviderRpc(
            env,
            providerConfig.resolveRpc,
            {
                p_auth_user_id:
                    providerIdentity.authUserId,

                p_provider_subject:
                    providerIdentity.providerSubject,

                p_email:
                    providerIdentity.email,

                p_email_verified:
                    providerIdentity.emailVerified ===
                    true,

                p_display_username:
                    providerIdentity.displayName
                    || providerIdentity.preferredUsername
            },
            `${providerConfig.label} identity resolution failed.`
        );

    const accountId =
        normalizeString(
            record.account_id
            ?? record.accountId
        );

    if (
        !accountId
    ) {
        throw new Error(
            `${providerConfig.label} identity resolution returned no account ID.`
        );
    }

    return {
        accountId,

        role:
            normalizeString(
                record.role
            )
            || "user",

        active:
            record.active !==
            false,

        createdAccount:
            record.created_account ===
            true
            || record.createdAccount ===
            true,

        createdIdentity:
            record.created_identity ===
            true
            || record.createdIdentity ===
            true
    };
}

/* =========================================================
EXPLICIT PROVIDER LINK
========================================================= */

async function linkProviderIdentity(
    env,
    accountId,
    providerIdentity
) {
    const providerConfig =
        getProviderConfig(
            providerIdentity.provider
        );

    if (
        !providerConfig
    ) {
        throw new Error(
            "Provider configuration is unavailable."
        );
    }

    const record =
        await callProviderRpc(
            env,
            providerConfig.linkRpc,
            {
                p_account_id:
                    accountId,

                p_auth_user_id:
                    providerIdentity.authUserId,

                p_provider_subject:
                    providerIdentity.providerSubject,

                p_email:
                    providerIdentity.email,

                p_email_verified:
                    providerIdentity.emailVerified ===
                    true,

                p_display_username:
                    providerIdentity.displayName
                    || providerIdentity.preferredUsername
            },
            `${providerConfig.label} identity linking failed.`
        );

    const resolvedAccountId =
        normalizeString(
            record.account_id
            ?? record.accountId
        );

    if (
        !resolvedAccountId
    ) {
        throw new Error(
            `${providerConfig.label} identity linking returned no account ID.`
        );
    }

    return {
        accountId:
            resolvedAccountId,

        role:
            normalizeString(
                record.role
            )
            || "user",

        active:
            record.active !==
            false,

        linkedIdentity:
            record.linked_identity ===
            true
            || record.linkedIdentity ===
            true
    };
}

/* =========================================================
PROVIDER SESSION DATA
========================================================= */

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

    const numericValue =
        Number(
            value
        );

    if (
        Number.isFinite(
            numericValue
        )
        && numericValue > 0
    ) {
        return numericValue;
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

function buildProviderSessionData(
    providerIdentity,
    {
        linkedAt = null
    } = {}
) {
    const now =
        Date.now();

    return {
        Linked:
            true,

        Authenticated:
            true,

        AccountId:
            providerIdentity.providerSubject,

        DisplayName:
            providerIdentity.displayName,

        PreferredUsername:
            providerIdentity.preferredUsername,

        Email:
            providerIdentity.email,

        AuthenticatedAt:
            now,

        LinkedAt:
            normalizeTimestamp(
                linkedAt
            )
            ?? now
    };
}

/* =========================================================
IDENTITY CONFLICT
========================================================= */

function hasIdentityConflict(
    sessionContext,
    resolvedAccount
) {
    const currentAccountId =
        normalizeString(
            sessionContext?.userId
        );

    const resolvedAccountId =
        normalizeString(
            resolvedAccount?.accountId
        );

    if (
        !currentAccountId
        || !resolvedAccountId
    ) {
        return false;
    }

    return currentAccountId !==
        resolvedAccountId;
}

/* =========================================================
NORMAL LOGIN SESSION
========================================================= */

async function establishLoginSession(
    request,
    env,
    providerIdentity,
    resolvedAccount
) {
    const existingSession =
        await getSessionContext(
            request,
            env
        );

    const provider =
        providerIdentity.provider;

    if (
        existingSession.authenticated ===
        true
    ) {
        if (
            hasIdentityConflict(
                existingSession,
                resolvedAccount
            )
        ) {
            return {
                conflict:
                    true,

                createdSession:
                    false,

                sessionCookie:
                    null,

                sessionId:
                    existingSession.sessionId
            };
        }

        await attachProviderToSession(
            env,
            existingSession.sessionId,
            provider,
            buildProviderSessionData(
                providerIdentity,
                {
                    linkedAt:
                        existingSession
                            ?.providers
                            ?.[provider]
                            ?.linkedAt
                }
            )
        );

        await setSessionUser(
            env,
            existingSession.sessionId,
            {
                userId:
                    resolvedAccount.accountId,

                role:
                    resolvedAccount.role,

                active:
                    resolvedAccount.active
            }
        );

        return {
            conflict:
                false,

            createdSession:
                false,

            sessionCookie:
                null,

            sessionId:
                existingSession.sessionId
        };
    }

    const created =
        await createSession(
            env,
            {
                UserId:
                    resolvedAccount.accountId,

                Role:
                    resolvedAccount.role,

                Active:
                    resolvedAccount.active,

                Providers: {
                    [provider]:
                        buildProviderSessionData(
                            providerIdentity
                        )
                }
            }
        );

    try {
        const sessionCookie =
            createSessionCookie(
                request,
                created.sessionId
            );

        if (
            !sessionCookie
        ) {
            throw new Error(
                "BPD session cookie creation failed."
            );
        }

        return {
            conflict:
                false,

            createdSession:
                true,

            sessionCookie,

            sessionId:
                created.sessionId
        };
    }
    catch (
        error
    ) {
        await deleteSession(
            env,
            created.sessionId
        );

        throw error;
    }
}

/* =========================================================
VALIDATE EXISTING ACCOUNT SESSION

Used by both:
    link
    reauthorize
========================================================= */

async function getExistingAccountContext(
    request,
    env
) {
    const targetAccountId =
        normalizeString(
            getOAuthAccountId(
                request
            )
        );

    if (
        !targetAccountId
    ) {
        return {
            valid:
                false,

            code:
                "OAUTH_ACCOUNT_MISSING",

            session:
                null,

            accountId:
                null
        };
    }

    const session =
        await getSessionContext(
            request,
            env
        );

    if (
        session.authenticated !==
        true
    ) {
        return {
            valid:
                false,

            code:
                "AUTH_REQUIRED",

            session,

            accountId:
                targetAccountId
        };
    }

    if (
        session.active !==
        true
    ) {
        return {
            valid:
                false,

            code:
                "ACCOUNT_INACTIVE",

            session,

            accountId:
                targetAccountId
        };
    }

    const currentAccountId =
        normalizeString(
            session.userId
        );

    if (
        !currentAccountId
    ) {
        return {
            valid:
                false,

            code:
                "SESSION_ACCOUNT_MISSING",

            session,

            accountId:
                targetAccountId
        };
    }

    if (
        currentAccountId !==
        targetAccountId
    ) {
        return {
            valid:
                false,

            code:
                "OAUTH_ACCOUNT_MISMATCH",

            session,

            accountId:
                targetAccountId
        };
    }

    return {
        valid:
            true,

        code:
            null,

        session,

        accountId:
            targetAccountId
    };
}

/* =========================================================
UPDATE EXISTING SESSION AFTER LINK
========================================================= */

async function establishLinkedSession(
    env,
    accountContext,
    providerIdentity,
    linkedAccount
) {
    if (
        normalizeString(
            linkedAccount.accountId
        )
        !== accountContext.accountId
    ) {
        throw new Error(
            "Linked account did not match the authenticated BPD account."
        );
    }

    await attachProviderToSession(
        env,
        accountContext.session.sessionId,
        providerIdentity.provider,
        buildProviderSessionData(
            providerIdentity
        )
    );

    await setSessionUser(
        env,
        accountContext.session.sessionId,
        {
            userId:
                linkedAccount.accountId,

            role:
                linkedAccount.role,

            active:
                linkedAccount.active
        }
    );

    return {
        sessionId:
            accountContext.session.sessionId
    };
}

/* =========================================================
VERIFY REAUTHORIZATION IDENTITY

The provider OAuth result must match the permanent provider
subject already linked to the canonical BPD account.

No linking RPC is called here.
========================================================= */

async function verifyReauthorizationIdentity(
    env,
    accountId,
    providerIdentity
) {
    let linkedProvider;

    try {
        linkedProvider =
            await verifyAccountProviderIdentity(
                env,
                accountId,
                providerIdentity.provider
            );
    }
    catch (
        error
    ) {
        const verificationError =
            new Error(
                "The linked provider identity could not be verified."
            );

        verificationError.code =
            "PROVIDER_VERIFICATION_UNAVAILABLE";

        verificationError.status =
            503;

        verificationError.cause =
            error;

        throw verificationError;
    }

    if (
        !linkedProvider
    ) {
        const error =
            new Error(
                "The provider is no longer linked to this BPD account."
            );

        error.code =
            "PROVIDER_NOT_LINKED";

        error.status =
            409;

        throw error;
    }

    const linkedProviderName =
        normalizeString(
            linkedProvider.provider
        )
            .toLowerCase();

    const linkedProviderSubject =
        normalizeString(
            linkedProvider.providerSubject
        );

    const authenticatedProviderName =
        normalizeString(
            providerIdentity.provider
        )
            .toLowerCase();

    const authenticatedProviderSubject =
        normalizeString(
            providerIdentity.providerSubject
        );

    if (
        linkedProviderName !==
            authenticatedProviderName
        || !linkedProviderSubject
        || !authenticatedProviderSubject
        || linkedProviderSubject !==
            authenticatedProviderSubject
    ) {
        const error =
            new Error(
                "The authenticated provider account does not match the linked provider identity."
            );

        error.code =
            "PROVIDER_REAUTHORIZATION_MISMATCH";

        error.status =
            409;

        throw error;
    }

    return linkedProvider;
}

/* =========================================================
UPDATE SESSION AFTER REAUTHORIZATION
========================================================= */

async function establishReauthorizedSession(
    env,
    accountContext,
    providerIdentity,
    linkedProvider
) {
    const provider =
        providerIdentity.provider;

    const existingLinkedAt =
        accountContext
            ?.session
            ?.providers
            ?.[provider]
            ?.linkedAt;

    await attachProviderToSession(
        env,
        accountContext.session.sessionId,
        provider,
        buildProviderSessionData(
            providerIdentity,
            {
                linkedAt:
                    existingLinkedAt
                    ?? linkedProvider?.linkedAt
                    ?? null
            }
        )
    );

    return {
        sessionId:
            accountContext.session.sessionId
    };
}

/* =========================================================
COMPLETE AUTHENTICATION STATE
========================================================= */

async function recordCompletedAuthentication(
    env,
    {
        accountId,
        provider,
        recordLogin
    }
) {
    try {
        return await completeAuthentication(
            env,
            {
                accountId,
                provider,
                recordLogin:
                    recordLogin ===
                    true
            }
        );
    }
    catch (
        error
    ) {
        if (
            isAuthenticationCompletionError(
                error
            )
        ) {
            throw error;
        }

        throw error;
    }
}

/* =========================================================
AUTHENTICATION STATE ERROR RESPONSE
========================================================= */

function getAuthenticationStateErrorResponse(
    error,
    debugId,
    provider
) {
    console.error(
        "OAUTH CALLBACK: Authentication state completion failed.",
        {
            debugId,

            provider,

            code:
                error?.code
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
                error?.code
                || "AUTHENTICATION_STATE_WRITE_FAILED",

            message:
                "Authentication succeeded, but the BPD authentication state could not be finalized.",

            debugId
        },
        503
    );
}

/* =========================================================
MAIN CALLBACK
========================================================= */

export async function handleOAuthCallback(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    const url =
        new URL(
            request.url
        );

    const code =
        normalizeString(
            url.searchParams.get(
                "code"
            )
        );

    const oauthError =
        normalizeNullableString(
            url.searchParams.get(
                "error"
            )
        );

    const provider =
        getOAuthProvider(
            request
        );

    const verifier =
        getOAuthPkceVerifier(
            request
        );

    const mode =
        getOAuthMode(
            request
        );

    /*
     * Read before clearing one-time OAuth cookies.
     */
    const returnTo =
        getOAuthReturnTo(
            request
        );

    try {
        /* =================================================
        PROVIDER ERROR
        ================================================= */

        if (
            oauthError
        ) {
            console.warn(
                "OAUTH CALLBACK: Provider returned an OAuth error.",
                {
                    debugId,

                    provider:
                        provider
                        || null,

                    mode:
                        mode
                        || null,

                    error:
                        oauthError
                }
            );

            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_PROVIDER_REJECTED",

                    message:
                        "OAuth authentication was not completed.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        CALLBACK VALIDATION
        ================================================= */

        if (
            !code
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_CODE_MISSING",

                    message:
                        "OAuth authorization code is missing.",

                    debugId
                },
                400
            );
        }

        if (
            !provider
            || !SUPPORTED_OAUTH_PROVIDERS.has(
                provider
            )
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_PROVIDER_INVALID",

                    message:
                        "OAuth provider context is invalid.",

                    debugId
                },
                400
            );
        }

        if (
            !mode
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_MODE_INVALID",

                    message:
                        "OAuth operation mode is invalid.",

                    debugId
                },
                400
            );
        }

        if (
            !verifier
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_PKCE_MISSING",

                    message:
                        "OAuth verification data is missing. Please restart authentication.",

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
                        "OAUTH_PROVIDER_CONFIGURATION_MISSING",

                    message:
                        "OAuth provider configuration is unavailable.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        VALIDATE EXISTING ACCOUNT SESSION

        Both link and reauthorize require an existing,
        authenticated BPD account.
        ================================================= */

        let accountContext =
            null;

        if (
            isOAuthExistingAccountMode(
                mode
            )
        ) {
            accountContext =
                await getExistingAccountContext(
                    request,
                    env
                );

            if (
                accountContext.valid !==
                true
            ) {
                console.warn(
                    "OAUTH CALLBACK: Existing account context validation failed.",
                    {
                        debugId,
                        provider,
                        mode,

                        code:
                            accountContext.code
                    }
                );

                return json(
                    {
                        success:
                            false,

                        code:
                            accountContext.code,

                        message:
                            "The provider authentication request is no longer valid.",

                        debugId
                    },
                    409
                );
            }
        }

        /* =================================================
        EXCHANGE AUTH CODE
        ================================================= */

        let tokenResult;

        try {
            tokenResult =
                await exchangeSupabaseCode(
                    env,
                    code,
                    verifier
                );
        }
        catch (
            error
        ) {
            console.error(
                "OAUTH CALLBACK: Supabase code exchange failed.",
                {
                    debugId,
                    provider,
                    mode,

                    upstreamStatus:
                        error?.upstreamStatus
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
                        "OAUTH_CODE_EXCHANGE_FAILED",

                    message:
                        "OAuth authorization could not be verified.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        VALIDATE AUTH USER
        ================================================= */

        let authUser;

        try {
            authUser =
                await loadSupabaseAuthUser(
                    env,
                    tokenResult.accessToken
                );
        }
        catch (
            error
        ) {
            console.error(
                "OAUTH CALLBACK: Supabase Auth user validation failed.",
                {
                    debugId,
                    provider,
                    mode,

                    upstreamStatus:
                        error?.upstreamStatus
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
                        "OAUTH_USER_VALIDATION_FAILED",

                    message:
                        "Authenticated user could not be validated.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        CONFIRM EXPECTED PROVIDER
        ================================================= */

        if (
            !validateExpectedProvider(
                provider,
                authUser
            )
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "OAUTH_PROVIDER_MISMATCH",

                    message:
                        "Authenticated provider did not match the requested authentication flow.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        RESOLVE PROVIDER IDENTITY
        ================================================= */

        const providerIdentity =
            getProviderIdentity(
                authUser,
                provider
            );

        if (
            !providerIdentity
            || !providerIdentity.authUserId
            || !providerIdentity.providerSubject
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "PROVIDER_IDENTITY_MISSING",

                    message:
                        "Provider identity could not be resolved.",

                    debugId
                },
                502
            );
        }

        /* =================================================
        EXPLICIT LINK FLOW
        ================================================= */

        if (
            mode ===
            OAUTH_MODE_LINK
        ) {
            let linkedAccount;

            try {
                linkedAccount =
                    await linkProviderIdentity(
                        env,
                        accountContext.accountId,
                        providerIdentity
                    );
            }
            catch (
                error
            ) {
                console.error(
                    "OAUTH CALLBACK: Provider identity link failed.",
                    {
                        debugId,
                        provider,

                        upstreamStatus:
                            error?.upstreamStatus
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
                            error?.upstreamCode
                            || "ACCOUNT_LINK_FAILED",

                        message:
                            `${providerConfig.label} could not be linked to this BPD account.`,

                        debugId
                    },
                    409
                );
            }

            if (
                linkedAccount.active !==
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

            await establishLinkedSession(
                env,
                accountContext,
                providerIdentity,
                linkedAccount
            );

            try {
                await recordCompletedAuthentication(
                    env,
                    {
                        accountId:
                            linkedAccount.accountId,

                        provider,

                        recordLogin:
                            false
                    }
                );
            }
            catch (
                error
            ) {
                return getAuthenticationStateErrorResponse(
                    error,
                    debugId,
                    provider
                );
            }

            console.info(
                "OAUTH CALLBACK: Provider link completed.",
                {
                    debugId,
                    provider,

                    linkedIdentity:
                        linkedAccount.linkedIdentity ===
                        true
                }
            );

            return redirect(
                returnTo,
                getOAuthClearCookies(
                    request
                )
            );
        }

        /* =================================================
        REAUTHORIZATION FLOW
        ================================================= */

        if (
            mode ===
            OAUTH_MODE_REAUTHORIZE
        ) {
            let linkedProvider;

            try {
                linkedProvider =
                    await verifyReauthorizationIdentity(
                        env,
                        accountContext.accountId,
                        providerIdentity
                    );
            }
            catch (
                error
            ) {
                console.error(
                    "OAUTH CALLBACK: Provider reauthorization verification failed.",
                    {
                        debugId,
                        provider,

                        code:
                            error?.code
                            || null,

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

                        code:
                            error?.code
                            || "PROVIDER_REAUTHORIZATION_FAILED",

                        message:
                            error?.code ===
                            "PROVIDER_REAUTHORIZATION_MISMATCH"
                                ? `The authenticated ${providerConfig.label} account does not match the account currently linked to this BPD account.`
                                : `${providerConfig.label} could not be reauthorized.`,

                        debugId
                    },
                    Number.isInteger(
                        error?.status
                    )
                        ? error.status
                        : 409
                );
            }

            await establishReauthorizedSession(
                env,
                accountContext,
                providerIdentity,
                linkedProvider
            );

            try {
                await recordCompletedAuthentication(
                    env,
                    {
                        accountId:
                            accountContext.accountId,

                        provider,

                        recordLogin:
                            false
                    }
                );
            }
            catch (
                error
            ) {
                return getAuthenticationStateErrorResponse(
                    error,
                    debugId,
                    provider
                );
            }

            console.info(
                "OAUTH CALLBACK: Provider reauthorization completed.",
                {
                    debugId,
                    provider,
                    accountId:
                        accountContext.accountId
                }
            );

            return redirect(
                returnTo,
                getOAuthClearCookies(
                    request
                )
            );
        }

        /* =================================================
        NORMAL LOGIN FLOW
        ================================================= */

        let resolvedAccount;

        try {
            resolvedAccount =
                await resolveProviderIdentity(
                    env,
                    providerIdentity
                );
        }
        catch (
            error
        ) {
            console.error(
                "OAUTH CALLBACK: Global identity resolution failed.",
                {
                    debugId,
                    provider,

                    upstreamStatus:
                        error?.upstreamStatus
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
                        error?.upstreamCode
                        || "ACCOUNT_RESOLUTION_FAILED",

                    message:
                        "BPD account synchronization failed.",

                    debugId
                },
                502
            );
        }

        if (
            resolvedAccount.active !==
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

        const sessionResult =
            await establishLoginSession(
                request,
                env,
                providerIdentity,
                resolvedAccount
            );

        if (
            sessionResult.conflict ===
            true
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_LINK_CONFLICT",

                    message:
                        `This ${providerConfig.label} account is associated with a different BPD account.`,

                    debugId
                },
                409
            );
        }

        /*
         * Only a newly created BPD browser session counts as
         * a successful BPD login for the 10-day login-gap
         * policy.
         *
         * Reusing an already authenticated BPD session does
         * not advance account_login_status.lastLoginAt.
         */
        try {
            await recordCompletedAuthentication(
                env,
                {
                    accountId:
                        resolvedAccount.accountId,

                    provider,

                    recordLogin:
                        sessionResult.createdSession ===
                        true
                }
            );
        }
        catch (
            error
        ) {
            /*
             * If this callback created a brand-new session but
             * auth-state persistence fails, do not leave that
             * newly created session active.
             */
            if (
                sessionResult.createdSession ===
                true
                && sessionResult.sessionId
            ) {
                try {
                    await deleteSession(
                        env,
                        sessionResult.sessionId
                    );
                }
                catch (
                    deleteError
                ) {
                    console.error(
                        "OAUTH CALLBACK: Failed to clean up session after auth-state failure.",
                        {
                            debugId,

                            message:
                                deleteError?.message
                                || "Unknown error"
                        }
                    );
                }
            }

            return getAuthenticationStateErrorResponse(
                error,
                debugId,
                provider
            );
        }

        const cookies =
            getOAuthClearCookies(
                request
            );

        if (
            sessionResult.sessionCookie
        ) {
            cookies.unshift(
                sessionResult.sessionCookie
            );
        }

        const destination =
            resolvedAccount.createdAccount ===
            true
                ? NEW_ACCOUNT_RETURN_TO
                : returnTo;

        console.info(
            "OAUTH CALLBACK: Authentication completed.",
            {
                debugId,
                provider,
                mode,

                createdAccount:
                    resolvedAccount.createdAccount ===
                    true,

                createdIdentity:
                    resolvedAccount.createdIdentity ===
                    true,

                createdSession:
                    sessionResult.createdSession ===
                    true,

                reusedSession:
                    sessionResult.createdSession !==
                    true
            }
        );

        return redirect(
            destination,
            cookies
        );
    }
    catch (
        error
    ) {
        console.error(
            "OAUTH CALLBACK: Unexpected failure.",
            {
                debugId,

                provider:
                    provider
                    || null,

                mode:
                    mode
                    || null,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
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
                    error?.code
                    || "OAUTH_CALLBACK_FAILED",

                message:
                    "OAuth callback failed unexpectedly.",

                debugId
            },
            500
        );
    }
}