"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD DISCORD NOTIFICATIONS

File:
    functions/services/admin/taskboard_discord.js

Purpose:
    Sends Taskboard activity summaries to Discord through
    protected Cloudflare webhook secrets.

Webhook Secrets:
    NEW_TASKBOARD_REPORT_DISCORD
        - New task notifications.

    TASKBOARD_SUMMARY_DISCORD
        - Completed task notifications.
        - Shelved task notifications.
        - Future Taskboard summary notifications.

Existing Discord Role Environment Variables:
    DISCORD_AUTHZ_OWNER_ROLE_ID
    DISCORD_AUTHZ_DATABASE_ROLE_ID
    DISCORD_AUTHZ_SECURITY_ROLE_ID
    DISCORD_AUTHZ_UI_ROLE_ID

Supported Events:
    - task created
    - task completed
    - task shelved

Responsibilities:
    - Normalize authoritative task data.
    - Build styled Discord embed payloads.
    - Include lifecycle reasons when available.
    - Select the correct Discord webhook by event type.
    - Mention the Discord roles assigned responsibility.
    - Restrict mentions to server-mapped Discord role IDs.
    - Send webhook requests server-side.
    - Normalize webhook failures.
    - Never expose webhook URLs to the browser.

Security:
    - Discord webhook URLs come only from env secrets.
    - Webhook values must never be returned to the client.
    - Discord role IDs come only from server-side env.
    - Task/account data should be authoritative server data.
    - responsible_roles are mapped through a fixed allowlist.
    - Task data can never directly supply a Discord role ID.
    - allowed_mentions explicitly permits only mapped roles.
    - This module is not an authorization boundary.
========================================================= */

/* =========================================================
WEBHOOK ENVIRONMENT NAMES
========================================================= */

const NEW_TASKBOARD_REPORT_WEBHOOK_ENV =
    "NEW_TASKBOARD_REPORT_DISCORD";

const TASKBOARD_SUMMARY_WEBHOOK_ENV =
    "TASKBOARD_SUMMARY_DISCORD";

/* =========================================================
TASKBOARD RESPONSIBILITY -> DISCORD ROLE

These reuse the existing Discord authorization role IDs.

Taskboard responsibility:
    owner
    database
    security
    ui
========================================================= */

const TASKBOARD_ROLE_ENV =
    Object.freeze({
        owner:
            "DISCORD_AUTHZ_OWNER_ROLE_ID",

        database:
            "DISCORD_AUTHZ_DATABASE_ROLE_ID",

        security:
            "DISCORD_AUTHZ_SECURITY_ROLE_ID",

        ui:
            "DISCORD_AUTHZ_UI_ROLE_ID"
    });

/* =========================================================
DISCORD EMBED COLORS

Discord expects decimal RGB integer values.

created:
    Blue

completed:
    Green

shelved:
    Amber
========================================================= */

const DISCORD_EMBED_COLORS =
    Object.freeze({
        created:
            0x3498DB,

        completed:
            0x2ECC71,

        shelved:
            0xF39C12
    });

/* =========================================================
DISCORD LIMITS
========================================================= */

const DISCORD_MAX_TITLE_LENGTH =
    256;

const DISCORD_MAX_DESCRIPTION_LENGTH =
    4096;

const DISCORD_MAX_FIELD_NAME_LENGTH =
    256;

const DISCORD_MAX_FIELD_VALUE_LENGTH =
    1024;

const DISCORD_MAX_ERROR_BODY_LENGTH =
    1000;

/* =========================================================
ERROR
========================================================= */

export class TaskboardDiscordError extends Error {
    constructor(
        message,
        {
            code =
                "TASKBOARD_DISCORD_ERROR",

            status =
                500,

            details =
                null
        } = {}
    ) {
        super(
            message
        );

        this.name =
            "TaskboardDiscordError";

        this.code =
            code;

        this.status =
            status;

        this.details =
            details;
    }
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

function normalizeRoles(
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
                    Boolean
                )
        )
    ];
}

function truncateText(
    value,
    maximumLength
) {
    const text =
        normalizeString(
            value
        );

    if (
        text.length <=
        maximumLength
    ) {
        return text;
    }

    return (
        text.slice(
            0,
            Math.max(
                0,
                maximumLength - 1
            )
        )
        + "…"
    );
}

/* =========================================================
TASK VALUES
========================================================= */

