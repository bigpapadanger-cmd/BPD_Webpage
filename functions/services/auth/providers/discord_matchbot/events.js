"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT SCHEDULED EVENT SERVICE

File:
    functions/services/auth/providers/discord_matchbot/events.js

Purpose:
    Creates, updates, and manages Discord Scheduled Events
    through the installable Gaming Network MatchBot.

Description:
    - Uses the centralized MatchBot REST client.
    - Supports external Discord Scheduled Events for matches.
    - Validates MatchBot access to the target guild.
    - Normalizes Discord event responses.
    - Provides helpers to create, update, cancel, complete,
      and retrieve scheduled events.
    - Does not perform Discord authentication.
    - Does not perform BPD staff authorization.
    - Does not use DISCORD_AUTHZ_* configuration.

Dependencies:
    functions/services/auth/providers/discord_matchbot/client.js
    functions/services/auth/providers/discord_matchbot/guilds.js

Required Bot Permission:
    Create Events

Future:
    If MatchBot later needs to edit events created by other
    users/apps, Manage Events may be required.

Security:
    - Guild IDs are validated before Discord API use.
    - MatchBot installation is re-verified before operations.
    - Event IDs are validated as Discord snowflakes.
    - Browser input must not directly determine authoritative
      event ownership or state transitions.
========================================================= */

import {
    DiscordMatchBotError,
    discordMatchBotGet,
    discordMatchBotPost,
    discordMatchBotPatch
} from "./client.js";

import {
    requireDiscordMatchBotGuild
} from "./guilds.js";

/* =========================================================
DISCORD EVENT CONSTANTS
========================================================= */

const DISCORD_EVENT_ENTITY_TYPE =
    Object.freeze({
        STAGE_INSTANCE:
            1,

        VOICE:
            2,

        EXTERNAL:
            3
    });

const DISCORD_EVENT_STATUS =
    Object.freeze({
        SCHEDULED:
            1,

        ACTIVE:
            2,

        COMPLETED:
            3,

        CANCELED:
            4
    });

const DEFAULT_EVENT_DURATION_MINUTES =
    60;

const MAX_EVENT_NAME_LENGTH =
    100;

const MAX_EVENT_DESCRIPTION_LENGTH =
    1000;

const MAX_EVENT_LOCATION_LENGTH =
    100;

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

function normalizeInteger(
    value
) {
    const normalized =
        Number(
            value
        );

    return Number.isInteger(
        normalized
    )
        ? normalized
        : null;
}

/* =========================================================
SNOWFLAKE
========================================================= */

function requireDiscordSnowflake(
    value,
    fieldName = "Discord ID"
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
        || !/^\d{16,22}$/u.test(
            normalized
        )
    ) {
        throw new DiscordMatchBotError(
            `${fieldName} is invalid.`,
            {
                code:
                    "DISCORD_MATCHBOT_INVALID_SNOWFLAKE",

                status:
                    400
            }
        );
    }

    return normalized;
}

/* =========================================================
DATE / TIME
========================================================= */

function requireIsoDateTime(
    value,
    fieldName
) {
    const normalized =
        normalizeString(
            value
        );

    const timestamp =
        Date.parse(
            normalized
        );

    if (
        !normalized
        || !Number.isFinite(
            timestamp
        )
    ) {
        throw new DiscordMatchBotError(
            `${fieldName} is invalid.`,
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_TIME_INVALID",

                status:
                    400
            }
        );
    }

    return new Date(
        timestamp
    ).toISOString();
}

/* =========================================================
EVENT NORMALIZATION
========================================================= */

function normalizeScheduledEvent(
    event
) {
    if (
        !event
        || typeof event !==
            "object"
        || Array.isArray(
            event
        )
    ) {
        return null;
    }

    const id =
        normalizeString(
            event.id
        );

    const guildId =
        normalizeString(
            event.guild_id
        );

    const name =
        normalizeString(
            event.name
        );

    if (
        !id
        || !guildId
        || !name
    ) {
        return null;
    }

    return {
        id,

        guildId,

        channelId:
            normalizeString(
                event.channel_id
            )
            || null,

        creatorId:
            normalizeString(
                event.creator_id
            )
            || null,

        name,

        description:
            normalizeString(
                event.description
            )
            || null,

        scheduledStartTime:
            normalizeString(
                event.scheduled_start_time
            )
            || null,

        scheduledEndTime:
            normalizeString(
                event.scheduled_end_time
            )
            || null,

        privacyLevel:
            normalizeInteger(
                event.privacy_level
            ),

        status:
            normalizeInteger(
                event.status
            ),

        entityType:
            normalizeInteger(
                event.entity_type
            ),

        entityId:
            normalizeString(
                event.entity_id
            )
            || null,

        location:
            normalizeString(
                event.entity_metadata?.location
            )
            || null,

        userCount:
            normalizeInteger(
                event.user_count
            ),

        image:
            normalizeString(
                event.image
            )
            || null
    };
}

