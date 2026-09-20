"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD RESPONSIBILITY ROLE SYNCHRONIZATION SERVICE

File:
    functions/services/auth/providers/discord/role_sync.js

Purpose:
    Synchronizes responsibility roles derived from the
    authenticated user's current Discord guild roles into
    identity.account_roles.

Description:
    - Accepts an already-authorized Discord context.
    - Uses responsibility roles derived from the live
      Discord guild member response.
    - Synchronizes those roles into identity.account_roles.
    - Grants newly acquired responsibility roles.
    - Revokes responsibility roles no longer present.
    - Returns the authoritative active role state after
      synchronization.
    - Does not perform another Discord API request.
    - Does not accept account IDs or role lists from the
      browser.

Managed Responsibility Roles:
    owner
    database
    security
    ui

Security:
    - The account ID comes from the authenticated BPD
      authorization context.
    - Responsibility roles come from the server-side live
      Discord guild lookup.
    - Browser-supplied account IDs are never used.
    - Browser-supplied role lists are never used.
    - Supabase synchronization uses the service-role-backed
      RPC transport.
    - Unknown responsibility roles fail closed.

Dependencies:
    functions/services/auth/authorization.js
    functions/services/supabase/admin/tasks/rpc.js

Authorization Flow:
    authenticated BPD account
        ↓
    verified Discord identity
        ↓
    live Discord guild member
        ↓
    responsibilityRoles
        ↓
    this service
        ↓
    api.admin_sync_discord_account_roles
        ↓
    identity.account_roles
========================================================= */

import {
    AuthorizationError
} from "../../authorization.js";

import {
    callAdminTaskRpc
} from "../../../supabase/admin/tasks/rpc.js";

/* =========================================================
CONSTANTS
========================================================= */

const DISCORD_ROLE_SYNC_RPC =
    "admin_sync_discord_account_roles";

const RESPONSIBILITY_ROLES =
    Object.freeze([
        "owner",
        "database",
        "security",
        "ui"
    ]);

const RESPONSIBILITY_ROLE_SET =
    new Set(
        RESPONSIBILITY_ROLES
    );

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