function getTaskCode(
    task
) {
    return normalizeString(
        task?.task_code
        || task?.taskCode
        || task?.code
    );
}

function getTaskTitle(
    task
) {
    return normalizeString(
        task?.title
    );
}

function getTaskBody(
    task
) {
    return normalizeString(
        task?.body
        || task?.description
    );
}

function getTaskPriority(
    task
) {
    return normalizeString(
        task?.priority
    );
}

function getTaskStatus(
    task
) {
    return normalizeString(
        task?.status
    );
}

function getTaskTimelineDays(
    task
) {
    const value =
        Number(
            task?.timeline_days
            ?? task?.timelineDays
        );

    return Number.isInteger(
        value
    )
        ? value
        : null;
}

function getTaskRoles(
    task
) {
    return normalizeRoles(
        task?.responsible_roles
        || task?.responsibleRoles
    );
}

function getTaskCreatedAt(
    task
) {
    return normalizeString(
        task?.created_at
        || task?.createdAt
    );
}

function getTaskCompletedAt(
    task
) {
    return normalizeString(
        task?.completed_at
        || task?.completedAt
    );
}

function getTaskShelvedReason(
    task
) {
    return normalizeString(
        task?.shelved_reason
        || task?.shelvedReason
    );
}

function getTaskPreviousStatus(
    task
) {
    return normalizeString(
        task?.previous_status
        || task?.previousStatus
    );
}

/* =========================================================
ROLE DISPLAY
========================================================= */

function formatRoleName(
    role
) {
    switch (
        normalizeString(
            role
        )
            .toLowerCase()
    ) {
        case "owner":
            return "Owner";

        case "database":
            return "Database";

        case "security":
            return "Security";

        case "ui":
            return "UI";

        default:
            return normalizeString(
                role
            );
    }
}

function formatRoles(
    roles
) {
    const formattedRoles =
        normalizeRoles(
            roles
        )
            .map(
                formatRoleName
            )
            .filter(
                Boolean
            );

    return formattedRoles.length >
        0
        ? formattedRoles.join(
            ", "
        )
        : "Unassigned";
}

/* =========================================================
DISCORD ROLE ID VALIDATION
========================================================= */

function isDiscordSnowflake(
    value
) {
    return /^\d{16,22}$/.test(
        normalizeString(
            value
        )
    );
}

/* =========================================================
DISCORD ROLE LOOKUP

Task data supplies only the Taskboard responsibility name.

Example:
    security

Server configuration determines the actual Discord role:

    DISCORD_AUTHZ_SECURITY_ROLE_ID

The browser/task record can never choose an arbitrary
Discord role ID.
========================================================= */

function getDiscordRoleId(
    env,
    taskboardRole
) {
    const normalizedRole =
        normalizeString(
            taskboardRole
        )
            .toLowerCase();

    const environmentName =
        TASKBOARD_ROLE_ENV[
            normalizedRole
        ];

    if (
        !environmentName
    ) {
        return "";
    }

    const roleId =
        normalizeString(
            env?.[
                environmentName
            ]
        );

    if (
        !roleId
    ) {
        console.error(
            "[TASKBOARD DISCORD ROLE ID MISSING]",
            {
                taskboardRole:
                    normalizedRole,

                environmentName
            }
        );

        return "";
    }

    if (
        !isDiscordSnowflake(
            roleId
        )
    ) {
        console.error(
            "[TASKBOARD DISCORD ROLE ID INVALID]",
            {
                taskboardRole:
                    normalizedRole,

                environmentName
            }
        );

        return "";
    }

    return roleId;
}

/* =========================================================
ROLE MENTIONS

Example task:
    responsible_roles:
        [
            "security",
            "ui"
        ]

Result:
    <@&SECURITY_ROLE_ID> <@&UI_ROLE_ID>

allowed_mentions is populated with those exact role IDs.
========================================================= */

function createRoleMentions(
    env,
    task
) {
    const roles =
        getTaskRoles(
            task
        );

    const roleIds =
        [
            ...new Set(
                roles
                    .map(
                        role =>
                            getDiscordRoleId(
                                env,
                                role
                            )
                    )
                    .filter(
                        Boolean
                    )
            )
        ];

    return {
        roleIds,

        content:
            roleIds
                .map(
                    roleId =>
                        `<@&${roleId}>`
                )
                .join(
                    " "
                )
    };
}

/* =========================================================
TIMELINE DISPLAY
========================================================= */

