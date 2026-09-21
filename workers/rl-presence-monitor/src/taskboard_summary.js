"use strict";

/* =========================================================
BPD GAMING NETWORK
TASKBOARD DAILY SUMMARY

File:
    workers/rl-presence-monitor/src/taskboard_summary.js

Purpose:
    Generates and delivers a daily Admin Taskboard summary
    to Discord.

Report:
    - Total current tasks.
    - Active Taskboard tasks.
    - Deleted records.
    - Count of tasks in each status.
    - Count of tasks associated with each responsibility
      group.

Status Groups:
    - To Do
    - In Progress
    - Completed
    - Shelved
    - Archived
    - Deleted

Responsibility Groups:
    - Owner
    - Database
    - Security
    - UI

Important:
    - Responsibility counts are independent.
    - A task assigned to multiple groups is counted once
      for each associated group.
    - This report never mentions Discord users or roles.
    - allowed_mentions disables all Discord mentions.
    - Discord webhook URL remains server-side.
========================================================= */

/* =========================================================
ENVIRONMENT
========================================================= */

const SUMMARY_WEBHOOK_ENV =
    "TASKBOARD_SUMMARY_DISCORD";

const SUPABASE_SERVICE_ROLE_ENV =
    "SUPABASE_SERVICE_ROLE_KEY";

/* =========================================================
SUPABASE RPC
========================================================= */

const TASKBOARD_SUMMARY_RPC =
    "admin_taskboard_summary";

/* =========================================================
DISCORD STYLE
========================================================= */

const SUMMARY_COLOR =
    0x9B59B6;

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

