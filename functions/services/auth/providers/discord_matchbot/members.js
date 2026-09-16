"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT MEMBER SERVICE

File:
    functions/services/auth/providers/discord_matchbot/members.js

Purpose:
    Retrieves and normalizes Discord guild-member data for
    users in guilds where Gaming Network MatchBot is
    installed.

Description:
    - Uses the centralized MatchBot Discord REST client.
    - Requires MatchBot to have access to the target guild.
    - Retrieves a specific Discord member by Discord user ID.
    - Returns current guild membership, nickname, roles,
      member state, and effective guild permissions.
    - Supports targeted eligibility checks for match alerts.
    - Does not mirror entire guild member lists into Supabase.
    - Does not perform BPD staff authorization.
    - Does not use DISCORD_AUTHZ_* configuration.

Dependencies:
    functions/services/auth/providers/discord_matchbot/client.js
    functions/services/auth/providers/discord_matchbot/guilds.js

Security:
    - Discord user IDs must come from trusted application
      data such as linked BPD Discord identities.
    - Browser-supplied Discord IDs must never be trusted for
      authorization decisions.
    - MatchBot token is never exposed.
    - Guild membership is checked against Discord at request
      time instead of trusting stale stored membership.
    - Guild configuration permissions are derived from
      authoritative Discord guild roles.

Permission Resolution:
    Effective base guild permissions are derived from:
        @everyone role
        + assigned member roles

    Guild owner:
        all permissions

    Administrator:
        all permissions

Important:
    This resolves guild-level permissions only.

    Channel-specific permission overwrites are evaluated
    separately by channel/message operations when needed.
========================================================= */

import {
    DiscordMatchBotError,
    discordMatchBotGet
} from "./client.js";

import {
    requireDiscordMatchBotGuild
} from "./guilds.js";

/* =========================================================
PERMISSION CONSTANTS
========================================================= */

const DISCORD_PERMISSION_ADMINISTRATOR =
    1n << 3n;

const DISCORD_ALL_PERMISSIONS =
    (1n << 53n) - 1n;

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

function normalizeRoleIds(
    roles
) {
    if (
        !Array.isArray(
            roles
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            roles
                .map(
                    normalizeString
                )
                .filter(
                    Boolean
                )
        )
    ];
}

function normalizePermissionString(
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
        return "0";
    }

    return normalized;
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
USER NORMALIZATION
========================================================= */

