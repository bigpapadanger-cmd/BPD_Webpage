"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT LAST LOGIN API

File:
    functions/api/auth/account/last_login.js

Purpose:
    Updates last_seen_at for the currently authenticated
    canonical BPD account.
========================================================= */

import {
    getSessionContext
} from "../../../services/auth/sessions/session_context.js";

import {
    touchAccountLastSeen
} from "../../../services/auth/account/last_login.js";

import {
    json
} from "../../../services/common_helpers/responses.js";
import {
    refreshStats
} from "../../../services/rl/stats/refresh.js";
export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } = context;

    const debugId =
        crypto.randomUUID();

    try {
        const session =
            await getSessionContext(
                request,
                env
            );

        if (
            session.authenticated !==
            true
            || !session.userId
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "UNAUTHORIZED",

                    message:
                        "Authentication required.",

                    debugId
                },
                401
            );
        }

        if (
            session.active !==
            true
        ) {
            return json(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "The authenticated account is inactive.",

                    debugId
                },
                403
            );
        }

        const lastSeenAt =
            await touchAccountLastSeen(
                env,
                session.userId
            );
        const mmrRefresh =
            await refreshPlayerMmrIfDue(
                env,
                {
                    accountId:
                        session.userId,

                    epicAccountId:
                        session.providers?.epic?.accountId
                        || null
                }
            );
        return json(
            {
                success:
                    true,

                lastSeenAt,

                debugId
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "LAST LOGIN API: Failed.",
            {
                debugId,

                status:
                    error?.status
                    || null,

                code:
                    error?.code
                    || null,

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return json(
            {
                success:
                    false,

                code:
                    error?.code
                    || "LAST_LOGIN_FAILED",

                message:
                    "Account activity could not be updated.",

                debugId
            },
            error?.status
            || 500
        );
    }
}