"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK ASSIGNEES SERVICE

File:
    functions/services/supabase/admin/tasks/assignees.js

Purpose:
    Securely retrieves the authoritative Taskboard
    assignment options and the current user's verified
    Taskboard responsibility roles.

Description:
    - Requires TASKS_ASSIGN permission.
    - Requires active Taskboard membership.
    - Retrieves canonical assignment data from Supabase.
    - Uses the verified Taskboard role context returned by
      the membership check.
    - Keeps available assignment roles separate from the
      current user's authorization roles.
    - Does not expose provider-specific account information.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Current-user roles are derived server-side from
      identity.account_roles.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskAssign
} from "../../../admin/permissions.js";

import {
    requireTaskboardMembership
} from "../../../admin/taskboard_roles.js";

import {
    ADMIN_TASK_RPCS,
    callAdminTaskRpc
} from "./rpc.js";

/* =========================================================
CONSTANTS
========================================================= */

const TASKBOARD_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim().toLowerCase()
        : "";
}

function normalizeRoles(
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
                    role =>
                        normalizeString(
                            role
                        )
                )
                .filter(
                    role =>
                        TASKBOARD_ROLES.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
GET ASSIGNEES

Returns:
{
    success: true,

    availableRoles: [
        "owner",
        "database",
        "security",
        "ui"
    ],

    accounts: [],

    userRoles: [
        ...
    ],

    isOwner: boolean
}

Important:

    availableRoles
        = roles tasks may be assigned to.

    userRoles
        = verified responsibility roles actually held by
          the authenticated account.

    isOwner
        = presentation convenience only.

None of these client-visible values establish authorization.
Server-side checks remain authoritative.
========================================================= */

export async function getAdminTaskAssignees(
    request,
    env
) {
    /* -----------------------------------------------------
    OPERATION PERMISSION
    ----------------------------------------------------- */

    const authorization =
        await authorizeTaskAssign(
            request,
            env
        );

    /* -----------------------------------------------------
    TASKBOARD MEMBERSHIP + VERIFIED ROLE CONTEXT

    requireTaskboardMembership() already resolves and
    returns the complete Taskboard role context.

    Do not make another Taskboard-role RPC.
    ----------------------------------------------------- */

    const roleContext =
        await requireTaskboardMembership(
            env,
            authorization
        );

    const userRoles =
        normalizeRoles(
            roleContext?.roles
        );

    /*
     * requireTaskboardMembership() should guarantee at
     * least one valid role. Keep this boundary fail-closed
     * if that contract ever changes.
     */
    if (
        userRoles.length === 0
    ) {
        const error =
            new Error(
                "An active Taskboard role is required."
            );

        error.name =
            "AdminTaskAssigneesError";

        error.code =
            "TASKBOARD_ROLE_REQUIRED";

        error.status =
            403;

        throw error;
    }

    /* -----------------------------------------------------
    AUTHORITATIVE ASSIGNMENT OPTIONS
    ----------------------------------------------------- */

    const assigneeData =
        await callAdminTaskRpc(
            env,
            ADMIN_TASK_RPCS.ASSIGNEES,
            {}
        );

    /*
     * The current RPC may return its assignable roles under
     * either "roles" or "availableRoles".

     * Normalize either representation into the public API
     * contract.
     */
    const availableRoles =
        normalizeRoles(
            assigneeData?.roles
            ?? assigneeData?.availableRoles
        );

    const accounts =
        Array.isArray(
            assigneeData?.accounts
        )
            ? assigneeData.accounts
            : [];

    /* -----------------------------------------------------
    RESPONSE
    ----------------------------------------------------- */

    return {
        success:
            true,

        availableRoles,

        accounts,

        userRoles,

        isOwner:
            userRoles.includes(
                "owner"
            )
    };
}