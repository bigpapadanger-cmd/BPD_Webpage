"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT GUILD SERVICE

File:
    functions/services/auth/providers/discord_matchbot/guilds.js

Purpose:
    Retrieves and normalizes Discord guilds where the
    installable Gaming Network MatchBot is currently present.

Description:
    - Uses the centralized MatchBot Discord REST client.
    - Lists guilds accessible to the MatchBot.
    - Retrieves individual guild details.
    - Normalizes guild information for later channel,
      member, notification, and event workflows.
    - Does not perform Discord authentication.
    - Does not perform BPD staff authorization.
    - Does not use DISCORD_AUTHZ_* configuration.

Dependencies:
    functions/services/auth/providers/discord_matchbot/client.js

Security:
    - Uses only the server-side MatchBot token through the
      centralized REST client.
    - Never exposes the bot token.
    - Guild IDs supplied by callers are validated before
      they are used in Discord API paths.
    - A guild is considered usable only if Discord confirms
      MatchBot currently has access to it.

Architecture:
    MatchBot REST client
        ↓
    Discord guild APIs
        ↓
    normalized guild information
        ↓
    channels / members / messages / events
========================================================= */

import {
    DiscordMatchBotError,
    discordMatchBotGet
} from "./client.js";

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
FEATURE NORMALIZATION
========================================================= */

function normalizeFeatures(
    value
) {
    if (
        !Array.isArray(
            value
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            value
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
GUILD NORMALIZATION
========================================================= */

function normalizeGuild(
    guild
) {
    if (
        !guild
        || typeof guild !==
            "object"
        || Array.isArray(
            guild
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            guild.id
        );

    const name =
        normalizeString(
            guild.name
        );

    if (
        !id
        || !name
    ) {
        return null;
    }

    return {
        id,

        name,

        icon:
            normalizeString(
                guild.icon
            )
            || null,

        owner:
            guild.owner ===
            true,

        ownerId:
            normalizeString(
                guild.owner_id
            )
            || null,

        permissions:
            normalizeString(
                guild.permissions
            )
            || null,

        preferredLocale:
            normalizeString(
                guild.preferred_locale
            )
            || null,

        description:
            normalizeString(
                guild.description
            )
            || null,

        vanityUrlCode:
            normalizeString(
                guild.vanity_url_code
            )
            || null,

        memberCount:
            Number.isInteger(
                guild.approximate_member_count
            )
                ? guild.approximate_member_count
                : null,

        presenceCount:
            Number.isInteger(
                guild.approximate_presence_count
            )
                ? guild.approximate_presence_count
                : null,

        features:
            normalizeFeatures(
                guild.features
            )
    };
}

/* =========================================================
LIST MATCHBOT GUILDS

Discord:
    GET /users/@me/guilds

Purpose:
    Returns guilds where MatchBot is currently installed.

Important:
    This reflects the bot account's guild memberships, not
    the currently authenticated BPD user's guild list.
========================================================= */

export async function getDiscordMatchBotGuilds(
    env
) {
    const result =
        await discordMatchBotGet(
            env,
            "/users/@me/guilds"
        );

    if (
        !Array.isArray(
            result
        )
    ) {
        throw new DiscordMatchBotError(
            "Discord returned an invalid MatchBot guild list.",
            {
                code:
                    "DISCORD_MATCHBOT_GUILD_LIST_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return result
        .map(
            normalizeGuild
        )
        .filter(
            Boolean
        )
        .sort(
            (
                a,
                b
            ) =>
                a.name.localeCompare(
                    b.name
                )
        );
}

/* =========================================================
GET MATCHBOT GUILD

Discord:
    GET /guilds/{guild.id}?with_counts=true

Purpose:
    Retrieves authoritative information about one guild where
    MatchBot should currently be installed.
========================================================= */

export async function getDiscordMatchBotGuild(
    env,
    guildId
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}?with_counts=true`
        );

    const guild =
        normalizeGuild(
            result
        );

    if (
        !guild
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid MatchBot guild information.",
            {
                code:
                    "DISCORD_MATCHBOT_GUILD_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return guild;
}

/* =========================================================
MATCHBOT GUILD ACCESS

Purpose:
    Confirms that MatchBot currently has access to a guild.

Behavior:
    - Returns the normalized guild when accessible.
    - Returns null when Discord reports that the guild does
      not exist for this bot.
    - Re-throws infrastructure, permission, and rate-limit
      failures.
========================================================= */

export async function findDiscordMatchBotGuild(
    env,
    guildId
) {
    try {
        return await getDiscordMatchBotGuild(
            env,
            guildId
        );
    }
    catch (
        error
    ) {
        if (
            error?.code ===
                "DISCORD_MATCHBOT_NOT_FOUND"
        ) {
            return null;
        }

        throw error;
    }
}

/* =========================================================
REQUIRE MATCHBOT GUILD

Purpose:
    Requires MatchBot to currently have access to the
    requested guild.
========================================================= */

export async function requireDiscordMatchBotGuild(
    env,
    guildId
) {
    const guild =
        await findDiscordMatchBotGuild(
            env,
            guildId
        );

    if (
        !guild
    ) {
        throw new DiscordMatchBotError(
            "Gaming Network MatchBot is not installed in this Discord server.",
            {
                code:
                    "DISCORD_MATCHBOT_GUILD_REQUIRED",

                status:
                    404
            }
        );
    }

    return guild;
}