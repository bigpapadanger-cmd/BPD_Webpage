"use strict";

/* =========================================================
BPD GAMING NETWORK
PROVIDER AUTHENTICATION COMPLETION SERVICE

File:
    functions/services/auth/providers/provider_authentication.js

Purpose:
    Centralizes post-authentication handling for supported
    external identity providers.

Responsibilities:
    - Record successful provider authentication in KV.
    - Accept a trusted server-generated authentication event
      timestamp.
    - Keep provider-specific callback services from
      duplicating provider authorization-state logic.

Important:
    - This service records provider authentication only.
    - It does NOT record BPD login events.
    - BPD login state is handled by the higher-level
      authentication.js service.
========================================================= */

import {
    recordProviderAuthentication
} from "./provider_auth_state.js";

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

function normalizeProvider(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

/* =========================================================
COMPLETE PROVIDER AUTHENTICATION

authenticatedAt:
    Optional trusted server-generated authentication event
    timestamp.

    The higher-level authentication completion service may
    pass the same timestamp to both provider authentication
    and BPD login state so they represent one exact event.
========================================================= */

export async function completeProviderAuthentication(
    env,
    accountId,
    provider,
    authenticatedAt = null
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !normalizedAccountId
    ) {
        throw new Error(
            "A canonical BPD account ID is required."
        );
    }

    if (
        !normalizedProvider
    ) {
        throw new Error(
            "An authentication provider is required."
        );
    }

    return recordProviderAuthentication(
        env,
        normalizedAccountId,
        normalizedProvider,
        authenticatedAt
    );
}