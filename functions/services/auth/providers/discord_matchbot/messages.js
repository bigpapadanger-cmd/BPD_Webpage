"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT MESSAGE SERVICE

File:
    functions/services/auth/providers/discord_matchbot/messages.js

Purpose:
    Sends Discord messages through the installable Gaming
    Network MatchBot.

Description:
    - Uses the centralized MatchBot REST client.
    - Validates the target guild/channel before sending.
    - Supports plain text messages and embeds.
    - Supports optional user and role mentions.
    - Uses explicit allowed_mentions to prevent accidental
      mass mentions.
    - Provides a reusable test-message helper.
    - Does not perform Discord authentication.
    - Does not perform BPD staff authorization.
    - Does not use DISCORD_AUTHZ_* configuration.

Dependencies:
    functions/services/auth/providers/discord_matchbot/client.js
    functions/services/auth/providers/discord_matchbot/channels.js

Security:
    - Browser-supplied guild/channel IDs must be validated
      against Discord before use.
    - @everyone and @here are never allowed.
    - Role mentions are allowed only when explicitly passed
      by trusted server-side code.
    - User mentions are allowed only when explicitly passed
      by trusted server-side code.
    - DISCORD_MATCHBOT_TOKEN is never exposed.
========================================================= */

import {
    DiscordMatchBotError,
    discordMatchBotPost
} from "./client.js";

import {
    requireDiscordMatchBotNotificationChannel
} from "./channels.js";

/* =========================================================
CONSTANTS
========================================================= */

const DISCORD_MESSAGE_MAX_LENGTH =
    2000;

const DISCORD_EMBED_TITLE_MAX_LENGTH =
    256;

const DISCORD_EMBED_DESCRIPTION_MAX_LENGTH =
    4096;

const DISCORD_EMBED_FIELD_NAME_MAX_LENGTH =
    256;

const DISCORD_EMBED_FIELD_VALUE_MAX_LENGTH =
    1024;

const DISCORD_EMBED_MAX_FIELDS =
    25;

const DISCORD_MAX_EMBEDS =
    10;

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

function normalizeStringArray(
    values
) {
    if (
        !Array.isArray(
            values
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            values
                .map(
                    normalizeString
                )
                .filter(
                    Boolean
                )
        )
    ];
}

/* =========================================================
SNOWFLAKE
========================================================= */

function normalizeSnowflakeArray(
    values
) {
    return normalizeStringArray(
        values
    ).filter(
        (
            value
        ) =>
            /^\d{16,22}$/u.test(
                value
            )
    );
}

/* =========================================================
CONTENT
========================================================= */

function normalizeContent(
    value
) {
    const content =
        normalizeString(
            value
        );

    if (
        !content
    ) {
        return null;
    }

    if (
        content.length >
        DISCORD_MESSAGE_MAX_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord message content exceeds the maximum length.",
            {
                code:
                    "DISCORD_MATCHBOT_MESSAGE_TOO_LONG",

                status:
                    400
            }
        );
    }

    return content;
}

/* =========================================================
EMBED FIELD
========================================================= */

function normalizeEmbedField(
    field
) {
    if (
        !field
        || typeof field !==
            "object"
        || Array.isArray(
            field
        )
    ) {
        return null;
    }

    const name =
        normalizeString(
            field.name
        );

    const value =
        normalizeString(
            field.value
        );

    if (
        !name
        || !value
    ) {
        return null;
    }

    if (
        name.length >
        DISCORD_EMBED_FIELD_NAME_MAX_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord embed field name exceeds the maximum length.",
            {
                code:
                    "DISCORD_MATCHBOT_EMBED_FIELD_NAME_TOO_LONG",

                status:
                    400
            }
        );
    }

    if (
        value.length >
        DISCORD_EMBED_FIELD_VALUE_MAX_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord embed field value exceeds the maximum length.",
            {
                code:
                    "DISCORD_MATCHBOT_EMBED_FIELD_VALUE_TOO_LONG",

                status:
                    400
            }
        );
    }

    return {
        name,
        value,

        inline:
            field.inline ===
            true
    };
}

/* =========================================================
EMBED
========================================================= */

