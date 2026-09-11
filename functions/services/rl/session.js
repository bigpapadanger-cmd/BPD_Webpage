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
    Returns Rocket League authentication and profile state
    for the current BPD browser session.

Description:
    - Uses the global BPD session as the authentication source.
    - Uses identity.accounts.id as the canonical account ID.
    - Requires a linked Epic provider for Rocket League access.
    - Loads the Rocket League profile by account_id.
    - Returns authoritative profile/access state from Supabase.
    - Does not create or repair identities.

Identity Model:
    session.userId
        = identity.accounts.id

    core.rl_players.account_id
        = identity.accounts.id

    providers.epic.accountId
        = Epic account ID

Important:
    - Global BPD authentication does not require Epic.
    - Rocket League functionality does require linked Epic.
    - Epic account ID is provider metadata, not ownership.
    - Supabase profile failure does not invalidate the global
      BPD session.
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
        typeof value !== "string"
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

function getProfileComplete(
    profile
) {
    return (
        profile?.profileComplete === true
        || profile?.profile_complete === true
    );
}

function getRocketLeagueAccess(
    profile
) {
    return (
        profile?.rocketLeagueAccess === true
        || profile?.rocket_league_access === true
    );
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
            session.authenticated !== true
        ) {
            return json(
                {
                    success:
                        true,

                    authenticated:
                        false,

                    requiresEpicLogin:
                        true,

                    user:
                        null,

                    profileLoaded:
                        false,

                    profileComplete:
                        false,

                    rocketLeagueAccess:
                        false,

                    profileError:
                        null
                }
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

                    requiresEpicLogin:
                        false,

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    user:
                        null,

                    profileLoaded:
                        false,

                    profileComplete:
                        false,

                    rocketLeagueAccess:
                        false,

                    profileError:
                        null,

                    message:
                        "Your global BPD account identity could not be resolved.",

                    debugId
                },
                409
            );
        }

        if (
            session.active !== true
        ) {
            return json(
                {
                    success:
                        false,

                    authenticated:
                        true,

                    requiresEpicLogin:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    user: {
                        accountId,

                        userId:
                            accountId,

                        role:
                            session.role,

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

                    profileLoaded:
                        false,

                    profileComplete:
                        false,

                    rocketLeagueAccess:
                        false,

                    profileError:
                        null,

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

        if (
            epic?.linked !== true
            || !epicAccountId
        ) {
            return json(
                {
                    success:
                        true,

                    authenticated:
                        true,

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
                            session.role,

                        active:
                            session.active === true,

                        rlPlayerId:
                            null,

                        EpicUniqueId:
                            null,

                        EpicDisplayName:
                            null,

                        EpicPreferredUsername:
                            null
                    },

                    profileLoaded:
                        false,

                    profileComplete:
                        false,

                    rocketLeagueAccess:
                        false,

                    profileError:
                        null
                }
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
                    && returnedAccountId !== accountId
                ) {
                    throw new Error(
                        "Rocket League profile returned an unexpected global account."
                    );
                }
            }

            const rlPlayerId =
                getProfileRlPlayerId(
                    profile
                );

            profileLoaded =
                Boolean(
                    profile
                    && rlPlayerId
                );
        }
        catch (
            error
        ) {
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
        RESPONSE STATE
        ================================================= */

        const rlPlayerId =
            getProfileRlPlayerId(
                profile
            );

        const profileComplete =
            getProfileComplete(
                profile
            );

        const rocketLeagueAccess =
            getRocketLeagueAccess(
                profile
            );

        const role =
            normalizeNullableString(
                profile?.role
            )
            || session.role
            || null;

        const active =
            profile
                ? profile.active === true
                : session.active === true;

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

                requiresEpicLogin:
                    false,

                user,

                profileLoaded,

                profileComplete,

                rocketLeagueAccess,

                profileError
            }
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

                requiresEpicLogin:
                    false,

                user:
                    null,

                profileLoaded:
                    false,

                profileComplete:
                    false,

                rocketLeagueAccess:
                    false,

                profileError:
                    null,

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