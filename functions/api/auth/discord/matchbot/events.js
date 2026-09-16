"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT EVENTS API

File:
    functions/api/auth/discord/matchbot/events.js

Purpose:
    Provides authorized access to Discord Scheduled Events
    created and managed through Gaming Network MatchBot.

Description:
    - Requires an authenticated, active BPD account.
    - Requires a verified linked Discord identity.
    - Requires MatchBot to be installed in the target guild.
    - Requires the linked Discord user to have:
        Administrator
        OR
        Manage Guild
    - Supports:
        GET    list scheduled events
        POST   create scheduled event
        PATCH  update event / change event status
    - Does not use DISCORD_AUTHZ_* configuration.

Route:
    GET
        /api/auth/discord/matchbot/events?guildId=...

    POST
        /api/auth/discord/matchbot/events

    PATCH
        /api/auth/discord/matchbot/events

POST JSON:
    {
        "guildId": "...",
        "name": "Rocket League Match",
        "description": "...",
        "location": "Rocket League",
        "scheduledStartTime": "2026-09-20T23:00:00Z",
        "scheduledEndTime": "2026-09-21T00:00:00Z"
    }

PATCH JSON:
    Update fields:
    {
        "guildId": "...",
        "eventId": "...",
        "action": "update",
        "name": "...",
        "description": "...",
        "location": "...",
        "scheduledStartTime": "...",
        "scheduledEndTime": "..."
    }

    Status actions:
        "start"
        "complete"
        "cancel"

Security:
    - Browser does not determine authoritative Discord user.
    - Guild-management authority is re-verified.
    - Event IDs are validated by the service layer.
    - MatchBot credentials are never exposed.
========================================================= */

import {
    isAuthorizationError
} from "../../../../services/auth/authorization.js";

import {
    authorizeDiscordMatchBotConfiguration
} from "../../../../services/auth/providers/discord_matchbot/permissions.js";

import {
    getDiscordMatchBotScheduledEvents,
    createDiscordMatchBotScheduledEvent,
    updateDiscordMatchBotScheduledEvent,
    startDiscordMatchBotScheduledEvent,
    completeDiscordMatchBotScheduledEvent,
    cancelDiscordMatchBotScheduledEvent
} from "../../../../services/auth/providers/discord_matchbot/events.js";

import {
    isDiscordMatchBotError
} from "../../../../services/auth/providers/discord_matchbot/client.js";

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
REQUEST BODY
========================================================= */

async function readJsonBody(
    request
) {
    const contentType =
        normalizeString(
            request.headers.get(
                "content-type"
            )
        ).toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        throw new Error(
            "INVALID_CONTENT_TYPE"
        );
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        throw new Error(
            "INVALID_JSON"
        );
    }

    if (
        !body
        || typeof body !== "object"
        || Array.isArray(
            body
        )
    ) {
        throw new Error(
            "INVALID_BODY"
        );
    }

    return body;
}

/* =========================================================
AUTHORIZATION ERROR
========================================================= */

