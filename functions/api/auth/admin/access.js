"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN ACCESS API

File:
    functions/api/auth/admin/access.js

Route:
    GET /api/auth/admin/access

Purpose:
    Verifies that the currently authenticated BPD account
    has authorized Discord-backed Admin access AND at least
    one active Admin responsibility role before allowing
    access to any Admin page.

Description:
    - Verifies Discord-backed Admin access.
    - Requires at least one active Admin responsibility role.
    - Returns authoritative Admin operation permissions.
    - Returns verified Discord staff state.
    - Returns active Admin/Taskboard responsibility roles.
    - Denies all Admin access when no responsibility role
      is assigned.
    - Keeps Discord authorization and responsibility-role
      authorization independently verified server-side.

Access Requirements:
    A user may access the Admin area only when:

    1. The user has an authenticated BPD account.
    2. The BPD account has an associated Discord identity.
    3. The Discord account currently satisfies the
       Discord-backed Admin staff authorization policy.
    4. The BPD account has at least one active role from:
           owner
           database
           security
           ui

    Failure of either authorization layer denies access to
    the entire Admin area.

Security:
    - Discord identity is resolved server-side.
    - Discord guild roles are verified server-side.
    - Responsibility roles are resolved server-side from
      the canonical identity.account_roles source.
    - Browser-submitted account IDs, Discord IDs,
      permissions, or roles are never trusted.
    - Supabase credentials are never exposed.
========================================================= */

/* =========================================================
IMPORTS
========================================================= */

import {
    authorizeAdminContext
} from "../../../services/admin/permissions.js";

import {
    requireTaskboardMembership
} from "../../../services/admin/taskboard_roles.js";

/* =========================================================
CONSTANTS
========================================================= */

const JSON_HEADERS =
    Object.freeze({
        "Content-Type":
            "application/json; charset=utf-8",

        "Cache-Control":
            "no-store"
    });

const ADMIN_RESPONSIBILITY_ROLES =
    new Set([
        "owner",
        "database",
        "security",
        "ui"
    ]);

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,

            headers:
                JSON_HEADERS
        }
    );
}

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

function normalizeResponsibilityRoles(
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
                        ).toLowerCase()
                )
                .filter(
                    role =>
                        ADMIN_RESPONSIBILITY_ROLES.has(
                            role
                        )
                )
        )
    ];
}

/* =========================================================
ERROR STATUS
========================================================= */

function getErrorStatus(
    error
) {
    const status =
        Number(
            error?.status
        );

    if (
        Number.isInteger(
            status
        )
        && status >= 400
        && status <= 599
    ) {
        return status;
    }

    return 500;
}

/* =========================================================
ERROR RESPONSE
========================================================= */

function handleApiError(
    error
) {
    const status =
        getErrorStatus(
            error
        );

    if (
        status >= 500
    ) {
        console.error(
            "[ADMIN ACCESS API]",
            {
                name:
                    error?.name
                    ?? null,

                code:
                    error?.code
                    ?? null,

                message:
                    error?.message
                    ?? null,

                databaseCode:
                    error?.databaseCode
                    ?? null,

                details:
                    error?.details
                    ?? null,

                hint:
                    error?.hint
                    ?? null
            }
        );
    }

    return jsonResponse(
        {
            success:
                false,

            authorized:
                false,

            error:
                status === 401
                    ? "AUTHENTICATION_REQUIRED"
                    : status === 403
                        ? "ADMIN_ACCESS_DENIED"
                        : "ADMIN_ACCESS_CHECK_FAILED"
        },
        status
    );
}

/* =========================================================
GET /api/auth/admin/access

Successful response:

{
    success: true,
    authorized: true,

    admin: {
        staff: true,
        isAdmin: boolean,
        isModerator: boolean,
        isLeagueStaff: boolean,
        permissions: [...]
    },

    taskboard: {
        member: true,
        roles: [...],
        isOwner: boolean
    }
}

Important:
    authorized:true means BOTH authorization layers have
    succeeded:

    - Discord-backed Admin authorization
    - active responsibility-role membership
========================================================= */

export async function onRequestGet(
    context
) {
    try {
        const {
            request,
            env
        } =
            context;

        /* -------------------------------------------------
        DISCORD-BACKED ADMIN AUTHORIZATION

        This verifies the authenticated BPD account,
        associated Discord identity, guild membership,
        current Discord roles, and Admin staff policy.
        ------------------------------------------------- */

        const authorization =
            await authorizeAdminContext(
                request,
                env
            );

        /* -------------------------------------------------
        RESPONSIBILITY ROLE AUTHORIZATION

        Every Admin page requires at least one active role
        from the canonical responsibility-role source.

        requireTaskboardMembership() returns the verified
        role context so another role lookup is not needed.
        ------------------------------------------------- */

        const roleContext =
            await requireTaskboardMembership(
                env,
                authorization
            );

        const responsibilityRoles =
            normalizeResponsibilityRoles(
                roleContext?.roles
            );

        /* -------------------------------------------------
        FAIL CLOSED

        requireTaskboardMembership() should already reject
        an account without a qualifying role.

        This additional check ensures this API never returns
        authorized:true if an invalid or empty role context
        reaches this point.
        ------------------------------------------------- */

        if (
            responsibilityRoles.length ===
            0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    authorized:
                        false,

                    error:
                        "ADMIN_ACCESS_DENIED"
                },
                403
            );
        }

        /* -------------------------------------------------
        RESPONSE
        ------------------------------------------------- */

        return jsonResponse(
            {
                success:
                    true,

                authorized:
                    true,

                admin: {
                    staff:
                        authorization?.admin?.staff ===
                        true,

                    isAdmin:
                        authorization?.admin?.isAdmin ===
                        true,

                    isModerator:
                        authorization?.admin?.isModerator ===
                        true,

                    isLeagueStaff:
                        authorization?.admin?.isLeagueStaff ===
                        true,

                    permissions:
                        Array.isArray(
                            authorization?.admin?.permissions
                        )
                            ? authorization.admin.permissions
                            : []
                },

                taskboard: {
                    member:
                        true,

                    roles:
                        responsibilityRoles,

                    isOwner:
                        responsibilityRoles.includes(
                            "owner"
                        )
                }
            },
            200
        );
    }
    catch (
        error
    ) {
        return handleApiError(
            error
        );
    }
}

/* =========================================================
METHOD FALLBACK
========================================================= */

export async function onRequest(
    context
) {
    const method =
        normalizeString(
            context?.request?.method
        ).toUpperCase();

    if (
        method === "GET"
    ) {
        return onRequestGet(
            context
        );
    }

    return jsonResponse(
        {
            success:
                false,

            authorized:
                false,

            error:
                "METHOD_NOT_ALLOWED"
        },
        405
    );
}