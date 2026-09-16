"use strict";

/* =========================================================
BPD GAMING NETWORK
DISCORD MATCHBOT INTERACTION SERVICE

File:
    functions/services/auth/providers/discord_matchbot/interactions.js

Purpose:
    Verifies, parses, normalizes, and dispatches inbound
    Discord interactions for Gaming Network MatchBot.

Responsibilities:
    - Verify Discord Ed25519 request signatures.
    - Parse signed interaction payloads.
    - Normalize Discord interaction data.
    - Respond to Discord PING verification.
    - Route:
        application commands
        message components
        autocomplete
        modal submissions
    - Generate Discord interaction response payloads.

Does NOT:
    - Read HTTP request bodies.
    - Return Cloudflare Response objects.
    - Require BPD browser sessions.
    - Use DISCORD_AUTHZ_* configuration.

Environment:
    DISCORD_MATCHBOT_PUBLIC_KEY

Security:
    - Interaction payloads are not trusted until their
      Discord signature has been verified.
    - Browser cookies are irrelevant to this service.
    - @everyone/@here parsing is disabled in generated
      message responses.
========================================================= */

/* =========================================================
INTERACTION TYPES
========================================================= */

export const DISCORD_INTERACTION_TYPE =
    Object.freeze({
        PING:
            1,

        APPLICATION_COMMAND:
            2,

        MESSAGE_COMPONENT:
            3,

        APPLICATION_COMMAND_AUTOCOMPLETE:
            4,

        MODAL_SUBMIT:
            5
    });

/* =========================================================
RESPONSE TYPES
========================================================= */

export const DISCORD_INTERACTION_RESPONSE_TYPE =
    Object.freeze({
        PONG:
            1,

        CHANNEL_MESSAGE_WITH_SOURCE:
            4,

        DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE:
            5,

        DEFERRED_UPDATE_MESSAGE:
            6,

        UPDATE_MESSAGE:
            7,

        APPLICATION_COMMAND_AUTOCOMPLETE_RESULT:
            8,

        MODAL:
            9
    });

/* =========================================================
MESSAGE FLAGS
========================================================= */

export const DISCORD_MESSAGE_FLAG_EPHEMERAL =
    1 << 6;

/* =========================================================
ERROR
========================================================= */

export class DiscordMatchBotInteractionError extends Error {
    constructor(
        message,
        {
            code =
                "DISCORD_MATCHBOT_INTERACTION_ERROR",

            status =
                500,

            cause =
                null
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "DiscordMatchBotInteractionError";

        this.code =
            code;

        this.status =
            status;

        if (
            cause
        ) {
            this.cause =
                cause;
        }
    }
}

export function isDiscordMatchBotInteractionError(
    error
) {
    return (
        error instanceof
            DiscordMatchBotInteractionError
        || error?.name ===
            "DiscordMatchBotInteractionError"
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

/* =========================================================
HEX
========================================================= */

function hexToUint8Array(
    value
) {
    const normalized =
        normalizeString(
            value
        ).toLowerCase();

    if (
        !normalized
        || normalized.length % 2 !== 0
        || !/^[0-9a-f]+$/u.test(
            normalized
        )
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction cryptographic data is invalid.",
            {
                code:
                    "DISCORD_INTERACTION_HEX_INVALID",

                status:
                    401
            }
        );
    }

    const bytes =
        new Uint8Array(
            normalized.length / 2
        );

    for (
        let index = 0;
        index < normalized.length;
        index += 2
    ) {
        bytes[index / 2] =
            Number.parseInt(
                normalized.slice(
                    index,
                    index + 2
                ),
                16
            );
    }

    return bytes;
}

/* =========================================================
PUBLIC KEY
========================================================= */

function getDiscordPublicKey(
    env
) {
    const configured =
        normalizeString(
            env?.DISCORD_MATCHBOT_PUBLIC_KEY
        );

    if (
        !configured
    ) {
        throw new DiscordMatchBotInteractionError(
            "Gaming Network MatchBot interaction public key is not configured.",
            {
                code:
                    "DISCORD_MATCHBOT_PUBLIC_KEY_MISSING",

                status:
                    503
            }
        );
    }

    let publicKey;

    try {
        publicKey =
            hexToUint8Array(
                configured
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
            throw new DiscordMatchBotInteractionError(
                "Gaming Network MatchBot interaction public key is invalid.",
                {
                    code:
                        "DISCORD_MATCHBOT_PUBLIC_KEY_INVALID",

                    status:
                        503,

                    cause:
                        error
                }
            );
        }

        throw error;
    }

    if (
        publicKey.byteLength !== 32
    ) {
        throw new DiscordMatchBotInteractionError(
            "Gaming Network MatchBot interaction public key is invalid.",
            {
                code:
                    "DISCORD_MATCHBOT_PUBLIC_KEY_INVALID",

                status:
                    503
            }
        );
    }

    return publicKey;
}

/* =========================================================
SIGNATURE VERIFICATION

Discord signs:
    X-Signature-Timestamp + raw request body

using Ed25519.

The raw body must be identical to the body Discord sent.
========================================================= */

export async function verifyDiscordMatchBotInteraction(
    request,
    env,
    rawBody
) {
    if (
        !(request instanceof Request)
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction request is invalid.",
            {
                code:
                    "DISCORD_INTERACTION_REQUEST_INVALID",

                status:
                    400
            }
        );
    }

    if (
        typeof rawBody !== "string"
        || !rawBody
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction body is required.",
            {
                code:
                    "DISCORD_INTERACTION_BODY_REQUIRED",

                status:
                    400
            }
        );
    }

