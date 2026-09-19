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

import { authorizeRequest } from "../../../services/auth/authorization.js";
import { authorizationErrorResponse } from "../../../services/rl/authorization.js";

import {
    handleAccountLastLogin
} from "../../../services/auth/account/last_login.js";

import {
    json
} from "../../../services/common_helpers/responses.js";

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
        const authorization = await authorizeRequest(request, env, { account: true });
        const session = authorization.sessionContext;

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

        // Activity must not advance the successful BPD login timestamp.
        const { lastSeenAt, statsRefresh } = await handleAccountLastLogin(env, authorization.accountId);

        return json(
            {
                success:
                    true,

                lastSeenAt,
                statsRefresh,

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

        return authorizationErrorResponse(error);
    }
}
