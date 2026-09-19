"use strict";

/* =========================================================
BPD GAMING NETWORK
PROVIDER AUTHORIZATION STATE SERVICE

File:
    functions/services/auth/providers/provider_auth_state.js

Purpose:
    Stores and evaluates temporary provider authentication
    freshness in Cloudflare KV.

Responsibilities:
    - Record successful provider authentication timestamps.
    - Track the previous BPD login timestamp.
    - Detect login gaps greater than the configured maximum.
    - Enforce the firm provider authentication lifetime.
    - Determine whether a linked provider requires
      reauthorization.
    - Support a shared server-generated authentication event
      timestamp across provider authentication and BPD login.

Trust Model:
    - Supabase remains the authority for permanent provider
      ownership/linkage.
    - KV only determines whether that linked provider was
      authenticated recently enough.
    - Browser-supplied timestamps are never trusted.
    - Authentication event timestamps must originate from
      trusted server-side authentication code.

Provider Policy:
    - Provider authentication expires 31 days after the most
      recent successful provider OAuth/OpenID authentication.
    - Normal website activity never extends that 31-day date.
    - A BPD login gap of 10 days or more forces all linked
      providers to authenticate again.
    - Each provider must individually authenticate after the
      login-gap cutoff before becoming valid again.

KV Keys:
    provider_auth_id:{accountId}:{provider}

    account_login_status:{accountId}
========================================================= */

import {
    PROVIDER_AUTH_KEY_PREFIX,
    ACCOUNT_LOGIN_STATE_KEY_PREFIX,
    PROVIDER_AUTH_DURATION_DAYS,
    LOGIN_GAP_DURATION_DAYS,
    PROVIDER_AUTH_TTL_SECONDS
} from "../../config/api_vars.js";

/* =========================================================
CONSTANTS
========================================================= */

const DAY_MS =
    24
    * 60
    * 60
    * 1000;

const PROVIDER_AUTH_DURATION_MS =
    PROVIDER_AUTH_DURATION_DAYS
    * DAY_MS;

const LOGIN_GAP_DURATION_MS =
    LOGIN_GAP_DURATION_DAYS
    * DAY_MS;

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
KV ACCESS
========================================================= */

function getAuthKv(
    env
) {
    const kv =
        env?.AUTH_SESSIONS;

    if (
        !kv
        || typeof kv.get !==
            "function"
        || typeof kv.put !==
            "function"
    ) {
        throw new Error(
            "AUTH_SESSIONS KV binding is unavailable."
        );
    }

    return kv;
}

/* =========================================================
KEY BUILDERS
========================================================= */

function buildProviderAuthKey(
    accountId,
    provider
) {
    return (
        PROVIDER_AUTH_KEY_PREFIX
        + accountId
        + ":"
        + provider
    );
}

function buildAccountLoginKey(
    accountId
) {
    return (
        ACCOUNT_LOGIN_STATE_KEY_PREFIX
        + accountId
    );
}

/* =========================================================
TIMESTAMP HELPERS
========================================================= */

function parseTimestamp(
    value
) {
    if (
        typeof value ===
            "number"
        && Number.isFinite(
            value
        )
    ) {
        return value;
    }

    const timestamp =
        Date.parse(
            normalizeString(
                value
            )
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
}

function toIsoTimestamp(
    value
) {
    return new Date(
        value
    )
        .toISOString();
}

/*
 * Authentication timestamps passed into this service are
 * internal server-generated values.
 *
 * null / undefined:
 *     use Date.now()
 *
 * number:
 *     use the supplied millisecond timestamp
 *
 * ISO/date string:
 *     parse the supplied timestamp
 *
 * Invalid timestamps fail closed rather than silently
 * falling back to the current time.
 */
function resolveAuthenticationTimestamp(
    value
) {
    if (
        value === null
        || value === undefined
    ) {
        return Date.now();
    }

    const timestamp =
        parseTimestamp(
            value
        );

    if (
        timestamp ===
            null
        || timestamp <=
            0
    ) {
        throw new Error(
            "Authentication event timestamp is invalid."
        );
    }

    return timestamp;
}

/* =========================================================
LOAD JSON
========================================================= */

async function loadJson(
    kv,
    key
) {
    const value =
        await kv.get(
            key,
            "json"
        );

    if (
        !value
        || typeof value !==
            "object"
        || Array.isArray(
            value
        )
    ) {
        return null;
    }

    return value;
}

/* =========================================================
PROVIDER AUTH RECORD

authenticatedAt:
    Optional trusted server-generated authentication event
    timestamp.

    Passing the same authenticatedAt to recordAccountLogin()
    allows provider connectedAt and providerReauthAfter to
    represent the exact same authentication event.
========================================================= */

export async function recordProviderAuthentication(
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
            "A canonical account ID is required."
        );
    }

    if (
        !normalizedProvider
    ) {
        throw new Error(
            "A provider is required."
        );
    }

    const kv =
        getAuthKv(
            env
        );

    const authenticationTime =
        resolveAuthenticationTimestamp(
            authenticatedAt
        );

    const expiresAt =
        authenticationTime
        + PROVIDER_AUTH_DURATION_MS;

    // Recover missing policy state without inventing a successful BPD login.
    const loginKey = buildAccountLoginKey(normalizedAccountId);
    if (!await loadJson(kv, loginKey)) {
        await kv.put(loginKey, JSON.stringify({
            accountId: normalizedAccountId,
            lastLoginAt: null,
            providerReauthAfter: toIsoTimestamp(authenticationTime)
        }));
    }

    const state = {
        accountId:
            normalizedAccountId,

        provider:
            normalizedProvider,

        connectedAt:
            toIsoTimestamp(
                authenticationTime
            ),

        expiresAt:
            toIsoTimestamp(
                expiresAt
            )
    };

    await kv.put(
        buildProviderAuthKey(
            normalizedAccountId,
            normalizedProvider
        ),
        JSON.stringify(
            state
        ),
        {
            expirationTtl:
                PROVIDER_AUTH_TTL_SECONDS
        }
    );

    return state;
}

