"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT CHANNEL SERVICE

File:
    functions/services/auth/providers/discord_matchbot/channels.js

Purpose:
    Retrieves and evaluates Discord channels available to the
    installable Gaming Network MatchBot.

Description:
    - Uses the centralized MatchBot Discord REST client.
    - Requires MatchBot to be installed in the target guild.
    - Retrieves guild channels from Discord.
    - Normalizes channel information.
    - Filters channels to those appropriate for MatchBot
      notifications.
    - Provides reusable helpers for channel validation before
      sending messages or creating configuration records.

Dependencies:
    functions/services/auth/providers/discord_matchbot/client.js
    functions/services/auth/providers/discord_matchbot/guilds.js

Security:
    - Uses only the server-side MatchBot token.
    - Never trusts a browser-supplied channel ID without
      validating it against Discord.
    - Never assumes a stored channel remains valid forever.
    - MatchBot guild access is re-verified before channel
      operations.
    - DISCORD_AUTHZ_* configuration is never used here.

Important:
    Discord guild channel responses include permission
    overwrites but do not directly provide a final resolved
    bot permission set for every channel.

    This service therefore performs structural channel
    validation here.

    Final send authorization is still enforced by Discord
    when messages are actually sent.

Supported Notification Channels:
    - Guild Text
    - Announcement

Future:
    Thread support can be added separately if needed.
========================================================= */

import {
    DiscordMatchBotError,
    discordMatchBotGet
} from "./client.js";

import {
    requireDiscordMatchBotGuild
} from "./guilds.js";

/* =========================================================
DISCORD CHANNEL TYPES
========================================================= */

const DISCORD_CHANNEL_TYPE =
    Object.freeze({
        GUILD_TEXT:
            0,

        GUILD_VOICE:
            2,

        GUILD_CATEGORY:
            4,

        GUILD_ANNOUNCEMENT:
            5,

        ANNOUNCEMENT_THREAD:
            10,

        PUBLIC_THREAD:
            11,

        PRIVATE_THREAD:
            12,

        GUILD_STAGE_VOICE:
            13,

        GUILD_FORUM:
            15,

        GUILD_MEDIA:
            16
    });

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

function normalizeInteger(
    value
) {
    const normalized =
        Number(
            value
        );

    return Number.isInteger(
        normalized
    )
        ? normalized
        : null;
}

/* =========================================================
SNOWFLAKE
========================================================= */

function requireDiscordSnowflake(
    value,
    fieldName = "Discord ID"
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
        || !/^\d{16,22}$/u.test(
            normalized
        )
    ) {
        throw new DiscordMatchBotError(
            `${fieldName} is invalid.`,
            {
                code:
                    "DISCORD_MATCHBOT_INVALID_SNOWFLAKE",

                status:
                    400
            }
        );
    }

    return normalized;
}

/* =========================================================
CHANNEL TYPE
========================================================= */

function getChannelTypeName(
    type
) {
    switch (
        type
    ) {
        case DISCORD_CHANNEL_TYPE.GUILD_TEXT:
            return "text";

        case DISCORD_CHANNEL_TYPE.GUILD_VOICE:
            return "voice";

        case DISCORD_CHANNEL_TYPE.GUILD_CATEGORY:
            return "category";

        case DISCORD_CHANNEL_TYPE.GUILD_ANNOUNCEMENT:
            return "announcement";

        case DISCORD_CHANNEL_TYPE.ANNOUNCEMENT_THREAD:
            return "announcement_thread";

        case DISCORD_CHANNEL_TYPE.PUBLIC_THREAD:
            return "public_thread";

        case DISCORD_CHANNEL_TYPE.PRIVATE_THREAD:
            return "private_thread";

        case DISCORD_CHANNEL_TYPE.GUILD_STAGE_VOICE:
            return "stage_voice";

        case DISCORD_CHANNEL_TYPE.GUILD_FORUM:
            return "forum";

        case DISCORD_CHANNEL_TYPE.GUILD_MEDIA:
            return "media";

        default:
            return "unknown";
    }
}

/* =========================================================
NOTIFICATION CHANNEL TYPE
========================================================= */

function isSupportedNotificationChannelType(
    type
) {
    return (
        type ===
            DISCORD_CHANNEL_TYPE.GUILD_TEXT
        || type ===
            DISCORD_CHANNEL_TYPE.GUILD_ANNOUNCEMENT
    );
}

/* =========================================================
PERMISSION OVERWRITES
========================================================= */

function normalizePermissionOverwrites(
    overwrites
) {
    if (
        !Array.isArray(
            overwrites
        )
    ) {
        return [];
    }

    return overwrites
        .map(
            (
                overwrite
            ) => {
                if (
                    !overwrite
                    || typeof overwrite !==
                        "object"
                    || Array.isArray(
                        overwrite
                    )
                ) {
                    return null;
                }

                const id =
                    normalizeString(
                        overwrite.id
                    );

                const type =
                    normalizeInteger(
                        overwrite.type
                    );

                if (
                    !id
                    || type ===
                        null
                ) {
                    return null;
                }

                return {
                    id,

                    type,

                    allow:
                        normalizeString(
                            overwrite.allow
                        )
                        || "0",

                    deny:
                        normalizeString(
                            overwrite.deny
                        )
                        || "0"
                };
            }
        )
        .filter(
            Boolean
        );
}

