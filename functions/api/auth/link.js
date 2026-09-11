"use strict";

/* =========================================================
BPD GAMING NETWORK
ACCOUNT PROVIDER LINK API

File:
    functions/api/auth/link.js

Public Route:
    GET /api/auth/link?provider={provider}

Service:
    functions/services/auth/account/link_provider.js

Purpose:
    Public API entry point for linking an additional
    authentication provider to the currently authenticated
    global BPD account.

Description:
    - Requires an existing authenticated BPD session.
    - Accepts only the provider name from the browser.
    - The target identity.accounts.id is resolved exclusively
      from the authenticated BPD session.
    - Redirects into the provider-specific linking flow.

Example:
    GET /api/auth/link?provider=google

Important:
    - The browser never supplies account_id.
    - This route starts linking; it does not directly mutate
      identity.account_identities.
    - Database ownership changes occur only after the OAuth
      callback successfully authenticates the provider.
========================================================= */

import {
    handleLinkProvider
} from "../../services/auth/account/link_provider.js";

/* =========================================================
GET
========================================================= */

export async function onRequestGet(
    context
) {
    return handleLinkProvider(
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
        context.request.method === "GET"
    ) {
        return onRequestGet(
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
                "Only GET requests are allowed."
        }),
        {
            status:
                405,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store",

                "Allow":
                    "GET"
            }
        }
    );
}