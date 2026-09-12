"use strict";

/* =========================================================
BPD GAMING NETWORK
OAUTH PROVIDER HELPERS

File:
    functions/services/auth/oauth/provider_helpers.js

Purpose:
    Provides centralized provider-specific interpretation for
    Supabase-backed OAuth authentication.

Description:
    - Defines supported Supabase OAuth providers.
    - Normalizes provider names.
    - Validates the expected authenticated provider.
    - Extracts provider identities from Supabase Auth users.
    - Extracts provider subject IDs.
    - Extracts provider display names and usernames.
    - Extracts provider email metadata.

Important:
    - Provider email never determines BPD account ownership.
    - Provider subject is the canonical external identity key.
    - Epic direct OAuth is handled separately.
========================================================= */

/* =========================================================
SUPPORTED PROVIDERS
========================================================= */

export const SUPPORTED_OAUTH_PROVIDERS =
    new Set([
        "google",
        "discord"
    ]);

/* =========================================================
PROVIDER CONFIGURATION
========================================================= */

const PROVIDER_CONFIG =
    Object.freeze({
        google: {
            label:
                "Google",

            resolveRpc:
                "resolve_google_identity",

            linkRpc:
                "link_google_identity"
        },

        discord: {
            label:
                "Discord",

            resolveRpc:
                "resolve_discord_identity",

            linkRpc:
                "link_discord_identity"
        }
    });

/* =========================================================
NORMALIZATION
========================================================= */

export function normalizeString(
    value
) {
    return typeof value === "string"
        ? value.trim()
        : "";
}

export function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
}

export function normalizeProvider(
    value
) {
    return normalizeString(
        value
    )
        .toLowerCase();
}

/* =========================================================
PROVIDER CONFIG
========================================================= */

export function getProviderConfig(
    provider
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !SUPPORTED_OAUTH_PROVIDERS.has(
            normalizedProvider
        )
    ) {
        return null;
    }

    return (
        PROVIDER_CONFIG[
            normalizedProvider
        ]
        || null
    );
}

/* =========================================================
SUPABASE PROVIDERS
========================================================= */

function getSupabaseProviders(
    user
) {
    const providers =
        new Set();

    const primaryProvider =
        normalizeProvider(
            user?.app_metadata
                ?.provider
        );

    if (
        primaryProvider
    ) {
        providers.add(
            primaryProvider
        );
    }

    const metadataProviders =
        user?.app_metadata
            ?.providers;

    if (
        Array.isArray(
            metadataProviders
        )
    ) {
        for (
            const provider
            of metadataProviders
        ) {
            const normalized =
                normalizeProvider(
                    provider
                );

            if (
                normalized
            ) {
                providers.add(
                    normalized
                );
            }
        }
    }

    if (
        Array.isArray(
            user?.identities
        )
    ) {
        for (
            const identity
            of user.identities
        ) {
            const normalized =
                normalizeProvider(
                    identity?.provider
                );

            if (
                normalized
            ) {
                providers.add(
                    normalized
                );
            }
        }
    }

    return [
        ...providers
    ];
}

/* =========================================================
EXPECTED PROVIDER VALIDATION
========================================================= */

export function validateExpectedProvider(
    provider,
    user
) {
    const expectedProvider =
        normalizeProvider(
            provider
        );

    if (
        !SUPPORTED_OAUTH_PROVIDERS.has(
            expectedProvider
        )
    ) {
        return false;
    }

    return getSupabaseProviders(
        user
    )
        .includes(
            expectedProvider
        );
}

/* =========================================================
SUPABASE PROVIDER IDENTITY
========================================================= */

function getSupabaseIdentity(
    user,
    provider
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    const identities =
        Array.isArray(
            user?.identities
        )
            ? user.identities
            : [];

    return (
        identities.find(
            identity =>
                normalizeProvider(
                    identity?.provider
                )
                === normalizedProvider
        )
        || null
    );
}

/* =========================================================
IDENTITY DATA
========================================================= */

function getIdentityData(
    identity
) {
    if (
        identity?.identity_data
        && typeof identity.identity_data ===
            "object"
        && !Array.isArray(
            identity.identity_data
        )
    ) {
        return identity.identity_data;
    }

    return {};
}

