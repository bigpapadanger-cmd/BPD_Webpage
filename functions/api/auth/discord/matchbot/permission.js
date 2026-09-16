"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT GUILD CONFIGURATION PERMISSIONS

File:
    functions/services/auth/providers/discord_matchbot/permissions.js

Purpose:
    Determines whether a linked Discord user may configure
    Gaming Network MatchBot for a specific Discord guild.

Description:
    - Uses the authenticated BPD account's verified Discord
      identity.
    - Requires MatchBot to be installed in the target guild.
    - Retrieves the current Discord guild member.
    - Evaluates whether that Discord user has authority to
      configure MatchBot for the guild.
    - Does not use BPD staff/admin role authorization.
    - Does not use DISCORD_AUTHZ_* configuration.

Authorization Rule:
    A user may configure MatchBot for a guild when Discord
    confirms that the user currently has either:

        Administrator
        OR
        Manage Guild

Security:
    - Discord user ID must come from the authenticated BPD
      account's verified linked Discord identity.
    - The browser never determines the authoritative Discord
      user ID.
    - The browser may request a guild ID, but Discord access
      and member permissions are independently verified.
    - MatchBot guild configuration authority is separate from
      BPD staff authorization.
========================================================= */

import {
    AuthorizationError,
    authorizeRequest,
    getVerifiedProvider
} from "../../authorization.js";

import {
    DiscordMatchBotError
} from "./client.js";

import {
    requireDiscordMatchBotGuild
} from "./guilds.js";

import {
    requireDiscordMatchBotGuildMember
} from "./members.js";

/* =========================================================
DISCORD PERMISSIONS

Discord permissions are represented as a bit field.

Relevant permissions:
    ADMINISTRATOR = 1 << 3
    MANAGE_GUILD  = 1 << 5

Use BigInt because Discord permission values may exceed the
safe integer range of JavaScript Number.
========================================================= */

const DISCORD_PERMISSION_ADMINISTRATOR =
    1n << 3n;

const DISCORD_PERMISSION_MANAGE_GUILD =
    1n << 5n;

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
VERIFIED DISCORD IDENTITY
========================================================= */

function requireVerifiedDiscordIdentity(
    authorization
) {
    const provider =
        getVerifiedProvider(
            authorization,
            "discord"
        );

    const discordUserId =
        normalizeString(
            provider?.subject
        );

    if (
        !discordUserId
    ) {
        throw new AuthorizationError(
            "DISCORD_PROVIDER_REQUIRED",
            "A linked Discord account is required to configure MatchBot.",
            403
        );
    }

    return {
        provider,
        discordUserId
    };
}

/* =========================================================
GUILD PERMISSION VALUE

Discord's guild/member endpoints do not always return the
final guild permission value on the member object itself.

This helper accepts an already-resolved permission bitfield.

The guild configuration route/service should obtain the
authoritative effective guild permissions from Discord and
pass them here.
========================================================= */

function normalizePermissionBits(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
        || !/^\d+$/u.test(
            normalized
        )
    ) {
        return 0n;
    }

    try {
        return BigInt(
            normalized
        );
    }
    catch {
        return 0n;
    }
}

/* =========================================================
PERMISSION CHECK
========================================================= */

export function hasDiscordPermission(
    permissions,
    requiredPermission
) {
    const bits =
        normalizePermissionBits(
            permissions
        );

    return (
        bits
        & requiredPermission
    ) ===
    requiredPermission;
}

export function canManageDiscordGuild(
    permissions
) {
    return (
        hasDiscordPermission(
            permissions,
            DISCORD_PERMISSION_ADMINISTRATOR
        )
        || hasDiscordPermission(
            permissions,
            DISCORD_PERMISSION_MANAGE_GUILD
        )
    );
}

/* =========================================================
MATCHBOT CONFIGURATION CONTEXT
========================================================= */

export async function authorizeDiscordMatchBotConfiguration(
    request,
    env,
    guildId
) {
    /*
     * Canonical BPD authentication.
     *
     * This verifies:
     * - BPD session
     * - canonical account
     * - active account
     * - authoritative linked Discord identity
     */
    const authorization =
        await authorizeRequest(
            request,
            env,
            {
                account:
                    true,

                provider:
                    "discord"
            }
        );

    const {
        provider:
            discordProvider,

        discordUserId
    } =
        requireVerifiedDiscordIdentity(
            authorization
        );

    /*
     * Confirm MatchBot itself is installed in the guild.
     */
    const guild =
        await requireDiscordMatchBotGuild(
            env,
            guildId
        );

    /*
     * Confirm the linked Discord user is actually still a
     * member of that guild.
     */
    const member =
        await requireDiscordMatchBotGuildMember(
            env,
            guild.id,
            discordUserId
        );

    /*
     * IMPORTANT:
     *
     * members.js currently returns role IDs and member
     * metadata, but it does not yet return the effective
     * Discord permission bitfield.
     *
     * Until that is added, fail closed rather than guessing
     * from role names or IDs.
     */
    const permissions =
        normalizeString(
            member.permissions
        );

    if (
        !permissions
    ) {
        throw new DiscordMatchBotError(
            "Discord guild permissions could not be resolved for this user.",
            {
                code:
                    "DISCORD_MATCHBOT_MEMBER_PERMISSIONS_UNAVAILABLE",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    if (
        !canManageDiscordGuild(
            permissions
        )
    ) {
        throw new AuthorizationError(
            "DISCORD_MATCHBOT_GUILD_MANAGE_REQUIRED",
            "You must have Manage Server or Administrator permission in this Discord server to configure MatchBot.",
            403
        );
    }

    return {
        ...authorization,

        matchBot: {
            guild,

            discordProvider,

            discordUserId,

            member,

            permissions,

            canManageGuild:
                true
        }
    };
}