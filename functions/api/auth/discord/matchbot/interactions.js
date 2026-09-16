"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT INTERACTIONS API

File:
    functions/api/auth/discord/matchbot/interactions.js

Purpose:
    HTTP entry point for inbound Discord interactions.

Responsibilities:
    - Accept Discord POST requests.
    - Enforce request-body size limits.
    - Preserve and read the raw request body exactly once.
    - Pass signed requests to the MatchBot interaction
      service.
    - Convert service results/errors into HTTP responses.

Service:
    functions/services/auth/providers/discord_matchbot/
    interactions.js

Discord Endpoint:
    POST
    /api/auth/discord/matchbot/interactions

Discord Developer Portal:
    https://bpd-gaming-network.com/api/auth/discord/matchbot/interactions

Security:
    - Does not use BPD browser session authentication.
    - Discord request signatures are verified by the service.
    - Browser cookies are ignored.
========================================================= */

import {
    isDiscordMatchBotInteractionError,
    processDiscordMatchBotInteraction
} from "../../../../services/auth/providers/discord_matchbot/interactions.js";

/* =========================================================
LIMITS
========================================================= */

const MAX_INTERACTION_BODY_LENGTH =
    1024 * 1024;

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
POST
========================================================= */

export async function onRequestPost(
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
        CONTENT LENGTH GUARD
        ================================================= */

        const contentLengthHeader =
            request.headers.get(
                "content-length"
            );

        if (
            contentLengthHeader
        ) {
            const contentLength =
                Number(
                    contentLengthHeader
                );

            if (
                Number.isFinite(
                    contentLength
                )
                && contentLength >
                    MAX_INTERACTION_BODY_LENGTH
            ) {
                return jsonResponse(
                    {
                        success:
                            false,

                        code:
                            "INTERACTION_BODY_TOO_LARGE"
                    },
                    413
                );
            }
        }

        /* =================================================
        RAW BODY

        Discord signature verification requires the exact
        unmodified request body.

        Do not call request.json() before this point.
        ================================================= */

        const rawBody =
            await request.text();

        if (
            !rawBody
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "INTERACTION_BODY_REQUIRED"
                },
                400
            );
        }

        /*
         * Character count is not a perfect byte count, but
         * the Content-Length guard above handles normal
         * Discord requests. This provides an additional
         * defensive bound when Content-Length is absent.
         */
        if (
            rawBody.length >
            MAX_INTERACTION_BODY_LENGTH
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "INTERACTION_BODY_TOO_LARGE"
                },
                413
            );
        }

        /* =================================================
        VERIFY + DISPATCH
        ================================================= */

        const result =
            await processDiscordMatchBotInteraction(
                request,
                env,
                rawBody
            );

        return jsonResponse(
            result.response
        );
    }
    catch (
        error
    ) {
        if (
            isDiscordMatchBotInteractionError(
                error
            )
        ) {
            if (
                error.status >= 500
            ) {
                console.error(
                    "MATCHBOT INTERACTIONS API: Service failure.",
                    {
                        debugId,

                        code:
                            error.code,

                        status:
                            error.status,

                        message:
                            error.message
                    }
                );
            }
            else {
                console.warn(
                    "MATCHBOT INTERACTIONS API: Request rejected.",
                    {
                        debugId,

                        code:
                            error.code,

                        status:
                            error.status
                    }
                );
            }

            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        error.code,

                    debugId
                },
                error.status
            );
        }

        console.error(
            "MATCHBOT INTERACTIONS API: Unexpected failure.",
            {
                debugId,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return jsonResponse(
            {
                success:
                    false,

                code:
                    "MATCHBOT_INTERACTION_FAILED",

                debugId
            },
            500
        );
    }
}

/* =========================================================
OTHER METHODS
========================================================= */

function methodNotAllowed() {
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

export function onRequestGet() {
    return methodNotAllowed();
}

export function onRequestPut() {
    return methodNotAllowed();
}

export function onRequestPatch() {
    return methodNotAllowed();
}

export function onRequestDelete() {
    return methodNotAllowed();
}