function getUserMetadata(
    user
) {
    if (
        user?.user_metadata
        && typeof user.user_metadata ===
            "object"
        && !Array.isArray(
            user.user_metadata
        )
    ) {
        return user.user_metadata;
    }

    return {};
}

/* =========================================================
PROVIDER SUBJECT
========================================================= */

function getProviderSubject(
    identity,
    identityData
) {
    return (
        normalizeString(
            identityData.sub
        )
        || normalizeString(
            identityData.provider_id
        )
        || normalizeString(
            identityData.user_id
        )
        || normalizeString(
            identity?.id
        )
    );
}

/* =========================================================
EMAIL
========================================================= */

function getProviderEmail(
    user,
    identityData
) {
    return (
        normalizeNullableString(
            identityData.email
        )
        || normalizeNullableString(
            user?.email
        )
    );
}

function getProviderEmailVerified(
    identityData,
    userMetadata
) {
    return (
        identityData.email_verified ===
            true
        || userMetadata.email_verified ===
            true
    );
}

/* =========================================================
GOOGLE DISPLAY NAME
========================================================= */

function getGoogleDisplayName(
    identityData,
    userMetadata
) {
    return (
        normalizeNullableString(
            identityData.full_name
        )
        || normalizeNullableString(
            identityData.name
        )
        || normalizeNullableString(
            userMetadata.full_name
        )
        || normalizeNullableString(
            userMetadata.name
        )
    );
}

/* =========================================================
DISCORD DISPLAY NAME
========================================================= */

function getDiscordDisplayName(
    identityData,
    userMetadata
) {
    return (
        normalizeNullableString(
            identityData.global_name
        )
        || normalizeNullableString(
            identityData.full_name
        )
        || normalizeNullableString(
            identityData.name
        )
        || normalizeNullableString(
            identityData.username
        )
        || normalizeNullableString(
            userMetadata.global_name
        )
        || normalizeNullableString(
            userMetadata.full_name
        )
        || normalizeNullableString(
            userMetadata.name
        )
        || normalizeNullableString(
            userMetadata.user_name
        )
        || normalizeNullableString(
            userMetadata.username
        )
    );
}

/* =========================================================
DISPLAY NAME
========================================================= */

function getProviderDisplayName(
    provider,
    identityData,
    userMetadata
) {
    switch (
        provider
    ) {
        case "google":
            return getGoogleDisplayName(
                identityData,
                userMetadata
            );

        case "discord":
            return getDiscordDisplayName(
                identityData,
                userMetadata
            );

        default:
            return null;
    }
}

/* =========================================================
PREFERRED USERNAME
========================================================= */

function getProviderPreferredUsername(
    provider,
    identityData,
    userMetadata
) {
    if (
        provider !==
        "discord"
    ) {
        return null;
    }

    return (
        normalizeNullableString(
            identityData.username
        )
        || normalizeNullableString(
            userMetadata.user_name
        )
        || normalizeNullableString(
            userMetadata.username
        )
    );
}

/* =========================================================
PROVIDER IDENTITY
========================================================= */

export function getProviderIdentity(
    user,
    provider
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !SUPPORTED_OAUTH_PROVIDERS.has(
            normalizedProvider
        )
    ) {
        return null;
    }

    const identity =
        getSupabaseIdentity(
            user,
            normalizedProvider
        );

    if (
        !identity
    ) {
        return null;
    }

    const identityData =
        getIdentityData(
            identity
        );

    const userMetadata =
        getUserMetadata(
            user
        );

    const providerSubject =
        getProviderSubject(
            identity,
            identityData
        );

    if (
        !providerSubject
    ) {
        return null;
    }

    return {
        provider:
            normalizedProvider,

        authUserId:
            normalizeString(
                user?.id
            ),

        providerSubject,

        email:
            getProviderEmail(
                user,
                identityData
            ),

        emailVerified:
            getProviderEmailVerified(
                identityData,
                userMetadata
            ),

        displayName:
            getProviderDisplayName(
                normalizedProvider,
                identityData,
                userMetadata
            ),

        preferredUsername:
            getProviderPreferredUsername(
                normalizedProvider,
                identityData,
                userMetadata
            )
    };
}