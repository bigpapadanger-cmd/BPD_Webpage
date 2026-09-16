"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT REST CLIENT

File:
    functions/services/auth/providers/discord_matchbot/client.js

Purpose:
    Provides the centralized Discord REST API client for the
    installable Gaming Network MatchBot.

Description:
    - Authenticates Discord API requests using the MatchBot
      bot token.
    - Provides reusable GET, POST, PATCH, PUT, and DELETE
      helpers.
    - Handles JSON and empty Discord responses.
    - Applies request timeouts.
    - Normalizes Discord API errors.
    - Preserves Discord rate-limit information.
    - Provides a bot identity check for setup/testing.

Required Environment:
    DISCORD_MATCHBOT_TOKEN

Related Environment:
    DISCORD_MATCHBOT_CLIENT_ID
    DISCORD_MATCHBOT_SECRET
    DISCORD_MATCHBOT_PUBLIC_KEY
    DISCORD_MATCHBOT_INSTALL_URL

Important:
    - Only DISCORD_MATCHBOT_TOKEN is used by this REST client.
    - DISCORD_MATCHBOT_SECRET is for OAuth2 code exchange and
      must never be used as a Bot authorization token.
    - The MatchBot is separate from the BPD authorization
      bot that verifies staff roles in the fixed BPD guild.
    - DISCORD_AUTHZ_* values must never be used here.
    - The bot token must never be logged or returned to the
      browser.

Architecture:
    Canonical Discord authentication:
        Supabase Discord OAuth

    BPD guild authorization:
        DISCORD_AUTHZ_* services

    MatchBot operations:
        this client
            ↓
        DISCORD_MATCHBOT_TOKEN
            ↓
        Discord REST API
            ↓
        installed guilds
        channels
        members
        messages
        scheduled events
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const DISCORD_API_BASE_URL =
    "https://discord.com/api/v10";

const DEFAULT_REQUEST_TIMEOUT_MS =
    10000;

const MAX_REQUEST_TIMEOUT_MS =
    30000;

/* =========================================================
ERROR
========================================================= */

