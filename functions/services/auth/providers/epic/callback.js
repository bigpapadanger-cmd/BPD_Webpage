"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH CALLBACK SERVICE

File:
    functions/services/auth/providers/epic/callback.js

Public Route:
    GET /api/auth/epic/callback

Purpose:
    Completes direct Epic Games OAuth authentication for
    global BPD login and authenticated Epic account linking.

Description:
    - Validates Epic OAuth state.
    - Determines whether the flow is login or link.
    - Exchanges the Epic authorization code.
    - Loads the authenticated Epic identity.
    - Login mode resolves or creates the canonical BPD
      account through api.resolve_epic_identity.
    - Link mode attaches Epic to the already-authenticated
      canonical BPD account through api.link_epic_identity.
    - Synchronizes Epic provider state into the centralized
      Cloudflare KV session.
    - Never stores Epic access tokens.

Identity:
    identity.accounts.id
        = canonical global BPD account ID

    identity.account_identities.provider_subject
        = Epic account ID

Security:
    - OAuth state must match the HttpOnly state cookie.
    - Link mode requires an existing active BPD account.
    - Link mode requires the stored target account ID to
      exactly match the current authenticated session.
    - Link mode never creates identity.accounts.
    - Epic provider_subject ownership is enforced by the
      database RPC.
    - Browser-submitted account IDs are never trusted.
    - Epic access tokens are temporary and never persisted.

Modes:
    login
        Epic may resolve an existing BPD account or create
        a new BPD account.

    link
        Epic is attached only to the currently authenticated
        BPD account.

Important:
    - Rocket League player creation does not occur here.
    - Linking Epic does not automatically create
      core.rl_players.
========================================================= */

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
    setSessionUser
} from "../../sessions/session.js";

import {
    getSessionContext
} from "../../sessions/session_context.js";

import {
    authorizeRequest,
    isAuthorizationError
} from "../../authorization.js";

/* =========================================================
CONSTANTS
========================================================= */

const DEFAULT_RETURN_TO =
    "/Account";

const NEW_ACCOUNT_RETURN_TO =
    "/Account?setup=1";

const OAUTH_MODE_LOGIN =
    "login";

const OAUTH_MODE_LINK =
    "link";

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
    ) {
        return mode;
    }

    return "";
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
        resolvedAccountId !== accountId
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
    epicProfile
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
            now
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

    const providerData =
        buildEpicProviderData(
            epicProfile
        );

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

            cookie
        };
    }

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

        cookie
    };
}

/* =========================================================
LINK CONTEXT
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
                "LINK_ACCOUNT_MISSING"
        };
    }

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
                "LINK_ACCOUNT_MISMATCH"
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
    linkContext,
    linkedAccount,
    epicProfile
) {
    if (
        linkedAccount.accountId !==
        linkContext.accountId
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
        linkContext.sessionId,
        "epic",
        buildEpicProviderData(
            epicProfile
        )
    );

    await setSessionUser(
        env,
        linkContext.sessionId,
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

export async function handleEpicCallback(
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
        VALIDATE LINK SESSION BEFORE PROVIDER EXCHANGE
        ================================================= */

        let linkContext =
            null;

        if (
            mode ===
            OAUTH_MODE_LINK
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
                    "EPIC CALLBACK: Link context validation failed.",
                    {
                        debugId,

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
                            "The Epic account-link request is no longer valid.",

                        debugId
                    },
                    linkContext.code ===
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
                        linkContext.accountId,
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
                linkContext,
                linkedAccount,
                epicProfile
            );

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
                "LINK_ACCOUNT_MISMATCH";

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
                        ? "This Epic account cannot be linked to the current BPD account."
                        : "Epic authentication could not be completed.",

                debugId
            },
            conflict
                ? 409
                : 500
        );
    }
}