function formatTimeline(
    days
) {
    if (
        !Number.isInteger(
            days
        )
    ) {
        return "—";
    }

    return days ===
        1
        ? "1 day"
        : `${days} days`;
}

/* =========================================================
DISCORD TIMESTAMP
========================================================= */

function createDiscordTimestamp(
    value,
    style =
        "f"
) {
    const timestamp =
        Date.parse(
            normalizeString(
                value
            )
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        return "";
    }

    return (
        `<t:${Math.floor(timestamp / 1000)}:${style}>`
    );
}

/* =========================================================
EMBED FIELD
========================================================= */

function createField(
    name,
    value,
    inline =
        false
) {
    const normalizedName =
        truncateText(
            name,
            DISCORD_MAX_FIELD_NAME_LENGTH
        );

    const normalizedValue =
        truncateText(
            value,
            DISCORD_MAX_FIELD_VALUE_LENGTH
        );

    if (
        !normalizedName
        || !normalizedValue
    ) {
        return null;
    }

    return {
        name:
            normalizedName,

        value:
            normalizedValue,

        inline:
            inline ===
            true
    };
}

/* =========================================================
BASE EMBED
========================================================= */

function createBaseTaskEmbed(
    task,
    {
        title,
        description =
            "",
        fields =
            [],
        color =
            null
    } = {}
) {
    const taskCode =
        getTaskCode(
            task
        );

    const taskTitle =
        getTaskTitle(
            task
        );

    const embed = {
        title:
            truncateText(
                title
                || taskCode
                || "Taskboard Update",
                DISCORD_MAX_TITLE_LENGTH
            ),

        description:
            truncateText(
                description
                || taskTitle
                || "Taskboard activity recorded.",
                DISCORD_MAX_DESCRIPTION_LENGTH
            ),

        fields:
            fields.filter(
                Boolean
            ),

        footer: {
            text:
                taskCode
                    ? `BPD Taskboard • ${taskCode}`
                    : "BPD Taskboard"
        },

        timestamp:
            new Date()
                .toISOString()
    };

    if (
        Number.isInteger(
            color
        )
    ) {
        embed.color =
            color;
    }

    return embed;
}

/* =========================================================
NEW TASK EMBED

Style:
    🆕 Blue
========================================================= */

function createTaskCreatedEmbed(
    task
) {
    const taskCode =
        getTaskCode(
            task
        );

    const taskTitle =
        getTaskTitle(
            task
        );

    const body =
        getTaskBody(
            task
        );

    const priority =
        getTaskPriority(
            task
        );

    const status =
        getTaskStatus(
            task
        );

    const timelineDays =
        getTaskTimelineDays(
            task
        );

    const roles =
        getTaskRoles(
            task
        );

    const createdAt =
        createDiscordTimestamp(
            getTaskCreatedAt(
                task
            )
        );

    const fields = [
        createField(
            "Priority",
            priority
            || "—",
            true
        ),

        createField(
            "Status",
            status
            || "To Do",
            true
        ),

        createField(
            "Timeline",
            formatTimeline(
                timelineDays
            ),
            true
        ),

        createField(
            "Responsible",
            formatRoles(
                roles
            ),
            false
        ),

        createdAt
            ? createField(
                "Created",
                createdAt,
                false
            )
            : null
    ];

    let description =
        "";

    if (
        taskTitle
        && body
    ) {
        description =
            `**${taskTitle}**\n\n${body}`;
    }
    else if (
        taskTitle
    ) {
        description =
            `**${taskTitle}**`;
    }
    else if (
        body
    ) {
        description =
            body;
    }

    return createBaseTaskEmbed(
        task,
        {
            title:
                `🆕 New Task${taskCode ? ` — ${taskCode}` : ""}`,

            description,

            fields,

            color:
                DISCORD_EMBED_COLORS.created
        }
    );
}

/* =========================================================
COMPLETED TASK EMBED

Style:
    ✅ Green
========================================================= */

