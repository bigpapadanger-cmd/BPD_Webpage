"use strict";

/* =========================================================
BPD GAMING NETWORK
CENTRALIZED SESSION STORAGE SERVICE

File:
    functions/services/auth/sessions/session.js

Purpose:
    Provides the authoritative storage and mutation layer for
    BPD browser sessions stored in Cloudflare KV.

Description:
    - Reads and writes AUTH_SESSIONS KV records.
    - Creates and clears the BPD session cookie.
    - Enforces idle and absolute session expiration.
    - Refreshes active session TTLs.
    - Creates centralized BPD account sessions.
    - Updates canonical global account state.
    - Attaches and removes provider authentication state.
    - Deletes and replaces browser sessions.
    - Cleans temporary legacy Epic session fields.

Session Identity:
    sessionData.UserId
        = identity.accounts.id

    sessionData.Role
        = identity.accounts.role

    sessionData.Active
        = identity.accounts.active

    sessionData.Providers
        = provider-specific authentication metadata

Provider Identity:
    Providers.epic.AccountId
        = Epic account ID

    Providers.google.AccountId
        = Google provider subject

Important:
    - UserId always represents identity.accounts.id.
    - Provider account IDs must never be stored as UserId.
    - This is the only application service that should
      directly manipulate AUTH_SESSIONS.
    - Application services should read normalized sessions
      through session_context.js.
    - Provider access tokens must never be stored here.
========================================================= */

import {
    AUTH_SESSION_COOKIE,
    SESSION_IDLE_TTL_SECONDS,
    SESSION_ABSOLUTE_TTL_SECONDS,
    SESSION_REFRESH_INTERVAL_MS
} from "../../config/api_vars.js";

/* =========================================================
COOKIE HELPERS
========================================================= */

export function getCookie(
    request,
    name
) {
    const cookieName =
        typeof name === "string"
            ? name.trim()
            : "";

    if (
        !cookieName
    ) {
        return "";
    }

    const header =
        request.headers.get(
            "cookie"
        )
        || "";

    if (
        !header
        || !header.includes(
            "="
        )
    ) {
        return "";
    }

    const cookies =
        header.split(
            ";"
        );

    for (
        const cookie
        of cookies
    ) {
        const separatorIndex =
            cookie.indexOf(
                "="
            );

        if (
            separatorIndex === -1
        ) {
            continue;
        }

        const currentName =
            cookie
                .slice(
                    0,
                    separatorIndex
                )
                .trim();

        if (
            currentName !== cookieName
        ) {
            continue;
        }

        const currentValue =
            cookie
                .slice(
                    separatorIndex
                    + 1
                )
                .trim();

        try {
            return decodeURIComponent(
                currentValue
            );
        }
        catch {
            return "";
        }
    }

    return "";
}

export function createCookie(
    request,
    name,
    value,
    maxAgeSeconds
) {
    const safeName =
        typeof name === "string"
            ? name.trim()
            : "";

    const safeValue =
        typeof value === "string"
            ? value.trim()
            : "";

    const safeMaxAge =
        Number.isInteger(
            maxAgeSeconds
        )
        && maxAgeSeconds >= 0
            ? maxAgeSeconds
            : 0;

    if (
        !safeName
    ) {
        return "";
    }

    const url =
        new URL(
            request.url
        );

    const parts = [
        `${safeName}=${encodeURIComponent(safeValue)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${safeMaxAge}`
    ];

    if (
        url.protocol === "https:"
    ) {
        parts.push(
            "Secure"
        );
    }

    return parts.join(
        "; "
    );
}

export function clearCookie(
    request,
    name
) {
    return createCookie(
        request,
        name,
        "",
        0
    );
}

/* =========================================================
SESSION COOKIE
========================================================= */

export function createSessionCookie(
    request,
    sessionId
) {
    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        return "";
    }

    return createCookie(
        request,
        AUTH_SESSION_COOKIE,
        normalizedSessionId,
        SESSION_ABSOLUTE_TTL_SECONDS
    );
}

