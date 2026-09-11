"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PROVIDER UNLINK API

File:
    functions/api/auth/unlink.js

Public Route:
    POST /api/auth/unlink

Service:
    functions/services/auth/account/unlink_provider.js

Purpose:
    Public API wrapper for unlinking an authentication
    provider from the currently authenticated BPD account.

Request Body:
    {
        "provider": "google"
    }

Important:
    - The browser does NOT provide account_id.
    - The authenticated session determines the target
      identity.accounts.id.
========================================================= */

import {
    handleUnlinkProvider
} from "../../services/auth/account/unlink_provider.js";

/* =========================================================
POST
========================================================= */

export async function onRequestPost(
    context
) {
    return handleUnlinkProvider(
        context.request,
        context.env
    );
}

/* =========================================================
OTHER METHODS
========================================================= */

export async function onRequest(
    context
) {
    if (
        context.request.method === "POST"
    ) {
        return onRequestPost(
            context
        );
    }

    return new Response(
        JSON.stringify({
            success:
                false,

            code:
                "METHOD_NOT_ALLOWED",

            message:
                "Only POST requests are allowed."
        }),
        {
            status:
                405,

            headers: {
                "Content-Type":
                    "application/json",

                "Allow":
                    "POST"
            }
        }
    );
}