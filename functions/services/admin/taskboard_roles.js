"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASKBOARD ROLE SERVICE

File:
    functions/services/admin/taskboard_roles.js

Purpose:
    Resolves persistent Taskboard responsibility roles and
    provides reusable task-specific authorization checks.

Taskboard Roles:
    - owner
    - database
    - security
    - ui

Description:
    - Taskboard roles are stored in identity.account_roles.
    - Only active role grants are returned by Supabase.
    - Only recognized Taskboard roles are accepted here.
    - A user may hold multiple Taskboard roles.
    - owner may access tasks regardless of assignment.
    - Non-owner users require an overlap between their
      Taskboard roles and the task's responsible_roles.
    - Discord/Admin permissions remain a separate layer.

Security:
    - Account ID originates from server-side authorization.
    - Browser-submitted role claims are never trusted.
    - Browser-submitted account IDs are never trusted.
    - Database role results are whitelisted again here.
    - Task responsibility checks must be performed server-side.

Important:
    Discord/Admin permissions answer:
        WHAT may this staff member do?

    Taskboard roles answer:
        WHICH task responsibilities belong to them?
========================================================= */

import {
    AuthorizationError
} from "../auth/authorization.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "../supabase/admin/tasks/rpc.js";

/* =========================================================
TASKBOARD ROLES
========================================================= */

export const TASKBOARD_ROLES =
    Object.freeze({
        OWNER:
            "owner",

        DATABASE:
            "database",

        SECURITY:
            "security",

        UI:
            "ui"
    });

const TASKBOARD_ROLE_VALUES =
    Object.freeze(
        Object.values(
            TASKBOARD_ROLES
        )
    );

const TASKBOARD_ROLE_SET =
    new Set(
        TASKBOARD_ROLE_VALUES
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

function normalizeRole(
    value
) {
    return normalizeString(
        value
    ).toLowerCase();
}

function normalizeRoleList(
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
                    normalizeRole
                )
                .filter(
                    role =>
                        TASKBOARD_ROLE_SET.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
ACCOUNT ID

The canonical account ID must originate from the trusted
authorization context.

This mirrors the current authorization context compatibility
used by the Admin task lifecycle service. Once the central
authorization shape is permanently fixed, both locations can
be reduced to the single canonical property.
========================================================= */

export function getAuthorizedAccountId(
    authorization
) {
    const candidates = [
        authorization?.account?.id,
        authorization?.accountId,
        authorization?.account?.accountId,
        authorization?.identity?.accountId
    ];

    for (
        const candidate
        of candidates
    ) {
        const normalized =
            normalizeString(
                candidate
            );

        if (
            normalized
        ) {
            return normalized;
        }
    }

    throw new AuthorizationError(
        "ADMIN_ACCOUNT_ID_MISSING",
        "The authenticated account ID could not be resolved.",
        500
    );
}

/* =========================================================
RPC RESULT NORMALIZATION

Expected Supabase result:

    [
        { role: "owner" },
        { role: "database" }
    ]

Only recognized Taskboard roles survive normalization.
========================================================= */

function normalizeRoleRpcResult(
    result
) {
    if (
        !Array.isArray(
            result
        )
    ) {
        return [];
    }

    return normalizeRoleList(
        result.map(
            row =>
                row?.role
        )
    );
}

/* =========================================================
GET TASKBOARD ROLES

The authorization object must already have been created by
the trusted server-side Admin authorization layer.

This function intentionally accepts the authorization
context rather than an arbitrary browser account ID.
========================================================= */

export async function getTaskboardRoles(
    env,
    authorization
) {
    const accountId =
        getAuthorizedAccountId(
            authorization
        );

    const result =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.TASKBOARD_ROLES,
            {
                p_account_id:
                    accountId
            }
        );

    return normalizeRoleRpcResult(
        result
    );
}

/* =========================================================
GET TASKBOARD ROLE CONTEXT

Returns a normalized responsibility context suitable for
server-side authorization and API responses.

Example:

    {
        accountId: "...",
        roles: ["owner", "database"],
        isOwner: true
    }
========================================================= */

export async function getTaskboardRoleContext(
    env,
    authorization
) {
    const accountId =
        getAuthorizedAccountId(
            authorization
        );

    const roles =
        await getTaskboardRoles(
            env,
            authorization
        );

    return {
        accountId,

        roles,

        isOwner:
            roles.includes(
                TASKBOARD_ROLES.OWNER
            )
    };
}

/* =========================================================
REQUIRE TASKBOARD MEMBERSHIP

A staff member may possess Discord/Admin permissions while
having no Taskboard responsibility role.

Taskboard operations requiring responsibility membership
should use this helper.
========================================================= */

export async function requireTaskboardMembership(
    env,
    authorization
) {
    const context =
        await getTaskboardRoleContext(
            env,
            authorization
        );

    if (
        context.roles.length ===
        0
    ) {
        throw new AuthorizationError(
            "TASKBOARD_ROLE_REQUIRED",
            "You do not have an active Taskboard role.",
            403
        );
    }

    return context;
}

/* =========================================================
ROLE INTERSECTION
========================================================= */

export function hasTaskboardRoleOverlap(
    userRoles,
    responsibleRoles
) {
    const normalizedUserRoles =
        normalizeRoleList(
            userRoles
        );

    const normalizedResponsibleRoles =
        normalizeRoleList(
            responsibleRoles
        );

    if (
        normalizedUserRoles.includes(
            TASKBOARD_ROLES.OWNER
        )
    ) {
        return true;
    }

    if (
        normalizedUserRoles.length ===
            0
        || normalizedResponsibleRoles.length ===
            0
    ) {
        return false;
    }

    const responsibleRoleSet =
        new Set(
            normalizedResponsibleRoles
        );

    return normalizedUserRoles.some(
        role =>
            responsibleRoleSet.has(
                role
            )
    );
}

/* =========================================================
REQUIRE TASK RESPONSIBILITY

Rule:
    owner
        -> may access any task

    database/security/ui
        -> must overlap task.responsible_roles

The operation-level Admin permission must be checked
separately before this function is called.
========================================================= */

export async function requireTaskResponsibility(
    env,
    authorization,
    responsibleRoles
) {
    const context =
        await requireTaskboardMembership(
            env,
            authorization
        );

    if (
        context.isOwner
    ) {
        return context;
    }

    if (
        !hasTaskboardRoleOverlap(
            context.roles,
            responsibleRoles
        )
    ) {
        throw new AuthorizationError(
            "TASKBOARD_TASK_ACCESS_REQUIRED",
            "You are not assigned to this task.",
            403,
            {
                taskboardRoles:
                    context.roles
            }
        );
    }

    return context;
}

/* =========================================================
ROLE CHECK
========================================================= */

export function isTaskboardRole(
    value
) {
    return TASKBOARD_ROLE_SET.has(
        normalizeRole(
            value
        )
    );
}

/* =========================================================
NORMALIZE EXPORTED ROLE LIST

Useful for task payload validation and API presentation.

This does not authorize anything.
========================================================= */

export function normalizeTaskboardRoles(
    values
) {
    return normalizeRoleList(
        values
    );
}