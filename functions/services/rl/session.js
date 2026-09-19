"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE SESSION SERVICE

File:
    functions/services/rl/session.js

Public Route:
    GET /api/auth/rocketleague/session

API Route:
    functions/api/auth/rocketleague/session.js

Purpose:
    Returns Rocket League authentication, Epic authorization,
    registration, profile, and access state for the current
    BPD browser session.

Epic State Model:
    epicLinked
        A permanent Epic identity is linked in Supabase.

    epicAuthorized
        The linked Epic identity currently satisfies the
        provider authentication-freshness policy.

    requiresEpicReauthorization
        Epic remains permanently linked, but its temporary
        authorization state must be refreshed.

    requiresEpicLogin
        No permanent Epic identity is linked.

Rocket League Access:
    Valid BPD session
        +
    Active BPD account
        +
    Permanently linked Epic identity
        +
    Currently authorized Epic identity
        +
    Persisted Rocket League player
        +
    Active Rocket League player
        +
    Completed registration
        +
    Age consent
        +
    Terms/Privacy consent
        +
    Stored profile completion
        +
    Stored Rocket League access
        =
    rocketLeagueAccess = true

Important:
    - Global BPD authentication does not require Epic.
    - Rocket League access does require currently authorized
      Epic.
    - A stale Epic identity remains linked.
    - Provider authorization failures fail Rocket League
      access closed.
    - Profile lookup failures do not invalidate the global
      BPD browser session.
========================================================= */

import {
    json
} from "../common_helpers/responses.js";

import {
    authorizeRequest,
    requireProvider
} from "../auth/authorization.js";

import {
    authorizationErrorResponse
} from "./authorization.js";

import {
    getRocketLeagueProfileByAccountId
} from "../supabase/rocketleague/rocketleague_profile.js";

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

function normalizeNullableString(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    return normalized
        || null;
}

/* =========================================================
PROFILE HELPERS
========================================================= */

function getProfileAccountId(
    profile
) {
    return normalizeNullableString(
        profile?.accountId
        || profile?.account_id
        || profile?.userId
        || profile?.user_id
    );
}

function getProfileRlPlayerId(
    profile
) {
    return normalizeNullableString(
        profile?.rlPlayerId
        || profile?.rl_player_id
    );
}

function getRegistrationStatus(
    profile
) {
    return (
        normalizeString(
            profile?.registrationStatus
            || profile?.registration_status
        )
            .toLowerCase()
        || "incomplete"
    );
}

function getAgeConsent(
    profile
) {
    return (
        profile?.ageConsent ===
            true
        || profile?.age_consent ===
            true
        || profile?.ageConsentVerified ===
            true
        || profile?.age_consent_verified ===
            true
    );
}

function getPolicyConsent(
    profile
) {
    return (
        profile?.policyConsent ===
            true
        || profile?.policy_consent ===
            true
        || profile?.policyConsentVerified ===
            true
        || profile?.policy_consent_verified ===
            true
    );
}

function getStoredProfileComplete(
    profile
) {
    return (
        profile?.profileComplete ===
            true
        || profile?.profile_complete ===
            true
    );
}

function getStoredRocketLeagueAccess(
    profile
) {
    return (
        profile?.rocketLeagueAccess ===
            true
        || profile?.rocket_league_access ===
            true
    );
}

/* =========================================================
EMPTY ROCKET LEAGUE STATE
========================================================= */

function buildEmptyRocketLeagueState(
    overrides = {}
) {
    return {
        profileLoaded:
            false,

        registrationStatus:
            "incomplete",

        ageConsent:
            false,

        policyConsent:
            false,

        registrationAccepted:
            false,

        profileComplete:
            false,

        rocketLeagueAccess:
            false,

        profileError:
            null,

        ...overrides
    };
}

/* =========================================================
EPIC STATE
========================================================= */

function buildEpicState(
    {
        linked = false,
        authorized = false,
        requiresReauthorization = false
    } = {}
) {
    const epicLinked =
        linked ===
        true;

    const epicAuthorized =
        epicLinked
        && authorized ===
            true;

    const requiresEpicReauthorization =
        epicLinked
        && epicAuthorized !==
            true
        && requiresReauthorization ===
            true;

    return {
        epicLinked,

        epicAuthorized,

        requiresEpicReauthorization,

        /*
         * "Login" means initial Epic connection/link.
         *
         * A permanently linked but stale Epic account must
         * never be represented as needing initial login.
         */
        requiresEpicLogin:
            epicLinked !==
            true
    };
}

/* =========================================================
BASE USER
========================================================= */

