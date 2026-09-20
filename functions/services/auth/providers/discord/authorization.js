"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD AUTHORIZATION SERVICE

File:
    functions/services/auth/providers/discord/authorization.js

Purpose:
    Bridges authenticated BPD accounts to authoritative
    Discord guild membership and role authorization.

Description:
    - Requires an authenticated, active BPD account.
    - Requires a verified linked Discord identity.
    - Uses the authoritative Discord provider_subject from
      identity.account_identities.
    - Reads the connected Discord user's current guild roles.
    - Exposes normalized Discord staff-role state.
    - Provides reusable authorization helpers for Admin,
      Rocket League staff tools, moderation, notifications,
      and future site-wide staff functionality.

Security:
    - The browser never supplies the Discord user ID used for
      authorization.
    - Discord identity ownership is verified by the central
      BPD authorization service against Supabase.
    - Discord guild roles are read server-side using the bot
      token and configured guild.
    - Client role state is never authoritative.
    - Discord-specific errors are normalized into the common
      AuthorizationError type.

Dependencies:
    functions/services/auth/authorization.js
    functions/services/auth/providers/discord/guild_roles.js

Important:
    - This service does not perform Discord OAuth.
    - This service does not link Discord accounts.
    - This service does not define Admin permissions.
    - Admin permission mapping belongs in:
          functions/services/admin/permissions.js

Authorization Flow:
    Request
        -> BPD session
        -> canonical BPD account
        -> verified Discord identity
        -> Discord provider_subject
        -> Discord guild member
        -> Discord role IDs
        -> normalized Discord staff state
========================================================= */

import {
    AuthorizationError,
    authorizeRequest,
    getVerifiedProvider
} from "../../authorization.js";

import {
    DiscordGuildRolesError,
    getDiscordGuildMember
} from "./guild_roles.js";

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
DISCORD REQUIREMENT NORMALIZATION
========================================================= */

function normalizeRequirements(
    requirements = {}
) {
    return {
        staff:
            requirements?.staff ===
            true,

        admin:
            requirements?.admin ===
            true,

        moderator:
            requirements?.moderator ===
            true,

        leagueStaff:
            requirements?.leagueStaff ===
            true
    };
}

/* =========================================================
DISCORD ERROR CONVERSION
========================================================= */

function convertDiscordGuildError(
    error
) {
    if (
        error instanceof
            AuthorizationError
        || error?.name ===
            "AuthorizationError"
    ) {
        return error;
    }

    if (
        error instanceof
            DiscordGuildRolesError
        || error?.name ===
            "DiscordGuildRolesError"
    ) {
        return new AuthorizationError(
            normalizeString(
                error.code
            )
            || "DISCORD_AUTHORIZATION_FAILED",

            normalizeString(
                error.message
            )
            || "Discord authorization failed.",

            Number.isInteger(
                error.status
            )
                ? error.status
                : 503,

            {
                discordStatus:
                    error.discordStatus
                    ?? null,

                unavailable:
                    error.unavailable ===
                    true
            }
        );
    }

    return new AuthorizationError(
        "DISCORD_AUTHORIZATION_FAILED",
        "Discord authorization could not be completed.",
        503
    );
}

/* =========================================================
VERIFIED DISCORD PROVIDER
========================================================= */

function requireVerifiedDiscordProvider(
    authorization
) {
    const discordProvider =
        getVerifiedProvider(
            authorization,
            "discord"
        );

    if (
        !discordProvider
    ) {
        throw new AuthorizationError(
            "DISCORD_PROVIDER_REQUIRED",
            "A linked Discord account is required.",
            403
        );
    }

    const discordUserId =
        normalizeString(
            discordProvider.subject
        );

    if (
        !discordUserId
    ) {
        throw new AuthorizationError(
            "DISCORD_IDENTITY_MISSING",
            "The connected Discord identity could not be resolved.",
            403
        );
    }

    return {
        provider:
            discordProvider,

        userId:
            discordUserId
    };
}

/* =========================================================
DISCORD AUTHORIZATION CONTEXT
========================================================= */

function createDiscordAuthorizationContext(
    authorization,
    discordProvider,
    member
) {
    return {
        ...authorization,

        discord: {
            connected:
                true,

            provider:
                discordProvider,

            userId:
                member.userId,

            guildMember:
                member.guildMember ===
                true,

            roleIds:
                Array.isArray(
                    member.roleIds
                )
                    ? [
                        ...member.roleIds
                    ]
                    : [],

            nickname:
                member.nickname
                ?? null,

            pending:
                member.pending ===
                true,

            joinedAt:
                member.joinedAt
                ?? null,

            communicationDisabledUntil:
                member.communicationDisabledUntil
                ?? null,

            /* =============================================
            STAFF AUTHORIZATION ROLES
            ============================================= */

            isAdmin:
                member.isAdmin ===
                true,

            isModerator:
                member.isModerator ===
                true,

            isLeagueStaff:
                member.isLeagueStaff ===
                true,

            isStaff:
                member.isStaff ===
                true,

            /* =============================================
            RESPONSIBILITY ROLES
            ============================================= */

            isOwner:
                member.isOwner ===
                true,

            isDatabase:
                member.isDatabase ===
                true,

            isSecurity:
                member.isSecurity ===
                true,

            isUi:
                member.isUi ===
                true,

            responsibilityRoles:
                Array.isArray(
                    member.responsibilityRoles
                )
                    ? [
                        ...member.responsibilityRoles
                    ]
                    : []
        }
    };
}
/* =========================================================
ROLE REQUIREMENTS
========================================================= */

