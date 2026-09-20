import { completeOAuthCallback } from "../../oauth/callback_response.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH CALLBACK SERVICE

File:
    functions/services/auth/providers/epic/callback.js

Public Route:
    GET /api/auth/epic/callback

Purpose:
    Completes direct Epic Games OAuth authentication for:
    - global BPD login
    - authenticated Epic account linking
    - authenticated Epic reauthorization

Description:
    - Validates Epic OAuth state.
    - Determines whether the flow is login, link, or
      reauthorize.
    - Exchanges the Epic authorization code.
    - Loads the authenticated Epic identity.
    - Login mode resolves or creates the canonical BPD
      account through api.resolve_epic_identity.
    - Link mode attaches Epic to the already-authenticated
      canonical BPD account through api.link_epic_identity.
    - Reauthorize mode verifies that the authenticated Epic
      account exactly matches the permanent linked Epic
      provider identity.
    - Synchronizes Epic provider state into the centralized
      Cloudflare KV session.
    - Records provider-auth freshness through the central
      authentication completion service.
    - Never stores Epic access tokens.

Identity:
    identity.accounts.id
        = canonical global BPD account ID

    identity.account_identities.provider_subject
        = Epic account ID

Security:
    - OAuth state must match the HttpOnly state cookie.
    - Link and reauthorize modes require an existing active
      BPD account.
    - Existing-account modes require the stored target account
      ID to exactly match the current authenticated session.
    - Link mode never creates identity.accounts.
    - Reauthorize mode never creates or relinks identities.
    - Reauthorization requires the newly authenticated Epic
      account ID to exactly match the permanent linked
      provider_subject.
    - Browser-submitted account IDs are never trusted.
    - Epic access tokens are temporary and never persisted.

Modes:
    login
        Epic may resolve an existing BPD account or create
        a new BPD account.

    link
        Epic is attached only to the currently authenticated
        BPD account.

    reauthorize
        The already-linked Epic account proves ownership
        again without modifying permanent provider linkage.

Important:
    - Rocket League player creation does not occur here.
    - Linking or reauthorizing Epic does not automatically
      create core.rl_players.
========================================================= */
//added login connection for getting MMR

import {
    handleAccountLastLogin
} from "../../account/last_login.js";
import {
    json,
    redirect
} from "../../../common_helpers/responses.js";

import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE,
    OAUTH_RETURN_COOKIE,
    OAUTH_MODE_COOKIE,
    OAUTH_ACCOUNT_COOKIE
} from "../../../config/api_vars.js";

import {
    getCookie,
    clearCookie,
    createSession,
    createSessionCookie,
    attachProviderToSession,
    setSessionUser,
    deleteSession
} from "../../sessions/session.js";

import {
    getSessionContext
} from "../../sessions/session_context.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../../authorization.js";

import {
    verifyAccountProviderIdentity
} from "../provider_identity.js";

import {
    completeAuthentication,
    isAuthenticationCompletionError
} from "../../authentication.js";

import {
    OAUTH_MODE_LOGIN,
    OAUTH_MODE_LINK,
    OAUTH_MODE_REAUTHORIZE
} from "../../oauth/state.js";

/* =========================================================
CONSTANTS
========================================================= */

const DEFAULT_RETURN_TO =
    "/Account";

const NEW_ACCOUNT_RETURN_TO =
    "/Account?setup=1";

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

function normalizeMode(
    value
) {
    const mode =
        normalizeString(
            value
        )
            .toLowerCase();

    if (
        mode === OAUTH_MODE_LOGIN
        || mode === OAUTH_MODE_LINK
        || mode === OAUTH_MODE_REAUTHORIZE
    ) {
        return mode;
    }

    return "";
}

function isExistingAccountMode(
    mode
) {
    return (
        mode === OAUTH_MODE_LINK
        || mode === OAUTH_MODE_REAUTHORIZE
    );
}

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

    const numeric =
        Number(
            value
        );

    if (
        Number.isFinite(
            numeric
        )
        && numeric > 0
    ) {
        return numeric;
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
        || /[\\\u0000-\u0020\u007f]/u.test(returnTo)
        || returnTo.startsWith(
            "//"
        )
    ) {
        return DEFAULT_RETURN_TO;
    }

    return returnTo;
}