/* =========================================================
CREATE EXTERNAL EVENT PAYLOAD
========================================================= */

function createExternalEventPayload(
    {
        name,

        description =
            null,

        location,

        scheduledStartTime,

        scheduledEndTime =
            null,

        durationMinutes =
            DEFAULT_EVENT_DURATION_MINUTES
    } = {}
) {
    const normalizedName =
        normalizeString(
            name
        );

    const normalizedDescription =
        normalizeString(
            description
        );

    const normalizedLocation =
        normalizeString(
            location
        );

    if (
        !normalizedName
        || normalizedName.length >
            MAX_EVENT_NAME_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord scheduled event name is invalid.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_NAME_INVALID",

                status:
                    400
            }
        );
    }

    if (
        normalizedDescription.length >
        MAX_EVENT_DESCRIPTION_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord scheduled event description is too long.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_DESCRIPTION_TOO_LONG",

                status:
                    400
            }
        );
    }

    if (
        !normalizedLocation
        || normalizedLocation.length >
            MAX_EVENT_LOCATION_LENGTH
    ) {
        throw new DiscordMatchBotError(
            "Discord scheduled event location is invalid.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_LOCATION_INVALID",

                status:
                    400
            }
        );
    }

    const startTime =
        requireIsoDateTime(
            scheduledStartTime,
            "Scheduled event start time"
        );

    let endTime;

    if (
        scheduledEndTime
    ) {
        endTime =
            requireIsoDateTime(
                scheduledEndTime,
                "Scheduled event end time"
            );
    }
    else {
        const duration =
            Number.isFinite(
                Number(
                    durationMinutes
                )
            )
            && Number(
                durationMinutes
            ) > 0
                ? Number(
                    durationMinutes
                )
                : DEFAULT_EVENT_DURATION_MINUTES;

        endTime =
            new Date(
                Date.parse(
                    startTime
                )
                + duration
                * 60
                * 1000
            )
                .toISOString();
    }

    if (
        Date.parse(
            endTime
        ) <= Date.parse(
            startTime
        )
    ) {
        throw new DiscordMatchBotError(
            "Discord scheduled event end time must occur after the start time.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_TIME_RANGE_INVALID",

                status:
                    400
            }
        );
    }

    const payload = {
        name:
            normalizedName,

        privacy_level:
            2,

        entity_type:
            DISCORD_EVENT_ENTITY_TYPE.EXTERNAL,

        scheduled_start_time:
            startTime,

        scheduled_end_time:
            endTime,

        entity_metadata: {
            location:
                normalizedLocation
        }
    };

    if (
        normalizedDescription
    ) {
        payload.description =
            normalizedDescription;
    }

    return payload;
}

/* =========================================================
GET GUILD EVENTS

Discord:
    GET /guilds/{guild.id}/scheduled-events
========================================================= */

export async function getDiscordMatchBotScheduledEvents(
    env,
    guildId
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/scheduled-events?with_user_count=true`
        );

    if (
        !Array.isArray(
            result
        )
    ) {
        throw new DiscordMatchBotError(
            "Discord returned an invalid scheduled event list.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_LIST_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return result
        .map(
            normalizeScheduledEvent
        )
        .filter(
            Boolean
        );
}

/* =========================================================
GET ONE EVENT
========================================================= */

export async function getDiscordMatchBotScheduledEvent(
    env,
    guildId,
    eventId
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    const normalizedEventId =
        requireDiscordSnowflake(
            eventId,
            "Discord scheduled event ID"
        );

    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const result =
        await discordMatchBotGet(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/scheduled-events/${encodeURIComponent(
                normalizedEventId
            )}?with_user_count=true`
        );

    const event =
        normalizeScheduledEvent(
            result
        );

    if (
        !event
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid scheduled event information.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return event;
}

/* =========================================================
CREATE EXTERNAL SCHEDULED EVENT

Discord:
    POST /guilds/{guild.id}/scheduled-events
========================================================= */