export function clearSessionCookie(
    request
) {
    return clearCookie(
        request,
        AUTH_SESSION_COOKIE
    );
}

/* =========================================================
SESSION ID
========================================================= */

function createSessionId() {
    return crypto.randomUUID();
}

function normalizeSessionId(
    sessionId
) {
    const normalized =
        String(
            sessionId
            || ""
        )
            .trim();

    if (
        normalized.length < 5
    ) {
        return null;
    }

    return normalized;
}

function getSessionKey(
    sessionId
) {
    const normalized =
        normalizeSessionId(
            sessionId
        );

    return normalized
        ? `session:${normalized}`
        : null;
}

export function getSessionIdFromRequest(
    request
) {
    return normalizeSessionId(
        getCookie(
            request,
            AUTH_SESSION_COOKIE
        )
    );
}

/* =========================================================
GENERAL NORMALIZATION
========================================================= */

function normalizeSessionData(
    sessionData
) {
    if (
        !sessionData
        || typeof sessionData !== "object"
        || Array.isArray(
            sessionData
        )
    ) {
        return {};
    }

    return {
        ...sessionData
    };
}

function normalizeProviderName(
    provider
) {
    const normalized =
        String(
            provider
            || ""
        )
            .trim()
            .toLowerCase();

    return normalized
        || null;
}

function normalizeProviderData(
    providerData
) {
    if (
        !providerData
        || typeof providerData !== "object"
        || Array.isArray(
            providerData
        )
    ) {
        return {};
    }

    return {
        ...providerData
    };
}

function normalizeProviders(
    providers
) {
    if (
        !providers
        || typeof providers !== "object"
        || Array.isArray(
            providers
        )
    ) {
        return {};
    }

    const normalizedProviders =
        {};

    for (
        const [
            provider,
            providerData
        ]
        of Object.entries(
            providers
        )
    ) {
        const providerName =
            normalizeProviderName(
                provider
            );

        if (
            !providerName
        ) {
            continue;
        }

        normalizedProviders[
            providerName
        ] =
            normalizeProviderData(
                providerData
            );
    }

    return normalizedProviders;
}

/* =========================================================
SESSION RETRIEVAL
========================================================= */

