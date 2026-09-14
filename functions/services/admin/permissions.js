"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN PERMISSIONS SERVICE

File:
    functions/services/admin/permissions.js

Purpose:
    Converts authoritative Discord guild staff roles into
    normalized BPD Gaming Network application permissions.

Description:
    - Uses the centralized Discord authorization service.
    - Requires a linked Discord account.
    - Requires current membership in the configured BPD
      Discord guild.
    - Requires at least one recognized staff role.
    - Converts Discord Admin, Moderator, and League Staff
      roles into application-level permissions.
    - Supports users who hold multiple Discord staff roles.
    - Provides reusable permission checks for Admin APIs and
      future site-wide staff functionality.
    - Provides task-board-specific authorization helpers.

Security:
    - Discord role information is read server-side.
    - Browser-submitted role or permission claims are never
      trusted.
    - Permission decisions are derived only from the current
      authoritative Discord authorization context.
    - Individual protected API endpoints must require the
      permission needed for that specific operation.
    - Hiding a button in the browser is not authorization.
    - Task assignment permission remains separate from task
      update permission.
    - Task deletion permission remains separate from all
      normal task lifecycle operations.

Dependency Direction:
    auth/authorization.js
        -> providers/discord/authorization.js
        -> admin/permissions.js
        -> protected Admin/service endpoints

Important:
    - Discord roles answer WHO the staff member is.
    - This file answers WHAT that staff member may do.
    - Discord role IDs do not belong in this file.
    - Role IDs remain isolated in guild_roles.js through
      environment variables.
    - Adding a new permission does not automatically grant it
      to any non-Admin role.
========================================================= */

import {
    AuthorizationError
} from "../auth/authorization.js";

import {
    authorizeDiscordStaff
} from "../auth/providers/discord/authorization.js";

/* =========================================================
PERMISSION DEFINITIONS

Use these constants throughout server-side Admin services
instead of repeating raw permission strings.
========================================================= */

export const ADMIN_PERMISSIONS =
    Object.freeze({
        PAGE_ACCESS:
            "admin.page.access",

        TASKS_READ:
            "tasks.read",

        TASKS_CREATE:
            "tasks.create",

        TASKS_UPDATE:
            "tasks.update",

        TASKS_ASSIGN:
            "tasks.assign",

        TASKS_DELETE:
            "tasks.delete",

        NOTIFICATIONS_READ:
            "notifications.read",

        NOTIFICATIONS_SEND:
            "notifications.send",

        NOTIFICATIONS_MANAGE:
            "notifications.manage",

        DISCORD_ALERTS_SEND:
            "discord.alerts.send",

        AUDIT_READ:
            "audit.read",

        ADMIN_SETTINGS_MANAGE:
            "admin.settings.manage"
    });

/* =========================================================
ALL ADMIN PERMISSIONS

Administrators receive every permission currently defined.

This intentionally means newly defined permissions are
automatically granted to Admin while every non-Admin role
must receive new permissions explicitly.
========================================================= */

const ALL_ADMIN_PERMISSIONS =
    Object.freeze(
        Object.values(
            ADMIN_PERMISSIONS
        )
    );

/* =========================================================
MODERATOR PERMISSIONS

Baseline:
    - May access the Admin/staff page.
    - May read/create/update/assign tasks.
    - May perform normal task lifecycle operations.
    - May read and send normal site notifications.
    - May not delete or restore deleted tasks.
    - May not read the global Admin audit feed.
    - May not send Discord alerts.
    - May not manage Admin settings.
========================================================= */

const MODERATOR_PERMISSIONS =
    Object.freeze([
        ADMIN_PERMISSIONS.PAGE_ACCESS,

        ADMIN_PERMISSIONS.TASKS_READ,
        ADMIN_PERMISSIONS.TASKS_CREATE,
        ADMIN_PERMISSIONS.TASKS_UPDATE,
        ADMIN_PERMISSIONS.TASKS_ASSIGN,

        ADMIN_PERMISSIONS.NOTIFICATIONS_READ,
        ADMIN_PERMISSIONS.NOTIFICATIONS_SEND
    ]);

/* =========================================================
LEAGUE STAFF PERMISSIONS

Baseline:
    - May access the Admin/staff page.
    - May participate in the shared task board.
    - May read/create/update/assign tasks.
    - May perform normal task lifecycle operations.
    - May view notifications.
    - May not delete or restore deleted tasks.
    - May not read the global Admin audit feed.
    - May not send notifications or Discord alerts.
    - May not manage Admin settings.
========================================================= */

const LEAGUE_STAFF_PERMISSIONS =
    Object.freeze([
        ADMIN_PERMISSIONS.PAGE_ACCESS,

        ADMIN_PERMISSIONS.TASKS_READ,
        ADMIN_PERMISSIONS.TASKS_CREATE,
        ADMIN_PERMISSIONS.TASKS_UPDATE,
        ADMIN_PERMISSIONS.TASKS_ASSIGN,

        ADMIN_PERMISSIONS.NOTIFICATIONS_READ
    ]);

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