function buildBaseUser(
    session,
    accountId,
    overrides = {}
) {
    return {
        accountId,

        /*
         * Temporary compatibility alias.
         */
        userId:
            accountId,

        rlPlayerId:
            null,

        role:
            session?.role
            || null,

        active:
            session?.active ===
            true,

        EpicUniqueId:
            null,

        EpicDisplayName:
            null,

        EpicPreferredUsername:
            null,

        ...overrides
    };
}

/* =========================================================
MAIN
========================================================= */

export async function handleRocketLeagueSession(
    request,
    env
) {
    const debugId =
        crypto.randomUUID();

    try {
        /* =================================================
        GLOBAL BPD SESSION
        ================================================= */

        const authorization =
            await authorizeRequest(
                request,
                env,
                {
                    recovery:
                        true
                }
            );

        const session =
            authorization
                ?.sessionContext
            || null;

        if (
            session?.authenticated !==
            true
        ) {
            return json(
                {
                    success:
                        true,

                    authenticated:
                        false,

                    ...buildEpicState(),

                    user:
                        null,

                    ...buildEmptyRocketLeagueState()
                },
                200
            );
        }

        const accountId =
            normalizeNullableString(
                session.userId
            );

        if (
            !accountId
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    ...buildEpicState(),

                    user:
                        null,

                    ...buildEmptyRocketLeagueState(),

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    message:
                        "Your global BPD account identity could not be resolved.",

                    debugId
                },
                409
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

                    authenticated:
                        true,

                    ...buildEpicState(),

                    accountId,

                    userId:
                        accountId,

                    user:
                        buildBaseUser(
                            session,
                            accountId,
                            {
                                active:
                                    false
                            }
                        ),

                    ...buildEmptyRocketLeagueState(),

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "This BPD account is not active.",

                    debugId
                },
                403
            );
        }

        /* =================================================
        EPIC PROVIDER

        requireProvider() verifies both:

            1. permanent Supabase linkage
            2. current provider authorization freshness

        PROVIDER_REQUIRED
            No permanent Epic link exists.

        PROVIDER_REAUTHORIZATION_REQUIRED
            Permanent Epic link exists, but current provider
            authorization is stale/missing.
        ================================================= */

        let verifiedEpic;

        try {
            const providerAuthorization =
                await requireProvider(
                    authorization,
                    env,
                    "epic"
                );

            verifiedEpic =
                providerAuthorization
                    ?.provider
                || null;
        }
        catch (
            error
        ) {
            if (
                error?.code ===
                "PROVIDER_REQUIRED"
            ) {
                return json(
                    {
                        success:
                            true,

                        authenticated:
                            true,

                        ...buildEpicState({
                            linked:
                                false,

                            authorized:
                                false
                        }),

                        accountId,

                        userId:
                            accountId,

                        user:
                            buildBaseUser(
                                session,
                                accountId
                            ),

                        ...buildEmptyRocketLeagueState(),

                        code:
                            "EPIC_ACCOUNT_REQUIRED",

                        message:
                            "A linked Epic account is required to access Rocket League."
                    },
                    200
                );
            }

            if (
                error?.code ===
                "PROVIDER_REAUTHORIZATION_REQUIRED"
            ) {
                return json(
                    {
                        success:
                            true,

                        authenticated:
                            true,

                        ...buildEpicState({
                            linked:
                                true,

                            authorized:
                                false,

                            requiresReauthorization:
                                true
                        }),

                        accountId,

                        userId:
                            accountId,

                        user:
                            buildBaseUser(
                                session,
                                accountId
                            ),

                        ...buildEmptyRocketLeagueState(),

                        code:
                            "EPIC_REAUTHORIZATION_REQUIRED",

                        message:
                            "Your linked Epic account must be verified again before Rocket League features can be used."
                    },
                    200
                );
            }

            return authorizationErrorResponse(
                error
            );
        }

        /* =================================================
        VERIFIED EPIC IDENTITY
        ================================================= */

        const epicAccountId =
            normalizeNullableString(
                verifiedEpic?.subject
            );

        const epicDisplayName =
            normalizeNullableString(
                verifiedEpic
                    ?.displayUsername
            );

        if (
            !epicAccountId
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    ...buildEpicState({
                        linked:
                            true,

                        authorized:
                            false
                    }),

                    accountId,

                    userId:
                        accountId,

                    user:
                        buildBaseUser(
                            session,
                            accountId
                        ),

                    ...buildEmptyRocketLeagueState(),

                    code:
                        "EPIC_IDENTITY_VERIFICATION_INVALID",

                    message:
                        "The verified Epic account identity could not be resolved.",

                    debugId
                },
                503
            );
        }

        const epicState =
            buildEpicState({
                linked:
                    true,

                authorized:
                    true
            });

        /* =================================================
        PRESENTATION METADATA

        Permanent provider ownership is supplied by the
        verified provider identity above.

        Session provider metadata is presentation-only.
        ================================================= */

        const sessionEpic =
            authorization
                ?.providers
                ?.epic
            || session
                ?.providers
                ?.epic
            || null;

        const epicPreferredUsername =
            normalizeNullableString(
                sessionEpic
                    ?.preferredUsername
            )
            || epicDisplayName;

        const resolvedEpicDisplayName =
            normalizeNullableString(
                sessionEpic
                    ?.displayName
            )
            || epicDisplayName;

        /* =================================================
        ROCKET LEAGUE PROFILE
        ================================================= */

        let profile =
            null;

        let profileLoaded =
            false;

        let profileError =
            null;

        try {
            profile =
                await getRocketLeagueProfileByAccountId(
                    env,
                    accountId
                );

            if (
                profile
            ) {
                const returnedAccountId =
                    getProfileAccountId(
                        profile
                    );

                if (
                    returnedAccountId
                    && returnedAccountId !==
                        accountId
                ) {
                    throw new Error(
                        "Rocket League profile returned an unexpected global account."
                    );
                }
            }

            const loadedRlPlayerId =
                getProfileRlPlayerId(
                    profile
                );

            profileLoaded =
                Boolean(
                    profile
                    && loadedRlPlayerId
                );
        }
        catch (
            error
        ) {
            profile =
                null;

            profileLoaded =
                false;

            profileError =
                error?.message
                || "Rocket League profile data is temporarily unavailable.";

            console.error(
                "ROCKET LEAGUE SESSION: Profile lookup failed.",
                {
                    debugId,

                    name:
                        error?.name
                        || "Error",

                    code:
                        error?.code
                        || null,

                    message:
                        error?.message
                        || "Unknown error",

                    upstreamStatus:
                        error?.upstreamStatus
                        || null,

                    upstreamCode:
                        error?.upstreamCode
                        || null
                }
            );
        }

        /* =================================================
        AUTHORITATIVE ROCKET LEAGUE STATE
        ================================================= */

        const rlPlayerId =
            profileLoaded
                ? getProfileRlPlayerId(
                    profile
                )
                : null;

        const role =
            normalizeNullableString(
                profile?.role
            )
            || session.role
            || null;

        const active =
            profileLoaded ===
                true
            && profile?.active ===
                true;

        const registrationStatus =
            profileLoaded
                ? getRegistrationStatus(
                    profile
                )
                : "incomplete";

        const ageConsent =
            profileLoaded ===
                true
            && getAgeConsent(
                profile
            );

        const policyConsent =
            profileLoaded ===
                true
            && getPolicyConsent(
                profile
            );

        const registrationAccepted =
            profileLoaded ===
                true
            && registrationStatus ===
                "complete"
            && ageConsent ===
                true
            && policyConsent ===
                true;

        const profileComplete =
            profileLoaded ===
                true
            && registrationAccepted ===
                true
            && getStoredProfileComplete(
                profile
            ) ===
                true;

        /*
         * Full Rocket League access fails closed.
         *
         * At this point current Epic authorization has
         * already been verified by requireProvider().
         */
        const rocketLeagueAccess =
            profileLoaded ===
                true
            && epicState.epicLinked ===
                true
            && epicState.epicAuthorized ===
                true
            && active ===
                true
            && registrationAccepted ===
                true
            && profileComplete ===
                true
            && getStoredRocketLeagueAccess(
                profile
            ) ===
                true;

        const user =
            buildBaseUser(
                session,
                accountId,
                {
                    rlPlayerId,

                    role,

                    active,

                    EpicUniqueId:
                        epicAccountId,

                    EpicDisplayName:
                        resolvedEpicDisplayName,

                    EpicPreferredUsername:
                        epicPreferredUsername
                }
            );

        /* =================================================
        RESPONSE
        ================================================= */

        return json(
            {
                success:
                    true,

                authenticated:
                    true,

                ...epicState,

                accountId,

                userId:
                    accountId,

                user,

                profileLoaded,

                registrationStatus,

                ageConsent,

                policyConsent,

                registrationAccepted,

                profileComplete,

                rocketLeagueAccess,

                profileError
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE SESSION: Unexpected failure.",
            {
                debugId,

                name:
                    error?.name
                    || "Error",

                code:
                    error?.code
                    || null,

                message:
                    error?.message
                    || "Unknown error",

                stack:
                    error?.stack
                    || null,

                method:
                    request.method
            }
        );

        return authorizationErrorResponse(
            error
        );
    }
}