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
    Returns Rocket League authentication, registration,
    profile, and access state for the current BPD browser
    session.

Description:
    - Uses the global BPD session as the authentication source.
    - Uses identity.accounts.id as the canonical account ID.
    - Does not create or modify account/provider identities.
    - Checks whether Epic is linked to the BPD account.
    - Loads the Rocket League profile by account_id.
    - Requires an active BPD account.
    - Requires an active Rocket League player for RL access.
    - Requires completed registration status.
    - Requires age/eligibility consent.
    - Requires Terms of Service / Privacy acknowledgement.
    - Requires stored profile completion.
    - Requires stored Rocket League access.
    - Fails Rocket League access closed.
    - Profile lookup failure does not invalidate the global
      BPD session.

Identity Model:
    session.userId
        = identity.accounts.id

    core.rl_players.account_id
        = identity.accounts.id

    providers.epic.accountId
        = Epic account ID

Rocket League Access Model:
    authenticated BPD account
        +
    active BPD account
        +
    linked Epic provider
        +
    persisted Rocket League player
        +
    active Rocket League player
        +
    registration_status = complete
        +
    age consent = true
        +
    policy consent = true
        +
    stored profile_complete = true
        +
    stored rocket_league_access = true
        =
    rocketLeagueAccess = true

Important:
    - Global BPD authentication does not require Epic.
    - Rocket League access does require Epic.
    - Epic provider metadata is not the canonical BPD
      ownership key.
    - Legacy registration rows cannot bypass either required
      consent.
    - Stored profileComplete and rocketLeagueAccess values
      are never trusted without their prerequisite gates.
========================================================= */

import {
    json
} from "../common_helpers/responses.js";

import {
    getSessionContext,
    getProviderContext
} from "../auth/sessions/session_context.js";

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

        const session =
            await getSessionContext(
                request,
                env
            );

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

                    epicLinked:
                        false,

                    requiresEpicLogin:
                        false,

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

                    epicLinked:
                        false,

                    requiresEpicLogin:
                        false,

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

                    epicLinked:
                        false,

                    requiresEpicLogin:
                        false,

                    user: {
                        accountId,

                        /*
                         * Temporary compatibility alias.
                         */
                        userId:
                            accountId,

                        role:
                            session.role
                            || null,

                        active:
                            false,

                        rlPlayerId:
                            null,

                        EpicUniqueId:
                            null,

                        EpicDisplayName:
                            null,

                        EpicPreferredUsername:
                            null
                    },

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
        ================================================= */

        const epic =
            getProviderContext(
                session,
                "epic"
            );

        const epicAccountId =
            normalizeNullableString(
                epic?.accountId
            );

        const epicDisplayName =
            normalizeNullableString(
                epic?.displayName
            );

        const epicPreferredUsername =
            normalizeNullableString(
                epic?.preferredUsername
            );

        const epicLinked =
            epic?.linked ===
                true
            && Boolean(
                epicAccountId
            );

        if (
            !epicLinked
        ) {
            return json(
                {
                    success:
                        true,

                    authenticated:
                        true,

                    epicLinked:
                        false,

                    requiresEpicLogin:
                        true,

                    user: {
                        accountId,

                        /*
                         * Temporary compatibility alias.
                         */
                        userId:
                            accountId,

                        role:
                            session.role
                            || null,

                        active:
                            true,

                        rlPlayerId:
                            null,

                        EpicUniqueId:
                            null,

                        EpicDisplayName:
                            null,

                        EpicPreferredUsername:
                            null
                    },

                    ...buildEmptyRocketLeagueState()
                },
                200
            );
        }

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
        AUTHORITATIVE RESPONSE STATE
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

        /*
         * Global account activity was already required above.
         *
         * From this point forward, "active" represents the
         * persisted Rocket League player's active state.
         */
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

        /*
         * Registration status by itself is insufficient.
         *
         * Both consent requirements must also be present.
         */
        const registrationAccepted =
            profileLoaded ===
                true
            && registrationStatus ===
                "complete"
            && ageConsent ===
                true
            && policyConsent ===
                true;

        /*
         * A legacy stored profileComplete=true value cannot
         * bypass registration requirements.
         */
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
         * Every prerequisite must be satisfied before the
         * database access flag is honored.
         */
        const rocketLeagueAccess =
            profileLoaded ===
                true
            && epicLinked ===
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

        const user = {
            accountId,

            /*
             * Temporary compatibility alias.
             */
            userId:
                accountId,

            rlPlayerId,

            role,

            active,

            EpicUniqueId:
                epicAccountId,

            EpicDisplayName:
                epicDisplayName,

            EpicPreferredUsername:
                epicPreferredUsername
        };

        return json(
            {
                success:
                    true,

                authenticated:
                    true,

                epicLinked:
                    true,

                requiresEpicLogin:
                    false,

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

        return json(
            {
                success:
                    false,

                authenticated:
                    false,

                epicLinked:
                    false,

                requiresEpicLogin:
                    false,

                user:
                    null,

                ...buildEmptyRocketLeagueState(),

                code:
                    "ROCKET_LEAGUE_SESSION_FAILED",

                message:
                    "Rocket League session could not be loaded.",

                debugId
            },
            500
        );
    }
}