function createTaskCompletedEmbed(
    task
) {
    const taskCode =
        getTaskCode(
            task
        );

    const taskTitle =
        getTaskTitle(
            task
        );

    const priority =
        getTaskPriority(
            task
        );

    const roles =
        getTaskRoles(
            task
        );

    const createdAt =
        createDiscordTimestamp(
            getTaskCreatedAt(
                task
            )
        );

    const completedAt =
        createDiscordTimestamp(
            getTaskCompletedAt(
                task
            )
        );

    const fields = [
        createField(
            "Priority",
            priority
            || "—",
            true
        ),

        createField(
            "Responsible",
            formatRoles(
                roles
            ),
            true
        ),

        createdAt
            ? createField(
                "Created",
                createdAt,
                false
            )
            : null,

        completedAt
            ? createField(
                "Completed",
                completedAt,
                false
            )
            : null
    ];

    return createBaseTaskEmbed(
        task,
        {
            title:
                `✅ Task Completed${taskCode ? ` — ${taskCode}` : ""}`,

            description:
                taskTitle
                    ? `**${taskTitle}**`
                    : "A Taskboard task was completed.",

            fields,

            color:
                DISCORD_EMBED_COLORS.completed
        }
    );
}

/* =========================================================
SHELVED TASK EMBED

Style:
    📦 Amber
========================================================= */

function createTaskShelvedEmbed(
    task
) {
    const taskCode =
        getTaskCode(
            task
        );

    const taskTitle =
        getTaskTitle(
            task
        );

    const priority =
        getTaskPriority(
            task
        );

    const roles =
        getTaskRoles(
            task
        );

    const previousStatus =
        getTaskPreviousStatus(
            task
        );

    const reason =
        getTaskShelvedReason(
            task
        );

    const fields = [
        createField(
            "Priority",
            priority
            || "—",
            true
        ),

        createField(
            "Previous Status",
            previousStatus
            || "—",
            true
        ),

        createField(
            "Responsible",
            formatRoles(
                roles
            ),
            false
        ),

        createField(
            "Reason",
            reason
            || "No reason recorded.",
            false
        )
    ];

    return createBaseTaskEmbed(
        task,
        {
            title:
                `📦 Task Shelved${taskCode ? ` — ${taskCode}` : ""}`,

            description:
                taskTitle
                    ? `**${taskTitle}**`
                    : "A Taskboard task was shelved.",

            fields,

            color:
                DISCORD_EMBED_COLORS.shelved
        }
    );
}

/* =========================================================
WEBHOOK SELECTION
========================================================= */

function getWebhookEnvName(
    event
) {
    switch (
        normalizeString(
            event
        )
            .toLowerCase()
    ) {
        case "created":
        case "create":
            return NEW_TASKBOARD_REPORT_WEBHOOK_ENV;

        case "completed":
        case "complete":
        case "shelved":
        case "shelve":
            return TASKBOARD_SUMMARY_WEBHOOK_ENV;

        default:
            throw new TaskboardDiscordError(
                "The requested Taskboard Discord event is unsupported.",
                {
                    code:
                        "TASKBOARD_DISCORD_EVENT_UNSUPPORTED",

                    status:
                        400,

                    details: {
                        event:
                            normalizeString(
                                event
                            )
                    }
                }
            );
    }
}

/* =========================================================
WEBHOOK URL
========================================================= */

function requireWebhookUrl(
    env,
    environmentName
) {
    const webhookUrl =
        normalizeString(
            env?.[
                environmentName
            ]
        );

    if (
        !webhookUrl
    ) {
        throw new TaskboardDiscordError(
            `${environmentName} is not configured.`,
            {
                code:
                    "TASKBOARD_DISCORD_WEBHOOK_MISSING",

                status:
                    500,

                details: {
                    environmentName
                }
            }
        );
    }

    let parsedUrl;

    try {
        parsedUrl =
            new URL(
                webhookUrl
            );
    }
    catch {
        throw new TaskboardDiscordError(
            `The Discord webhook configured in ${environmentName} is invalid.`,
            {
                code:
                    "TASKBOARD_DISCORD_WEBHOOK_INVALID",

                status:
                    500,

                details: {
                    environmentName
                }
            }
        );
    }

    if (
        parsedUrl.protocol !==
            "https:"
    ) {
        throw new TaskboardDiscordError(
            `The Discord webhook configured in ${environmentName} must use HTTPS.`,
            {
                code:
                    "TASKBOARD_DISCORD_WEBHOOK_INVALID",

                status:
                    500,

                details: {
                    environmentName
                }
            }
        );
    }

    return parsedUrl.href;
}

/* =========================================================
WEBHOOK DELIVERY
========================================================= */