/* =========================================================
CHANNEL NORMALIZATION
========================================================= */

function normalizeChannel(
    channel
) {
    if (
        !channel
        || typeof channel !==
            "object"
        || Array.isArray(
            channel
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            channel.id
        );

    const guildId =
        normalizeString(
            channel.guild_id
        );

    const name =
        normalizeString(
            channel.name
        );

    const type =
        normalizeInteger(
            channel.type
        );

    if (
        !id
        || !guildId
        || type ===
            null
    ) {
        return null;
    }

    return {
        id,

        guildId,

        name:
            name
            || null,

        type,

        typeName:
            getChannelTypeName(
                type
            ),

        parentId:
            normalizeString(
                channel.parent_id
            )
            || null,

        position:
            normalizeInteger(
                channel.position
            )
            ?? 0,

        topic:
            normalizeString(
                channel.topic
            )
            || null,

        nsfw:
            channel.nsfw ===
            true,

        rateLimitPerUser:
            normalizeInteger(
                channel.rate_limit_per_user
            )
            ?? 0,

        permissionOverwrites:
            normalizePermissionOverwrites(
                channel.permission_overwrites
            ),

        supportsNotifications:
            isSupportedNotificationChannelType(
                type
            )
    };
}

/* =========================================================
SORT CHANNELS
========================================================= */

function sortChannels(
    channels
) {
    return [
        ...channels
    ].sort(
        (
            a,
            b
        ) => {
            if (
                a.position !==
                b.position
            ) {
                return (
                    a.position
                    - b.position
                );
            }

            return (
                a.name
                || ""
            ).localeCompare(
                b.name
                || ""
            );
        }
    );
}

/* =========================================================
GET GUILD CHANNELS

Discord:
    GET /guilds/{guild.id}/channels

Purpose:
    Returns normalized channels for a guild where MatchBot
    is currently installed.
========================================================= */

export async function getDiscordMatchBotGuildChannels(
    env,
    guildId
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    /*
     * Confirm MatchBot currently has guild access before
     * querying its channels.
     */
    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/channels`
        );

    if (
        !Array.isArray(
            result
        )
    ) {
        throw new DiscordMatchBotError(
            "Discord returned an invalid MatchBot channel list.",
            {
                code:
                    "DISCORD_MATCHBOT_CHANNEL_LIST_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return sortChannels(
        result
            .map(
                normalizeChannel
            )
            .filter(
                Boolean
            )
    );
}

/* =========================================================
GET NOTIFICATION CHANNELS

Purpose:
    Returns channels structurally suitable for MatchBot
    notification delivery.

Important:
    This does not replace Discord's final permission check.
    Sending a message remains the authoritative confirmation
    that MatchBot can actually post to the channel.
========================================================= */

export async function getDiscordMatchBotNotificationChannels(
    env,
    guildId
) {
    const channels =
        await getDiscordMatchBotGuildChannels(
            env,
            guildId
        );

    return channels.filter(
        (
            channel
        ) =>
            channel.supportsNotifications ===
            true
    );
}

/* =========================================================
FIND CHANNEL
========================================================= */

export async function findDiscordMatchBotChannel(
    env,
    guildId,
    channelId
) {
    const normalizedChannelId =
        requireDiscordSnowflake(
            channelId,
            "Discord channel ID"
        );

    const channels =
        await getDiscordMatchBotGuildChannels(
            env,
            guildId
        );

    return (
        channels.find(
            (
                channel
            ) =>
                channel.id ===
                normalizedChannelId
        )
        || null
    );
}

/* =========================================================
REQUIRE CHANNEL
========================================================= */

export async function requireDiscordMatchBotChannel(
    env,
    guildId,
    channelId
) {
    const channel =
        await findDiscordMatchBotChannel(
            env,
            guildId,
            channelId
        );

    if (
        !channel
    ) {
        throw new DiscordMatchBotError(
            "The selected Discord channel is not available to Gaming Network MatchBot.",
            {
                code:
                    "DISCORD_MATCHBOT_CHANNEL_REQUIRED",

                status:
                    404
            }
        );
    }

    return channel;
}

/* =========================================================
REQUIRE NOTIFICATION CHANNEL
========================================================= */

export async function requireDiscordMatchBotNotificationChannel(
    env,
    guildId,
    channelId
) {
    const channel =
        await requireDiscordMatchBotChannel(
            env,
            guildId,
            channelId
        );

    if (
        channel.supportsNotifications !==
        true
    ) {
        throw new DiscordMatchBotError(
            "The selected Discord channel cannot be used for MatchBot notifications.",
            {
                code:
                    "DISCORD_MATCHBOT_CHANNEL_UNSUPPORTED",

                status:
                    400
            }
        );
    }

    return channel;
}