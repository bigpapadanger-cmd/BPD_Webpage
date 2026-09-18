"use strict";

/*
=========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE CONTROLLER

File:
    /Tabs/RocketLeague/JS/profile.js

Purpose:
    Loads and renders the authenticated user's Rocket League
    profile, player-submitted starting ranks, and current
    authoritative competitive rank/MMR information.

Rank Model:
    input
        Rank information entered by the player during
        Rocket League registration/profile setup.

    current
        Current competitive rank/MMR collected by the
        server-side Rocket League rank system and stored
        in Supabase.

Responsibilities:
    - Loads Rocket League profile data.
    - Resolves the player's display name.
    - Separates player-entered rank data from current
      authoritative rank/MMR.
    - Passes both rank sources to ranks.js.
    - Returns normalized Rocket League profile/access state.
    - Does not determine rank themes.
    - Does not trust browser input as current MMR.

Security:
    - Current rank/MMR must originate from server-returned
      profile data.
    - Player-entered rank is informational only.
    - Client-side state controls UI only.
    - Server APIs remain authoritative.

Recommended Server Shape:
    profile: {
        ranks: {
            input: {
                duel: {},
                double: {},
                standard: {}
            },
            current: {
                duel: {},
                double: {},
                standard: {}
            }
        }
    }
=========================================================
*/