/* =========================================================
PROVIDER AUTH STATE
========================================================= */

export async function getProviderAuthRecord(
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
        || !normalizedProvider
    ) {
        return null;
    }

    const kv =
        getAuthKv(
            env
        );

    return loadJson(
        kv,
        buildProviderAuthKey(
            normalizedAccountId,
            normalizedProvider
        )
    );
}

/* =========================================================
ACCOUNT LOGIN STATE
========================================================= */

export async function getAccountLoginState(
    env,
    accountId
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        return null;
    }

    const kv =
        getAuthKv(
            env
        );

    return loadJson(
        kv,
        buildAccountLoginKey(
            normalizedAccountId
        )
    );
}

/* =========================================================
RECORD ACCOUNT LOGIN

Important:
    The previous login timestamp is evaluated BEFORE the
    current login timestamp is written.

If the previous login was at least LOGIN_GAP_DURATION_DAYS
before this login event, providerReauthAfter is advanced to
the current login event timestamp.

That cutoff remains until each provider authenticates after
it.

loginAt:
    Optional trusted server-generated login event timestamp.

    For a successful provider-backed BPD login, this should
    normally be the same timestamp supplied to
    recordProviderAuthentication().
========================================================= */

export async function recordAccountLogin(
    env,
    accountId,
    loginAt = null
) {
    const normalizedAccountId =
        normalizeString(
            accountId
        );

    if (
        !normalizedAccountId
    ) {
        throw new Error(
            "A canonical account ID is required."
        );
    }

    const kv =
        getAuthKv(
            env
        );

    const key =
        buildAccountLoginKey(
            normalizedAccountId
        );

    const previousState =
        await loadJson(
            kv,
            key
        );

    const loginTime =
        resolveAuthenticationTimestamp(
            loginAt
        );

    const previousLoginAt =
        parseTimestamp(
            previousState
                ?.lastLoginAt
        );

    const previousReauthAfter =
        parseTimestamp(
            previousState
                ?.providerReauthAfter
        );

    const loginGapExceeded =
        previousLoginAt !==
            null
        && (
            loginTime
            - previousLoginAt
        ) >=
            LOGIN_GAP_DURATION_MS;

    let providerReauthAfter =
        previousReauthAfter;

    if (
        loginGapExceeded
    ) {
        providerReauthAfter =
            loginTime;
    }

    const state = {
        accountId:
            normalizedAccountId,

        lastLoginAt:
            toIsoTimestamp(
                loginTime
            ),

        providerReauthAfter:
            providerReauthAfter !==
                null
                ? toIsoTimestamp(
                    providerReauthAfter
                )
                : null,

        loginGapExceeded
    };

    /*
     * Intentionally no short expiration TTL.
     *
     * The previous login timestamp must remain available
     * after a user has been away for more than 10 days.
     */
    await kv.put(
        key,
        JSON.stringify(
            state
        )
    );

    return state;
}

/* =========================================================
PROVIDER AUTHORIZATION STATE
========================================================= */