/* =========================================================
LIMIT LOG MESSAGE
========================================================= */

function limitMessage(
    value
) {
    return String(
        value
        ?? ""
    )
        .replace(
            /\s+/g,
            " "
        )
        .slice(
            0,
            300
        );
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
CALL API RPC
========================================================= */

async function callApiRpc(
    env,
    rpcName,
    payload
) {
    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        throw new Error(
            "Supabase configuration is unavailable."
        );
    }

    const response =
        await fetch(
            `${configuration.url}rpc/${rpcName}`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Content-Type":
                        "application/json",

                    "Content-Profile":
                        "api",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );

    const responseText =
        await response.text();

    let responseData =
        null;

    try {
        responseData =
            responseText
                ? JSON.parse(
                    responseText
                )
                : null;
    }
    catch {
        responseData =
            responseText;
    }

    if (
        !response.ok
    ) {
        const message =
            (
                responseData
                && typeof responseData ===
                    "object"
                && !Array.isArray(
                    responseData
                )
            )
                ? (
                    normalizeString(
                        responseData.message
                    )
                    || normalizeString(
                        responseData.error
                    )
                )
                : "";

        const error =
            new Error(
                message
                || `${rpcName} failed.`
            );

        error.upstreamStatus =
            response.status;

        error.upstreamCode =
            (
                responseData
                && typeof responseData ===
                    "object"
                && !Array.isArray(
                    responseData
                )
            )
                ? normalizeNullableString(
                    responseData.code
                )
                : null;

        throw error;
    }

    const record =
        Array.isArray(
            responseData
        )
            ? (
                responseData[0]
                || null
            )
            : responseData;

    if (
        !record
        || typeof record !==
            "object"
        || Array.isArray(
            record
        )
    ) {
        throw new Error(
            `${rpcName} returned an invalid response.`
        );
    }

    return record;
}

/* =========================================================
RESOLVE EPIC LOGIN IDENTITY
========================================================= */

async function resolveEpicIdentity(
    env,
    epicAccountId,
    displayName
) {
    const result =
        await callApiRpc(
            env,
            "resolve_epic_identity",
            {
                p_provider_subject:
                    epicAccountId,

                p_display_username:
                    displayName
            }
        );

    const accountId =
        normalizeNullableString(
            result.account_id
            ?? result.accountId
        );

    if (
        !accountId
    ) {
        throw new Error(
            "Epic identity resolution returned no account ID."
        );
    }

    return {
        accountId,

        role:
            normalizeString(
                result.role
            )
            || "user",

        active:
            result.active ===
            true,

        createdAccount:
            result.created_account ===
                true
            || result.createdAccount ===
                true,

        createdIdentity:
            result.created_identity ===
                true
            || result.createdIdentity ===
                true
    };
}

/* =========================================================
LINK EPIC IDENTITY
========================================================= */

async function linkEpicIdentity(
    env,
    accountId,
    epicProfile
) {
    const result =
        await callApiRpc(
            env,
            "link_epic_identity",
            {
                p_account_id:
                    accountId,

                p_provider_subject:
                    epicProfile.epicAccountId,

                p_display_username:
                    epicProfile.displayName
                    || epicProfile.preferredUsername
            }
        );

    const resolvedAccountId =
        normalizeNullableString(
            result.account_id
            ?? result.accountId
        );

    if (
        !resolvedAccountId
    ) {
        throw new Error(
            "Epic identity linking returned no account ID."
        );
    }

    if (
        resolvedAccountId !==
        accountId
    ) {
        const error =
            new Error(
                "Epic identity was linked to an unexpected BPD account."
            );

        error.code =
            "LINK_ACCOUNT_MISMATCH";

        throw error;
    }

    return {
        accountId:
            resolvedAccountId,

        role:
            normalizeString(
                result.role
            )
            || "user",

        active:
            result.active ===
            true,

        linkedIdentity:
            result.linked_identity ===
                true
            || result.linkedIdentity ===
                true
    };
}

