import { authorizationErrorResponse } from "../../../services/rl/authorization.js";
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
    getDiscordMatchBotEligibility,
    logDiscordEligibilityDiagnostic
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

function isCrossSiteRequest(request) {
    const origin = normalizeString(request.headers.get("Origin"));
    return request.headers.get("Sec-Fetch-Site") === "cross-site"
        || (origin !== "" && origin !== new URL(request.url).origin);
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

            status:
                "not_linked",

            mutualGuildCount:
                0,

            countComplete:
                true,

            checkedAt:
                new Date().toISOString(),

            eligibilityLost:
                false,

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

async function handleEligibilityRequest(context, force) {
    const {
        request,
        env
    } =
        context;

    if (isCrossSiteRequest(request)) {
        return jsonResponse({ success: false, code: "CROSS_SITE_REQUEST_REJECTED", message: "This request must come from the BPD website." }, 403);
    }

    try {
        /* =====================================================
        AUTHORIZE ACCOUNT + DISCORD PROVIDER
        ===================================================== */

        // Registration eligibility is available before registration is complete,
        // but still requires current Epic authorization.
        try { await authorizeRequest(request, env, { account: true, provider: "epic" }); }
        catch (error) {
            logDiscordEligibilityDiagnostic(env, "epic_authorization", { providerResultCode: "AUTHORIZATION_FAILED" });
            return authorizationErrorResponse(error);
        }

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
            logDiscordEligibilityDiagnostic(env, "discord_authorization", {
                canonicalDiscordIdentityResolved: false,
                providerResultCode: error?.code === "PROVIDER_REQUIRED" ? "DISCORD_NOT_LINKED" : "AUTHORIZATION_FAILED"
            });
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
                authorization.accountId,
                { force }
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

                eligible:
                    typeof eligibility?.eligible === "boolean"
                    ? eligibility.eligible
                    : null,

                status:
                    normalizeString(eligibility?.status)
                    || "available",

                mutualGuildCount:
                    Number.isSafeInteger(eligibility?.mutualGuildCount)
                    ? eligibility.mutualGuildCount
                    : null,

                countComplete:
                    eligibility?.countComplete === true,

                checkedAt:
                    normalizeString(eligibility?.checkedAt)
                    || null,

                stale:
                    eligibility?.stale === true,

                retryAfterSeconds:
                    Number.isSafeInteger(eligibility?.retryAfterSeconds)
                    ? eligibility.retryAfterSeconds
                    : null,

                warningRequired:
                    eligibility?.warningRequired === true,

                snoozedUntil:
                    normalizeString(eligibility?.snoozedUntil)
                    || null,

                eligibilityLost:
                    eligibility?.eligibilityLost === true,

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

                mutualGuild: null
            }
        );
    }
    catch (
        error
    ) {
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

        return jsonResponse(
            {
                success: true,

                discordLinked: true,

                matchBotAvailable: false,

                eligible: null,

                status: "unavailable",

                mutualGuildCount: null,

                countComplete: false,

                checkedAt: null,

                stale: true,

                warningRequired: false,

                snoozedUntil: null,

                eligibilityLost: false,

                code: "DISCORD_NOTIFICATION_CHECK_FAILED",

                reason: "DISCORD_NOTIFICATION_CHECK_FAILED",

                message:
                    "Discord notification availability could not be checked.",

                installUrl:
                    getMatchBotInstallUrl(env)
            }
        );
    }
}

export async function onRequestGet(context) {
    return handleEligibilityRequest(context, false);
}

export async function onRequestPost(context) {
    const { request } = context;
    if (normalizeString(request.headers.get("Origin")) !== new URL(request.url).origin || isCrossSiteRequest(request)) {
        return jsonResponse({ success: false, code: "CROSS_SITE_REQUEST_REJECTED", message: "This request must come from the BPD website." }, 403);
    }
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > 128) {
        return jsonResponse({ success: false, code: "REQUEST_SCHEMA_INVALID", message: "The refresh request is invalid." }, 400);
    }
    let body;
    try {
        const raw = await request.text();
        if (raw.length > 128) throw new Error("body");
        body = JSON.parse(raw);
    } catch {
        return jsonResponse({ success: false, code: "REQUEST_SCHEMA_INVALID", message: "The refresh request is invalid." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        return jsonResponse({ success: false, code: "REQUEST_SCHEMA_INVALID", message: "The refresh request is invalid." }, 400);
    }
    return handleEligibilityRequest(context, true);
}
