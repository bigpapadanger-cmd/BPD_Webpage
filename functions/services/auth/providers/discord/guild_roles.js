"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD AUTHORIZATION GUILD ROLE SERVICE

File:
    functions/services/auth/providers/discord/guild_roles.js

Purpose:
    Retrieves and evaluates a connected Discord user's roles
    in the configured BPD Gaming Network authorization guild.

Description:
    - Reads a Discord guild member using the dedicated
      authorization bot.
    - Uses the configured BPD authorization guild and bot
      credentials.
    - Returns the member's current Discord role IDs.
    - Evaluates configured BPD staff role IDs.
    - Provides reusable helpers for authorization throughout
      the website.
    - Does not perform Discord login or account linking.
    - Does not use the installable MatchBot.
    - Does not trust Discord user IDs supplied by clients.

Required Environment:
    DISCORD_AUTHZ_GUILD_ID
    DISCORD_AUTHZ_BOT_TOKEN

Configured Staff Roles:
    DISCORD_AUTHZ_ADMIN_ROLE_ID
    DISCORD_AUTHZ_MOD_ROLE_ID
    DISCORD_AUTHZ_LEAGUE_STAFF_ROLE_ID

Architecture:
    Canonical Discord authentication:
        Supabase Discord OAuth
            ↓
        identity.account_identities
            ↓
        verified Discord provider_subject

    BPD guild authorization:
        verified Discord provider_subject
            ↓
        this service
            ↓
        dedicated authorization bot
            ↓
        fixed BPD Gaming Network guild
            ↓
        current Discord role IDs

    MatchBot:
        Completely separate.
        Uses DISCORD_MATCHBOT_* configuration.
        Never participates in BPD staff authorization.

Security:
    - The Discord user ID passed to this service must come
      from the authenticated account's verified linked
      Discord identity.
    - Never accept a Discord user ID directly from a browser
      and use it for authorization.
    - Role IDs, not role names, are authoritative.
    - Authorization bot credentials are server-only.
    - MatchBot credentials are never used here.
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const DISCORD_API_BASE_URL =
    "https://discord.com/api/v10";

const DISCORD_REQUEST_TIMEOUT_MS =
    8000;

/* =========================================================
ERROR
========================================================= */