export function requireDiscordStaffRole(
    authorization
) {
    if (
        authorization
            ?.discord
            ?.isStaff !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_STAFF_ROLE_REQUIRED",
            "A BPD Gaming Network staff role is required.",
            403
        );
    }

    return authorization;
}

export function requireDiscordAdminRole(
    authorization
) {
    if (
        authorization
            ?.discord
            ?.isAdmin !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_ADMIN_ROLE_REQUIRED",
            "A BPD Gaming Network administrator role is required.",
            403
        );
    }

    return authorization;
}

export function requireDiscordModeratorRole(
    authorization
) {
    if (
        authorization
            ?.discord
            ?.isModerator !==
        true
        && authorization
            ?.discord
            ?.isAdmin !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_MOD_ROLE_REQUIRED",
            "A BPD Gaming Network moderator role is required.",
            403
        );
    }

    return authorization;
}

export function requireDiscordLeagueStaffRole(
    authorization
) {
    if (
        authorization
            ?.discord
            ?.isLeagueStaff !==
        true
        && authorization
            ?.discord
            ?.isAdmin !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_LEAGUE_STAFF_ROLE_REQUIRED",
            "A BPD Gaming Network league staff role is required.",
            403
        );
    }

    return authorization;
}

/* =========================================================
AUTHORIZE DISCORD REQUEST

Supported Requirements:

    {}
        Active BPD account
        + linked Discord account
        + member of configured Discord guild

    {
        staff: true
    }

    {
        admin: true
    }

    {
        moderator: true
    }

    {
        leagueStaff: true
    }

This function always requires Discord to be linked and the
user to exist in the configured guild.
========================================================= */

export async function authorizeDiscordRequest(
    request,
    env,
    requirements = {}
) {
    const normalizedRequirements =
        normalizeRequirements(
            requirements
        );

    /*
     * Central authorization performs:
     *
     * - session validation
     * - canonical account resolution
     * - active-account verification
     * - authoritative Discord identity verification
     *
     * verifiedProviders.discord therefore contains the
     * provider_subject owned by this canonical BPD account.
     */
    let authorization =
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

        userId:
            discordUserId
    } =
        requireVerifiedDiscordProvider(
            authorization
        );

    let member;

    try {
        member =
            await getDiscordGuildMember(
                discordUserId,
                env
            );
    }
    catch (
        error
    ) {
        throw convertDiscordGuildError(
            error
        );
    }

    authorization =
        createDiscordAuthorizationContext(
            authorization,
            discordProvider,
            member
        );

    if (
        normalizedRequirements.staff
    ) {
        requireDiscordStaffRole(
            authorization
        );
    }

    if (
        normalizedRequirements.admin
    ) {
        requireDiscordAdminRole(
            authorization
        );
    }

    if (
        normalizedRequirements.moderator
    ) {
        requireDiscordModeratorRole(
            authorization
        );
    }

    if (
        normalizedRequirements.leagueStaff
    ) {
        requireDiscordLeagueStaffRole(
            authorization
        );
    }

    return authorization;
}

/* =========================================================
CONVENIENCE HELPERS
========================================================= */

export async function authorizeDiscordGuildMember(
    request,
    env
) {
    return authorizeDiscordRequest(
        request,
        env
    );
}

export async function authorizeDiscordStaff(
    request,
    env
) {
    return authorizeDiscordRequest(
        request,
        env,
        {
            staff:
                true
        }
    );
}

export async function authorizeDiscordAdmin(
    request,
    env
) {
    return authorizeDiscordRequest(
        request,
        env,
        {
            admin:
                true
        }
    );
}

export async function authorizeDiscordModerator(
    request,
    env
) {
    return authorizeDiscordRequest(
        request,
        env,
        {
            moderator:
                true
        }
    );
}

export async function authorizeDiscordLeagueStaff(
    request,
    env
) {
    return authorizeDiscordRequest(
        request,
        env,
        {
            leagueStaff:
                true
        }
    );
}

/* =========================================================
DISCORD AUTHORIZATION ERROR CHECK
========================================================= */

export function isDiscordAuthorizationError(
    error
) {
    return (
        error instanceof
            AuthorizationError
        || error?.name ===
            "AuthorizationError"
    );
}