export async function createDiscordMatchBotScheduledEvent(
    env,
    guildId,
    options
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const payload =
        createExternalEventPayload(
            options
        );

    const result =
        await discordMatchBotPost(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/scheduled-events`,
            payload
        );

    const event =
        normalizeScheduledEvent(
            result
        );

    if (
        !event
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid scheduled event information.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_CREATE_RESPONSE_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return event;
}

/* =========================================================
UPDATE EVENT

Only explicitly supplied fields are modified.
========================================================= */

export async function updateDiscordMatchBotScheduledEvent(
    env,
    guildId,
    eventId,
    {
        name =
            undefined,

        description =
            undefined,

        location =
            undefined,

        scheduledStartTime =
            undefined,

        scheduledEndTime =
            undefined
    } = {}
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    const normalizedEventId =
        requireDiscordSnowflake(
            eventId,
            "Discord scheduled event ID"
        );

    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const payload = {};

    if (
        name !==
        undefined
    ) {
        const normalizedName =
            normalizeString(
                name
            );

        if (
            !normalizedName
            || normalizedName.length >
                MAX_EVENT_NAME_LENGTH
        ) {
            throw new DiscordMatchBotError(
                "Discord scheduled event name is invalid.",
                {
                    code:
                        "DISCORD_MATCHBOT_EVENT_NAME_INVALID",

                    status:
                        400
                }
            );
        }

        payload.name =
            normalizedName;
    }

    if (
        description !==
        undefined
    ) {
        const normalizedDescription =
            normalizeString(
                description
            );

        if (
            normalizedDescription.length >
            MAX_EVENT_DESCRIPTION_LENGTH
        ) {
            throw new DiscordMatchBotError(
                "Discord scheduled event description is too long.",
                {
                    code:
                        "DISCORD_MATCHBOT_EVENT_DESCRIPTION_TOO_LONG",

                    status:
                        400
                }
            );
        }

        payload.description =
            normalizedDescription
            || null;
    }

    if (
        location !==
        undefined
    ) {
        const normalizedLocation =
            normalizeString(
                location
            );

        if (
            !normalizedLocation
            || normalizedLocation.length >
                MAX_EVENT_LOCATION_LENGTH
        ) {
            throw new DiscordMatchBotError(
                "Discord scheduled event location is invalid.",
                {
                    code:
                        "DISCORD_MATCHBOT_EVENT_LOCATION_INVALID",

                    status:
                        400
                }
            );
        }

        payload.entity_metadata = {
            location:
                normalizedLocation
        };
    }

    if (
        scheduledStartTime !==
        undefined
    ) {
        payload.scheduled_start_time =
            requireIsoDateTime(
                scheduledStartTime,
                "Scheduled event start time"
            );
    }

    if (
        scheduledEndTime !==
        undefined
    ) {
        payload.scheduled_end_time =
            requireIsoDateTime(
                scheduledEndTime,
                "Scheduled event end time"
            );
    }

    if (
        Object.keys(
            payload
        ).length ===
        0
    ) {
        throw new DiscordMatchBotError(
            "At least one scheduled event field must be updated.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_UPDATE_EMPTY",

                status:
                    400
            }
        );
    }

    const result =
        await discordMatchBotPatch(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/scheduled-events/${encodeURIComponent(
                normalizedEventId
            )}`,
            payload
        );

    const event =
        normalizeScheduledEvent(
            result
        );

    if (
        !event
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid updated event information.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_UPDATE_RESPONSE_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return event;
}

/* =========================================================
SET EVENT STATUS
========================================================= */

async function setDiscordMatchBotScheduledEventStatus(
    env,
    guildId,
    eventId,
    status
) {
    const normalizedGuildId =
        requireDiscordSnowflake(
            guildId,
            "Discord guild ID"
        );

    const normalizedEventId =
        requireDiscordSnowflake(
            eventId,
            "Discord scheduled event ID"
        );

    await requireDiscordMatchBotGuild(
        env,
        normalizedGuildId
    );

    const result =
        await discordMatchBotPatch(
            env,
            `/guilds/${encodeURIComponent(
                normalizedGuildId
            )}/scheduled-events/${encodeURIComponent(
                normalizedEventId
            )}`,
            {
                status
            }
        );

    const event =
        normalizeScheduledEvent(
            result
        );

    if (
        !event
    ) {
        throw new DiscordMatchBotError(
            "Discord returned invalid scheduled event status information.",
            {
                code:
                    "DISCORD_MATCHBOT_EVENT_STATUS_RESPONSE_INVALID",

                status:
                    503,

                unavailable:
                    true
            }
        );
    }

    return event;
}

/* =========================================================
START EVENT
========================================================= */

export function startDiscordMatchBotScheduledEvent(
    env,
    guildId,
    eventId
) {
    return setDiscordMatchBotScheduledEventStatus(
        env,
        guildId,
        eventId,
        DISCORD_EVENT_STATUS.ACTIVE
    );
}

/* =========================================================
COMPLETE EVENT
========================================================= */

export function completeDiscordMatchBotScheduledEvent(
    env,
    guildId,
    eventId
) {
    return setDiscordMatchBotScheduledEventStatus(
        env,
        guildId,
        eventId,
        DISCORD_EVENT_STATUS.COMPLETED
    );
}

/* =========================================================
CANCEL EVENT
========================================================= */

export function cancelDiscordMatchBotScheduledEvent(
    env,
    guildId,
    eventId
) {
    return setDiscordMatchBotScheduledEventStatus(
        env,
        guildId,
        eventId,
        DISCORD_EVENT_STATUS.CANCELED
    );
}