function normalizePermission(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

function normalizePermissionList(
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
                    normalizePermission
                )
                .filter(
                    Boolean
                )
        )
    ];
}

/* =========================================================
KNOWN PERMISSION
========================================================= */

function isKnownPermission(
    permission
) {
    const normalized =
        normalizePermission(
            permission
        );

    if (
        !normalized
    ) {
        return false;
    }

    return ALL_ADMIN_PERMISSIONS
        .includes(
            normalized
        );
}

/* =========================================================
ROLE -> PERMISSION MAPPING

Permissions are additive.

Example:
    A user with both Moderator and League Staff receives the
    union of both role permission sets.

Admin automatically receives every defined permission.
========================================================= */

export function getPermissionsForDiscordRoles(
    discord
) {
    if (
        !discord
        || typeof discord !==
            "object"
    ) {
        return [];
    }

    if (
        discord.isAdmin ===
        true
    ) {
        return [
            ...ALL_ADMIN_PERMISSIONS
        ];
    }

    const permissions =
        new Set();

    if (
        discord.isModerator ===
        true
    ) {
        for (
            const permission
            of MODERATOR_PERMISSIONS
        ) {
            permissions.add(
                permission
            );
        }
    }

    if (
        discord.isLeagueStaff ===
        true
    ) {
        for (
            const permission
            of LEAGUE_STAFF_PERMISSIONS
        ) {
            permissions.add(
                permission
            );
        }
    }

    return [
        ...permissions
    ];
}

/* =========================================================
PERMISSION CONTEXT
========================================================= */

function createAdminPermissionContext(
    authorization
) {
    const permissions =
        getPermissionsForDiscordRoles(
            authorization?.discord
        );

    return {
        ...authorization,

        admin: {
            staff:
                authorization
                    ?.discord
                    ?.isStaff ===
                true,

            isAdmin:
                authorization
                    ?.discord
                    ?.isAdmin ===
                true,

            isModerator:
                authorization
                    ?.discord
                    ?.isModerator ===
                true,

            isLeagueStaff:
                authorization
                    ?.discord
                    ?.isLeagueStaff ===
                true,

            permissions
        }
    };
}

/* =========================================================
HAS PERMISSION
========================================================= */

export function hasAdminPermission(
    authorization,
    permission
) {
    const normalizedPermission =
        normalizePermission(
            permission
        );

    if (
        !normalizedPermission
    ) {
        return false;
    }

    if (
        !isKnownPermission(
            normalizedPermission
        )
    ) {
        return false;
    }

    const permissions =
        normalizePermissionList(
            authorization
                ?.admin
                ?.permissions
        );

    return permissions.includes(
        normalizedPermission
    );
}

/* =========================================================
REQUIRE PERMISSION
========================================================= */

export function requireAdminPermission(
    authorization,
    permission
) {
    const normalizedPermission =
        normalizePermission(
            permission
        );

    if (
        !normalizedPermission
        || !isKnownPermission(
            normalizedPermission
        )
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_CONFIGURATION_INVALID",
            "The required Admin permission is invalid.",
            500,
            {
                permission:
                    normalizedPermission
                    || null
            }
        );
    }

    if (
        !hasAdminPermission(
            authorization,
            normalizedPermission
        )
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_REQUIRED",
            "You do not have permission to perform this action.",
            403,
            {
                requiredPermission:
                    normalizedPermission
            }
        );
    }

    return authorization;
}

/* =========================================================
REQUIRE ANY PERMISSION
========================================================= */

export function requireAnyAdminPermission(
    authorization,
    permissions
) {
    const requiredPermissions =
        normalizePermissionList(
            permissions
        );

    if (
        requiredPermissions.length ===
        0
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_CONFIGURATION_INVALID",
            "At least one valid Admin permission is required.",
            500
        );
    }

    const invalidPermission =
        requiredPermissions.find(
            permission =>
                !isKnownPermission(
                    permission
                )
        );

    if (
        invalidPermission
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_CONFIGURATION_INVALID",
            "An invalid Admin permission was requested.",
            500,
            {
                permission:
                    invalidPermission
            }
        );
    }

    const allowed =
        requiredPermissions.some(
            permission =>
                hasAdminPermission(
                    authorization,
                    permission
                )
        );

    if (
        !allowed
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_REQUIRED",
            "You do not have permission to perform this action.",
            403,
            {
                requiredPermissions
            }
        );
    }

    return authorization;
}

/* =========================================================
REQUIRE ALL PERMISSIONS
========================================================= */

