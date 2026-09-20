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
    one current Admin responsibility role before allowing
    access to any Admin page.

Description:
    - Verifies Discord-backed Admin access.
    - Reads current responsibility roles from live Discord
      guild membership.
    - Synchronizes Discord responsibility roles into
      identity.account_roles.
    - Requires at least one active Admin responsibility role.
    - Returns authoritative Admin operation permissions.
    - Returns verified Discord staff state.
    - Returns synchronized Admin responsibility roles.
    - Denies all Admin access when no responsibility role
      is currently assigned.

Access Requirements:
    A user may access the Admin area only when:

    1. The user has an authenticated BPD account.
    2. The BPD account has an associated Discord identity.
    3. The Discord account currently satisfies the
       Discord-backed Admin staff authorization policy.
    4. The Discord account currently has at least one
       responsibility role mapped to:
           owner
           database
           security
           ui
    5. The current Discord responsibility-role state has
       been synchronized into identity.account_roles.

Security:
    - Discord identity is resolved server-side.
    - Discord guild roles are verified server-side.
    - Responsibility roles originate from the live,
      server-verified Discord guild member.
    - identity.account_roles is synchronized server-side.
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

import {
    syncDiscordResponsibilityRoles
} from "../../../services/auth/providers/discord/role_sync.js";

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
    status = 200,
    extraHeaders = null
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,

            headers: {
                ...JSON_HEADERS,

                ...(
                    extraHeaders
                    && typeof extraHeaders ===
                        "object"
                        ? extraHeaders
                        : {}
                )
            }
        }
    );
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
                        )
                            .toLowerCase()
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
    authorized:true means all required authorization layers
    have succeeded:

    - BPD account authorization
    - Discord provider authorization
    - live Discord guild authorization
    - Discord staff authorization
    - responsibility-role synchronization
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

        This resolves:
            authenticated BPD account
            verified Discord identity
            live Discord guild member
            current Discord role IDs
            staff authorization
            current responsibilityRoles
        ------------------------------------------------- */

        const authorization =
            await authorizeAdminContext(
                request,
                env
            );

        /* -------------------------------------------------
        SYNCHRONIZE RESPONSIBILITY ROLES

        Discord is authoritative for the four Admin
        responsibility roles.

        This occurs BEFORE reading identity.account_roles so
        newly granted roles are immediately available and
        removed roles are immediately revoked.

        No browser-supplied role information is involved.
        ------------------------------------------------- */

        const synchronizedRoleContext =
            await syncDiscordResponsibilityRoles(
                env,
                authorization
            );

        const synchronizedRoles =
            normalizeResponsibilityRoles(
                synchronizedRoleContext?.roles
            );

        /* -------------------------------------------------
        FAIL CLOSED AFTER SYNCHRONIZATION

        A successful Discord staff authorization alone does
        not grant access to /Admin.

        At least one current responsibility role is also
        required.
        ------------------------------------------------- */

        if (
            synchronizedRoles.length ===
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
        CANONICAL RESPONSIBILITY ROLE AUTHORIZATION

        The synchronized role state has now been persisted.

        Read it through the normal Taskboard role service so
        the same canonical responsibility-role source is
        used throughout the rest of the Admin system.
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
        FINAL FAIL-CLOSED CHECK

        The synchronization result and canonical database
        role lookup must both produce valid membership.
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
        SYNCHRONIZATION CONSISTENCY CHECK

        The canonical responsibility-role lookup must match
        the role state produced by the Discord synchronization
        performed during this request.

        A mismatch indicates that authoritative Discord state
        and persisted responsibility state could not be
        confirmed consistently.

        Fail closed rather than authorizing against stale or
        partially synchronized role state.
        ------------------------------------------------- */

        const synchronizedRoleKey =
            [
                ...synchronizedRoles
            ]
                .sort()
                .join(
                    "|"
                );

        const responsibilityRoleKey =
            [
                ...responsibilityRoles
            ]
                .sort()
                .join(
                    "|"
                );

        if (
            synchronizedRoleKey !==
            responsibilityRoleKey
        ) {
            console.error(
                "[ADMIN ACCESS API] Responsibility role synchronization mismatch.",
                {
                    accountId:
                        authorization?.accountId
                        ?? null,

                    synchronizedRoles,

                    responsibilityRoles
                }
            );

            return jsonResponse(
                {
                    success:
                        false,

                    authorized:
                        false,

                    error:
                        "ADMIN_ACCESS_CHECK_FAILED"
                },
                503
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
                            ? [
                                ...authorization
                                    .admin
                                    .permissions
                            ]
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
        )
            .toUpperCase();

    if (
        method ===
        "GET"
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
        405,
        {
            "Allow":
                "GET"
        }
    );
}