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
    Completes OAuth authentication and provider-linking flows
    managed through Supabase Auth.

Supported Providers:
    - Google
    - Discord
    - Epic Games

Supported OAuth Modes:
    - login
    - link

Login Flow:
    Provider authentication
        ↓
    Resolve provider identity
        ↓
    Provider-specific identity RPC
        ↓
    Resolve or create identity.accounts
        ↓
    Establish centralized BPD session

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

Important:
    - Supabase access tokens are NOT stored in BPD sessions.
    - Supabase refresh tokens are NOT stored in BPD sessions.
    - Provider access tokens are NOT stored in BPD sessions.
    - Raw sessionData is never consumed here.
    - Email never determines account ownership.
    - Link mode NEVER creates identity.accounts.
    - Provider ownership is based on provider subject.
========================================================= */

import {
    json,
    redirect
} from "../../common_helpers/responses.js";

import {
    getCookie,
    clearCookie,
    createSession,
    createSessionCookie,
    attachProviderToSession,
    setSessionUser,
    deleteSession
} from "../sessions/session.js";

import {
    getSessionContext
} from "../sessions/session_context.js";

/* =========================================================
OAUTH COOKIE NAMES
========================================================= */

const PKCE_COOKIE =
    "bpd_oauth_pkce";

const OAUTH_PROVIDER_COOKIE =
    "bpd_oauth_provider";

const OAUTH_MODE_COOKIE =
    "bpd_oauth_mode";

const OAUTH_ACCOUNT_COOKIE =
    "bpd_oauth_account";

/* =========================================================
OAUTH MODES
========================================================= */

const OAUTH_MODE_LOGIN =
    "login";

const OAUTH_MODE_LINK =
    "link";

/* =========================================================
SUPPORTED PROVIDERS
========================================================= */

