"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT TEST MESSAGE API

File:
    functions/api/auth/discord/matchbot/test_message.js

Purpose:
    Sends a real test message through Gaming Network MatchBot
    to a selected Discord channel.

Description:
    - Requires an authenticated, active BPD account.
    - Requires a verified linked Discord identity.
    - Requires MatchBot to be installed in the target guild.
    - Requires the linked Discord user to have:
        Administrator
        OR
        Manage Guild
    - Validates the selected notification channel.
    - Sends a test embed through MatchBot.
    - Does not use DISCORD_AUTHZ_* configuration.

Route:
    POST /api/auth/discord/matchbot/test_message

Request JSON:
    {
        "guildId": "...",
        "channelId": "..."
    }

Security:
    - Browser cannot choose the authoritative Discord user.
    - Guild configuration permission is re-verified.
    - Channel existence is re-verified against Discord.
    - MatchBot credentials are never returned.
========================================================= */

import {
    isAuthorizationError
} from "../../../../services/auth/authorization.js";

import {
    authorizeDiscordMatchBotConfiguration
} from "../../../../services/auth/providers/discord_matchbot/permissions.js";

import {
    sendDiscordMatchBotTestMessage
} from "../../../../services/auth/providers/discord_matchbot/messages.js";

import {
    isDiscordMatchBotError
} from "../../../../services/auth/providers/discord_matchbot/client.js";

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}

/* =========================================================
REQUEST BODY
========================================================= */

async function readJsonBody(
    request
) {
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
        throw new Error(
            "INVALID_CONTENT_TYPE"
        );
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        throw new Error(
            "INVALID_JSON"
        );
    }

    if (
        !body
        || typeof body !==
            "object"
        || Array.isArray(
            body
        )
    ) {
        throw new Error(
            "INVALID_BODY"
        );
    }

    return body;
}

/* =========================================================
AUTHORIZATION ERROR
========================================================= */

function authorizationErrorResponse(
    error,
    debugId
) {
    if (
        error?.code ===
        "AUTH_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "AUTH_REQUIRED",

                message:
                    "You must be signed in to configure MatchBot.",

                debugId
            },
            401
        );
    }

    if (
        error?.code ===
        "ACCOUNT_INACTIVE"
    ) {
        return jsonResponse(
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
        error?.code ===
        "PROVIDER_REQUIRED"
        || error?.code ===
        "DISCORD_PROVIDER_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "DISCORD_PROVIDER_REQUIRED",

                message:
                    "A linked Discord account is required to configure MatchBot.",

                debugId
            },
            403
        );
    }

    if (
        error?.code ===
        "DISCORD_MATCHBOT_GUILD_MANAGE_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "DISCORD_MATCHBOT_GUILD_MANAGE_REQUIRED",

                message:
                    "You must have Manage Server or Administrator permission in this Discord server to configure MatchBot.",

                debugId
            },
            403
        );
    }

    return jsonResponse(
        {
            success:
                false,

            code:
                error?.code
                || "AUTHORIZATION_FAILED",

            message:
                "Your account could not be authorized for this MatchBot server.",

            debugId
        },
        Number.isInteger(
            error?.status
        )
            ? error.status
            : 403
    );
}

/* =========================================================
MATCHBOT ERROR
========================================================= */

function matchBotErrorResponse(
    error,
    debugId
) {
    return jsonResponse(
        {
            success:
                false,

            code:
                error?.code
                || "MATCHBOT_TEST_MESSAGE_FAILED",

            message:
                error?.code ===
                "DISCORD_MATCHBOT_FORBIDDEN"
                    ? "MatchBot does not have permission to send messages in the selected Discord channel."
                    : "MatchBot could not send the test message.",

            debugId
        },
        Number.isInteger(
            error?.status
        )
            ? error.status
            : 503
    );
}

/* =========================================================
POST
========================================================= */

export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } =
        context;

    const debugId =
        crypto.randomUUID();

    try {
        let body;

        try {
            body =
                await readJsonBody(
                    request
                );
        }
        catch (
            error
        ) {
            const code =
                error?.message
                || "INVALID_REQUEST";

            return jsonResponse(
                {
                    success:
                        false,

                    code,

                    message:
                        "A valid JSON request body is required.",

                    debugId
                },
                400
            );
        }

        const guildId =
            normalizeString(
                body.guildId
            );

        const channelId =
            normalizeString(
                body.channelId
            );

        if (
            !guildId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "GUILD_ID_REQUIRED",

                    message:
                        "A Discord guild ID is required.",

                    debugId
                },
                400
            );
        }

        if (
            !channelId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "CHANNEL_ID_REQUIRED",

                    message:
                        "A Discord channel ID is required.",

                    debugId
                },
                400
            );
        }

        /* =================================================
        AUTHORIZE GUILD CONFIGURATION
        ================================================= */

        const authorization =
            await authorizeDiscordMatchBotConfiguration(
                request,
                env,
                guildId
            );

        /* =================================================
        SEND TEST MESSAGE
        ================================================= */

        const result =
            await sendDiscordMatchBotTestMessage(
                env,
                authorization.matchBot.guild.id,
                channelId
            );

        return jsonResponse(
            {
                success:
                    true,

                guild: {
                    id:
                        authorization.matchBot.guild.id,

                    name:
                        authorization.matchBot.guild.name
                },

                channel: {
                    id:
                        result.channel.id,

                    name:
                        result.channel.name,

                    type:
                        result.channel.typeName
                },

                message: {
                    id:
                        result.message.id,

                    channelId:
                        result.message.channelId,

                    timestamp:
                        result.message.timestamp
                }
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT TEST MESSAGE API: Request failed.",
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

        if (
            isAuthorizationError(
                error
            )
        ) {
            return authorizationErrorResponse(
                error,
                debugId
            );
        }

        if (
            isDiscordMatchBotError(
                error
            )
        ) {
            return matchBotErrorResponse(
                error,
                debugId
            );
        }

        return jsonResponse(
            {
                success:
                    false,

                code:
                    "MATCHBOT_TEST_MESSAGE_FAILED",

                message:
                    "MatchBot could not send the test message.",

                debugId
            },
            500
        );
    }
}

/* =========================================================
OTHER METHODS
========================================================= */

export function onRequestGet() {
    return jsonResponse(
        {
            success:
                false,

            code:
                "METHOD_NOT_ALLOWED"
        },
        405
    );
}

export function onRequestPut() {
    return onRequestGet();
}

export function onRequestPatch() {
    return onRequestGet();
}

export function onRequestDelete() {
    return onRequestGet();
}