function authorizationErrorResponse(
    error,
    debugId
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
                    "You must be signed in to manage MatchBot events.",

                debugId
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
                    "This BPD account is not active.",

                debugId
            },
            403
        );
    }

    if (
        error?.code === "PROVIDER_REQUIRED"
        || error?.code === "DISCORD_PROVIDER_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "DISCORD_PROVIDER_REQUIRED",

                message:
                    "A linked Discord account is required to manage MatchBot events.",

                debugId
            },
            403
        );
    }

    if (
        error?.code ===
        "DISCORD_MATCHBOT_GUILD_MANAGE_REQUIRED"
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    "DISCORD_MATCHBOT_GUILD_MANAGE_REQUIRED",

                message:
                    "You must have Manage Server or Administrator permission in this Discord server to manage MatchBot events.",

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
                "Your account could not be authorized for this MatchBot server.",

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
MATCHBOT ERROR
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
                || "MATCHBOT_EVENTS_FAILED",

            message:
                "MatchBot scheduled event processing failed.",

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
EVENT RESPONSE
========================================================= */

function createEventResponse(
    event
) {
    return {
        id:
            event.id,

        guildId:
            event.guildId,

        channelId:
            event.channelId,

        creatorId:
            event.creatorId,

        name:
            event.name,

        description:
            event.description,

        scheduledStartTime:
            event.scheduledStartTime,

        scheduledEndTime:
            event.scheduledEndTime,

        privacyLevel:
            event.privacyLevel,

        status:
            event.status,

        entityType:
            event.entityType,

        entityId:
            event.entityId,

        location:
            event.location,

        userCount:
            event.userCount,

        image:
            event.image
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
        const url =
            new URL(
                request.url
            );

        const guildId =
            normalizeString(
                url.searchParams.get(
                    "guildId"
                )
            );

        if (
            !guildId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "GUILD_ID_REQUIRED",

                    message:
                        "A Discord guild ID is required.",

                    debugId
                },
                400
            );
        }

        const authorization =
            await authorizeDiscordMatchBotConfiguration(
                request,
                env,
                guildId
            );

        const events =
            await getDiscordMatchBotScheduledEvents(
                env,
                authorization.matchBot.guild.id
            );

        return jsonResponse(
            {
                success:
                    true,

                guild: {
                    id:
                        authorization.matchBot.guild.id,

                    name:
                        authorization.matchBot.guild.name
                },

                events:
                    events.map(
                        createEventResponse
                    ),

                count:
                    events.length
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT EVENTS API GET: Request failed.",
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
                    "MATCHBOT_EVENTS_FAILED",

                message:
                    "MatchBot scheduled events could not be loaded.",

                debugId
            },
            500
        );
    }
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
        let body;

        try {
            body =
                await readJsonBody(
                    request
                );
        }
        catch (
            error
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        error?.message
                        || "INVALID_REQUEST",

                    message:
                        "A valid JSON request body is required.",

                    debugId
                },
                400
            );
        }

        const guildId =
            normalizeString(
                body.guildId
            );

        if (
            !guildId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "GUILD_ID_REQUIRED",

                    message:
                        "A Discord guild ID is required.",

                    debugId
                },
                400
            );
        }

        const authorization =
            await authorizeDiscordMatchBotConfiguration(
                request,
                env,
                guildId
            );

        const event =
            await createDiscordMatchBotScheduledEvent(
                env,
                authorization.matchBot.guild.id,
                {
                    name:
                        body.name,

                    description:
                        body.description,

                    location:
                        body.location,

                    scheduledStartTime:
                        body.scheduledStartTime,

                    scheduledEndTime:
                        body.scheduledEndTime,

                    durationMinutes:
                        body.durationMinutes
                }
            );

        return jsonResponse(
            {
                success:
                    true,

                event:
                    createEventResponse(
                        event
                    )
            },
            201
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT EVENTS API POST: Request failed.",
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
                    "MATCHBOT_EVENT_CREATE_FAILED",

                message:
                    "MatchBot could not create the scheduled event.",

                debugId
            },
            500
        );
    }
}

/* =========================================================
PATCH
========================================================= */

export async function onRequestPatch(
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
        let body;

        try {
            body =
                await readJsonBody(
                    request
                );
        }
        catch (
            error
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        error?.message
                        || "INVALID_REQUEST",

                    message:
                        "A valid JSON request body is required.",

                    debugId
                },
                400
            );
        }

        const guildId =
            normalizeString(
                body.guildId
            );

        const eventId =
            normalizeString(
                body.eventId
            );

        const action =
            normalizeString(
                body.action
            )
                .toLowerCase();

        if (
            !guildId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "GUILD_ID_REQUIRED",

                    message:
                        "A Discord guild ID is required.",

                    debugId
                },
                400
            );
        }

        if (
            !eventId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "EVENT_ID_REQUIRED",

                    message:
                        "A Discord scheduled event ID is required.",

                    debugId
                },
                400
            );
        }

        if (
            !action
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "EVENT_ACTION_REQUIRED",

                    message:
                        "An event action is required.",

                    debugId
                },
                400
            );
        }

        const authorization =
            await authorizeDiscordMatchBotConfiguration(
                request,
                env,
                guildId
            );

        let event;

        switch (
            action
        ) {
            case "update":
                event =
                    await updateDiscordMatchBotScheduledEvent(
                        env,
                        authorization.matchBot.guild.id,
                        eventId,
                        {
                            name:
                                body.name,

                            description:
                                body.description,

                            location:
                                body.location,

                            scheduledStartTime:
                                body.scheduledStartTime,

                            scheduledEndTime:
                                body.scheduledEndTime
                        }
                    );

                break;

            case "start":
                event =
                    await startDiscordMatchBotScheduledEvent(
                        env,
                        authorization.matchBot.guild.id,
                        eventId
                    );

                break;

            case "complete":
                event =
                    await completeDiscordMatchBotScheduledEvent(
                        env,
                        authorization.matchBot.guild.id,
                        eventId
                    );

                break;

            case "cancel":
                event =
                    await cancelDiscordMatchBotScheduledEvent(
                        env,
                        authorization.matchBot.guild.id,
                        eventId
                    );

                break;

            default:
                return jsonResponse(
                    {
                        success:
                            false,

                        code:
                            "EVENT_ACTION_INVALID",

                        message:
                            "The scheduled event action is invalid.",

                        debugId
                    },
                    400
                );
        }

        return jsonResponse(
            {
                success:
                    true,

                event:
                    createEventResponse(
                        event
                    )
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "MATCHBOT EVENTS API PATCH: Request failed.",
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
                    "MATCHBOT_EVENT_UPDATE_FAILED",

                message:
                    "MatchBot could not update the scheduled event.",

                debugId
            },
            500
        );
    }
}

/* =========================================================
UNSUPPORTED METHODS
========================================================= */

export function onRequestPut() {
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

export function onRequestDelete() {
    return onRequestPut();
}