export class DiscordMatchBotError extends Error {
    constructor(
        message,
        {
            code =
                "DISCORD_MATCHBOT_ERROR",

            status =
                500,

            discordStatus =
                null,

            discordCode =
                null,

            retryAfter =
                null,

            requestId =
                null,

            unavailable =
                false,

            cause =
                null
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "DiscordMatchBotError";

        this.code =
            code;

        this.status =
            status;

        this.discordStatus =
            discordStatus;

        this.discordCode =
            discordCode;

        this.retryAfter =
            retryAfter;

        this.requestId =
            requestId;

        this.unavailable =
            unavailable;

        if (
            cause
        ) {
            this.cause =
                cause;
        }
    }
}

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

function normalizeTimeout(
    value
) {
    const timeout =
        Number(
            value
        );

    if (
        !Number.isFinite(
            timeout
        )
        || timeout <= 0
    ) {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }

    return Math.min(
        Math.floor(
            timeout
        ),
        MAX_REQUEST_TIMEOUT_MS
    );
}

/* =========================================================
CONFIGURATION
========================================================= */

function getMatchBotToken(
    env
) {
    const token =
        normalizeString(
            env?.DISCORD_MATCHBOT_TOKEN
        );

    if (
        !token
    ) {
        throw new DiscordMatchBotError(
            "Discord MatchBot token is not configured.",
            {
                code:
                    "DISCORD_MATCHBOT_TOKEN_MISSING",

                status:
                    500
            }
        );
    }

    return token;
}

/* =========================================================
PATH
========================================================= */

function normalizeDiscordPath(
    path
) {
    const normalized =
        normalizeString(
            path
        );

    if (
        !normalized
    ) {
        throw new DiscordMatchBotError(
            "Discord API path is required.",
            {
                code:
                    "DISCORD_MATCHBOT_PATH_REQUIRED",

                status:
                    500
            }
        );
    }

    if (
        normalized.startsWith(
            "http://"
        )
        || normalized.startsWith(
            "https://"
        )
    ) {
        throw new DiscordMatchBotError(
            "Absolute Discord API URLs are not permitted.",
            {
                code:
                    "DISCORD_MATCHBOT_ABSOLUTE_URL_REJECTED",

                status:
                    500
            }
        );
    }

    return normalized.startsWith(
        "/"
    )
        ? normalized
        : `/${normalized}`;
}

/* =========================================================
METHOD
========================================================= */

function normalizeMethod(
    method
) {
    const normalized =
        normalizeString(
            method
        )
            .toUpperCase();

    switch (
        normalized
    ) {
        case "GET":
        case "POST":
        case "PUT":
        case "PATCH":
        case "DELETE":
            return normalized;

        default:
            throw new DiscordMatchBotError(
                "Discord API request method is not supported.",
                {
                    code:
                        "DISCORD_MATCHBOT_METHOD_INVALID",

                    status:
                        500
                }
            );
    }
}

/* =========================================================
RESPONSE BODY
========================================================= */

async function readDiscordResponse(
    response
) {
    if (
        response.status ===
        204
    ) {
        return null;
    }

    const contentType =
        normalizeString(
            response.headers.get(
                "content-type"
            )
        )
            .toLowerCase();

    try {
        if (
            contentType.includes(
                "application/json"
            )
        ) {
            return await response.json();
        }

        const text =
            await response.text();

        return text
            ? {
                message:
                    text
            }
            : null;
    }
    catch {
        return null;
    }
}

/* =========================================================
RATE LIMIT
========================================================= */

function getRetryAfter(
    response,
    result
) {
    if (
        result
        && typeof result ===
            "object"
        && Number.isFinite(
            Number(
                result.retry_after
            )
        )
    ) {
        return Number(
            result.retry_after
        );
    }

    const headerValue =
        response.headers.get(
            "retry-after"
        );

    const parsed =
        Number(
            headerValue
        );

    return Number.isFinite(
        parsed
    )
        ? parsed
        : null;
}

/* =========================================================
REQUEST ID
========================================================= */

function getRequestId(
    response
) {
    return normalizeString(
        response.headers.get(
            "x-request-id"
        )
    )
    || null;
}

/* =========================================================
DISCORD ERROR
========================================================= */

function createDiscordResponseError(
    response,
    result
) {
    const discordMessage =
        result
        && typeof result ===
            "object"
            ? normalizeString(
                result.message
            )
            : "";

    const discordCode =
        result
        && typeof result ===
            "object"
            ? result.code
                ?? null
            : null;

    const requestId =
        getRequestId(
            response
        );

    switch (
        response.status
    ) {
        case 400:
            return new DiscordMatchBotError(
                discordMessage
                || "Discord rejected the MatchBot request.",
                {
                    code:
                        "DISCORD_MATCHBOT_BAD_REQUEST",

                    status:
                        400,

                    discordStatus:
                        400,

                    discordCode,

                    requestId
                }
            );

        case 401:
            return new DiscordMatchBotError(
                "Discord rejected the MatchBot credentials.",
                {
                    code:
                        "DISCORD_MATCHBOT_UNAUTHORIZED",

                    status:
                        503,

                    discordStatus:
                        401,

                    discordCode,

                    requestId,

                    unavailable:
                        true
                }
            );

        case 403:
            return new DiscordMatchBotError(
                discordMessage
                || "MatchBot does not have permission to perform this Discord action.",
                {
                    code:
                        "DISCORD_MATCHBOT_FORBIDDEN",

                    status:
                        403,

                    discordStatus:
                        403,

                    discordCode,

                    requestId
                }
            );

        case 404:
            return new DiscordMatchBotError(
                discordMessage
                || "The requested Discord resource was not found.",
                {
                    code:
                        "DISCORD_MATCHBOT_NOT_FOUND",

                    status:
                        404,

                    discordStatus:
                        404,

                    discordCode,

                    requestId
                }
            );

        case 429:
            return new DiscordMatchBotError(
                "Discord temporarily rate limited the MatchBot request.",
                {
                    code:
                        "DISCORD_MATCHBOT_RATE_LIMITED",

                    status:
                        503,

                    discordStatus:
                        429,

                    discordCode,

                    retryAfter:
                        getRetryAfter(
                            response,
                            result
                        ),

                    requestId,

                    unavailable:
                        true
                }
            );

        default:
            return new DiscordMatchBotError(
                discordMessage
                || "Discord MatchBot request failed.",
                {
                    code:
                        "DISCORD_MATCHBOT_REQUEST_FAILED",

                    status:
                        response.status >= 500
                            ? 503
                            : 500,

                    discordStatus:
                        response.status,

                    discordCode,

                    requestId,

                    unavailable:
                        response.status >= 500
                }
            );
    }
}

/* =========================================================
REQUEST BODY
========================================================= */

function prepareRequestBody(
    body
) {
    if (
        body === undefined
        || body === null
    ) {
        return {
            body:
                undefined,

            contentType:
                null
        };
    }

    if (
        typeof FormData !==
            "undefined"
        && body instanceof
            FormData
    ) {
        return {
            body,

            contentType:
                null
        };
    }

    return {
        body:
            JSON.stringify(
                body
            ),

        contentType:
            "application/json"
    };
}

/* =========================================================
MATCHBOT REQUEST
========================================================= */

export async function discordMatchBotRequest(
    env,
    path,
    {
        method =
            "GET",

        body =
            undefined,

        headers =
            undefined,

        timeoutMs =
            DEFAULT_REQUEST_TIMEOUT_MS
    } = {}
) {
    const token =
        getMatchBotToken(
            env
        );

    const normalizedPath =
        normalizeDiscordPath(
            path
        );

    const normalizedMethod =
        normalizeMethod(
            method
        );

    const normalizedTimeout =
        normalizeTimeout(
            timeoutMs
        );

    const requestUrl =
        `${DISCORD_API_BASE_URL}${normalizedPath}`;

    const preparedBody =
        prepareRequestBody(
            body
        );

    const requestHeaders =
        new Headers(
            headers
            || {}
        );

    requestHeaders.set(
        "Authorization",
        `Bot ${token}`
    );

    requestHeaders.set(
        "Accept",
        "application/json"
    );

    requestHeaders.set(
        "User-Agent",
        "BPD-Gaming-Network-MatchBot/1.0"
    );

    if (
        preparedBody.contentType
        && !requestHeaders.has(
            "Content-Type"
        )
    ) {
        requestHeaders.set(
            "Content-Type",
            preparedBody.contentType
        );
    }

    const controller =
        new AbortController();

    const timeoutId =
        setTimeout(
            () => {
                controller.abort();
            },
            normalizedTimeout
        );

    let response;

    try {
        response =
            await fetch(
                requestUrl,
                {
                    method:
                        normalizedMethod,

                    headers:
                        requestHeaders,

                    body:
                        preparedBody.body,

                    signal:
                        controller.signal
                }
            );
    }
    catch (
        error
    ) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new DiscordMatchBotError(
                "Discord MatchBot request timed out.",
                {
                    code:
                        "DISCORD_MATCHBOT_REQUEST_TIMEOUT",

                    status:
                        503,

                    unavailable:
                        true,

                    cause:
                        error
                }
            );
        }