export async function getStoredSession(
    request,
    env
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        return null;
    }

    const sessionId =
        getSessionIdFromRequest(
            request
        );

    if (
        !sessionId
    ) {
        return null;
    }

    const key =
        getSessionKey(
            sessionId
        );

    if (
        !key
    ) {
        return null;
    }

    const data =
        await env.AUTH_SESSIONS.get(
            key,
            "json"
        );

    if (
        !data
        || typeof data !== "object"
        || Array.isArray(
            data
        )
    ) {
        return null;
    }

    const now =
        Date.now();

    const absoluteExpiresAt =
        Number(
            data.AbsoluteExpiresAt
        );

    if (
        !Number.isFinite(
            absoluteExpiresAt
        )
        || absoluteExpiresAt <= now
    ) {
        try {
            await env.AUTH_SESSIONS.delete(
                key
            );
        }
        catch (
            error
        ) {
            console.warn(
                "BPD SESSION: Expired session cleanup failed.",
                {
                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }

        return null;
    }

    const remainingAbsoluteSeconds =
        Math.floor(
            (
                absoluteExpiresAt
                - now
            )
            / 1000
        );

    if (
        remainingAbsoluteSeconds <= 0
    ) {
        return null;
    }

    const lastSeenAt =
        Number(
            data.LastSeenAt
            || 0
        );

    const shouldRefresh =
        (
            !Number.isFinite(
                lastSeenAt
            )
            || lastSeenAt <= 0
            || (
                now
                - lastSeenAt
            ) >=
                SESSION_REFRESH_INTERVAL_MS
        );

    if (
        shouldRefresh
    ) {
        const nextIdleTtl =
            Math.max(
                1,
                Math.min(
                    SESSION_IDLE_TTL_SECONDS,
                    remainingAbsoluteSeconds
                )
            );

        data.LastSeenAt =
            now;

        try {
            await env.AUTH_SESSIONS.put(
                key,
                JSON.stringify(
                    data
                ),
                {
                    expirationTtl:
                        nextIdleTtl
                }
            );
        }
        catch (
            error
        ) {
            /*
             * Failure to refresh the idle TTL should not
             * automatically invalidate an otherwise valid
             * session during the current request.
             */
            console.error(
                "BPD SESSION: Failed to refresh session TTL.",
                {
                    name:
                        error?.name
                        || "Error",

                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }

    return {
        sessionId,

        sessionData:
            data
    };
}

/* =========================================================
WRITE SESSION
========================================================= */

export async function writeSession(
    env,
    sessionId,
    sessionData
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        throw new Error(
            "AUTH_SESSIONS is not configured."
        );
    }

    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        throw new Error(
            "Session ID is invalid."
        );
    }

    const key =
        getSessionKey(
            normalizedSessionId
        );

    const data =
        normalizeSessionData(
            sessionData
        );

    const now =
        Date.now();

    const absoluteExpiresAt =
        Number(
            data.AbsoluteExpiresAt
        );

    if (
        !Number.isFinite(
            absoluteExpiresAt
        )
        || absoluteExpiresAt <= now
    ) {
        throw new Error(
            "Session absolute expiration is invalid."
        );
    }

    data.Providers =
        normalizeProviders(
            data.Providers
        );

    const remainingAbsoluteSeconds =
        Math.max(
            1,
            Math.floor(
                (
                    absoluteExpiresAt
                    - now
                )
                / 1000
            )
        );

    const expirationTtl =
        Math.min(
            SESSION_IDLE_TTL_SECONDS,
            remainingAbsoluteSeconds
        );

    await env.AUTH_SESSIONS.put(
        key,
        JSON.stringify(
            data
        ),
        {
            expirationTtl
        }
    );

    return {
        sessionId:
            normalizedSessionId,

        sessionData:
            data
    };
}

/* =========================================================
CREATE SESSION
========================================================= */

export async function createSession(
    env,
    initialData = {}
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        throw new Error(
            "AUTH_SESSIONS is not configured."
        );
    }

    const normalizedInitialData =
        normalizeSessionData(
            initialData
        );

    const sessionId =
        createSessionId();

    const now =
        Date.now();

    /*
     * System-owned session timestamps are deliberately set
     * here instead of accepting caller-provided values.
     */
    const sessionData = {
        UserId:
            normalizedInitialData.UserId
            || null,

        Role:
            normalizedInitialData.Role
            || null,

        Active:
            normalizedInitialData.Active !== false,

        CreatedAt:
            now,

        LastSeenAt:
            now,

        AbsoluteExpiresAt:
            now
            + (
                SESSION_ABSOLUTE_TTL_SECONDS
                * 1000
            ),

        Providers:
            normalizeProviders(
                normalizedInitialData.Providers
            )
    };

    /*
     * Preserve additional non-system fields temporarily for
     * backward compatibility with older session consumers.
     *
     * Critical session fields above cannot be overridden.
     */
    for (
        const [
            key,
            value
        ]
        of Object.entries(
            normalizedInitialData
        )
    ) {
        if (
            key === "UserId"
            || key === "Role"
            || key === "Active"
            || key === "CreatedAt"
            || key === "LastSeenAt"
            || key === "AbsoluteExpiresAt"
            || key === "Providers"
        ) {
            continue;
        }

        sessionData[
            key
        ] =
            value;
    }

    await writeSession(
        env,
        sessionId,
        sessionData
    );

    return {
        sessionId,
        sessionData
    };
}

/* =========================================================
UPDATE SESSION
========================================================= */

export async function updateSession(
    env,
    sessionId,
    updates
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        throw new Error(
            "AUTH_SESSIONS is not configured."
        );
    }

    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        throw new Error(
            "Session ID is invalid."
        );
    }

    const key =
        getSessionKey(
            normalizedSessionId
        );

    const existing =
        await env.AUTH_SESSIONS.get(
            key,
            "json"
        );

    if (
        !existing
        || typeof existing !== "object"
        || Array.isArray(
            existing
        )
    ) {
        throw new Error(
            "Session was not found."
        );
    }

    const normalizedUpdates =
        normalizeSessionData(
            updates
        );

    /*
     * CreatedAt and AbsoluteExpiresAt are system-controlled.
     * General session mutation cannot extend or replace them.
     */
    delete normalizedUpdates.CreatedAt;
    delete normalizedUpdates.AbsoluteExpiresAt;

    const nextSession = {
        ...existing,
        ...normalizedUpdates,

        CreatedAt:
            existing.CreatedAt,

        AbsoluteExpiresAt:
            existing.AbsoluteExpiresAt,

        LastSeenAt:
            Date.now()
    };

    if (
        Object.prototype.hasOwnProperty.call(
            normalizedUpdates,
            "Providers"
        )
    ) {
        nextSession.Providers = {
            ...normalizeProviders(
                existing.Providers
            ),

            ...normalizeProviders(
                normalizedUpdates.Providers
            )
        };
    }
    else {
        nextSession.Providers =
            normalizeProviders(
                existing.Providers
            );
    }

    await writeSession(
        env,
        normalizedSessionId,
        nextSession
    );

    return {
        sessionId:
            normalizedSessionId,

        sessionData:
            nextSession
    };
}

