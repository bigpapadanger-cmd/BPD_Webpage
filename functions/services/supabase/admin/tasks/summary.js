"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN TASK SUMMARY SERVICE

File:
    functions/services/supabase/admin/tasks/summary.js

Purpose:
    Securely retrieves Taskboard summary statistics through
    the Supabase admin_get_task_summary RPC.

Description:
    - Requires TASKS_READ permission.
    - Requires active Taskboard membership.
    - Loads verified Taskboard roles server-side.
    - owner receives summary metrics across all authorized
      Taskboard records.
    - database/security/ui receive metrics only for tasks
      overlapping their verified responsibility roles.
    - Performs no client-side or server-side recalculation.
    - Does not mutate task state.

Security:
    - Browser-submitted permissions are never trusted.
    - Browser-submitted Taskboard roles are never trusted.
    - Authorized roles come from identity.account_roles.
    - Task scope is enforced by the Supabase RPC before
      summary metrics are calculated.
    - Supabase service-role credentials remain server-side.
========================================================= */

import {
    authorizeTaskRead
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

const ALLOWED_TASKBOARD_ROLES =
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
        ? value.trim()
        : "";
}

function normalizeAuthorizedRoles(
    roleContext
) {
    const roles =
        Array.isArray(
            roleContext?.roles
        )
            ? roleContext.roles
            : [];

    return [
        ...new Set(
            roles
                .map(
                    role =>
                        normalizeString(
                            role
                        ).toLowerCase()
                )
                .filter(
                    role =>
                        ALLOWED_TASKBOARD_ROLES.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
GET SUMMARY

Authorization sequence:

    TASKS_READ
        ↓
    active Taskboard membership
        ↓
    verified Taskboard role context
        ↓
    admin_get_task_summary
        ↓
    database responsibility scope
        ↓
    authorized metrics only
========================================================= */

export async function getAdminTaskSummary(
    request,
    env
) {
    /* -----------------------------------------------------
    OPERATION PERMISSION
    ----------------------------------------------------- */

    const authorization =
        await authorizeTaskRead(
            request,
            env
        );

    /* -----------------------------------------------------
    TASKBOARD MEMBERSHIP + VERIFIED ROLES

    requireTaskboardMembership() already resolves and
    returns the complete Taskboard role context.

    Do not make a second Taskboard-role RPC here.
    ----------------------------------------------------- */

    const roleContext =
        await requireTaskboardMembership(
            env,
            authorization
        );

    const authorizedRoles =
        normalizeAuthorizedRoles(
            roleContext
        );

    /*
     * requireTaskboardMembership() already guarantees at
     * least one role. Keep this additional check so this
     * service fails closed if that contract ever changes.
     */
    if (
        authorizedRoles.length === 0
    ) {
        const error =
            new Error(
                "An active Taskboard role is required."
            );

        error.name =
            "AdminTaskSummaryError";

        error.code =
            "TASKBOARD_ROLE_REQUIRED";

        error.status =
            403;

        throw error;
    }

    /* -----------------------------------------------------
    SUMMARY RPC

    p_authorized_roles is derived exclusively from the
    server-verified Taskboard role context.
    ----------------------------------------------------- */

    return callAdminTaskRpc(
        env,
        ADMIN_TASK_RPCS.SUMMARY,
        {
            p_authorized_roles:
                authorizedRoles
        }
    );
}