export async function getProviderAuthorizationState(
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
        || !normalizedProvider
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "PROVIDER_STATE_INVALID",

            connectedAt:
                null,

            expiresAt:
                null,

            providerReauthAfter:
                null
        };
    }

    const [
        providerState,
        accountLoginState
    ] =
        await Promise.all([
            getProviderAuthRecord(
                env,
                normalizedAccountId,
                normalizedProvider
            ),

            getAccountLoginState(
                env,
                normalizedAccountId
            )
        ]);

    if (
        !providerState
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "PROVIDER_AUTH_STATE_MISSING",

            connectedAt:
                null,

            expiresAt:
                null,

            providerReauthAfter:
                accountLoginState
                    ?.providerReauthAfter
                ?? null
        };
    }

    const connectedAt =
        parseTimestamp(
            providerState
                ?.connectedAt
        );

    const expiresAt =
        parseTimestamp(
            providerState
                ?.expiresAt
        );

    const providerReauthAfter =
        parseTimestamp(
            accountLoginState
                ?.providerReauthAfter
        );

    const lastLoginAt = parseTimestamp(accountLoginState?.lastLoginAt);
    const nowForPolicy = Date.now();
    if (providerState.accountId !== normalizedAccountId
        || providerState.provider !== normalizedProvider
        || !accountLoginState || accountLoginState.accountId !== normalizedAccountId
        || (lastLoginAt === null && providerReauthAfter === null)
        || (accountLoginState.lastLoginAt != null && lastLoginAt === null)
        || (accountLoginState.providerReauthAfter != null && providerReauthAfter === null)
        || lastLoginAt > nowForPolicy || providerReauthAfter > nowForPolicy
        || connectedAt === null || connectedAt <= 0 || expiresAt === null
        || expiresAt <= connectedAt) {
        return { authorized: false, requiresReauthorization: true,
            reason: "PROVIDER_AUTH_STATE_INVALID", connectedAt: null, expiresAt: null,
            providerReauthAfter: null };
    }

    // A still-valid browser session cannot bypass a gap between successful logins.
    const idleCutoff = lastLoginAt !== null && nowForPolicy - lastLoginAt >= LOGIN_GAP_DURATION_MS
        ? lastLoginAt + LOGIN_GAP_DURATION_MS : 0;
    if (connectedAt < Math.max(providerReauthAfter || 0, idleCutoff)) {
        return { authorized: false, requiresReauthorization: true,
            reason: "LOGIN_GAP_REAUTH_REQUIRED", connectedAt: providerState.connectedAt,
            expiresAt: providerState.expiresAt,
            providerReauthAfter: toIsoTimestamp(Math.max(providerReauthAfter || 0, idleCutoff)) };
    }

    if (
        connectedAt ===
        null
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "PROVIDER_CONNECTED_AT_INVALID",

            connectedAt:
                null,

            expiresAt:
                providerState
                    ?.expiresAt
                ?? null,

            providerReauthAfter:
                accountLoginState
                    ?.providerReauthAfter
                ?? null
        };
    }

    const now =
        Date.now();

    /*
     * Fail closed if KV contains an impossible future
     * provider authentication timestamp.
     */
    if (
        connectedAt >
        now
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "PROVIDER_CONNECTED_AT_FUTURE",

            connectedAt:
                providerState
                    .connectedAt,

            expiresAt:
                providerState
                    ?.expiresAt
                ?? null,

            providerReauthAfter:
                accountLoginState
                    ?.providerReauthAfter
                ?? null
        };
    }

    /*
     * The stored expiresAt value may shorten the lifetime,
     * but it can never extend authentication beyond the firm
     * connectedAt + PROVIDER_AUTH_DURATION_MS deadline.
     */
    const hardExpired =
        (
            expiresAt !==
                null
            && now >=
                expiresAt
        )
        || (
            now
            - connectedAt
        ) >=
            PROVIDER_AUTH_DURATION_MS;

    if (
        hardExpired
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "PROVIDER_AUTH_EXPIRED",

            connectedAt:
                providerState
                    .connectedAt,

            expiresAt:
                providerState
                    ?.expiresAt
                ?? null,

            providerReauthAfter:
                accountLoginState
                    ?.providerReauthAfter
                ?? null
        };
    }

    /*
     * Equality is intentionally valid.
     *
     * A provider used to establish a BPD login may have the
     * exact same shared authentication-event timestamp as the
     * providerReauthAfter cutoff.
     *
     * Only providers authenticated BEFORE the cutoff require
     * reauthorization.
     */
    const loginGapRequiresReauth =
        providerReauthAfter !==
            null
        && connectedAt <
            providerReauthAfter;

    if (
        loginGapRequiresReauth
    ) {
        return {
            authorized:
                false,

            requiresReauthorization:
                true,

            reason:
                "LOGIN_GAP_REAUTH_REQUIRED",

            connectedAt:
                providerState
                    .connectedAt,

            expiresAt:
                providerState
                    ?.expiresAt
                ?? null,

            providerReauthAfter:
                accountLoginState
                    ?.providerReauthAfter
                ?? null
        };
    }

    return {
        authorized:
            true,

        requiresReauthorization:
            false,

        reason:
            null,

        connectedAt:
            providerState
                .connectedAt,

        expiresAt:
            providerState
                ?.expiresAt
            ?? toIsoTimestamp(
                connectedAt
                + PROVIDER_AUTH_DURATION_MS
            ),

        providerReauthAfter:
            accountLoginState
                ?.providerReauthAfter
            ?? null
    };
}

export async function revokeProviderAuthentication(env, accountId, provider) {
    const kv = getAuthKv(env);
    await kv.delete(buildProviderAuthKey(normalizeString(accountId), normalizeProvider(provider)));
}