function normalizeEmbed(
    embed
) {
    if (
        !embed
        || typeof embed !==
            "object"
        || Array.isArray(
            embed
        )
    ) {
        return null;
    }

    const title =
        normalizeString(
            embed.title
        );

    const description =
        normalizeString(
            embed.description
        );

    if (
        title
        && title.length >
            DISCORD_EMBED_TITLE_MAX_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord embed title exceeds the maximum length.",
            {
                code:
                    "DISCORD_MATCHBOT_EMBED_TITLE_TOO_LONG",

                status:
                    400
            }
        );
    }

    if (
        description
        && description.length >
            DISCORD_EMBED_DESCRIPTION_MAX_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord embed description exceeds the maximum length.",
            {
                code:
                    "DISCORD_MATCHBOT_EMBED_DESCRIPTION_TOO_LONG",

                status:
                    400
            }
        );
    }

    let fields = [];

    if (
        Array.isArray(
            embed.fields
        )
    ) {
        fields =
            embed.fields
                .map(
                    normalizeEmbedField
                )
                .filter(
                    Boolean
                );

        if (
            fields.length >
            DISCORD_EMBED_MAX_FIELDS
        ) {
            throw new DiscordMatchBotError(
                "Discord embed contains too many fields.",
                {
                    code:
                        "DISCORD_MATCHBOT_EMBED_TOO_MANY_FIELDS",

                    status:
                        400
                }
            );
        }
    }

    const normalized = {};

    if (
        title
    ) {
        normalized.title =
            title;
    }

    if (
        description
    ) {
        normalized.description =
            description;
    }

    if (
        normalizeString(
            embed.url
        )
    ) {
        normalized.url =
            normalizeString(
                embed.url
            );
    }

    if (
        normalizeString(
            embed.timestamp
        )
    ) {
        normalized.timestamp =
            normalizeString(
                embed.timestamp
            );
    }

    if (
        Number.isInteger(
            embed.color
        )
        && embed.color >= 0
        && embed.color <= 16777215
    ) {
        normalized.color =
            embed.color;
    }

    if (
        fields.length >
        0
    ) {
        normalized.fields =
            fields;
    }

    if (
        embed.footer
        && typeof embed.footer ===
            "object"
    ) {
        const footerText =
            normalizeString(
                embed.footer.text
            );

        if (
            footerText
        ) {
            normalized.footer = {
                text:
                    footerText
            };
        }
    }

    if (
        embed.author
        && typeof embed.author ===
            "object"
    ) {
        const authorName =
            normalizeString(
                embed.author.name
            );

        if (
            authorName
        ) {
            normalized.author = {
                name:
                    authorName
            };
        }
    }

    return Object.keys(
        normalized
    ).length > 0
        ? normalized
        : null;
}

/* =========================================================
EMBEDS
========================================================= */

function normalizeEmbeds(
    embeds
) {
    if (
        !Array.isArray(
            embeds
        )
    ) {
        return [];
    }

    const normalized =
        embeds
            .map(
                normalizeEmbed
            )
            .filter(
                Boolean
            );

    if (
        normalized.length >
        DISCORD_MAX_EMBEDS
    ) {
        throw new DiscordMatchBotError(
            "Discord message contains too many embeds.",
            {
                code:
                    "DISCORD_MATCHBOT_TOO_MANY_EMBEDS",

                status:
                    400
            }
        );
    }

    return normalized;
}

/* =========================================================
ALLOWED MENTIONS

Important:
    Never allow parse=["everyone"].

Only explicitly supplied user/role IDs may be mentioned.
========================================================= */

function createAllowedMentions(
    {
        userIds =
            [],

        roleIds =
            []
    } = {}
) {
    const users =
        normalizeSnowflakeArray(
            userIds
        );

    const roles =
        normalizeSnowflakeArray(
            roleIds
        );

    return {
        parse:
            [],

        users,

        roles,

        replied_user:
            false
    };
}

/* =========================================================
MESSAGE PAYLOAD
========================================================= */

function createMessagePayload(
    {
        content =
            null,

        embeds =
            [],

        userMentions =
            [],

        roleMentions =
            []
    } = {}
) {
    const normalizedContent =
        normalizeContent(
            content
        );

    const normalizedEmbeds =
        normalizeEmbeds(
            embeds
        );

    if (
        !normalizedContent
        && normalizedEmbeds.length ===
            0
    ) {
        throw new DiscordMatchBotError(
            "Discord message content or embeds are required.",
            {
                code:
                    "DISCORD_MATCHBOT_MESSAGE_EMPTY",

                status:
                    400
            }
        );
    }

    const payload = {
        allowed_mentions:
            createAllowedMentions({
                userIds:
                    userMentions,

                roleIds:
                    roleMentions
            })
    };

    if (
        normalizedContent
    ) {
        payload.content =
            normalizedContent;
    }

    if (
        normalizedEmbeds.length >
        0
    ) {
        payload.embeds =
            normalizedEmbeds;
    }

    return payload;
}