/* =========================================================
ATTACH / UPDATE PROVIDER
========================================================= */

export async function attachProviderToSession(
    env,
    sessionId,
    provider,
    providerData = {}
) {
    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        throw new Error(
            "Provider name is required."
        );
    }

    if (
        !env.AUTH_SESSIONS
    ) {
        throw new Error(
            "AUTH_SESSIONS is not configured."
        );
    }

    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        throw new Error(
            "Session ID is invalid."
        );
    }

    const key =
        getSessionKey(
            normalizedSessionId
        );

    const existing =
        await env.AUTH_SESSIONS.get(
            key,
            "json"
        );

    if (
        !existing
        || typeof existing !== "object"
        || Array.isArray(
            existing
        )
    ) {
        throw new Error(
            "Session was not found."
        );
    }

    const existingProviders =
        normalizeProviders(
            existing.Providers
        );

    const existingProvider =
        normalizeProviderData(
            existingProviders[
                providerName
            ]
        );

    const nextProvider = {
        ...existingProvider,
        ...normalizeProviderData(
            providerData
        )
    };

    if (
        nextProvider.Linked === undefined
    ) {
        nextProvider.Linked =
            true;
    }

    const nextSession = {
        ...existing,

        LastSeenAt:
            Date.now(),

        Providers: {
            ...existingProviders,

            [
                providerName
            ]:
                nextProvider
        }
    };

    await writeSession(
        env,
        normalizedSessionId,
        nextSession
    );

    return {
        sessionId:
            normalizedSessionId,

        provider:
            providerName,

        providerData:
            nextProvider,

        sessionData:
            nextSession
    };
}

/* =========================================================
REMOVE PROVIDER
========================================================= */