function normalizeResponsibilityRoles(
    roles
) {
    if (!Array.isArray(roles) || roles.some(role =>
        typeof role !== "string" || !RESPONSIBILITY_ROLE_SET.has(role.trim().toLowerCase()))) {
        throw new AuthorizationError("DISCORD_ROLE_STATE_INVALID", "Discord responsibility roles could not be verified.", 503);
    }

    return [
        ...new Set(
            roles
                .map(
                    role =>
                        normalizeString(
                            role
                        )
                            .toLowerCase()
                )
                .filter(
                    role =>
                        RESPONSIBILITY_ROLE_SET.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
ACCOUNT ID
========================================================= */

function getAuthorizedAccountId(
    authorization
) {
    const accountId = normalizeString(authorization?.accountId);
    if (!accountId || authorization?.active !== true) {
        throw new AuthorizationError("DISCORD_AUTHORIZATION_REQUIRED", "A verified active account is required.", 403);
    }
    return accountId;
}

/* =========================================================
VERIFIED DISCORD CONTEXT
========================================================= */

function requireVerifiedDiscordContext(
    authorization
) {
    if (
        !authorization
        || typeof authorization !==
            "object"
    ) {
        throw new AuthorizationError(
            "DISCORD_AUTHORIZATION_REQUIRED",
            "Discord authorization is required.",
            403
        );
    }

    if (
        authorization
            ?.discord
            ?.connected !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_PROVIDER_REQUIRED",
            "A linked Discord account is required.",
            403
        );
    }

    if (
        authorization
            ?.discord
            ?.guildMember !==
        true
    ) {
        throw new AuthorizationError(
            "DISCORD_GUILD_MEMBERSHIP_REQUIRED",
            "Membership in the BPD Gaming Network Discord server is required.",
            403
        );
    }

    const subject = normalizeString(authorization?.verifiedProviders?.discord?.subject);
    if (!subject || subject !== normalizeString(authorization.discord.userId)) {
        throw new AuthorizationError("DISCORD_AUTHORIZATION_REQUIRED", "A verified Discord identity is required.", 403);
    }
    return authorization.discord;
}

/* =========================================================
RESPONSIBILITY ROLES

These values were produced by guild_roles.js from the live
Discord member role IDs.

An empty array is valid and important. It means Discord
currently reports no responsibility roles, so the database
synchronization must revoke any previously active managed
roles.
========================================================= */

function getDiscordResponsibilityRoles(
    authorization
) {
    const discord =
        requireVerifiedDiscordContext(
            authorization
        );

    return normalizeResponsibilityRoles(
        discord.responsibilityRoles
    );
}

/* =========================================================
RPC RESULT NORMALIZATION
========================================================= */

function normalizeSyncRows(
    value
) {
    if (
        !Array.isArray(
            value
        )
    ) {
        return [];
    }

    return value
        .map(
            row => {
                const role =
                    normalizeString(
                        row?.role
                    )
                        .toLowerCase();

                if (
                    !RESPONSIBILITY_ROLE_SET.has(
                        role
                    )
                ) {
                    return null;
                }

                return {
                    role,

                    active:
                        row?.active ===
                        true,

                    grantedAt:
                        normalizeString(
                            row?.granted_at
                            ?? row?.grantedAt
                        )
                        || null,

                    revokedAt:
                        normalizeString(
                            row?.revoked_at
                            ?? row?.revokedAt
                        )
                        || null
                };
            }
        )
        .filter(
            Boolean
        );
}

/* =========================================================
CURRENT ACTIVE ROLES

The synchronization RPC may return historical rows as well
as current rows. Only active rows determine the caller's
current responsibility-role state.
========================================================= */

function getActiveRoles(
    rows
) {
    return [
        ...new Set(
            rows
                .filter(
                    row =>
                        row.active ===
                        true
                )
                .map(
                    row =>
                        row.role
                )
        )
    ];
}

/* =========================================================
SYNC DISCORD RESPONSIBILITY ROLES

IMPORTANT:
    authorization must already have passed through the
    Discord authorization service.

    This function intentionally does not call Discord again.
========================================================= */

export async function syncDiscordResponsibilityRoles(
    env,
    authorization
) {
    const accountId =
        getAuthorizedAccountId(
            authorization
        );

    const discord =
        requireVerifiedDiscordContext(
            authorization
        );

    const discordRoles =
        getDiscordResponsibilityRoles(
            authorization
        );

    const result =
        await callAdminTaskRpc(
            env,
            DISCORD_ROLE_SYNC_RPC,
            {
                p_account_id:
                    accountId,

                p_roles:
                    discordRoles
            }
        );

    if (!Array.isArray(result) || result.some(row =>
        !row || !RESPONSIBILITY_ROLE_SET.has(normalizeString(row.role).toLowerCase())
        || typeof row.active !== "boolean")) {
        throw new AuthorizationError("DISCORD_ROLE_SYNC_UNAVAILABLE", "Responsibility roles could not be synchronized.", 503);
    }

    const rows =
        normalizeSyncRows(
            result
        );

    const activeRoles =
        getActiveRoles(
            rows
        );

    if (JSON.stringify([...activeRoles].sort()) !== JSON.stringify([...discordRoles].sort())) {
        throw new AuthorizationError("DISCORD_ROLE_SYNC_UNAVAILABLE", "Responsibility roles could not be synchronized.", 503);
    }

    return {
        accountId,

        discordUserId:
            normalizeString(
                discord.userId
            )
            || null,

        guildMember:
            true,

        discordRoles,

        roles:
            activeRoles,

        isOwner:
            activeRoles.includes(
                "owner"
            ),

        isDatabase:
            activeRoles.includes(
                "database"
            ),

        isSecurity:
            activeRoles.includes(
                "security"
            ),

        isUi:
            activeRoles.includes(
                "ui"
            ),

        synchronized:
            true,

        rows
    };
}