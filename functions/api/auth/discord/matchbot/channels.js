"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT CHANNELS API

File:
    functions/api/auth/discord/matchbot/channels.js

Purpose:
    Returns Discord channels that may be used for Gaming
    Network MatchBot notifications in a guild the current
    authenticated BPD user is authorized to configure.

Description:
    - Requires an authenticated, active BPD account.
    - Requires a verified linked Discord identity.
    - Requires MatchBot to be installed in the target guild.
    - Requires the linked Discord user to have:
        Administrator
        OR
        Manage Guild
    - Returns only notification-capable channels.
    - Does not expose channels from guilds the user cannot
      configure.
    - Does not use DISCORD_AUTHZ_* configuration.

Route:
    GET /api/auth/discord/matchbot/channels?guildId=...

Security:
    - Browser supplies only the requested guild ID.
    - Canonical Discord user identity comes from the linked
      BPD account.
    - Guild configuration authority is re-verified against
      current Discord state.
    - MatchBot token is never exposed.
========================================================= */

import {
    isAuthorizationError
} from "../../../../services/auth/authorization.js";

import {
    authorizeDiscordMatchBotConfiguration
} from "../../../../services/auth/providers/discord_matchbot/permissions.js";

import {
    getDiscordMatchBotNotificationChannels
} from "../../../../services/auth/providers/discord_matchbot/channels.js";

import {
    isDiscordMatchBotError
} from "../../../../services/auth/providers/discord_matchbot/client.js";

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
GUILD ID
========================================================= */

function getGuildId(
    request
) {
    const url =
        new URL(
            request.url
        );

    return normalizeString(
        url.searchParams.get(
            "guildId"
        )
    );
}

/* =========================================================
CHANNEL RESPONSE
========================================================= */

function createChannelResponse(
    channel
) {
    return {
        id:
            channel.id,

        guildId:
            channel.guildId,

        name:
            channel.name,

        type:
            channel.type,

        typeName:
            channel.typeName,

        parentId:
            channel.parentId,

        position:
            channel.position,

        topic:
            channel.topic,

        nsfw:
            channel.nsfw ===
            true,

        rateLimitPerUser:
            channel.rateLimitPerUser,

        supportsNotifications:
            channel.supportsNotifications ===
            true
    };
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
                || "MATCHBOT_CHANNELS_FAILED",

            message:
                "MatchBot channel information is currently unavailable.",

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
GET
========================================================= */

export async function onRequestGet(
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
        const guildId =
            getGuildId(
                request
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
        LOAD NOTIFICATION CHANNELS
        ================================================= */

        const channels =
            await getDiscordMatchBotNotificationChannels(
                env,
                authorization.matchBot.guild.id
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

                channels:
                    channels.map(
                        createChannelResponse
                    ),

                count:
                    channels.length
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT CHANNELS API: Request failed.",
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
                    "MATCHBOT_CHANNELS_FAILED",

                message:
                    "MatchBot channels could not be loaded.",

                debugId
            },
            500
        );
    }
}

/* =========================================================
OTHER METHODS
========================================================= */

export function onRequestPost() {
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
    return onRequestPost();
}

export function onRequestPatch() {
    return onRequestPost();
}

export function onRequestDelete() {
    return onRequestPost();
}