    const signatureHex =
        normalizeString(
            request.headers.get(
                "X-Signature-Ed25519"
            )
        );

    const timestamp =
        normalizeString(
            request.headers.get(
                "X-Signature-Timestamp"
            )
        );

    if (
        !signatureHex
        || !timestamp
    ) {
        return false;
    }

    let signature;

    try {
        signature =
            hexToUint8Array(
                signatureHex
            );
    }
    catch {
        return false;
    }

    if (
        signature.byteLength !== 64
    ) {
        return false;
    }

    const publicKeyBytes =
        getDiscordPublicKey(
            env
        );

    const encoder =
        new TextEncoder();

    const signedMessage =
        encoder.encode(
            `${timestamp}${rawBody}`
        );

    try {
        const publicKey =
            await crypto.subtle.importKey(
                "raw",
                publicKeyBytes,
                {
                    name:
                        "Ed25519"
                },
                false,
                [
                    "verify"
                ]
            );

        return await crypto.subtle.verify(
            {
                name:
                    "Ed25519"
            },
            publicKey,
            signature,
            signedMessage
        );
    }
    catch (
        error
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction signature verification failed.",
            {
                code:
                    "DISCORD_INTERACTION_SIGNATURE_CHECK_FAILED",

                status:
                    503,

                cause:
                    error
            }
        );
    }
}

/* =========================================================
INTERACTION NORMALIZATION
========================================================= */

export function normalizeDiscordMatchBotInteraction(
    value
) {
    if (
        !value
        || typeof value !== "object"
        || Array.isArray(
            value
        )
    ) {
        return null;
    }

    const type =
        Number(
            value.type
        );

    if (
        !Number.isInteger(
            type
        )
    ) {
        return null;
    }

    const directUser =
        value.user
        && typeof value.user === "object"
        && !Array.isArray(
            value.user
        )
            ? value.user
            : null;

    const memberUser =
        value.member?.user
        && typeof value.member.user === "object"
        && !Array.isArray(
            value.member.user
        )
            ? value.member.user
            : null;

    return {
        raw:
            value,

        id:
            normalizeString(
                value.id
            )
            || null,

        applicationId:
            normalizeString(
                value.application_id
            )
            || null,

        type,

        guildId:
            normalizeString(
                value.guild_id
            )
            || null,

        channelId:
            normalizeString(
                value.channel_id
            )
            || null,

        token:
            normalizeString(
                value.token
            )
            || null,

        version:
            Number.isInteger(
                value.version
            )
                ? value.version
                : null,

        data:
            value.data
            && typeof value.data === "object"
            && !Array.isArray(
                value.data
            )
                ? value.data
                : null,

        member:
            value.member
            && typeof value.member === "object"
            && !Array.isArray(
                value.member
            )
                ? value.member
                : null,

        user:
            directUser
            || memberUser
            || null
    };
}

/* =========================================================
PARSE SIGNED PAYLOAD
========================================================= */

export function parseDiscordMatchBotInteraction(
    rawBody
) {
    let payload;

    try {
        payload =
            JSON.parse(
                rawBody
            );
    }
    catch (
        error
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction JSON is invalid.",
            {
                code:
                    "DISCORD_INTERACTION_JSON_INVALID",

                status:
                    400,

                cause:
                    error
            }
        );
    }

    const interaction =
        normalizeDiscordMatchBotInteraction(
            payload
        );

    if (
        !interaction
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction payload is invalid.",
            {
                code:
                    "DISCORD_INTERACTION_INVALID",

                status:
                    400
            }
        );
    }

    return interaction;
}

/* =========================================================
RESPONSE HELPERS
========================================================= */

export function createDiscordMatchBotEphemeralMessage(
    content
) {
    return {
        type:
            DISCORD_INTERACTION_RESPONSE_TYPE
                .CHANNEL_MESSAGE_WITH_SOURCE,

        data: {
            content:
                normalizeString(
                    content
                )
                || "Gaming Network MatchBot received the interaction.",

            flags:
                DISCORD_MESSAGE_FLAG_EPHEMERAL,

            allowed_mentions: {
                parse:
                    []
            }
        }
    };
}

