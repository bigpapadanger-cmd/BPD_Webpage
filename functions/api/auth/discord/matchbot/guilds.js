"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT GUILDS API

File:
    functions/api/auth/discord/matchbot/guilds.js

Purpose:
    Returns Discord guilds where Gaming Network MatchBot is
    installed and the authenticated BPD user's linked Discord
    account has permission to configure the guild.

Description:
    - Requires an authenticated, active BPD account.
    - Requires a verified linked Discord identity.
    - Retrieves guilds where MatchBot is installed.
    - Checks the authenticated user's current Discord
      membership in each guild.
    - Requires Administrator or Manage Guild permission.
    - Returns only guilds the user may configure.
    - Does not expose inaccessible MatchBot guilds.
    - Does not use DISCORD_AUTHZ_* configuration.

Security:
    - Discord user identity comes only from the canonical
      linked provider identity.
    - Browser-supplied Discord user IDs are never accepted.
    - MatchBot guild membership does not automatically grant
      configuration rights.
    - Guild permissions are resolved against current Discord
      role data.
    - MatchBot token is never exposed.

Route:
    GET /api/auth/discord/matchbot/guilds
========================================================= */

import {
    authorizeRequest,
    getVerifiedProvider,
    isAuthorizationError
} from "../../../../services/auth/authorization.js";

import {
    getDiscordMatchBotGuilds
} from "../../../../services/auth/providers/discord_matchbot/guilds.js";

import {
    findDiscordMatchBotGuildMember
} from "../../../../services/auth/providers/discord_matchbot/members.js";

import {
    canManageDiscordGuild
} from "../../../../services/auth/providers/discord_matchbot/permissions.js";

import {
    isDiscordMatchBotError
} from "../../../../services/auth/providers/discord_matchbot/client.js";

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

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}

/* =========================================================
AUTHORIZATION ERROR RESPONSE
========================================================= */

function authorizationErrorResponse(
    error,
    debugId
) {
    if (
        error?.code ===
        "AUTH_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "AUTH_REQUIRED",

                message:
                    "You must be signed in to view MatchBot servers.",

                debugId
            },
            401
        );
    }

    if (
        error?.code ===
        "ACCOUNT_INACTIVE"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "ACCOUNT_INACTIVE",

                message:
                    "This BPD account is not active.",

                debugId
            },
            403
        );
    }

    if (
        error?.code ===
        "PROVIDER_REQUIRED"
        || error?.code ===
        "DISCORD_PROVIDER_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "DISCORD_PROVIDER_REQUIRED",

                message:
                    "A linked Discord account is required to configure MatchBot.",

                debugId
            },
            403
        );
    }

    return jsonResponse(
        {
            success:
                false,

            code:
                error?.code
                || "AUTHORIZATION_FAILED",

            message:
                "Your account could not be authorized for MatchBot.",

            debugId
        },
        Number.isInteger(
            error?.status
        )
            ? error.status
            : 403
    );
}

/* =========================================================
MATCHBOT ERROR RESPONSE
========================================================= */

function matchBotErrorResponse(
    error,
    debugId
) {
    return jsonResponse(
        {
            success:
                false,

            code:
                error?.code
                || "MATCHBOT_GUILD_LOOKUP_FAILED",

            message:
                error?.status === 429
                    ? "Discord temporarily rate limited the request."
                    : "MatchBot guild information is currently unavailable.",

            debugId
        },
        Number.isInteger(
            error?.status
        )
            ? error.status
            : 503
    );
}

/* =========================================================
GET VERIFIED DISCORD USER
========================================================= */

function requireLinkedDiscordUserId(
    authorization
) {
    const provider =
        getVerifiedProvider(
            authorization,
            "discord"
        );

    const discordUserId =
        normalizeString(
            provider?.subject
        );

    if (
        !discordUserId
    ) {
        const error =
            new Error(
                "A linked Discord account is required."
            );

        error.name =
            "AuthorizationError";

        error.code =
            "DISCORD_PROVIDER_REQUIRED";

        error.status =
            403;

        throw error;
    }

    return discordUserId;
}

/* =========================================================
NORMALIZE GUILD RESPONSE
========================================================= */

function createGuildResponse(
    guild,
    member
) {
    return {
        id:
            guild.id,

        name:
            guild.name,

        icon:
            guild.icon,

        description:
            guild.description,

        preferredLocale:
            guild.preferredLocale,

        memberCount:
            guild.memberCount,

        permissions:
            member.permissions,

        isGuildOwner:
            member.isGuildOwner ===
            true,

        isAdministrator:
            member.isAdministrator ===
            true,

        canManage:
            true
    };
}

/* =========================================================
GET
========================================================= */

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } =
        context;

    const debugId =
        crypto.randomUUID();

    try {
        /* =================================================
        CANONICAL BPD + DISCORD AUTHENTICATION
        ================================================= */

        let authorization;

        try {
            authorization =
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
        }
        catch (
            error
        ) {
            if (
                isAuthorizationError(
                    error
                )
            ) {
                return authorizationErrorResponse(
                    error,
                    debugId
                );
            }

            throw error;
        }

        const discordUserId =
            requireLinkedDiscordUserId(
                authorization
            );

        /* =================================================
        MATCHBOT GUILDS
        ================================================= */

        const installedGuilds =
            await getDiscordMatchBotGuilds(
                env
            );

        const configurableGuilds = [];

        /*
         * Evaluate each installed guild independently.
         *
         * A missing member is normal and does not fail the
         * entire request.
         *
         * Infrastructure failures still fail closed.
         */
        for (
            const guild
            of installedGuilds
        ) {
            let member;

            try {
                member =
                    await findDiscordMatchBotGuildMember(
                        env,
                        guild.id,
                        discordUserId
                    );
            }
            catch (
                error
            ) {
                if (
                    isDiscordMatchBotError(
                        error
                    )
                ) {
                    throw error;
                }

                throw error;
            }

            if (
                !member
            ) {
                continue;
            }

            if (
                !canManageDiscordGuild(
                    member.permissions
                )
            ) {
                continue;
            }

            configurableGuilds.push(
                createGuildResponse(
                    guild,
                    member
                )
            );
        }

        configurableGuilds.sort(
            (
                a,
                b
            ) =>
                a.name.localeCompare(
                    b.name
                )
        );

        return jsonResponse(
            {
                success:
                    true,

                guilds:
                    configurableGuilds,

                count:
                    configurableGuilds.length
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT GUILDS API: Request failed.",
            {
                debugId,

                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            isAuthorizationError(
                error
            )
        ) {
            return authorizationErrorResponse(
                error,
                debugId
            );
        }

        if (
            isDiscordMatchBotError(
                error
            )
        ) {
            return matchBotErrorResponse(
                error,
                debugId
            );
        }

        return jsonResponse(
            {
                success:
                    false,

                code:
                    "MATCHBOT_GUILDS_FAILED",

                message:
                    "MatchBot server information could not be loaded.",

                debugId
            },
            500
        );
    }
}

/* =========================================================
OTHER METHODS
========================================================= */

export function onRequestPost() {
    return jsonResponse(
        {
            success:
                false,

            code:
                "METHOD_NOT_ALLOWED"
        },
        405
    );
}

export function onRequestPut() {
    return onRequestPost();
}

export function onRequestPatch() {
    return onRequestPost();
}

export function onRequestDelete() {
    return onRequestPost();
}