async function sendDiscordWebhook(
    env,
    environmentName,
    payload
) {
    const webhookUrl =
        requireWebhookUrl(
            env,
            environmentName
        );

    let response;

    try {
        response =
            await fetch(
                webhookUrl,
                {
                    method:
                        "POST",

                    headers: {
                        "Accept":
                            "application/json",

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );
    }
    catch (
        cause
    ) {
        const error =
            new TaskboardDiscordError(
                "The Discord webhook could not be reached.",
                {
                    code:
                        "TASKBOARD_DISCORD_NETWORK_ERROR",

                    status:
                        502,

                    details: {
                        environmentName
                    }
                }
            );

        error.cause =
            cause;

        throw error;
    }

    if (
        !response.ok
    ) {
        let responseText =
            "";

        try {
            responseText =
                await response.text();
        }
        catch {
            responseText =
                "";
        }

        throw new TaskboardDiscordError(
            `Discord webhook request failed with status ${response.status}.`,
            {
                code:
                    response.status ===
                        429
                        ? "TASKBOARD_DISCORD_RATE_LIMITED"
                        : "TASKBOARD_DISCORD_HTTP_ERROR",

                status:
                    response.status,

                details: {
                    environmentName,

                    discordStatus:
                        response.status,

                    response:
                        truncateText(
                            responseText,
                            DISCORD_MAX_ERROR_BODY_LENGTH
                        )
                }
            }
        );
    }

    return true;
}

/* =========================================================
SEND TASK EMBED

The content field contains only server-generated Discord
role mentions.

allowed_mentions:
    parse is empty so Discord does not automatically parse
    arbitrary @everyone, @here, users, or roles.

    roles contains only the exact server-mapped role IDs
    associated with the task's authoritative
    responsible_roles.
========================================================= */

async function sendTaskEmbed(
    env,
    event,
    task,
    embed
) {
    const environmentName =
        getWebhookEnvName(
            event
        );

    const {
        roleIds,
        content
    } =
        createRoleMentions(
            env,
            task
        );

    return sendDiscordWebhook(
        env,
        environmentName,
        {
            username:
                "BPD Taskboard",

            content:
                content
                || undefined,

            embeds: [
                embed
            ],

            allowed_mentions: {
                parse:
                    [],

                roles:
                    roleIds
            }
        }
    );
}

/* =========================================================
NEW TASK NOTIFICATION

Destination:
    NEW_TASKBOARD_REPORT_DISCORD

Mentions:
    authoritative responsible_roles
========================================================= */

export async function sendTaskCreatedDiscordNotification(
    env,
    task
) {
    return sendTaskEmbed(
        env,
        "created",
        task,
        createTaskCreatedEmbed(
            task
        )
    );
}

/* =========================================================
COMPLETED TASK NOTIFICATION

Destination:
    TASKBOARD_SUMMARY_DISCORD

Mentions:
    authoritative responsible_roles
========================================================= */

export async function sendTaskCompletedDiscordNotification(
    env,
    task
) {
    return sendTaskEmbed(
        env,
        "completed",
        task,
        createTaskCompletedEmbed(
            task
        )
    );
}

/* =========================================================
SHELVED TASK NOTIFICATION

Destination:
    TASKBOARD_SUMMARY_DISCORD

Mentions:
    authoritative responsible_roles
========================================================= */

export async function sendTaskShelvedDiscordNotification(
    env,
    task
) {
    return sendTaskEmbed(
        env,
        "shelved",
        task,
        createTaskShelvedEmbed(
            task
        )
    );
}

/* =========================================================
GENERIC TASK EVENT
========================================================= */

export async function sendTaskDiscordNotification(
    env,
    {
        event,
        task
    } = {}
) {
    const normalizedEvent =
        normalizeString(
            event
        )
            .toLowerCase();

    switch (
        normalizedEvent
    ) {
        case "created":
        case "create":
            return sendTaskCreatedDiscordNotification(
                env,
                task
            );

        case "completed":
        case "complete":
            return sendTaskCompletedDiscordNotification(
                env,
                task
            );

        case "shelved":
        case "shelve":
            return sendTaskShelvedDiscordNotification(
                env,
                task
            );

        default:
            throw new TaskboardDiscordError(
                "The requested Taskboard Discord event is unsupported.",
                {
                    code:
                        "TASKBOARD_DISCORD_EVENT_UNSUPPORTED",

                    status:
                        400,

                    details: {
                        event:
                            normalizedEvent
                    }
                }
            );
    }
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isTaskboardDiscordError(
    error
) {
    return (
        error instanceof
            TaskboardDiscordError
        || error?.name ===
            "TaskboardDiscordError"
    );
}