/* =========================================================
NORMALIZE SENT MESSAGE
========================================================= */

function normalizeSentMessage(
    result
) {
    if (
        !result
        || typeof result !==
            "object"
        || Array.isArray(
            result
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            result.id
        );

    const channelId =
        normalizeString(
            result.channel_id
        );

    if (
        !id
        || !channelId
    ) {
        return null;
    }

    return {
        id,

        channelId,

        guildId:
            normalizeString(
                result.guild_id
            )
            || null,

        content:
            normalizeString(
                result.content
            )
            || null,

        timestamp:
            normalizeString(
                result.timestamp
            )
            || null,

        editedTimestamp:
            normalizeString(
                result.edited_timestamp
            )
            || null
    };
}

/* =========================================================
SEND MESSAGE

Discord:
    POST /channels/{channel.id}/messages
========================================================= */

export async function sendDiscordMatchBotMessage(
    env,
    guildId,
    channelId,
    options = {}
) {
    const channel =
        await requireDiscordMatchBotNotificationChannel(
            env,
            guildId,
            channelId
        );

    const payload =
        createMessagePayload(
            options
        );

    const result =
        await discordMatchBotPost(
            env,
            `/channels/${encodeURIComponent(
                channel.id
            )}/messages`,
            payload
        );

    const message =
        normalizeSentMessage(
            result
        );

    if (
        !message
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid MatchBot message information.",
            {
                code:
                    "DISCORD_MATCHBOT_MESSAGE_RESPONSE_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return {
        channel,

        message
    };
}

/* =========================================================
SEND TEST MESSAGE
========================================================= */

export async function sendDiscordMatchBotTestMessage(
    env,
    guildId,
    channelId
) {
    return sendDiscordMatchBotMessage(
        env,
        guildId,
        channelId,
        {
            embeds: [
                {
                    title:
                        "Gaming Network MatchBot",

                    description:
                        "MatchBot is connected and can send notifications to this channel.",

                    fields: [
                        {
                            name:
                                "Status",

                            value:
                                "Connection successful",

                            inline:
                                true
                        }
                    ],

                    timestamp:
                        new Date()
                            .toISOString()
                }
            ]
        }
    );
}

/* =========================================================
SEND MATCH ANNOUNCEMENT

Generic helper for later Rocket League / game-specific
match services.

This intentionally accepts normalized display values rather
than game-specific database objects.
========================================================= */

export async function sendDiscordMatchAnnouncement(
    env,
    guildId,
    channelId,
    {
        title =
            "Upcoming Match",

        playerOne,
        playerTwo,

        scheduledAt,

        mode =
            null,

        userMentions =
            [],

        roleMentions =
            []
    } = {}
) {
    const firstPlayer =
        normalizeString(
            playerOne
        );

    const secondPlayer =
        normalizeString(
            playerTwo
        );

    const timestamp =
        normalizeString(
            scheduledAt
        );

    if (
        !firstPlayer
        || !secondPlayer
        || !timestamp
    ) {
        throw new DiscordMatchBotError(
            "Match announcement information is incomplete.",
            {
                code:
                    "DISCORD_MATCHBOT_MATCH_DATA_INVALID",

                status:
                    400
            }
        );
    }

    const fields = [
        {
            name:
                "Match",

            value:
                `${firstPlayer} vs ${secondPlayer}`,

            inline:
                false
        },
        {
            name:
                "Scheduled",

            value:
                timestamp,

            inline:
                true
        }
    ];

    const normalizedMode =
        normalizeString(
            mode
        );

    if (
        normalizedMode
    ) {
        fields.push({
            name:
                "Mode",

            value:
                normalizedMode,

            inline:
                true
        });
    }

    return sendDiscordMatchBotMessage(
        env,
        guildId,
        channelId,
        {
            embeds: [
                {
                    title:
                        normalizeString(
                            title
                        )
                        || "Upcoming Match",

                    fields
                }
            ],

            userMentions,

            roleMentions
        }
    );
}