import {
    ROCKET_LEAGUE_PROFILE_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../../scripts/apiConnection.js";

import {
    renderRocketLeagueRanks,
    renderUnavailableRanks
} from "./ranks.js";

/*
=========================================================
NORMALIZATION
=========================================================
*/

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeObject(
    value
) {
    if (
        !value
        || typeof value !==
            "object"
        || Array.isArray(
            value
        )
    ) {
        return {};
    }

    return value;
}

function normalizeRankCollection(
    value
) {
    return normalizeObject(
        value
    );
}

/*
=========================================================
PROFILE ERROR
=========================================================
*/

function createProfileError(
    message,
    {
        code =
            "ROCKET_LEAGUE_PROFILE_UNAVAILABLE",

        status =
            null
    } = {}
) {
    const error =
        new Error(
            message
        );

    error.code =
        code;

    error.status =
        status;

    return error;
}

/*
=========================================================
PROFILE WARNING
=========================================================
*/

function setProfileWarning(
    visible,
    message = ""
) {
    const warningElement =
        document.getElementById(
            "rocketLeagueProfileWarning"
        );

    if (
        !warningElement
    ) {
        return;
    }

    warningElement.hidden =
        !visible;

    if (
        !visible
    ) {
        return;
    }

    const messageElement =
        warningElement.querySelector(
            "span"
        );

    if (
        messageElement
        && message
    ) {
        messageElement.textContent =
            message;
    }
}

/*
=========================================================
PLAYER NAME
=========================================================
*/

function setPlayerName(
    value
) {
    const playerNameElement =
        document.getElementById(
            "rocketLeaguePlayerName"
        );

    if (
        !playerNameElement
    ) {
        return;
    }

    playerNameElement.textContent =
        normalizeString(
            value
        )
        || "Epic Player";
}

/*
=========================================================
PROFILE COMPLETE
=========================================================
*/

function isProfileComplete(
    result,
    profile
) {
    return (
        result?.profileComplete ===
            true
        || result?.profileCompleted ===
            true
        || result?.registrationComplete ===
            true
        || profile?.profileComplete ===
            true
        || profile?.profileCompleted ===
            true
        || profile?.registrationComplete ===
            true
    );
}

/*
=========================================================
PROFILE DISPLAY NAME
=========================================================
*/

function getProfileDisplayName(
    result,
    profile,
    authUser
) {
    const candidates = [
        profile?.username,
        profile?.displayName,
        result?.epicDisplayName,
        result?.epicPreferredUsername,
        authUser?.EpicDisplayName,
        authUser?.EpicPreferredUsername,
        authUser?.displayName
    ];

    for (
        const candidate
        of candidates
    ) {
        const value =
            normalizeString(
                candidate
            );

        if (
            value
        ) {
            return value;
        }
    }

    return "";
}

/*
=========================================================
PLAYER-ENTERED RANKS

Primary:
    profile.ranks.input

Transitional compatibility:
    profile.inputRanked
    profile.submittedRanks
    profile.registration.ranked
=========================================================
*/

function getInputRanked(
    profile
) {
    return normalizeRankCollection(
        profile?.ranks?.input
        || profile?.inputRanked
        || profile?.submittedRanks
        || profile?.registration?.ranked
    );
}

/*
=========================================================
CURRENT AUTHORITATIVE RANKS

Primary:
    profile.ranks.current

Transitional compatibility:
    profile.currentRanked
    profile.stats.ranked
    profile.ranked

This data must originate from the server/database.
=========================================================
*/

function getCurrentRanked(
    profile
) {
    return normalizeRankCollection(
        profile?.ranks?.current
        || profile?.currentRanked
        || profile?.stats?.ranked
        || profile?.ranked
    );
}

/*
=========================================================
RANK DATA STATE
=========================================================
*/

function hasRankData(
    ranked
) {
    return (
        ranked
        && typeof ranked ===
            "object"
        && !Array.isArray(
            ranked
        )
        && Object.keys(
            ranked
        ).length >
            0
    );
}

/*
=========================================================
APPLY RANK STATE
=========================================================
*/

function applyRankState(
    inputRanked,
    currentRanked
) {
    const inputAvailable =
        hasRankData(
            inputRanked
        );

    const currentAvailable =
        hasRankData(
            currentRanked
        );

    document.body.dataset.rlInputRankAvailable =
        String(
            inputAvailable
        );

    document.body.dataset.rlCurrentRankAvailable =
        String(
            currentAvailable
        );

    renderRocketLeagueRanks({
        input:
            inputRanked,

        current:
            currentRanked
    });
}

/*
=========================================================
RENDER ROCKET LEAGUE PROFILE
=========================================================
*/

function renderRocketLeagueProfile(
    result,
    authUser,
    profile
) {
    setPlayerName(
        getProfileDisplayName(
            result,
            profile,
            authUser
        )
    );

    const inputRanked =
        getInputRanked(
            profile
        );

    const currentRanked =
        getCurrentRanked(
            profile
        );

    applyRankState(
        inputRanked,
        currentRanked
    );

    return {
        inputRanked,
        currentRanked
    };
}

/*
=========================================================
READ RESPONSE BODY
=========================================================
*/

async function readResponseBody(
    response
) {
    try {
        const body =
            await response.json();

        return normalizeObject(
            body
        );
    }
    catch {
        return {};
    }
}

/*
=========================================================
RESET PROFILE DISPLAY
=========================================================
*/

function resetProfileDisplay(
    message =
        "Profile data unavailable"
) {
    document.body.dataset.rlInputRankAvailable =
        "false";

    document.body.dataset.rlCurrentRankAvailable =
        "false";

    renderUnavailableRanks(
        message
    );
}

/*
=========================================================
HANDLE PROFILE REQUEST FAILURE
=========================================================
*/

function handleProfileRequestFailure(
    response,
    result
) {
    const message =
        normalizeString(
            result?.message
            || result?.error
        )
        || (
            response.status >=
                500
                ? "Rocket League profile services are currently unavailable."
                : "Your Rocket League profile could not be loaded."
        );

    setProfileWarning(
        true,
        message
    );

    resetProfileDisplay(
        message
    );

    throw createProfileError(
        message,
        {
            code:
                normalizeString(
                    result?.code
                )
                || (
                    response.status >=
                        500
                        ? "ROCKET_LEAGUE_PROFILE_UNAVAILABLE"
                        : "ROCKET_LEAGUE_PROFILE_REQUEST_FAILED"
                ),

            status:
                response.status
        }
    );
}

/*
=========================================================
LOAD ROCKET LEAGUE PROFILE
=========================================================
*/

export async function loadRocketLeagueProfile(
    authUser
) {
    setPlayerName(
        ""
    );

    setProfileWarning(
        false
    );

    document.body.dataset.rlInputRankAvailable =
        "false";

    document.body.dataset.rlCurrentRankAvailable =
        "false";

    let response;

    try {
        response =
            await apiFetch(
                ROCKET_LEAGUE_PROFILE_URL,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );
    }
    catch (
        error
    ) {
        const message =
            navigator.onLine ===
                false
                ? "Rocket League profile data is unavailable while offline."
                : "Rocket League profile services are currently unavailable.";

        setProfileWarning(
            true,
            message
        );

        resetProfileDisplay(
            message
        );

        throw createProfileError(
            message,
            {
                code:
                    "ROCKET_LEAGUE_PROFILE_NETWORK_ERROR"
            }
        );
    }

    const result =
        await readResponseBody(
            response
        );

    if (
        !response.ok
        || result.success !==
            true
    ) {
        handleProfileRequestFailure(
            response,
            result
        );
    }

    const profile =
        normalizeObject(
            result.profile
        );

    const {
        inputRanked,
        currentRanked
    } =
        renderRocketLeagueProfile(
            result,
            authUser,
            profile
        );

    /*
     * Access state remains server-derived.
     *
     * Do not reconstruct Rocket League access from rank
     * availability or profile completeness on the client.
     */

    const profileComplete =
        isProfileComplete(
            result,
            profile
        );

    const registrationAccepted =
        result?.registrationAccepted ===
        true;

    const rocketLeagueAccess =
        result?.rocketLeagueAccess ===
        true;

    return {
        profile,

        ranks: {
            input:
                inputRanked,

            current:
                currentRanked
        },

        rankState: {
            inputAvailable:
                hasRankData(
                    inputRanked
                ),

            currentAvailable:
                hasRankData(
                    currentRanked
                )
        },

        profileComplete,

        registrationAccepted,

        rocketLeagueAccess,

        profileSaved:
            result?.profileSaved ===
            true,

        profileLoaded:
            true
    };
}