function normalizeDiscordUser(
    user
) {
    if (
        !user
        || typeof user !==
            "object"
        || Array.isArray(
            user
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            user.id
        );

    if (
        !id
    ) {
        return null;
    }

    return {
        id,

        username:
            normalizeString(
                user.username
            )
            || null,

        globalName:
            normalizeString(
                user.global_name
            )
            || null,

        discriminator:
            normalizeString(
                user.discriminator
            )
            || null,

        avatar:
            normalizeString(
                user.avatar
            )
            || null,

        bot:
            user.bot ===
            true
    };
}

/* =========================================================
ROLE NORMALIZATION
========================================================= */

function normalizeGuildRole(
    role
) {
    if (
        !role
        || typeof role !==
            "object"
        || Array.isArray(
            role
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            role.id
        );

    if (
        !id
    ) {
        return null;
    }

    return {
        id,

        name:
            normalizeString(
                role.name
            )
            || null,

        permissions:
            normalizePermissionString(
                role.permissions
            ),

        position:
            Number.isInteger(
                role.position
            )
                ? role.position
                : 0,

        managed:
            role.managed ===
            true
    };
}

/* =========================================================
MEMBER NORMALIZATION
========================================================= */

function normalizeMember(
    guildId,
    discordUserId,
    member
) {
    if (
        !member
        || typeof member !==
            "object"
        || Array.isArray(
            member
        )
    ) {
        return null;
    }

    const user =
        normalizeDiscordUser(
            member.user
        );

    const resolvedUserId =
        user?.id
        || discordUserId;

    return {
        guildId,

        userId:
            resolvedUserId,

        guildMember:
            true,

        user,

        nickname:
            normalizeString(
                member.nick
            )
            || null,

        roleIds:
            normalizeRoleIds(
                member.roles
            ),

        joinedAt:
            normalizeString(
                member.joined_at
            )
            || null,

        pending:
            member.pending ===
            true,

        deaf:
            member.deaf ===
            true,

        mute:
            member.mute ===
            true,

        communicationDisabledUntil:
            normalizeString(
                member.communication_disabled_until
            )
            || null,

        avatar:
            normalizeString(
                member.avatar
            )
            || null,

        /*
         * Populated after guild-role permission resolution.
         */
        permissions:
            null,

        isGuildOwner:
            false,

        isAdministrator:
            false
    };
}

/* =========================================================
GET GUILD ROLES

Discord:
    GET /guilds/{guild.id}/roles
========================================================= */

async function getDiscordMatchBotGuildRoles(
    env,
    guildId
) {
    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                guildId
            )}/roles`
        );

    if (
        !Array.isArray(
            result
        )
    ) {
        throw new DiscordMatchBotError(
            "Discord returned an invalid guild role list.",
            {
                code:
                    "DISCORD_MATCHBOT_GUILD_ROLE_LIST_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return result
        .map(
            normalizeGuildRole
        )
        .filter(
            Boolean
        );
}

/* =========================================================
PERMISSION PARSING
========================================================= */

function parsePermissionBits(
    value
) {
    const normalized =
        normalizePermissionString(
            value
        );

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
BASE GUILD PERMISSIONS

Discord base guild permissions are calculated by combining:
    @everyone permissions
    + permissions from every assigned role

Owner and Administrator receive all permissions.
========================================================= */

function resolveGuildPermissions(
    guild,
    member,
    roles
) {
    const guildId =
        normalizeString(
            guild?.id
        );

    const ownerId =
        normalizeString(
            guild?.ownerId
        );

    const memberUserId =
        normalizeString(
            member?.userId
        );

    if (
        !guildId
        || !memberUserId
    ) {
        throw new DiscordMatchBotError(
            "Discord guild permission context is incomplete.",
            {
                code:
                    "DISCORD_MATCHBOT_PERMISSION_CONTEXT_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    /*
     * Discord guild owner implicitly has all permissions.
     */
    if (
        ownerId
        && memberUserId ===
            ownerId
    ) {
        return {
            permissions:
                DISCORD_ALL_PERMISSIONS
                    .toString(),

            isGuildOwner:
                true,

            isAdministrator:
                true
        };
    }

    const everyoneRole =
        roles.find(
            (
                role
            ) =>
                role.id ===
                guildId
        );

    let permissions =
        everyoneRole
            ? parsePermissionBits(
                everyoneRole.permissions
            )
            : 0n;

    const memberRoleIds =
        new Set(
            normalizeRoleIds(
                member.roleIds
            )
        );

    for (
        const role
        of roles
    ) {
        if (
            role.id ===
            guildId
        ) {
            continue;
        }

        if (
            !memberRoleIds.has(
                role.id
            )
        ) {
            continue;
        }

        permissions |=
            parsePermissionBits(
                role.permissions
            );
    }

    const isAdministrator =
        (
            permissions
            & DISCORD_PERMISSION_ADMINISTRATOR
        ) ===
        DISCORD_PERMISSION_ADMINISTRATOR;

    if (
        isAdministrator
    ) {
        permissions =
            DISCORD_ALL_PERMISSIONS;
    }

    return {
        permissions:
            permissions.toString(),

        isGuildOwner:
            false,

        isAdministrator
    };
}

/* =========================================================
GET MATCHBOT GUILD MEMBER

Discord:
    GET /guilds/{guild.id}/members/{user.id}

Purpose:
    Retrieves one specific Discord member from a guild where
    MatchBot is currently installed.

Important:
    This is the preferred approach for match notifications
    when the BPD system already knows the user's canonical
    linked Discord user ID.
========================================================= */

export async function getDiscordMatchBotGuildMember(
    env,
    guildId,
    discordUserId
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    const normalizedUserId =
        requireDiscordSnowflake(
            discordUserId,
            "Discord user ID"
        );

    const guild =
        await requireDiscordMatchBotGuild(
            env,
            normalizedGuildId
        );

    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/members/${encodeURIComponent(
                normalizedUserId
            )}`
        );

    const member =
        normalizeMember(
            normalizedGuildId,
            normalizedUserId,
            result
        );

    if (
        !member
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid MatchBot guild-member information.",
            {
                code:
                    "DISCORD_MATCHBOT_MEMBER_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    /*
     * Resolve authoritative guild-level permissions from
     * the current Discord role definitions.
     */
    const roles =
        await getDiscordMatchBotGuildRoles(
            env,
            normalizedGuildId
        );

    const permissionState =
        resolveGuildPermissions(
            guild,
            member,
            roles
        );

    member.permissions =
        permissionState.permissions;

    member.isGuildOwner =
        permissionState.isGuildOwner;

    member.isAdministrator =
        permissionState.isAdministrator;

    return member;
}

/* =========================================================
FIND MATCHBOT GUILD MEMBER

Behavior:
    - Returns normalized member data when present.
    - Returns null when the user is not a member of the guild.
    - Re-throws infrastructure/rate-limit/configuration
      failures.
========================================================= */

export async function findDiscordMatchBotGuildMember(
    env,
    guildId,
    discordUserId
) {
    try {
        return await getDiscordMatchBotGuildMember(
            env,
            guildId,
            discordUserId
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
REQUIRE MATCHBOT GUILD MEMBER
========================================================= */

export async function requireDiscordMatchBotGuildMember(
    env,
    guildId,
    discordUserId
) {
    const member =
        await findDiscordMatchBotGuildMember(
            env,
            guildId,
            discordUserId
        );

    if (
        !member
    ) {
        throw new DiscordMatchBotError(
            "The Discord user is not a member of this MatchBot server.",
            {
                code:
                    "DISCORD_MATCHBOT_MEMBER_REQUIRED",

                status:
                    404
            }
        );
    }

    return member;
}

/* =========================================================
HAS ROLE
========================================================= */

export function hasDiscordMatchBotRole(
    member,
    roleId
) {
    const normalizedRoleId =
        normalizeString(
            roleId
        );

    if (
        !normalizedRoleId
    ) {
        return false;
    }

    const roleIds =
        normalizeRoleIds(
            member?.roleIds
        );

    return roleIds.includes(
        normalizedRoleId
    );
}

/* =========================================================
HAS GUILD PERMISSION
========================================================= */

export function hasDiscordMatchBotGuildPermission(
    member,
    permission
) {
    const required =
        typeof permission ===
            "bigint"
            ? permission
            : parsePermissionBits(
                permission
            );

    const permissions =
        parsePermissionBits(
            member?.permissions
        );

    return (
        permissions
        & required
    ) ===
    required;
}

/* =========================================================
MEMBER DISPLAY NAME

Preference:
    guild nickname
    global display name
    username
    Discord user ID
========================================================= */

export function getDiscordMatchBotMemberDisplayName(
    member
) {
    return (
        normalizeString(
            member?.nickname
        )
        || normalizeString(
            member?.user?.globalName
        )
        || normalizeString(
            member?.user?.username
        )
        || normalizeString(
            member?.userId
        )
        || null
    );
}

/* =========================================================
MATCH ALERT ELIGIBILITY

Purpose:
    Performs Discord-side eligibility only.

This intentionally does NOT check the user's BPD/Supabase
notification preference. That belongs in the BPD data layer.

A user is Discord-side eligible when:
    - MatchBot is installed in the guild.
    - Discord confirms the linked user is still a member.
    - The account is not itself a bot.
========================================================= */

export async function getDiscordMatchBotMemberEligibility(
    env,
    guildId,
    discordUserId
) {
    const member =
        await findDiscordMatchBotGuildMember(
            env,
            guildId,
            discordUserId
        );

    if (
        !member
    ) {
        return {
            eligible:
                false,

            reason:
                "NOT_GUILD_MEMBER",

            member:
                null
        };
    }

    if (
        member.user?.bot ===
        true
    ) {
        return {
            eligible:
                false,

            reason:
                "BOT_ACCOUNT",

            member
        };
    }

    return {
        eligible:
            true,

        reason:
            null,

        member
    };
}