export class TaskboardSummaryError extends Error {
    constructor(
        message,
        {
            code =
                "TASKBOARD_SUMMARY_ERROR",

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
            "TaskboardSummaryError";

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

function normalizeCount(
    value
) {
    const count =
        Number(
            value
        );

    if (
        !Number.isFinite(
            count
        )
        || count <
            0
    ) {
        return 0;
    }

    return Math.trunc(
        count
    );
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
ENVIRONMENT REQUIREMENTS
========================================================= */

function requireEnvironmentValue(
    env,
    name
) {
    const value =
        normalizeString(
            env?.[
                name
            ]
        );

    if (
        !value
    ) {
        throw new TaskboardSummaryError(
            `${name} is not configured.`,
            {
                code:
                    "TASKBOARD_SUMMARY_ENV_MISSING",

                status:
                    500,

                details: {
                    name
                }
            }
        );
    }

    return value;
}

/* =========================================================
SUPABASE REST BASE URL

Supports either:

    https://project.supabase.co

or:

    https://project.supabase.co/rest/v1/

as SUPABASE_URL.
========================================================= */

function getSupabaseRestUrl(
    env
) {
    const configuredUrl =
        requireEnvironmentValue(
            env,
            "SUPABASE_URL"
        );

    let url;

    try {
        url =
            new URL(
                configuredUrl
            );
    }
    catch {
        throw new TaskboardSummaryError(
            "SUPABASE_URL is invalid.",
            {
                code:
                    "TASKBOARD_SUMMARY_SUPABASE_URL_INVALID",

                status:
                    500
            }
        );
    }

    let pathname =
        url.pathname.replace(
            /\/+$/,
            ""
        );

    if (
        pathname.endsWith(
            "/rest/v1"
        )
    ) {
        url.pathname =
            `${pathname}/`;

        return url.href;
    }

    url.pathname =
        "/rest/v1/";

    return url.href;
}

/* =========================================================
SUMMARY RPC URL
========================================================= */

function getSummaryRpcUrl(
    env
) {
    const restUrl =
        getSupabaseRestUrl(
            env
        );

    return new URL(
        `rpc/${TASKBOARD_SUMMARY_RPC}`,
        restUrl
    )
        .href;
}

/* =========================================================
LOAD SUMMARY FROM SUPABASE

Expected RPC result shape:

{
    "total_tasks": 31,
    "active_tasks": 30,
    "deleted_tasks": 1,

    "status": {
        "to_do": 8,
        "in_progress": 6,
        "completed": 10,
        "shelved": 3,
        "archived": 3,
        "deleted": 1
    },

    "responsibility": {
        "owner": 4,
        "database": 9,
        "security": 11,
        "ui": 12
    }
}
========================================================= */

async function loadTaskboardSummary(
    env
) {
    const serviceRoleKey =
        requireEnvironmentValue(
            env,
            SUPABASE_SERVICE_ROLE_ENV
        );

    const response =
        await fetch(
            getSummaryRpcUrl(
                env
            ),
            {
                method:
                    "POST",

                headers: {
                    "Accept":
                        "application/json",

                    "Content-Type":
                        "application/json",

                    "apikey":
                        serviceRoleKey,

                    "Authorization":
                        `Bearer ${serviceRoleKey}`
                },

                body:
                    JSON.stringify(
                        {}
                    )
            }
        );

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

        throw new TaskboardSummaryError(
            `Taskboard summary RPC failed with status ${response.status}.`,
            {
                code:
                    "TASKBOARD_SUMMARY_RPC_FAILED",

                status:
                    response.status,

                details: {
                    response:
                        truncateText(
                            responseText,
                            DISCORD_MAX_ERROR_BODY_LENGTH
                        )
                }
            }
        );
    }

    const result =
        await response.json();

    if (
        !result
        || typeof result !==
            "object"
        || Array.isArray(
            result
        )
    ) {
        throw new TaskboardSummaryError(
            "Taskboard summary RPC returned an invalid response.",
            {
                code:
                    "TASKBOARD_SUMMARY_RPC_INVALID",

                status:
                    502
            }
        );
    }

    return result;
}

/* =========================================================
NORMALIZE SUMMARY
========================================================= */

function normalizeSummary(
    result
) {
    const status =
        result?.status
        && typeof result.status ===
            "object"
            ? result.status
            : {};

    const responsibility =
        result?.responsibility
        && typeof result.responsibility ===
            "object"
            ? result.responsibility
            : {};

    return {
        totalTasks:
            normalizeCount(
                result?.total_tasks
            ),

        activeTasks:
            normalizeCount(
                result?.active_tasks
            ),

        deletedTasks:
            normalizeCount(
                result?.deleted_tasks
            ),

        status: {
            toDo:
                normalizeCount(
                    status?.to_do
                ),

            inProgress:
                normalizeCount(
                    status?.in_progress
                ),

            completed:
                normalizeCount(
                    status?.completed
                ),

            shelved:
                normalizeCount(
                    status?.shelved
                ),

            archived:
                normalizeCount(
                    status?.archived
                ),

            deleted:
                normalizeCount(
                    status?.deleted
                )
        },

        responsibility: {
            owner:
                normalizeCount(
                    responsibility?.owner
                ),

            database:
                normalizeCount(
                    responsibility?.database
                ),

            security:
                normalizeCount(
                    responsibility?.security
                ),

            ui:
                normalizeCount(
                    responsibility?.ui
                )
        }
    };
}

/* =========================================================
FIELD
========================================================= */

function createField(
    name,
    value,
    inline =
        false
) {
    return {
        name:
            truncateText(
                name,
                DISCORD_MAX_FIELD_NAME_LENGTH
            ),

        value:
            truncateText(
                value,
                DISCORD_MAX_FIELD_VALUE_LENGTH
            ),

        inline:
            inline ===
            true
    };
}

/* =========================================================
STATUS REPORT
========================================================= */

function createStatusReport(
    summary
) {
    return [
        `📝 **To Do** — \`${summary.status.toDo}\``,
        `🚧 **In Progress** — \`${summary.status.inProgress}\``,
        `✅ **Completed** — \`${summary.status.completed}\``,
        `📦 **Shelved** — \`${summary.status.shelved}\``,
        `🗄️ **Archived** — \`${summary.status.archived}\``,
        `🗑️ **Deleted** — \`${summary.status.deleted}\``
    ]
        .join(
            "\n"
        );
}

/* =========================================================
RESPONSIBILITY REPORT

Counts can exceed the number of tasks because one task
may be assigned to multiple responsibility groups.
========================================================= */

function createResponsibilityReport(
    summary
) {
    return [
        `👑 **Owner** — \`${summary.responsibility.owner}\``,
        `🗄️ **Database** — \`${summary.responsibility.database}\``,
        `🛡️ **Security** — \`${summary.responsibility.security}\``,
        `🎨 **UI** — \`${summary.responsibility.ui}\``
    ]
        .join(
            "\n"
        );
}

/* =========================================================
WORKLOAD OVERVIEW
========================================================= */

function createWorkloadReport(
    summary
) {
    const activeWork =
        summary.status.toDo
        + summary.status.inProgress;

    return [
        `⚙️ **Active Work** — \`${activeWork}\``,
        `✅ **Completed** — \`${summary.status.completed}\``,
        `📦 **On Hold** — \`${summary.status.shelved}\``,
        `🗄️ **Archived** — \`${summary.status.archived}\``
    ]
        .join(
            "\n"
        );
}

/* =========================================================
DISCORD EMBED
========================================================= */

function createSummaryEmbed(
    summary
) {
    return {
        title:
            truncateText(
                "📊 BPD Taskboard Daily Summary",
                DISCORD_MAX_TITLE_LENGTH
            ),

        description:
            truncateText(
                "Current Taskboard workload and responsibility snapshot.",
                DISCORD_MAX_DESCRIPTION_LENGTH
            ),

        color:
            SUMMARY_COLOR,

        fields: [
            createField(
                "📋 Current Taskboard",
                [
                    `**Active Records:** \`${summary.activeTasks}\``,
                    `**Total Records:** \`${summary.totalTasks}\``,
                    `**Deleted Records:** \`${summary.deletedTasks}\``
                ]
                    .join(
                        "\n"
                    ),
                false
            ),

            createField(
                "📌 Status Breakdown",
                createStatusReport(
                    summary
                ),
                true
            ),

            createField(
                "👥 Responsibility Breakdown",
                createResponsibilityReport(
                    summary
                ),
                true
            ),

            createField(
                "📈 Workload Overview",
                createWorkloadReport(
                    summary
                ),
                false
            ),

            createField(
                "ℹ️ Responsibility Counts",
                "Tasks assigned to multiple groups are counted once under each responsible group.",
                false
            )
        ],

        footer: {
            text:
                "BPD Gaming Network • Taskboard Report"
        },

        timestamp:
            new Date()
                .toISOString()
    };
}

/* =========================================================
DISCORD WEBHOOK
========================================================= */

function getSummaryWebhookUrl(
    env
) {
    const webhook =
        requireEnvironmentValue(
            env,
            SUMMARY_WEBHOOK_ENV
        );

    let url;

    try {
        url =
            new URL(
                webhook
            );
    }
    catch {
        throw new TaskboardSummaryError(
            `${SUMMARY_WEBHOOK_ENV} is invalid.`,
            {
                code:
                    "TASKBOARD_SUMMARY_WEBHOOK_INVALID",

                status:
                    500
            }
        );
    }

    if (
        url.protocol !==
            "https:"
    ) {
        throw new TaskboardSummaryError(
            `${SUMMARY_WEBHOOK_ENV} must use HTTPS.`,
            {
                code:
                    "TASKBOARD_SUMMARY_WEBHOOK_INVALID",

                status:
                    500
            }
        );
    }

    return url.href;
}

/* =========================================================
SEND DISCORD REPORT

No content mentions are included.

allowed_mentions.parse is empty to explicitly disable:

    @everyone
    @here
    user mentions
    role mentions
========================================================= */

async function sendTaskboardSummary(
    env,
    summary
) {
    const response =
        await fetch(
            getSummaryWebhookUrl(
                env
            ),
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
                    JSON.stringify({
                        username:
                            "BPD Taskboard",

                        embeds: [
                            createSummaryEmbed(
                                summary
                            )
                        ],

                        allowed_mentions: {
                            parse:
                                []
                        }
                    })
            }
        );

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

        throw new TaskboardSummaryError(
            `Taskboard Discord summary failed with status ${response.status}.`,
            {
                code:
                    response.status ===
                        429
                        ? "TASKBOARD_SUMMARY_DISCORD_RATE_LIMITED"
                        : "TASKBOARD_SUMMARY_DISCORD_FAILED",

                status:
                    response.status,

                details: {
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
RUN SUMMARY

Called by the Worker's scheduled handler.
========================================================= */

export async function runTaskboardSummary(
    env
) {
    console.log(
        "TASKBOARD SUMMARY: Starting daily summary."
    );

    try {
        const rawSummary =
            await loadTaskboardSummary(
                env
            );

        const summary =
            normalizeSummary(
                rawSummary
            );

        await sendTaskboardSummary(
            env,
            summary
        );

        console.log(
            "TASKBOARD SUMMARY: Daily summary delivered.",
            {
                totalTasks:
                    summary.totalTasks,

                activeTasks:
                    summary.activeTasks,

                deletedTasks:
                    summary.deletedTasks
            }
        );

        return {
            success:
                true,

            summary
        };
    }
    catch (
        error
    ) {
        console.error(
            "TASKBOARD SUMMARY: Daily summary failed.",
            {
                name:
                    error?.name
                    || null,

                code:
                    error?.code
                    || null,

                status:
                    error?.status
                    || null,

                message:
                    error?.message
                    || "Unknown Taskboard summary error",

                details:
                    error?.details
                    || null
            }
        );

        throw error;
    }
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isTaskboardSummaryError(
    error
) {
    return (
        error instanceof
            TaskboardSummaryError
        || error?.name ===
            "TaskboardSummaryError"
    );
}