const SUPPORTED_PROVIDERS =
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
            label:
                "Google",

            resolveRpc:
                "resolve_google_identity",

            linkRpc:
                "link_google_identity"
        },

        discord: {
            label:
                "Discord",

            resolveRpc:
                "resolve_discord_identity",

            linkRpc:
                "link_discord_identity"
        },

        epic: {
            label:
                "Epic Games",

            resolveRpc:
                "resolve_epic_identity",

            linkRpc:
                "link_epic_identity"
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

function normalizeProvider(
    value
) {
    return normalizeString(
        value
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
        normalizeProvider(
            provider
        );

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
SUPABASE PROJECT ORIGIN
========================================================= */

function getSupabaseOrigin(
    env
) {
    const configuredUrl =
        normalizeString(
            env.SUPABASE_URL
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
        env.SUPABASE_AUTH
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
            env.SUPABASE_URL
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
OAUTH MODE
========================================================= */

function getOAuthMode(
    request
) {
    const mode =
        normalizeString(
            getCookie(
                request,
                OAUTH_MODE_COOKIE
            )
        )
            .toLowerCase();

    /*
     * Existing login flows may not yet set bpd_oauth_mode.
     * Missing mode remains normal login for compatibility.
     */
    if (
        !mode
    ) {
        return OAUTH_MODE_LOGIN;
    }

    if (
        mode === OAUTH_MODE_LOGIN
        || mode === OAUTH_MODE_LINK
    ) {
        return mode;
    }

    return null;
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
SUPABASE PROVIDERS
========================================================= */

function getSupabaseProviders(
    user
) {
    const providers =
        new Set();

    const primaryProvider =
        normalizeProvider(
            user?.app_metadata
                ?.provider
        );

    if (
        primaryProvider
    ) {
        providers.add(
            primaryProvider
        );
    }

    const metadataProviders =
        user?.app_metadata
            ?.providers;

    if (
        Array.isArray(
            metadataProviders
        )
    ) {
        for (
            const provider
            of metadataProviders
        ) {
            const normalized =
                normalizeProvider(
                    provider
                );

            if (
                normalized
            ) {
                providers.add(
                    normalized
                );
            }
        }
    }

    if (
        Array.isArray(
            user?.identities
        )
    ) {
        for (
            const identity
            of user.identities
        ) {
            const normalized =
                normalizeProvider(
                    identity?.provider
                );

            if (
                normalized
            ) {
                providers.add(
                    normalized
                );
            }
        }
    }

    return [
        ...providers
    ];
}

/* =========================================================
EXPECTED PROVIDER VALIDATION
========================================================= */

function validateExpectedProvider(
    provider,
    user
) {
    const expectedProvider =
        normalizeProvider(
            provider
        );

    if (
        !expectedProvider
        || !SUPPORTED_PROVIDERS.has(
            expectedProvider
        )
    ) {
        return false;
    }

    return getSupabaseProviders(
        user
    )
        .includes(
            expectedProvider
        );
}

/* =========================================================
SUPABASE PROVIDER IDENTITY
========================================================= */

function getSupabaseIdentity(
    user,
    provider
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !normalizedProvider
    ) {
        return null;
    }

    const identities =
        Array.isArray(
            user?.identities
        )
            ? user.identities
            : [];

    return (
        identities.find(
            (
                entry
            ) =>
                normalizeProvider(
                    entry?.provider
                )
                === normalizedProvider
        )
        || null
    );
}

/* =========================================================
IDENTITY DATA
========================================================= */

function getIdentityData(
    identity
) {
    if (
        identity?.identity_data
        && typeof identity.identity_data ===
            "object"
        && !Array.isArray(
            identity.identity_data
        )
    ) {
        return identity.identity_data;
    }

    return {};
}

function getUserMetadata(
    user
) {
    if (
        user?.user_metadata
        && typeof user.user_metadata ===
            "object"
        && !Array.isArray(
            user.user_metadata
        )
    ) {
        return user.user_metadata;
    }

    return {};
}

/* =========================================================
PROVIDER SUBJECT
========================================================= */

function getProviderSubject(
    identity,
    identityData
) {
    return (
        normalizeString(
            identityData.sub
        )
        || normalizeString(
            identityData.provider_id
        )
        || normalizeString(
            identityData.user_id
        )
        || normalizeString(
            identity?.id
        )
    );
}

/* =========================================================
PROVIDER EMAIL
========================================================= */

function getProviderEmail(
    user,
    identityData
) {
    return (
        normalizeNullableString(
            identityData.email
        )
        || normalizeNullableString(
            user?.email
        )
    );
}

/* =========================================================
GOOGLE DISPLAY NAME
========================================================= */

function getGoogleDisplayName(
    identityData,
    userMetadata
) {
    return (
        normalizeNullableString(
            identityData.full_name
        )
        || normalizeNullableString(
            identityData.name
        )
        || normalizeNullableString(
            userMetadata.full_name
        )
        || normalizeNullableString(
            userMetadata.name
        )
    );
}

/* =========================================================
DISCORD DISPLAY NAME
========================================================= */

function getDiscordDisplayName(
    identityData,
    userMetadata
) {
    return (
        normalizeNullableString(
            identityData.global_name
        )
        || normalizeNullableString(
            identityData.full_name
        )
        || normalizeNullableString(
            identityData.name
        )
        || normalizeNullableString(
            identityData.username
        )
        || normalizeNullableString(
            userMetadata.global_name
        )
        || normalizeNullableString(
            userMetadata.full_name
        )
        || normalizeNullableString(
            userMetadata.name
        )
        || normalizeNullableString(
            userMetadata.user_name
        )
    );
}

/* =========================================================
EPIC DISPLAY NAME
========================================================= */

function getEpicDisplayName(
    identityData,
    userMetadata
) {
    return (
        normalizeNullableString(
            identityData.preferred_username
        )
        || normalizeNullableString(
            identityData.display_name
        )
        || normalizeNullableString(
            identityData.name
        )
        || normalizeNullableString(
            userMetadata.preferred_username
        )
        || normalizeNullableString(
            userMetadata.display_name
        )
        || normalizeNullableString(
            userMetadata.name
        )
    );
}

/* =========================================================
PROVIDER DISPLAY NAME
========================================================= */

function getProviderDisplayName(
    provider,
    identityData,
    userMetadata
) {
    if (
        provider ===
        "google"
    ) {
        return getGoogleDisplayName(
            identityData,
            userMetadata
        );
    }

    if (
        provider ===
        "discord"
    ) {
        return getDiscordDisplayName(
            identityData,
            userMetadata
        );
    }

    if (
        provider ===
        "epic"
    ) {
        return getEpicDisplayName(
            identityData,
            userMetadata
        );
    }

    return null;
}

/* =========================================================
PROVIDER PREFERRED USERNAME
========================================================= */

function getProviderPreferredUsername(
    provider,
    identityData,
    userMetadata
) {
    if (
        provider ===
        "discord"
    ) {
        return (
            normalizeNullableString(
                identityData.username
            )
            || normalizeNullableString(
                userMetadata.user_name
            )
            || normalizeNullableString(
                userMetadata.username
            )
        );
    }

    if (
        provider ===
        "epic"
    ) {
        return (
            normalizeNullableString(
                identityData.preferred_username
            )
            || normalizeNullableString(
                identityData.display_name
            )
            || normalizeNullableString(
                userMetadata.preferred_username
            )
            || normalizeNullableString(
                userMetadata.display_name
            )
        );
    }

    return null;
}

/* =========================================================
PROVIDER EMAIL VERIFIED
========================================================= */

function getProviderEmailVerified(
    identityData,
    userMetadata
) {
    return (
        identityData.email_verified ===
        true
        || userMetadata.email_verified ===
            true
    );
}

/* =========================================================
RESOLVE PROVIDER IDENTITY
========================================================= */

function getProviderIdentity(
    user,
    provider
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    const identity =
        getSupabaseIdentity(
            user,
            normalizedProvider
        );

    if (
        !identity
    ) {
        return null;
    }

    const identityData =
        getIdentityData(
            identity
        );

    const userMetadata =
        getUserMetadata(
            user
        );

    const providerSubject =
        getProviderSubject(
            identity,
            identityData
        );

    if (
        !providerSubject
    ) {
        return null;
    }

    return {
        provider:
            normalizedProvider,

        authUserId:
            normalizeString(
                user.id
            ),

        providerSubject,

        email:
            getProviderEmail(
                user,
                identityData
            ),

        emailVerified:
            getProviderEmailVerified(
                identityData,
                userMetadata
            ),

        displayName:
            getProviderDisplayName(
                normalizedProvider,
                identityData,
                userMetadata
            ),

        preferredUsername:
            getProviderPreferredUsername(
                normalizedProvider,
                identityData,
                userMetadata
            )
    };
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
            // Ignore malformed upstream error body.
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

function buildProviderSessionData(
    providerIdentity
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
            now
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
                providerIdentity
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
VALIDATE EXPLICIT LINK SESSION
========================================================= */

async function getLinkContext(
    request,
    env
) {
    const targetAccountId =
        normalizeString(
            getCookie(
                request,
                OAUTH_ACCOUNT_COOKIE
            )
        );

    if (
        !targetAccountId
    ) {
        return {
            valid:
                false,

            code:
                "LINK_ACCOUNT_MISSING",

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
                "LINK_ACCOUNT_MISMATCH",

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
    linkContext,
    providerIdentity,
    linkedAccount
) {
    if (
        normalizeString(
            linkedAccount.accountId
        )
        !== linkContext.accountId
    ) {
        throw new Error(
            "Linked account did not match the authenticated BPD account."
        );
    }

    await attachProviderToSession(
        env,
        linkContext.session.sessionId,
        providerIdentity.provider,
        buildProviderSessionData(
            providerIdentity
        )
    );

    await setSessionUser(
        env,
        linkContext.session.sessionId,
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
            linkContext.session.sessionId
    };
}

/* =========================================================
CLEAR TEMPORARY OAUTH COOKIES
========================================================= */

function getOAuthClearCookies(
    request
) {
    return [
        clearCookie(
            request,
            PKCE_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_PROVIDER_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_MODE_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_ACCOUNT_COOKIE
        )
    ]
        .filter(
            Boolean
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
        normalizeProvider(
            getCookie(
                request,
                OAUTH_PROVIDER_COOKIE
            )
        );

    const verifier =
        normalizeString(
            getCookie(
                request,
                PKCE_COOKIE
            )
        );

    const mode =
        getOAuthMode(
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

                    message:
                        "OAuth authorization code is missing.",

                    debugId
                },
                400
            );
        }

        if (
            !provider
            || !SUPPORTED_PROVIDERS.has(
                provider
            )
        ) {
            return json(
                {
                    success:
                        false,

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

                    message:
                        "OAuth provider configuration is unavailable.",

                    debugId
                },
                500
            );
        }

        /* =================================================
        VALIDATE LINK SESSION
        ================================================= */

        let linkContext =
            null;

        if (
            mode === OAUTH_MODE_LINK
        ) {
            linkContext =
                await getLinkContext(
                    request,
                    env
                );

            if (
                linkContext.valid !==
                true
            ) {
                console.warn(
                    "OAUTH CALLBACK: Link context validation failed.",
                    {
                        debugId,

                        provider,

                        code:
                            linkContext.code
                    }
                );

                return json(
                    {
                        success:
                            false,

                        code:
                            linkContext.code,

                        message:
                            "The account-link request is no longer valid.",

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
            mode === OAUTH_MODE_LINK
        ) {
            let linkedAccount;

            try {
                linkedAccount =
                    await linkProviderIdentity(
                        env,
                        linkContext.accountId,
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

            await establishLinkedSession(
                env,
                linkContext,
                providerIdentity,
                linkedAccount
            );

            console.info(
                "OAUTH CALLBACK: Provider link completed.",
                {
                    debugId,

                    provider,

                    hasAccountId:
                        true,

                    linkedIdentity:
                        linkedAccount.linkedIdentity ===
                        true
                }
            );

            return redirect(
                "/Account",
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

                    message:
                        "BPD account synchronization failed.",

                    debugId
                },
                502
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

        console.info(
            "OAUTH CALLBACK: Authentication completed.",
            {
                debugId,

                provider,

                mode,

                hasAccountId:
                    Boolean(
                        resolvedAccount.accountId
                    ),

                createdAccount:
                    resolvedAccount.createdAccount ===
                    true,

                createdIdentity:
                    resolvedAccount.createdIdentity ===
                    true,

                reusedSession:
                    !sessionResult.sessionCookie
            }
        );

        return redirect(
            "/",
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
                    "OAuth callback failed unexpectedly.",

                debugId
            },
            500
        );
    }
}