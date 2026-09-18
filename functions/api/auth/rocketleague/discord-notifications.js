"use strict";

/*
=========================================================
BPD GAMING NETWORK
ROCKET LEAGUE DISCORD NOTIFICATION ELIGIBILITY

File:
    functions/api/auth/rocketleague/discord-notifications.js

Route:
    GET /api/auth/rocketleague/discord-notifications

Purpose:
    Determines whether the authenticated BPD account may use
    Discord as a Rocket League notification method.

Security:
    - Requires an authenticated active BPD account.
    - Requires a verified linked Discord identity.
    - MatchBot eligibility is checked server-side.
    - Bot tokens are never exposed.
=========================================================
*/

import {
    authorizeRequest
} from "../../../services/auth/authorization.js";

import {
    requireLinkedDiscordIdentity
} from "../../../services/auth/providers/discord/authorization.js";

import {
    getDiscordMatchBotEligibility,
    DiscordMatchBotEligibilityError
} from "../../../services/auth/providers/discord_matchbot/eligibility.js";

/*
=========================================================
JSON RESPONSE
=========================================================
*/

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

/*
=========================================================
GET
=========================================================
*/

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } =
        context;

    try {
        /*
         * Require authenticated + active canonical account.
         *
         * We intentionally do not require Discord here yet,
         * because an unlinked Discord account should return
         * a normal eligibility response rather than a generic
         * authorization failure.
         */

        const authorization =
            await authorizeRequest(
                request,
                env,
                {
                    account:
                        true
                }
            );

        const accountId =
            authorization?.accountId
            || authorization?.userId
            || authorization?.account?.id
            || null;

        if (
            !accountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_CONTEXT_MISSING",

                    message:
                        "Authenticated account context is unavailable."
                },
                500
            );
        }

        /*
         * A missing linked Discord identity is not a route
         * failure. It simply means Discord notifications
         * cannot currently be selected.
         */

        let discordIdentity =
            null;

        try {
            discordIdentity =
                await requireLinkedDiscordIdentity(
                    accountId,
                    env
                );
        }
        catch (
            error
        ) {
            return jsonResponse(
                {
                    success:
                        true,

                    discordLinked:
                        false,

                    matchBotAvailable:
                        false,

                    eligible:
                        false,

                    reason:
                        "DISCORD_NOT_LINKED",

                    installUrl:
                        String(
                            env?.DISCORD_MATCHBOT_INSTALL_URL
                            || ""
                        ).trim()
                        || null
                }
            );
        }

        const discordUserId =
            discordIdentity?.discordUserId
            || null;

        const eligibility =
            await getDiscordMatchBotEligibility(
                env,
                discordUserId
            );

        return jsonResponse(
            {
                success:
                    true,

                discordLinked:
                    true,

                matchBotAvailable:
                    eligibility
                        .matchBotAvailable,

                eligible:
                    eligibility
                        .eligible,

                reason:
                    eligibility
                        .reason,

                installUrl:
                    eligibility
                        .installUrl,

                mutualGuild:
                    eligibility
                        .mutualGuild
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE DISCORD NOTIFICATIONS: Eligibility check failed.",
            {
                name:
                    error?.name
                    || "Error",

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
            error instanceof
            DiscordMatchBotEligibilityError
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        error.code,

                    message:
                        error.message
                },
                error.status
            );
        }

        const status =
            Number.isInteger(
                error?.status
            )
                ? error.status
                : 500;

        return jsonResponse(
            {
                success:
                    false,

                code:
                    error?.code
                    || "DISCORD_NOTIFICATION_CHECK_FAILED",

                message:
                    status === 401
                        ? "Authentication is required."
                        : status === 403
                            ? "Account access is not authorized."
                            : "Discord notification availability could not be checked."
            },
            status
        );
    }
}