export function createDiscordMatchBotPong() {
    return {
        type:
            DISCORD_INTERACTION_RESPONSE_TYPE.PONG
    };
}

export function createDiscordMatchBotAutocompleteResponse(
    choices = []
) {
    return {
        type:
            DISCORD_INTERACTION_RESPONSE_TYPE
                .APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,

        data: {
            choices:
                Array.isArray(
                    choices
                )
                    ? choices
                    : []
        }
    };
}

/* =========================================================
APPLICATION COMMAND
========================================================= */

async function handleApplicationCommand(
    interaction
) {
    const commandName =
        normalizeString(
            interaction.data?.name
        ).toLowerCase();

    console.log(
        "MATCHBOT INTERACTIONS: Application command received.",
        {
            commandName:
                commandName
                || null,

            guildId:
                interaction.guildId,

            channelId:
                interaction.channelId,

            userId:
                normalizeString(
                    interaction.user?.id
                )
                || null
        }
    );

    /*
     * Future command dispatch belongs here or in:
     *
     * discord_matchbot/interactions/commands/
     *
     * Example:
     *     matchbot.js
     *     status.js
     *     next.js
     *     alerts.js
     */

    return createDiscordMatchBotEphemeralMessage(
        commandName
            ? `The /${commandName} command is not configured yet.`
            : "This MatchBot command is not configured yet."
    );
}

/* =========================================================
MESSAGE COMPONENT
========================================================= */

async function handleMessageComponent(
    interaction
) {
    const customId =
        normalizeString(
            interaction.data?.custom_id
        );

    console.log(
        "MATCHBOT INTERACTIONS: Component received.",
        {
            customId:
                customId
                || null,

            guildId:
                interaction.guildId,

            userId:
                normalizeString(
                    interaction.user?.id
                )
                || null
        }
    );

    /*
     * Future component dispatch belongs under:
     *
     * discord_matchbot/interactions/components/
     */

    return createDiscordMatchBotEphemeralMessage(
        "This MatchBot action is not configured yet."
    );
}

/* =========================================================
AUTOCOMPLETE
========================================================= */

async function handleAutocomplete() {
    return createDiscordMatchBotAutocompleteResponse(
        []
    );
}

/* =========================================================
MODAL SUBMISSION
========================================================= */

async function handleModalSubmit(
    interaction
) {
    const customId =
        normalizeString(
            interaction.data?.custom_id
        );

    console.log(
        "MATCHBOT INTERACTIONS: Modal submitted.",
        {
            customId:
                customId
                || null,

            guildId:
                interaction.guildId,

            userId:
                normalizeString(
                    interaction.user?.id
                )
                || null
        }
    );

    /*
     * Future modal dispatch belongs under:
     *
     * discord_matchbot/interactions/modals/
     */

    return createDiscordMatchBotEphemeralMessage(
        "This MatchBot form is not configured yet."
    );
}

/* =========================================================
INTERACTION DISPATCH
========================================================= */

export async function handleDiscordMatchBotInteraction(
    interaction
) {
    switch (
        interaction.type
    ) {
        case DISCORD_INTERACTION_TYPE.PING:
            return createDiscordMatchBotPong();

        case DISCORD_INTERACTION_TYPE.APPLICATION_COMMAND:
            return handleApplicationCommand(
                interaction
            );

        case DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT:
            return handleMessageComponent(
                interaction
            );

        case DISCORD_INTERACTION_TYPE
            .APPLICATION_COMMAND_AUTOCOMPLETE:
            return handleAutocomplete(
                interaction
            );

        case DISCORD_INTERACTION_TYPE.MODAL_SUBMIT:
            return handleModalSubmit(
                interaction
            );

        default:
            return createDiscordMatchBotEphemeralMessage(
                "This Discord interaction type is not supported by MatchBot."
            );
    }
}

/* =========================================================
PROCESS SIGNED INTERACTION

Primary entry point for the API layer.
========================================================= */

export async function processDiscordMatchBotInteraction(
    request,
    env,
    rawBody
) {
    const verified =
        await verifyDiscordMatchBotInteraction(
            request,
            env,
            rawBody
        );

    if (
        !verified
    ) {
        throw new DiscordMatchBotInteractionError(
            "Discord interaction signature is invalid.",
            {
                code:
                    "DISCORD_INTERACTION_SIGNATURE_INVALID",

                status:
                    401
            }
        );
    }

    /*
     * Parsing happens only after Discord's signature has
     * been verified.
     */
    const interaction =
        parseDiscordMatchBotInteraction(
            rawBody
        );

    const response =
        await handleDiscordMatchBotInteraction(
            interaction
        );

    return {
        interaction,

        response
    };
}