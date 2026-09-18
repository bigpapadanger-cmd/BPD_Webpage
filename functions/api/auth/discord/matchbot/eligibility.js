"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT ELIGIBILITY SERVICE

File:
    functions/services/auth/providers/discord_matchbot/eligibility.js

Purpose:
    Determines whether a verified Discord user is eligible
    to use Discord-based Rocket League notifications.

Policy:
    - Server-side only.
    - Requires a Discord user ID supplied by trusted
      authorization code.
    - Checks whether the Discord user shares at least one
      configured guild with BPD MatchBot.
    - Never exposes Discord bot credentials to the browser.
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

function getDiscordBotToken(
    env
) {
    const token =
        normalizeString(
            env?.DISCORD_BOT_TOKEN
        );

    if (
        !token
    ) {
        const error =
            new Error(
                "Discord bot token is not configured."
            );

        error.code =
            "DISCORD_BOT_TOKEN_MISSING";

        error.status =
            500;

        throw error;
    }

    return token;
}

function getConfiguredGuildIds(
    env
) {
    const raw =
        normalizeString(
            env?.DISCORD_GUILD_IDS
            || env?.DISCORD_GUILD_ID
        );

    if (
        !raw
    ) {
        const error =
            new Error(
                "Discord guild configuration is unavailable."
            );

        error.code =
            "DISCORD_GUILD_CONFIGURATION_MISSING";

        error.status =
            500;

        throw error;
    }

    const guildIds =
        raw
            .split(",")
            .map(
                value =>
                    value.trim()
            )
            .filter(Boolean);

    if (
        guildIds.length ===
        0
    ) {
        const error =
            new Error(
                "Discord guild configuration is unavailable."
            );

        error.code =
            "DISCORD_GUILD_CONFIGURATION_MISSING";

        error.status =
            500;

        throw error;
    }

    return guildIds;
}

async function getGuildMember(
    env,
    guildId,
    discordUserId
) {
    const token =
        getDiscordBotToken(
            env
        );

    const url =
        new URL(
            `https://discord.com/api/v10/guilds/${encodeURIComponent(
                guildId
            )}/members/${encodeURIComponent(
                discordUserId
            )}`
        );

    const response =
        await fetch(
            url.href,
            {
                method:
                    "GET",

                headers: {
                    Authorization:
                        `Bot ${token}`,

                    Accept:
                        "application/json"
                }
            }
        );

    if (
        response.status ===
        404
    ) {
        return null;
    }

    if (
        !response.ok
    ) {
        const responseText =
            await response.text();

        console.error(
            "DISCORD MATCHBOT ELIGIBILITY: Guild member lookup failed.",
            {
                guildId,

                status:
                    response.status,

                response:
                    responseText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .slice(
                            0,
                            300
                        )
            }
        );

        const error =
            new Error(
                "Discord guild membership could not be verified."
            );

        error.code =
            "DISCORD_GUILD_MEMBER_LOOKUP_FAILED";

        error.status =
            response.status;

        throw error;
    }

    return response.json();
}

export async function getDiscordMatchBotEligibility(
    env,
    discordUserId
) {
    const normalizedDiscordUserId =
        normalizeString(
            discordUserId
        );

    if (
        !normalizedDiscordUserId
    ) {
        return {
            eligible:
                false,

            reason:
                "DISCORD_USER_ID_REQUIRED",

            mutualGuild:
                null
        };
    }

    const guildIds =
        getConfiguredGuildIds(
            env
        );

    for (
        const guildId
        of guildIds
    ) {
        const member =
            await getGuildMember(
                env,
                guildId,
                normalizedDiscordUserId
            );

        if (
            member
        ) {
            return {
                eligible:
                    true,

                reason:
                    null,

                mutualGuild: {
                    id:
                        guildId
                }
            };
        }
    }

    return {
        eligible:
            false,

        reason:
            "MATCHBOT_REQUIRED",

        mutualGuild:
            null
    };
}