export async function removeProviderFromSession(
    env,
    sessionId,
    provider
) {
    const providerName =
        normalizeProviderName(
            provider
        );

    if (
        !providerName
    ) {
        throw new Error(
            "Provider name is required."
        );
    }

    if (
        !env.AUTH_SESSIONS
    ) {
        throw new Error(
            "AUTH_SESSIONS is not configured."
        );
    }

    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        throw new Error(
            "Session ID is invalid."
        );
    }

    const key =
        getSessionKey(
            normalizedSessionId
        );

    const existing =
        await env.AUTH_SESSIONS.get(
            key,
            "json"
        );

    if (
        !existing
        || typeof existing !== "object"
        || Array.isArray(
            existing
        )
    ) {
        throw new Error(
            "Session was not found."
        );
    }

    const providers =
        normalizeProviders(
            existing.Providers
        );

    delete providers[
        providerName
    ];

    const nextSession = {
        ...existing,

        Providers:
            providers,

        LastSeenAt:
            Date.now()
    };

    /*
     * Temporary migration cleanup.
     *
     * session_context.js currently supports older Epic
     * sessions by reconstructing Providers.epic from these
     * root-level fields.
     *
     * They must therefore also be removed when Epic is
     * explicitly unlinked.
     */
    if (
        providerName === "epic"
    ) {
        delete nextSession.EpicUniqueId;
        delete nextSession.EpicDisplayName;
        delete nextSession.EpicPreferredUsername;
        delete nextSession.EpicAuthenticatedAt;
    }

    await writeSession(
        env,
        normalizedSessionId,
        nextSession
    );

    return {
        sessionId:
            normalizedSessionId,

        provider:
            providerName,

        sessionData:
            nextSession
    };
}

/* =========================================================
SET GLOBAL ACCOUNT
========================================================= */

export async function setSessionUser(
    env,
    sessionId,
    {
        userId = null,
        role = null,
        active = true
    } = {}
) {
    const normalizedUserId =
        typeof userId === "string"
            ? userId.trim()
            : "";

    const normalizedRole =
        typeof role === "string"
            ? role.trim()
            : "";

    return updateSession(
        env,
        sessionId,
        {
            UserId:
                normalizedUserId
                || null,

            Role:
                normalizedRole
                || null,

            Active:
                active === true
        }
    );
}

/* =========================================================
DELETE SESSION
========================================================= */

export async function deleteSession(
    env,
    sessionId
) {
    if (
        !env.AUTH_SESSIONS
    ) {
        return false;
    }

    const normalizedSessionId =
        normalizeSessionId(
            sessionId
        );

    if (
        !normalizedSessionId
    ) {
        return false;
    }

    const key =
        getSessionKey(
            normalizedSessionId
        );

    await env.AUTH_SESSIONS.delete(
        key
    );

    return true;
}

/* =========================================================
DESTROY REQUEST SESSION
========================================================= */

export async function destroyRequestSession(
    request,
    env
) {
    const sessionId =
        getSessionIdFromRequest(
            request
        );

    if (
        sessionId
    ) {
        try {
            await deleteSession(
                env,
                sessionId
            );
        }
        catch (
            error
        ) {
            /*
             * Browser cookie should still be cleared even if
             * KV deletion fails.
             */
            console.warn(
                "BPD SESSION: Session deletion failed.",
                {
                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }

    return clearSessionCookie(
        request
    );
}

/* =========================================================
REPLACE REQUEST SESSION
========================================================= */

export async function replaceRequestSession(
    request,
    env,
    initialData = {}
) {
    const existingSessionId =
        getSessionIdFromRequest(
            request
        );

    if (
        existingSessionId
    ) {
        try {
            await deleteSession(
                env,
                existingSessionId
            );
        }
        catch (
            error
        ) {
            console.warn(
                "BPD SESSION: Existing session cleanup failed.",
                {
                    message:
                        error?.message
                        || "Unknown error"
                }
            );
        }
    }

    const created =
        await createSession(
            env,
            initialData
        );

    const cookie =
        createSessionCookie(
            request,
            created.sessionId
        );

    if (
        !cookie
    ) {
        await deleteSession(
            env,
            created.sessionId
        );

        throw new Error(
            "Session cookie creation failed."
        );
    }

    return {
        sessionId:
            created.sessionId,

        sessionData:
            created.sessionData,

        cookie
    };
}

/* =========================================================
TTL EXPORTS
========================================================= */

export const SESSION_IDLE_TTL =
    SESSION_IDLE_TTL_SECONDS;

export const SESSION_ABSOLUTE_TTL =
    SESSION_ABSOLUTE_TTL_SECONDS;