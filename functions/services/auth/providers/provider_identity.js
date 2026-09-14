"use strict";

/* =========================================================
BPD GAMING NETWORK
AUTHORITATIVE PROVIDER IDENTITY SERVICE

File:
    functions/services/auth/providers/provider_identity.js

Purpose:
    Verifies that a canonical BPD account has an active
    provider identity linked in Supabase.

Description:
    - Calls api.verify_account_provider_identity.
    - Uses identity.accounts.id as the account ownership key.
    - Returns the canonical provider_subject stored in
      identity.account_identities.
    - Does not trust provider identity information from the
      browser.
    - Does not use email to determine provider ownership.
    - Does not use Cloudflare KV provider state as the final
      provider authorization authority.

Security:
    - accountId must originate from trusted server-side
      session authorization.
    - provider is selected by server authorization policy.
    - provider_subject is resolved only by Supabase.
    - SUPABASE_AUTH remains server-side only.

Important:
    - No browser-supplied Epic ID is accepted here.
    - No browser-supplied account ID should be passed here.
    - A provider that is missing or inactive returns null.
    - Supabase/RPC failures throw an error rather than being
      treated as "provider not linked."
========================================================= */

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return "";
    }

    return value.trim();
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
SUPABASE CONFIGURATION
========================================================= */

function getSupabaseConfiguration(
    env
) {
    const supabaseUrl =
        normalizeString(
            env?.SUPABASE_URL
        );

    const apiKey =
        normalizeString(
            env?.SUPABASE_AUTH
        );

    if (
        !supabaseUrl
        || !apiKey
    ) {
        return null;
    }

    return {
        baseUrl:
            supabaseUrl.endsWith(
                "/"
            )
                ? supabaseUrl
                : `${supabaseUrl}/`,

        apiKey
    };
}

/* =========================================================
RPC ERROR
========================================================= */

function createProviderVerificationError(
    message,
    {
        status = null,
        upstreamCode = null
    } = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        "ProviderIdentityVerificationError";

    error.status =
        status;

    error.upstreamCode =
        upstreamCode;

    return error;
}

/* =========================================================
NORMALIZE DATABASE RECORD
========================================================= */

function normalizeProviderIdentity(
    record
) {
    if (
        !record
        || typeof record !==
            "object"
        || Array.isArray(
            record
        )
    ) {
        return null;
    }

    const accountId =
        normalizeString(
            record.account_id
            ?? record.accountId
        );

    const provider =
        normalizeProvider(
            record.provider
        );

    const providerSubject =
        normalizeString(
            record.provider_subject
            ?? record.providerSubject
        );

    if (
        !accountId
        || !provider
        || !providerSubject
    ) {
        return null;
    }

    return {
        accountId,

        provider,

        providerSubject,

        displayUsername:
            normalizeString(
                record.display_username
                ?? record.displayUsername
            )
            || null,

        providerEmail:
            normalizeString(
                record.provider_email
                ?? record.providerEmail
            )
            || null,

        providerEmailVerified:
            record.provider_email_verified ===
                true
            || record.providerEmailVerified ===
                true,

        linkedAt:
            record.linked_at
            ?? record.linkedAt
            ?? null,

        lastAuthenticatedAt:
            record.last_authenticated_at
            ?? record.lastAuthenticatedAt
            ?? null,

        lastSyncedAt:
            record.last_synced_at
            ?? record.lastSyncedAt
            ?? null,

        active:
            record.active ===
            true
    };
}

/* =========================================================
VERIFY PROVIDER IDENTITY
========================================================= */

export async function verifyAccountProviderIdentity(
    env,
    accountId,
    provider
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
        throw createProviderVerificationError(
            "A canonical BPD account ID is required.",
            {
                upstreamCode:
                    "ACCOUNT_ID_REQUIRED"
            }
        );
    }

    if (
        !normalizedProvider
    ) {
        throw createProviderVerificationError(
            "An authentication provider is required.",
            {
                upstreamCode:
                    "PROVIDER_REQUIRED"
            }
        );
    }

    const configuration =
        getSupabaseConfiguration(
            env
        );

    if (
        !configuration
    ) {
        throw createProviderVerificationError(
            "Supabase provider verification configuration is unavailable.",
            {
                upstreamCode:
                    "SUPABASE_CONFIGURATION_MISSING"
            }
        );
    }

    const response =
        await fetch(
            `${configuration.baseUrl}rpc/verify_account_provider_identity`,
            {
                method:
                    "POST",

                headers: {
                    "apikey":
                        configuration.apiKey,

                    "Authorization":
                        `Bearer ${configuration.apiKey}`,

                    "Content-Profile":
                        "api",

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        p_account_id:
                            normalizedAccountId,

                        p_provider:
                            normalizedProvider
                    })
            }
        );

    if (
        !response.ok
    ) {
        let errorData =
            null;

        try {
            errorData =
                await response.json();
        }
        catch {
            // Ignore malformed upstream response.
        }

        const upstreamMessage =
            normalizeString(
                errorData?.message
            );

        const upstreamCode =
            normalizeString(
                errorData?.code
            );

        throw createProviderVerificationError(
            upstreamMessage
            || "Provider identity verification failed.",
            {
                status:
                    response.status,

                upstreamCode:
                    upstreamCode
                    || "PROVIDER_IDENTITY_VERIFICATION_FAILED"
            }
        );
    }

    let data;

    try {
        data =
            await response.json();
    }
    catch {
        throw createProviderVerificationError(
            "Provider identity verification returned an invalid response.",
            {
                status:
                    response.status,

                upstreamCode:
                    "PROVIDER_IDENTITY_RESPONSE_INVALID"
            }
        );
    }

    /*
     * The RPC returns SETOF/table results.
     *
     * No rows means the account exists but that provider is
     * not currently linked and active.
     */
    const record =
        Array.isArray(
            data
        )
            ? (
                data[0]
                || null
            )
            : data;

    if (
        !record
    ) {
        return null;
    }

    const identity =
        normalizeProviderIdentity(
            record
        );

    if (
        !identity
    ) {
        throw createProviderVerificationError(
            "Provider identity verification returned incomplete identity data.",
            {
                upstreamCode:
                    "PROVIDER_IDENTITY_INVALID"
            }
        );
    }

    /*
     * Defense in depth:
     *
     * Confirm Supabase returned the exact account and
     * provider that were requested.
     */
    if (
        identity.accountId !==
        normalizedAccountId
    ) {
        throw createProviderVerificationError(
            "Provider verification returned an unexpected BPD account.",
            {
                upstreamCode:
                    "PROVIDER_ACCOUNT_MISMATCH"
            }
        );
    }

    if (
        identity.provider !==
        normalizedProvider
    ) {
        throw createProviderVerificationError(
            "Provider verification returned an unexpected provider.",
            {
                upstreamCode:
                    "PROVIDER_NAME_MISMATCH"
            }
        );
    }

    if (
        identity.active !==
        true
    ) {
        return null;
    }

    return identity;
}

/* =========================================================
ERROR CHECK
========================================================= */

export function isProviderIdentityVerificationError(
    error
) {
    return (
        error?.name ===
        "ProviderIdentityVerificationError"
    );
}