/* =========================================================
EPIC TOKEN EXCHANGE
========================================================= */

async function exchangeEpicCode(
    env,
    code
) {
    const clientId =
        normalizeString(
            env?.EPIC_CLIENT_ID
        );

    const clientSecret =
        normalizeString(
            env?.EPIC_CLIENT_SECRET
        );

    const redirectUri =
        normalizeString(
            env?.EPIC_REDIRECT_URI
        );

    if (
        !clientId
        || !clientSecret
        || !redirectUri
    ) {
        throw new Error(
            "Epic callback configuration is incomplete."
        );
    }

    const response =
        await fetch(
            EPIC_TOKEN_URL,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",

                    "Authorization":
                        `Basic ${btoa(
                            `${clientId}:${clientSecret}`
                        )}`
                },

                body:
                    new URLSearchParams({
                        grant_type:
                            "authorization_code",

                        code,

                        redirect_uri:
                            redirectUri
                    })
            }
        );

    const responseText =
        await response.text();

    let data =
        null;

    try {
        data =
            responseText
                ? JSON.parse(
                    responseText
                )
                : null;
    }
    catch {
        data =
            null;
    }

    if (
        !response.ok
    ) {
        console.error(
            "EPIC CALLBACK: Token exchange rejected.",
            {
                status:
                    response.status,

                response:
                    limitMessage(
                        responseText
                    )
            }
        );

        const error =
            new Error(
                "Epic token exchange failed."
            );

        error.upstreamStatus =
            response.status;

        throw error;
    }

    const accessToken =
        normalizeString(
            data?.access_token
        );

    if (
        !accessToken
    ) {
        throw new Error(
            "Epic returned no access token."
        );
    }

    return {
        accessToken,

        tokenAccountId:
            normalizeNullableString(
                data?.account_id
            )
    };
}

/* =========================================================
LOAD EPIC PROFILE
========================================================= */

async function loadEpicProfile(
    accessToken,
    tokenAccountId
) {
    const response =
        await fetch(
            EPIC_USER_INFO_URL,
            {
                method:
                    "GET",

                headers: {
                    "Authorization":
                        `Bearer ${accessToken}`,

                    "Accept":
                        "application/json"
                }
            }
        );

    const responseText =
        await response.text();

    let profile =
        null;

    try {
        profile =
            responseText
                ? JSON.parse(
                    responseText
                )
                : null;
    }
    catch {
        profile =
            null;
    }

    if (
        !response.ok
    ) {
        console.error(
            "EPIC CALLBACK: Epic profile request rejected.",
            {
                status:
                    response.status,

                response:
                    limitMessage(
                        responseText
                    )
            }
        );

        const error =
            new Error(
                "Epic profile request failed."
            );

        error.upstreamStatus =
            response.status;

        throw error;
    }

    const epicAccountId =
        normalizeString(
            profile?.id
            || profile?.sub
            || tokenAccountId
        );

    if (
        !epicAccountId
    ) {
        throw new Error(
            "Epic authentication returned no account identity."
        );
    }

    return {
        epicAccountId,

        displayName:
            normalizeNullableString(
                profile?.displayName
                || profile?.display_name
                || profile?.preferred_username
            ),

        preferredUsername:
            normalizeNullableString(
                profile?.preferred_username
            )
    };
}

/* =========================================================
PROVIDER SESSION DATA
========================================================= */

