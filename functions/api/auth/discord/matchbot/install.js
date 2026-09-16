"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT INSTALL API

File:
    functions/api/auth/discord/matchbot/install.js

Purpose:
    Provides the Gaming Network MatchBot installation URL to
    an authenticated BPD account.

Description:
    - Requires an authenticated, active BPD account.
    - Does not require the user's Discord account to already
      be linked.
    - Reports whether the authenticated BPD account currently
      has a verified Discord identity.
    - Returns the configured Discord MatchBot installation
      URL.
    - Allows the frontend to display a warning when Discord
      is not linked.
    - Does not expose MatchBot credentials.
    - Does not install the bot directly.
    - Does not perform guild authorization.

Security:
    - The MatchBot token and OAuth secret are never returned.
    - DISCORD_MATCHBOT_INSTALL_URL is treated as public
      configuration.
    - Account/Discord state comes from authoritative server
      authorization.
    - Browser-supplied account or Discord IDs are ignored.

Environment:
    DISCORD_MATCHBOT_INSTALL_URL

Route:
    GET /api/auth/discord/matchbot/install
========================================================= */

import {
    authorizeRequest,
    getVerifiedProvider,
    isAuthorizationError
} from "../../../../services/auth/authorization.js";

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

function getInstallUrl(
    env
) {
    const configured =
        normalizeString(
            env?.DISCORD_MATCHBOT_INSTALL_URL
        );

    if (
        !configured
    ) {
        throw new Error(
            "DISCORD_MATCHBOT_INSTALL_URL_MISSING"
        );
    }

    let url;

    try {
        url =
            new URL(
                configured
            );
    }
    catch {
        throw new Error(
            "DISCORD_MATCHBOT_INSTALL_URL_INVALID"
        );
    }

    if (
        url.protocol !== "https:"
        || url.hostname !== "discord.com"
    ) {
        throw new Error(
            "DISCORD_MATCHBOT_INSTALL_URL_INVALID"
        );
    }

    return url.href;
}

/* =========================================================
AUTHORIZATION ERROR
========================================================= */

function authorizationErrorResponse(
    error
) {
    if (
        error?.code === "AUTH_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "AUTH_REQUIRED",

                message:
                    "You must be signed in to configure Gaming Network MatchBot."
            },
            401
        );
    }

    if (
        error?.code === "ACCOUNT_INACTIVE"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "ACCOUNT_INACTIVE",

                message:
                    "This BPD account is not active."
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
                "Your BPD account could not be authorized."
        },
        Number.isInteger(
            error?.status
        )
            ? error.status
            : 403
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

    const debugId =
        crypto.randomUUID();

    try {
        let authorization;

        try {
            authorization =
                await authorizeRequest(
                    request,
                    env,
                    {
                        account:
                            true
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
                    error
                );
            }

            throw error;
        }

        /* -------------------------------------------------
        LINKED DISCORD STATE

        Discord linking is optional for installation.

        A linked Discord identity is still strongly
        recommended because personalized MatchBot features
        depend on knowing which Discord user corresponds to
        the BPD account.
        ------------------------------------------------- */

        const discordProvider =
            getVerifiedProvider(
                authorization,
                "discord"
            );

        const discordLinked =
            Boolean(
                discordProvider
                && normalizeString(
                    discordProvider.subject
                )
            );

        const installUrl =
            getInstallUrl(
                env
            );

        return jsonResponse(
            {
                success:
                    true,

                matchBot: {
                    installUrl,

                    discordLinked,

                    limitedWithoutDiscord:
                        discordLinked !== true
                },

                warning:
                    discordLinked
                        ? null
                        : "Your Discord account is not linked to your BPD Gaming Network profile. You may install MatchBot, but personalized match alerts and account-aware features will be limited until Discord is linked."
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT INSTALL API: Request failed.",
            {
                debugId,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        let code =
            "MATCHBOT_INSTALL_CONFIGURATION_FAILED";

        if (
            error?.message ===
            "DISCORD_MATCHBOT_INSTALL_URL_MISSING"
        ) {
            code =
                "MATCHBOT_INSTALL_URL_MISSING";
        }
        else if (
            error?.message ===
            "DISCORD_MATCHBOT_INSTALL_URL_INVALID"
        ) {
            code =
                "MATCHBOT_INSTALL_URL_INVALID";
        }

        return jsonResponse(
            {
                success:
                    false,

                code,

                message:
                    "Gaming Network MatchBot installation is currently unavailable.",

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