"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC OAUTH CALLBACK SERVICE

File:
    functions/services/auth/providers/epic/callback.js

Public Route:
    GET /api/auth/epic/callback

Purpose:
    Completes Epic OAuth authentication and connects the Epic
    identity to the canonical global BPD account.

Description:
    - Validates the Epic OAuth state cookie.
    - Exchanges the authorization code for an Epic token.
    - Loads the authenticated Epic profile.
    - Resolves the Epic identity through identity.accounts.
    - Ensures the global account has a Rocket League player.
    - Creates or updates the centralized BPD browser session.
    - Redirects new accounts to account setup.
    - Redirects existing accounts to the requested local page.
    - Stores no Epic access token in the BPD session.

Identity Flow:
    Epic account ID
        ↓
    api.resolve_epic_identity
        ↓
    identity.accounts.id
        ↓
    api.ensure_rocketleague_player
        ↓
    core.rl_players.account_id
        ↓
    BPD session UserId

Important:
    - identity.accounts.id is the canonical global account ID.
    - Epic account ID is a provider identity, not UserId.
    - Rocket League ownership uses core.rl_players.account_id.
    - Existing BPD sessions cannot silently switch accounts.
    - Epic access tokens are temporary and never persisted.
========================================================= */

import {
    json,
    redirect
} from "../../../common_helpers/responses.js";

import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE
} from "../../../config/api_vars.js";

import {
    getCookie,
    clearCookie,
    createSession,
    createSessionCookie,
    getSessionIdFromRequest,
    attachProviderToSession,
    setSessionUser
} from "../../sessions/session.js";

import {
    getSessionContext
} from "../../sessions/session_context.js";

import { OAUTH_RETURN_COOKIE } from "../../../config/api_vars.js";
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
            env.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env.SUPABASE_AUTH
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
                && typeof responseData === "object"
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
                && typeof responseData === "object"
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

    if (
        !responseData
        || typeof responseData !==
            "object"
        || Array.isArray(
            responseData
        )
    ) {
        throw new Error(
            `${rpcName} returned an invalid response.`
        );
    }

    return responseData;
}

/* =========================================================
RESOLVE EPIC GLOBAL IDENTITY
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
            || result.accountId
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
            result.active === true,

        createdAccount:
            result.created_account === true
            || result.createdAccount === true,

        createdIdentity:
            result.created_identity === true
            || result.createdIdentity === true
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
            env.EPIC_CLIENT_ID
        );

    const clientSecret =
        normalizeString(
            env.EPIC_CLIENT_SECRET
        );

    const redirectUri =
        normalizeString(
            env.EPIC_REDIRECT_URI
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

    const displayName =
        normalizeNullableString(
            profile?.displayName
            || profile?.display_name
            || profile?.preferred_username
        );

    const preferredUsername =
        normalizeNullableString(
            profile?.preferred_username
        );

    return {
        epicAccountId,

        displayName,

        preferredUsername
    };
}

/* =========================================================
WRITE BPD SESSION
========================================================= */

async function establishBpdSession(
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
     * Never allow an OAuth callback to silently change the
     * authenticated browser from one BPD account to another.
     */
    if (
        currentSession.authenticated === true
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

    const providerData = {
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
            Date.now()
    };

    /* =====================================================
    EXISTING BPD SESSION
    ===================================================== */

    if (
        currentSession.authenticated === true
    ) {
        const sessionId =
            getSessionIdFromRequest(
                request
            );

        if (
            !sessionId
        ) {
            throw new Error(
                "Authenticated session has no session ID."
            );
        }

        await setSessionUser(
            env,
            sessionId,
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
            sessionId,
            "epic",
            providerData
        );

        const cookie =
            createSessionCookie(
                request,
                sessionId
            );

        if (
            !cookie
        ) {
            throw new Error(
                "Session cookie creation failed."
            );
        }

        return {
            sessionId,
            cookie
        };
    }

    /* =====================================================
    NEW BPD SESSION
    ===================================================== */

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

    const sessionId =
        created.sessionId;

    if (
        !sessionId
    ) {
        throw new Error(
            "Failed to create BPD session."
        );
    }

    const cookie =
        createSessionCookie(
            request,
            sessionId
        );

    if (
        !cookie
    ) {
        throw new Error(
            "Session cookie creation failed."
        );
    }

    return {
        sessionId,
        cookie
    };
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
            || storedState !== state
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
        RETURN DESTINATION
        ================================================= */

        const requestedReturnTo =
            normalizeReturnTo(
                getCookie(
                    request,
                    OAUTH_RETURN_COOKIE
                )
            );

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
         * It is not stored in KV or Supabase.
         */

        /* =================================================
        GLOBAL IDENTITY
        ================================================= */

        const identity =
            await resolveEpicIdentity(
                env,
                epicProfile.epicAccountId,
                epicProfile.displayName
                || epicProfile.preferredUsername
            );

        if (
            identity.active !== true
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



        /* =================================================
        CENTRALIZED BPD SESSION
        ================================================= */

        const session =
            await establishBpdSession(
                request,
                env,
                {
                    accountId:
                        identity.accountId,

                    role:
                        identity.role,

                    active:
                        identity.active
                },
                epicProfile
            );

        if (
            !session.cookie
        ) {
            throw new Error(
                "Failed to create BPD session cookie."
            );
        }

        /* =================================================
        SUCCESS DESTINATION
        ================================================= */

        const successDestination =
            identity.createdAccount === true
                ? NEW_ACCOUNT_RETURN_TO
                : requestedReturnTo;

        /* =================================================
        CLEAR ONE-TIME OAUTH COOKIES
        ================================================= */

        const stateCookie =
            clearCookie(
                request,
                AUTH_STATE_COOKIE
            );

        const returnCookie =
            clearCookie(
                request,
                OAUTH_RETURN_COOKIE
            );

        return redirect(
            successDestination,
            [
                session.cookie,
                stateCookie,
                returnCookie
            ]
        );
    }
    catch (
        error
    ) {
        console.error(
            "EPIC CALLBACK: Unexpected failure.",
            {
                debugId,

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

        const status =
            error?.code ===
                "ACCOUNT_LINK_CONFLICT"
                ? 409
                : 500;

        return json(
            {
                success:
                    false,

                code:
                    error?.code
                    || error?.upstreamCode
                    || "EPIC_CALLBACK_FAILED",

                message:
                    error?.code ===
                        "ACCOUNT_LINK_CONFLICT"
                        ? "This Epic account is linked to a different BPD account."
                        : "Epic authentication could not be completed.",

                debugId
            },
            status
        );
    }
}