function buildEpicProviderData(
    epicProfile,
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
            epicProfile.epicAccountId,

        DisplayName:
            epicProfile.displayName,

        PreferredUsername:
            epicProfile.preferredUsername,

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
LOGIN SESSION
========================================================= */

async function establishLoginSession(
    request,
    env,
    identity,
    epicProfile
) {
    const currentSession =
        await getSessionContext(
            request,
            env
        );

    /*
     * Never allow an OAuth login callback to silently move
     * an already-authenticated browser to another BPD
     * account.
     */
    if (
        currentSession.authenticated ===
            true
        && currentSession.userId
        && currentSession.userId !==
            identity.accountId
    ) {
        const error =
            new Error(
                "The Epic account belongs to a different BPD account."
            );

        error.code =
            "ACCOUNT_LINK_CONFLICT";

        throw error;
    }

    if (
        currentSession.authenticated ===
        true
    ) {
        if (
            !currentSession.sessionId
        ) {
            throw new Error(
                "Authenticated session has no session ID."
            );
        }

        const providerData =
            buildEpicProviderData(
                epicProfile,
                {
                    linkedAt:
                        currentSession
                            ?.providers
                            ?.epic
                            ?.linkedAt
                }
            );

        await setSessionUser(
            env,
            currentSession.sessionId,
            {
                userId:
                    identity.accountId,

                role:
                    identity.role,

                active:
                    identity.active
            }
        );

        await attachProviderToSession(
            env,
            currentSession.sessionId,
            "epic",
            providerData
        );

        const cookie =
            createSessionCookie(
                request,
                currentSession.sessionId
            );

        if (
            !cookie
        ) {
            throw new Error(
                "Session cookie creation failed."
            );
        }

        return {
            sessionId:
                currentSession.sessionId,

            cookie,

            createdSession:
                false
        };
    }

    const providerData =
        buildEpicProviderData(
            epicProfile
        );

    const created =
        await createSession(
            env,
            {
                UserId:
                    identity.accountId,

                Role:
                    identity.role,

                Active:
                    identity.active,

                Providers: {
                    epic:
                        providerData
                }
            }
        );

    try {
        const cookie =
            createSessionCookie(
                request,
                created.sessionId
            );

        if (
            !cookie
        ) {
            throw new Error(
                "Session cookie creation failed."
            );
        }

        return {
            sessionId:
                created.sessionId,

            cookie,

            createdSession:
                true
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
EXISTING ACCOUNT CONTEXT

Used by:
    link
    reauthorize

This deliberately requires only the canonical BPD account
session. It does NOT require current Epic freshness because
that would prevent an expired Epic identity from reaching
the reauthorization callback.
========================================================= */

async function getExistingAccountContext(
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
                "OAUTH_ACCOUNT_MISSING"
        };
    }

    let authorization;

    try {
        authorization =
            await authorizeRequest(
                request,
                env,
                {
                    account: true, recovery: true
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
            return {
                valid:
                    false,

                code:
                    error.code
                    || "AUTH_REQUIRED"
            };
        }

        throw error;
    }

    if (
        authorization.accountId !==
        targetAccountId
    ) {
        return {
            valid:
                false,

            code:
                "OAUTH_ACCOUNT_MISMATCH"
        };
    }

    if (
        !authorization.sessionId
    ) {
        return {
            valid:
                false,

            code:
                "SESSION_IDENTITY_INVALID"
        };
    }

    return {
        valid:
            true,

        accountId:
            authorization.accountId,

        sessionId:
            authorization.sessionId,

        authorization
    };
}

/* =========================================================
ESTABLISH LINKED SESSION
========================================================= */

async function establishLinkedSession(
    env,
    accountContext,
    linkedAccount,
    epicProfile
) {
    if (
        linkedAccount.accountId !==
        accountContext.accountId
    ) {
        const error =
            new Error(
                "Linked Epic identity returned an unexpected account."
            );

        error.code =
            "LINK_ACCOUNT_MISMATCH";

        throw error;
    }

    await attachProviderToSession(
        env,
        accountContext.sessionId,
        "epic",
        buildEpicProviderData(
            epicProfile
        )
    );

    await setSessionUser(
        env,
        accountContext.sessionId,
        {
            userId:
                linkedAccount.accountId,

            role:
                linkedAccount.role,

            active:
                linkedAccount.active
        }
    );
}

/* =========================================================
VERIFY EPIC REAUTHORIZATION

Loads the permanent Epic identity from Supabase and requires
the Epic account ID authenticated in this callback to exactly
match the linked provider_subject.

No link RPC is called here.
========================================================= */

async function verifyEpicReauthorization(
    env,
    accountId,
    epicProfile
) {
    let linkedProvider;

    try {
        linkedProvider =
            await verifyAccountProviderIdentity(
                env,
                accountId,
                "epic"
            );
    }
    catch (
        error
    ) {
        const verificationError =
            new Error(
                "The linked Epic identity could not be verified."
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
                "Epic is no longer linked to this BPD account."
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

    const linkedEpicAccountId =
        normalizeString(
            linkedProvider.providerSubject
        );

    const authenticatedEpicAccountId =
        normalizeString(
            epicProfile.epicAccountId
        );

    if (
        linkedProviderName !==
            "epic"
        || !linkedEpicAccountId
        || !authenticatedEpicAccountId
        || linkedEpicAccountId !==
            authenticatedEpicAccountId
    ) {
        const error =
            new Error(
                "The authenticated Epic account does not match the linked Epic identity."
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
ESTABLISH REAUTHORIZED SESSION
========================================================= */

async function establishReauthorizedSession(
    env,
    accountContext,
    epicProfile,
    linkedProvider
) {
    const existingLinkedAt =
        accountContext
            ?.authorization
            ?.providers
            ?.epic
            ?.linkedAt;

    await attachProviderToSession(
        env,
        accountContext.sessionId,
        "epic",
        buildEpicProviderData(
            epicProfile,
            {
                linkedAt:
                    existingLinkedAt
                    ?? linkedProvider?.linkedAt
                    ?? null
            }
        )
    );
}

/* =========================================================
COMPLETE CENTRAL AUTHENTICATION STATE
========================================================= */

async function recordCompletedAuthentication(
    env,
    {
        accountId,
        recordLogin
    }
) {
    const isLogin =
        recordLogin ===
        true;

    const result =
        await completeAuthentication(
            env,
            {
                accountId,

                provider:
                    "epic",

                recordLogin:
                    isLogin
            }
        );

    /*
     * Only a true BPD login updates account activity and
     * triggers the throttled Rocket League MMR refresh.
     *
     * Epic linking and reauthorization only refresh provider
     * authorization state and do not count as new BPD logins.
     */
    if (
        isLogin
    ) {
        try {
            await handleAccountLastLogin(
                env,
                accountId
            );
        }
        catch (
            error
        ) {
            console.error(
                "EPIC CALLBACK: Post-login account activity failed.",
                {
                    accountId,

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
        }
    }

    return result;
}

/* =========================================================
AUTH STATE ERROR RESPONSE
========================================================= */

function getAuthenticationStateErrorResponse(
    error,
    debugId
) {
    console.error(
        "EPIC CALLBACK: Authentication state completion failed.",
        {
            debugId,

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
                isAuthenticationCompletionError(
                    error
                )
                    ? (
                        error.code
                        || "AUTHENTICATION_STATE_WRITE_FAILED"
                    )
                    : "AUTHENTICATION_STATE_WRITE_FAILED",

            message:
                "Epic authentication succeeded, but the BPD authentication state could not be finalized.",

            debugId
        },
        503
    );
}

/* =========================================================
CLEAR EPIC OAUTH COOKIES
========================================================= */

function getOAuthClearCookies(
    request
) {
    return [
        clearCookie(
            request,
            AUTH_STATE_COOKIE
        ),

        clearCookie(
            request,
            OAUTH_RETURN_COOKIE
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
MAIN EPIC CALLBACK
========================================================= */

async function executeCallback(
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

    const state =
        normalizeString(
            url.searchParams.get(
                "state"
            )
        );

    const mode =
        normalizeMode(
            getCookie(
                request,
                OAUTH_MODE_COOKIE
            )
        );

    const requestedReturnTo =
        normalizeReturnTo(
            getCookie(
                request,
                OAUTH_RETURN_COOKIE
            )
        );

    try {
        /* =================================================
        OAUTH RESPONSE
        ================================================= */

        if (
            url.searchParams.has(
                "error"
            )
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "EPIC_OAUTH_REJECTED",

                    message:
                        "Epic authentication was not completed.",

                    debugId
                },
                400
            );
        }

        if (
            !code
            || !state
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "EPIC_OAUTH_PARAMETERS_MISSING",

                    message:
                        "Missing Epic OAuth parameters.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        STATE VALIDATION
        ================================================= */

        const storedState =
            getCookie(
                request,
                AUTH_STATE_COOKIE
            );

        if (
            !storedState
            || storedState !==
                state
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "EPIC_OAUTH_STATE_INVALID",

                    message:
                        "Invalid Epic OAuth state.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        MODE VALIDATION
        ================================================= */

        if (
            !mode
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "EPIC_OAUTH_MODE_INVALID",

                    message:
                        "Epic OAuth operation mode is invalid.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        VALIDATE EXISTING ACCOUNT CONTEXT

        Must happen before provider token exchange for link
        and reauthorization requests.
        ================================================= */

        let accountContext =
            null;

        if (
            isExistingAccountMode(
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
                    "EPIC CALLBACK: Existing account context validation failed.",
                    {
                        debugId,

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
                            "The Epic authentication request is no longer valid.",

                        debugId
                    },
                    accountContext.code ===
                        "AUTH_REQUIRED"
                        ? 401
                        : 409
                );
            }
        }

        /* =================================================
        EPIC TOKEN + PROFILE
        ================================================= */

        const token =
            await exchangeEpicCode(
                env,
                code
            );

        const epicProfile =
            await loadEpicProfile(
                token.accessToken,
                token.tokenAccountId
            );

        /*
         * token.accessToken intentionally goes no further.
         * It is never written to KV or Supabase.
         */

        /* =================================================
        EXPLICIT LINK MODE
        ================================================= */

        if (
            mode ===
            OAUTH_MODE_LINK
        ) {
            let linkedAccount;

            try {
                linkedAccount =
                    await linkEpicIdentity(
                        env,
                        accountContext.accountId,
                        epicProfile
                    );
            }
            catch (
                error
            ) {
                console.error(
                    "EPIC CALLBACK: Epic identity link failed.",
                    {
                        debugId,

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

                const conflict =
                    error?.upstreamCode ===
                        "23505"
                    || String(
                        error?.message
                        || ""
                    )
                        .includes(
                            "PROVIDER_IDENTITY_ALREADY_LINKED"
                        );

                return json(
                    {
                        success:
                            false,

                        code:
                            conflict
                                ? "PROVIDER_IDENTITY_ALREADY_LINKED"
                                : (
                                    error?.upstreamCode
                                    || "EPIC_LINK_FAILED"
                                ),

                        message:
                            conflict
                                ? "This Epic account is already linked to a different BPD account."
                                : "Epic Games could not be linked to this BPD account.",

                        debugId
                    },
                    conflict
                        ? 409
                        : 502
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
                linkedAccount,
                epicProfile
            );

            try {
                await recordCompletedAuthentication(
                    env,
                    {
                        accountId:
                            linkedAccount.accountId,

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
                    debugId
                );
            }

            console.info(
                "EPIC CALLBACK: Epic provider link completed.",
                {
                    debugId,

                    linkedIdentity:
                        linkedAccount
                            .linkedIdentity ===
                        true
                }
            );

            return redirect(
                requestedReturnTo,
                getOAuthClearCookies(
                    request
                )
            );
        }

        /* =================================================
        REAUTHORIZATION MODE
        ================================================= */

        if (
            mode ===
            OAUTH_MODE_REAUTHORIZE
        ) {
            let linkedProvider;

            try {
                linkedProvider =
                    await verifyEpicReauthorization(
                        env,
                        accountContext.accountId,
                        epicProfile
                    );
            }
            catch (
                error
            ) {
                console.error(
                    "EPIC CALLBACK: Epic reauthorization verification failed.",
                    {
                        debugId,

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
                            || "EPIC_REAUTHORIZATION_FAILED",

                        message:
                            error?.code ===
                            "PROVIDER_REAUTHORIZATION_MISMATCH"
                                ? "The authenticated Epic account does not match the Epic account linked to this BPD account."
                                : "Epic Games could not be reauthorized.",

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
                epicProfile,
                linkedProvider
            );

            try {
                await recordCompletedAuthentication(
                    env,
                    {
                        accountId:
                            accountContext.accountId,

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
                    debugId
                );
            }

            console.info(
                "EPIC CALLBACK: Epic provider reauthorization completed.",
                {
                    debugId,

                    accountId:
                        accountContext.accountId
                }
            );

            return redirect(
                requestedReturnTo,
                getOAuthClearCookies(
                    request
                )
            );
        }

        /* =================================================
        NORMAL LOGIN MODE
        ================================================= */

        const identity =
            await resolveEpicIdentity(
                env,
                epicProfile.epicAccountId,
                epicProfile.displayName
                || epicProfile
                    .preferredUsername
            );

        if (
            identity.active !==
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

        const session =
            await establishLoginSession(
                request,
                env,
                identity,
                epicProfile
            );

        /*
         * Only creation of a new BPD browser session counts
         * as a new BPD login for the login-gap policy.
         *
         * Re-authenticating Epic while a valid BPD session
         * already exists refreshes Epic provider auth only.
         */
        try {
            await recordCompletedAuthentication(
                env,
                {
                    accountId:
                        identity.accountId,

                    recordLogin:
                        session.createdSession ===
                        true
                }
            );
        }
        catch (
            error
        ) {
            /*
             * A newly created session must not survive if the
             * central auth state failed to finalize.
             */
            if (
                session.createdSession ===
                    true
                && session.sessionId
            ) {
                try {
                    await deleteSession(
                        env,
                        session.sessionId
                    );
                }
                catch (
                    deleteError
                ) {
                    console.error(
                        "EPIC CALLBACK: Failed to clean up session after auth-state failure.",
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
                debugId
            );
        }

        const successDestination =
            identity.createdAccount ===
                true
                ? NEW_ACCOUNT_RETURN_TO
                : requestedReturnTo;

        const cookies =
            getOAuthClearCookies(
                request
            );

        if (
            session.cookie
        ) {
            cookies.unshift(
                session.cookie
            );
        }

        console.info(
            "EPIC CALLBACK: Epic authentication completed.",
            {
                debugId,

                mode,

                createdAccount:
                    identity.createdAccount ===
                    true,

                createdIdentity:
                    identity.createdIdentity ===
                    true,

                createdSession:
                    session.createdSession ===
                    true,

                reusedSession:
                    session.createdSession !==
                    true
            }
        );

        return redirect(
            successDestination,
            cookies
        );
    }
    catch (
        error
    ) {
        console.error(
            "EPIC CALLBACK: Unexpected failure.",
            {
                debugId,

                mode:
                    mode
                    || null,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || error?.upstreamCode
                    || null,

                upstreamStatus:
                    error?.upstreamStatus
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        const conflict =
            error?.code ===
                "ACCOUNT_LINK_CONFLICT"
            || error?.code ===
                "LINK_ACCOUNT_MISMATCH"
            || error?.code ===
                "OAUTH_ACCOUNT_MISMATCH"
            || error?.code ===
                "PROVIDER_REAUTHORIZATION_MISMATCH";

        return json(
            {
                success:
                    false,

                code:
                    error?.code
                    || error?.upstreamCode
                    || "EPIC_CALLBACK_FAILED",

                message:
                    conflict
                        ? "This Epic account cannot be used with the current BPD account."
                        : "Epic authentication could not be completed.",

                debugId
            },
            conflict
                ? 409
                : 500
        );
    }
}
export async function handleEpicCallback(request, env) {
    return completeOAuthCallback(request, env, () => executeCallback(request, env));
}