        throw new DiscordMatchBotError(
            "Discord MatchBot could not reach Discord.",
            {
                code:
                    "DISCORD_MATCHBOT_NETWORK_ERROR",

                status:
                    503,

                unavailable:
                    true,

                cause:
                    error
            }
        );
    }
    finally {
        clearTimeout(
            timeoutId
        );
    }

    const result =
        await readDiscordResponse(
            response
        );

    if (
        !response.ok
    ) {
        throw createDiscordResponseError(
            response,
            result
        );
    }

    return result;
}

/* =========================================================
GET
========================================================= */

export function discordMatchBotGet(
    env,
    path,
    options = {}
) {
    return discordMatchBotRequest(
        env,
        path,
        {
            ...options,

            method:
                "GET"
        }
    );
}

/* =========================================================
POST
========================================================= */

export function discordMatchBotPost(
    env,
    path,
    body,
    options = {}
) {
    return discordMatchBotRequest(
        env,
        path,
        {
            ...options,

            method:
                "POST",

            body
        }
    );
}

/* =========================================================
PUT
========================================================= */

export function discordMatchBotPut(
    env,
    path,
    body,
    options = {}
) {
    return discordMatchBotRequest(
        env,
        path,
        {
            ...options,

            method:
                "PUT",

            body
        }
    );
}

/* =========================================================
PATCH
========================================================= */

export function discordMatchBotPatch(
    env,
    path,
    body,
    options = {}
) {
    return discordMatchBotRequest(
        env,
        path,
        {
            ...options,

            method:
                "PATCH",

            body
        }
    );
}

/* =========================================================
DELETE
========================================================= */

export function discordMatchBotDelete(
    env,
    path,
    options = {}
) {
    return discordMatchBotRequest(
        env,
        path,
        {
            ...options,

            method:
                "DELETE"
        }
    );
}

/* =========================================================
MATCHBOT IDENTITY

Discord:
    GET /users/@me

Purpose:
    Confirms that DISCORD_MATCHBOT_TOKEN is valid and returns
    the Discord bot account represented by the token.
========================================================= */

export async function getDiscordMatchBotIdentity(
    env
) {
    const result =
        await discordMatchBotGet(
            env,
            "/users/@me"
        );

    const id =
        normalizeString(
            result?.id
        );

    const username =
        normalizeString(
            result?.username
        );

    if (
        !id
        || !username
    ) {
        throw new DiscordMatchBotError(
            "Discord returned an invalid MatchBot identity.",
            {
                code:
                    "DISCORD_MATCHBOT_IDENTITY_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return {
        id,

        username,

        discriminator:
            normalizeString(
                result?.discriminator
            )
            || null,

        globalName:
            normalizeString(
                result?.global_name
            )
            || null,

        avatar:
            normalizeString(
                result?.avatar
            )
            || null,

        bot:
            result?.bot ===
            true,

        verified:
            result?.verified ===
            true
    };
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isDiscordMatchBotError(
    error
) {
    return (
        error instanceof
            DiscordMatchBotError
        || error?.name ===
            "DiscordMatchBotError"
    );
}