"use strict";

/* =========================================================
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
    - Discord identity is resolved through server-side
      authorization.
    - MatchBot eligibility is checked server-side.
    - Bot tokens are never exposed.
    - A missing Discord link is returned as normal eligibility
      state rather than an API authorization failure.
========================================================= */

import {
    authorizeRequest,
    isAuthorizationError
} from "../../../services/auth/authorization.js";

import {
    getDiscordMatchBotEligibility
} from "../../../services/auth/providers/discord_matchbot/eligibility.js";

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return String(
        value
        ?? ""
    )
        .trim();
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
INSTALL URL
========================================================= */

function getMatchBotInstallUrl(
    env,
    eligibility = null
) {
    return (
        normalizeString(
            eligibility?.installUrl
        )
        || normalizeString(
            env?.DISCORD_MATCHBOT_INSTALL_URL
        )
        || null
    );
}

/* =========================================================
UNLINKED DISCORD RESPONSE
========================================================= */

function discordNotLinkedResponse(
    env
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
                getMatchBotInstallUrl(
                    env
                ),

            mutualGuild:
                null
        }
    );
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

    try {
        /* =====================================================
        AUTHORIZE ACCOUNT + DISCORD PROVIDER
        ===================================================== */

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
            /*
             * No linked Discord identity is an expected
             * eligibility result rather than a route failure.
             */
            if (
                isAuthorizationError(
                    error
                )
                && (
                    error.code ===
                        "PROVIDER_REQUIRED"
                    || error.code ===
                        "ACCOUNT_IDENTITY_MISSING"
                )
            ) {
                return discordNotLinkedResponse(
                    env
                );
            }

            throw error;
        }

        /* =====================================================
        VERIFIED DISCORD IDENTITY
        ===================================================== */

        const discordUserId =
            normalizeString(
                authorization
                    ?.provider
                    ?.subject
            );

        if (
            !discordUserId
        ) {
            return discordNotLinkedResponse(
                env
            );
        }

        /* =====================================================
        MATCHBOT ELIGIBILITY
        ===================================================== */

        const eligibility =
            await getDiscordMatchBotEligibility(
                env,
                discordUserId
            );

        const eligible =
            eligibility?.eligible ===
            true;

        const matchBotAvailable =
            eligibility?.matchBotAvailable ===
            true
            || eligible;

        return jsonResponse(
            {
                success:
                    true,

                discordLinked:
                    true,

                matchBotAvailable,

                eligible,

                reason:
                    normalizeString(
                        eligibility?.reason
                    )
                    || (
                        eligible
                            ? null
                            : "MATCHBOT_REQUIRED"
                    ),

                installUrl:
                    getMatchBotInstallUrl(
                        env,
                        eligibility
                    ),

                mutualGuild:
                    eligibility?.mutualGuild
                    || null
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

        /* =====================================================
        AUTHORIZATION FAILURE
        ===================================================== */

        if (
            isAuthorizationError(
                error
            )
        ) {
            const status =
                Number.isInteger(
                    error?.status
                )
                    ? error.status
                    : (
                        error.code ===
                            "AUTH_REQUIRED"
                            ? 401
                            : 403
                    );

            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        error.code
                        || "AUTHORIZATION_FAILED",

                    message:
                        status === 401
                            ? "Authentication is required."
                            : "Account access is not authorized."
                },
                status
            );
        }

        /* =====================================================
        SERVICE FAILURE
        ===================================================== */

        const status =
            Number.isInteger(
                error?.status
            )
                && error.status >= 400
                && error.status <= 599
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
                    "Discord notification availability could not be checked."
            },
            status
        );
    }
}