export function requireAllAdminPermissions(
    authorization,
    permissions
) {
    const requiredPermissions =
        normalizePermissionList(
            permissions
        );

    if (
        requiredPermissions.length ===
        0
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_CONFIGURATION_INVALID",
            "At least one valid Admin permission is required.",
            500
        );
    }

    const invalidPermission =
        requiredPermissions.find(
            permission =>
                !isKnownPermission(
                    permission
                )
        );

    if (
        invalidPermission
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_CONFIGURATION_INVALID",
            "An invalid Admin permission was requested.",
            500,
            {
                permission:
                    invalidPermission
            }
        );
    }

    const allowed =
        requiredPermissions.every(
            permission =>
                hasAdminPermission(
                    authorization,
                    permission
                )
        );

    if (
        !allowed
    ) {
        throw new AuthorizationError(
            "ADMIN_PERMISSION_REQUIRED",
            "You do not have all permissions required to perform this action.",
            403,
            {
                requiredPermissions
            }
        );
    }

    return authorization;
}

/* =========================================================
AUTHORIZE ADMIN CONTEXT

Requires:
    - authenticated BPD account
    - active canonical account
    - linked Discord identity
    - membership in configured guild
    - recognized Discord staff role

No specific application permission is required here.

Useful for:
    /api/admin/session
    loading the Admin page
    retrieving the current staff permission set
========================================================= */

export async function authorizeAdminContext(
    request,
    env
) {
    const authorization =
        await authorizeDiscordStaff(
            request,
            env
        );

    return createAdminPermissionContext(
        authorization
    );
}

/* =========================================================
AUTHORIZE SINGLE PERMISSION
========================================================= */

export async function authorizeAdminPermission(
    request,
    env,
    permission
) {
    const authorization =
        await authorizeAdminContext(
            request,
            env
        );

    return requireAdminPermission(
        authorization,
        permission
    );
}

/* =========================================================
AUTHORIZE ANY PERMISSION
========================================================= */

export async function authorizeAnyAdminPermission(
    request,
    env,
    permissions
) {
    const authorization =
        await authorizeAdminContext(
            request,
            env
        );

    return requireAnyAdminPermission(
        authorization,
        permissions
    );
}

/* =========================================================
AUTHORIZE ALL PERMISSIONS
========================================================= */

export async function authorizeAllAdminPermissions(
    request,
    env,
    permissions
) {
    const authorization =
        await authorizeAdminContext(
            request,
            env
        );

    return requireAllAdminPermissions(
        authorization,
        permissions
    );
}

/* =========================================================
TASK BOARD AUTHORIZATION

These helpers provide one stable permission interface for all
Admin task-board endpoints.

This prevents endpoint implementations from duplicating raw
permission strings or accidentally using the wrong permission.
========================================================= */

/* =========================================================
TASK READ

Used for:
    - get task
    - list tasks
    - task summary
    - individual task event/history
========================================================= */

export async function authorizeTaskRead(
    request,
    env
) {
    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.TASKS_READ
    );
}

/* =========================================================
TASK CREATE

If assignment is included during creation, the caller must
also possess TASKS_ASSIGN.

The caller decides whether assignment is being requested
after validating the submitted task payload.
========================================================= */

export async function authorizeTaskCreate(
    request,
    env,
    {
        assignment =
            false
    } = {}
) {
    if (
        assignment ===
        true
    ) {
        return authorizeAllAdminPermissions(
            request,
            env,
            [
                ADMIN_PERMISSIONS.TASKS_CREATE,
                ADMIN_PERMISSIONS.TASKS_ASSIGN
            ]
        );
    }

    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.TASKS_CREATE
    );
}

/* =========================================================
TASK UPDATE

Normal field/lifecycle changes require TASKS_UPDATE.

Changing:
    assigned_role
    assigned_account_id

requires both:
    TASKS_UPDATE
    TASKS_ASSIGN
========================================================= */

export async function authorizeTaskUpdate(
    request,
    env,
    {
        assignment =
            false
    } = {}
) {
    if (
        assignment ===
        true
    ) {
        return authorizeAllAdminPermissions(
            request,
            env,
            [
                ADMIN_PERMISSIONS.TASKS_UPDATE,
                ADMIN_PERMISSIONS.TASKS_ASSIGN
            ]
        );
    }

    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.TASKS_UPDATE
    );
}

/* =========================================================
TASK ASSIGN

Used for:
    - assignee lookup
    - dedicated assignment operations
    - future assignment-management endpoints

This helper does not imply TASKS_UPDATE.
If an operation modifies an existing task assignment, use
authorizeTaskUpdate(..., { assignment: true }) instead.
========================================================= */

export async function authorizeTaskAssign(
    request,
    env
) {
    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.TASKS_ASSIGN
    );
}

/* =========================================================
TASK DELETE

Used for:
    - soft delete
    - restore deleted task

Deletion remains intentionally separate from normal task
updates and lifecycle operations.
========================================================= */

export async function authorizeTaskDelete(
    request,
    env
) {
    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.TASKS_DELETE
    );
}

/* =========================================================
TASK AUDIT

Used for the global task activity/audit feed.

Individual task history remains available through TASKS_READ.
Global administrative activity requires AUDIT_READ.
========================================================= */

export async function authorizeTaskAuditRead(
    request,
    env
) {
    return authorizeAdminPermission(
        request,
        env,
        ADMIN_PERMISSIONS.AUDIT_READ
    );
}