export class DiscordGuildRolesError extends Error {
    constructor(
        message,
        {
            code =
                "DISCORD_GUILD_ROLES_ERROR",

            status =
                500,

            discordStatus =
                null,

            unavailable =
                false
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "DiscordGuildRolesError";

        this.code =
            code;

        this.status =
            status;

        this.discordStatus =
            discordStatus;

        this.unavailable =
            unavailable;
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

/* =========================================================
AUTHORIZATION CONFIGURATION
========================================================= */

function getDiscordAuthorizationConfiguration(
    env
) {
    const guildId =
        normalizeString(
            env?.DISCORD_AUTHZ_GUILD_ID
        );

    const botToken =
        normalizeString(
            env?.DISCORD_AUTHZ_BOT_TOKEN
        );

    if (
        !guildId
    ) {
        throw new DiscordGuildRolesError(
            "Discord authorization guild configuration is missing.",
            {
                code:
                    "DISCORD_AUTHZ_GUILD_ID_MISSING",

                status:
                    500
            }
        );
    }

    if (
        !botToken
    ) {
        throw new DiscordGuildRolesError(
            "Discord authorization bot configuration is missing.",
            {
                code:
                    "DISCORD_AUTHZ_BOT_TOKEN_MISSING",

                status:
                    500
            }
        );
    }

    return {
        guildId,

        botToken,

        adminRoleId:
            normalizeString(
                env?.DISCORD_AUTHZ_ADMIN_ROLE_ID
            ),

        modRoleId:
            normalizeString(
                env?.DISCORD_AUTHZ_MOD_ROLE_ID
            ),

        leagueStaffRoleId:
            normalizeString(
                env?.DISCORD_AUTHZ_LEAGUE_STAFF_ROLE_ID
            )
    };
}

/* =========================================================
DISCORD USER ID
========================================================= */

function requireDiscordUserId(
    discordUserId
) {
    const normalized =
        normalizeString(
            discordUserId
        );

    if (
        !normalized
    ) {
        throw new DiscordGuildRolesError(
            "A linked Discord identity is required.",
            {
                code:
                    "DISCORD_IDENTITY_REQUIRED",

                status:
                    403
            }
        );
    }

    return normalized;
}

/* =========================================================
RESPONSE BODY
========================================================= */

async function readJsonResponse(
    response
) {
    try {
        const result =
            await response.json();

        return (
            result
            && typeof result ===
                "object"
            && !Array.isArray(
                result
            )
        )
            ? result
            : {};
    }
    catch {
        return {};
    }
}

/* =========================================================
DISCORD ERROR HANDLING
========================================================= */

function createDiscordResponseError(
    response,
    result
) {
    const discordMessage =
        normalizeString(
            result?.message
        );

    switch (
        response.status
    ) {
        case 401:
            return new DiscordGuildRolesError(
                "Discord rejected the configured authorization bot credentials.",
                {
                    code:
                        "DISCORD_AUTHZ_BOT_UNAUTHORIZED",

                    status:
                        503,

                    discordStatus:
                        401,

                    unavailable:
                        true
                }
            );

        case 403:
            return new DiscordGuildRolesError(
                "The Discord authorization bot cannot access the configured guild member.",
                {
                    code:
                        "DISCORD_AUTHZ_BOT_FORBIDDEN",

                    status:
                        503,

                    discordStatus:
                        403,

                    unavailable:
                        true
                }
            );

        case 404:
            return new DiscordGuildRolesError(
                "The connected Discord account is not a member of the configured authorization guild.",
                {
                    code:
                        "DISCORD_AUTHZ_GUILD_MEMBER_NOT_FOUND",

                    status:
                        403,

                    discordStatus:
                        404
                }
            );

        case 429:
            return new DiscordGuildRolesError(
                "Discord authorization role verification is temporarily rate limited.",
                {
                    code:
                        "DISCORD_AUTHZ_RATE_LIMITED",

                    status:
                        503,

                    discordStatus:
                        429,

                    unavailable:
                        true
                }
            );

        default:
            return new DiscordGuildRolesError(
                discordMessage
                || "Discord authorization guild role verification failed.",
                {
                    code:
                        "DISCORD_AUTHZ_GUILD_REQUEST_FAILED",

                    status:
                        response.status >=
                        500
                            ? 503
                            : 500,

                    discordStatus:
                        response.status,

                    unavailable:
                        response.status >=
                        500
                }
            );
    }
}

/* =========================================================
GUILD MEMBER REQUEST
========================================================= */

async function requestDiscordGuildMember(
    discordUserId,
    env
) {
    const userId =
        requireDiscordUserId(
            discordUserId
        );

    const {
        guildId,
        botToken
    } =
        getDiscordAuthorizationConfiguration(
            env
        );

    const requestUrl =
        new URL(
            `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(
                guildId
            )}/members/${encodeURIComponent(
                userId
            )}`
        );

    const controller =
        new AbortController();

    const timeoutId =
        setTimeout(
            () => {
                controller.abort();
            },
            DISCORD_REQUEST_TIMEOUT_MS
        );

    let response;

    try {
        response =
            await fetch(
                requestUrl.href,
                {
                    method:
                        "GET",

                    headers: {
                        "Authorization":
                            `Bot ${botToken}`,

                        "Accept":
                            "application/json"
                    },

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
            throw new DiscordGuildRolesError(
                "Discord authorization role verification timed out.",
                {
                    code:
                        "DISCORD_AUTHZ_REQUEST_TIMEOUT",

                    status:
                        503,

                    unavailable:
                        true
                }
            );
        }

        throw new DiscordGuildRolesError(
            "Discord authorization role verification is currently unavailable.",
            {
                code:
                    "DISCORD_AUTHZ_REQUEST_FAILED",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }
    finally {
        clearTimeout(
            timeoutId
        );
    }

    const result =
        await readJsonResponse(
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
ROLE CHECK
========================================================= */

export function hasDiscordRole(
    roleIds,
    roleId
) {
    const requiredRoleId =
        normalizeString(
            roleId
        );

    if (
        !requiredRoleId
    ) {
        return false;
    }

    return normalizeRoleIds(
        roleIds
    ).includes(
        requiredRoleId
    );
}

/* =========================================================
STAFF ROLE STATE
========================================================= */

export function evaluateDiscordStaffRoles(
    roleIds,
    env
) {
    const normalizedRoles =
        normalizeRoleIds(
            roleIds
        );

    const {
        adminRoleId,
        modRoleId,
        leagueStaffRoleId
    } =
        getDiscordAuthorizationConfiguration(
            env
        );

    const isAdmin =
        hasDiscordRole(
            normalizedRoles,
            adminRoleId
        );

    const isModerator =
        hasDiscordRole(
            normalizedRoles,
            modRoleId
        );

    const isLeagueStaff =
        hasDiscordRole(
            normalizedRoles,
            leagueStaffRoleId
        );

    return {
        isAdmin,
        isModerator,
        isLeagueStaff,

        isStaff:
            isAdmin
            || isModerator
            || isLeagueStaff
    };
}

/* =========================================================
GET GUILD MEMBER

Returns normalized BPD authorization-guild member data.

The Discord user ID supplied here must already have been
resolved from the authenticated user's linked Discord
identity.
========================================================= */

export async function getDiscordGuildMember(
    discordUserId,
    env
) {
    const userId =
        requireDiscordUserId(
            discordUserId
        );

    const member =
        await requestDiscordGuildMember(
            userId,
            env
        );

    const roleIds =
        normalizeRoleIds(
            member.roles
        );

    return {
        userId,

        guildMember:
            true,

        roleIds,

        nickname:
            normalizeString(
                member.nick
            )
            || null,

        pending:
            member.pending ===
            true,

        joinedAt:
            normalizeString(
                member.joined_at
            )
            || null,

        communicationDisabledUntil:
            normalizeString(
                member.communication_disabled_until
            )
            || null,

        ...evaluateDiscordStaffRoles(
            roleIds,
            env
        )
    };
}

/* =========================================================
GET GUILD ROLES
========================================================= */

export async function getDiscordGuildRoles(
    discordUserId,
    env
) {
    const member =
        await getDiscordGuildMember(
            discordUserId,
            env
        );

    return {
        userId:
            member.userId,

        guildMember:
            member.guildMember,

        roleIds:
            member.roleIds,

        isAdmin:
            member.isAdmin,

        isModerator:
            member.isModerator,

        isLeagueStaff:
            member.isLeagueStaff,

        isStaff:
            member.isStaff
    };
}

/* =========================================================
REQUIRE GUILD MEMBERSHIP
========================================================= */

export async function requireDiscordGuildMember(
    discordUserId,
    env
) {
    return getDiscordGuildMember(
        discordUserId,
        env
    );
}

/* =========================================================
REQUIRE ANY STAFF ROLE
========================================================= */

export async function requireDiscordStaff(
    discordUserId,
    env
) {
    const member =
        await getDiscordGuildMember(
            discordUserId,
            env
        );

    if (
        member.isStaff !==
        true
    ) {
        throw new DiscordGuildRolesError(
            "A BPD Gaming Network staff role is required.",
            {
                code:
                    "DISCORD_STAFF_ROLE_REQUIRED",

                status:
                    403
            }
        );
    }

    return member;
}

/* =========================================================
REQUIRE ADMIN ROLE
========================================================= */

export async function requireDiscordAdmin(
    discordUserId,
    env
) {
    const member =
        await getDiscordGuildMember(
            discordUserId,
            env
        );

    if (
        member.isAdmin !==
        true
    ) {
        throw new DiscordGuildRolesError(
            "A BPD Gaming Network administrator role is required.",
            {
                code:
                    "DISCORD_ADMIN_ROLE_REQUIRED",

                status:
                    403
            }
        );
    }

    return member;
}

/* =========================================================
REQUIRE MODERATOR ROLE
========================================================= */

export async function requireDiscordModerator(
    discordUserId,
    env
) {
    const member =
        await getDiscordGuildMember(
            discordUserId,
            env
        );

    if (
        member.isModerator !==
        true
        && member.isAdmin !==
            true
    ) {
        throw new DiscordGuildRolesError(
            "A BPD Gaming Network moderator role is required.",
            {
                code:
                    "DISCORD_MOD_ROLE_REQUIRED",

                status:
                    403
            }
        );
    }

    return member;
}

/* =========================================================
REQUIRE LEAGUE STAFF ROLE
========================================================= */

export async function requireDiscordLeagueStaff(
    discordUserId,
    env
) {
    const member =
        await getDiscordGuildMember(
            discordUserId,
            env
        );

    if (
        member.isLeagueStaff !==
        true
        && member.isAdmin !==
            true
    ) {
        throw new DiscordGuildRolesError(
            "A BPD Gaming Network league staff role is required.",
            {
                code:
                    "DISCORD_LEAGUE_STAFF_ROLE_REQUIRED",

                status:
                    403
            }
        );
    }

    return member;
}