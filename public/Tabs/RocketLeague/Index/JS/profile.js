"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE CONTROLLER

File:
    /Tabs/RocketLeague/JS/profile.js

Purpose:
    Loads and renders the authenticated user's Rocket League
    profile and competitive rank information.

Description:
    - Loads Rocket League profile data from the centralized
      Rocket League profile API.
    - Uses /scripts/apiRoutes.js for the API route.
    - Renders the player's Rocket League display name.
    - Renders competitive playlist rank information.
    - Returns normalized Rocket League profile/access state
      to the Rocket League auth controller.
    - Does not use localStorage as profile or access state.
    - Does not independently calculate Rocket League access.

Security:
    - Rocket League profile and access state are determined
      by the server.
    - Client-side profile state controls UI only.
    - The browser does not supply the canonical BPD account
      ID or Epic account ID.
    - Server-side Rocket League authorization remains
      authoritative.

Important:
    - API/network failure is not treated as incomplete
      registration.
    - rocketLeagueAccess comes from the server response.
    - registrationAccepted comes from the server response.
    - profileComplete comes from the server response/profile.
========================================================= */

import {
    ROCKET_LEAGUE_PROFILE_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../../scripts/apiConnection.js";

import {
    renderRocketLeagueRanks
} from "./ranks.js";

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

/* =========================================================
PROFILE ERROR
========================================================= */

function createProfileError(
    message,
    {
        code = "ROCKET_LEAGUE_PROFILE_UNAVAILABLE",
        status = null
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

/* =========================================================
PROFILE WARNING
========================================================= */

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
        visible
        && message
    ) {
        const messageElement =
            warningElement.querySelector(
                "span"
            );

        if (
            messageElement
        ) {
            messageElement.textContent =
                message;
        }
    }
}

/* =========================================================
PLAYER NAME
========================================================= */

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

/* =========================================================
RANK STATUS
========================================================= */

function setRankStatus(
    message,
    state
) {
    const statusElement =
        document.getElementById(
            "rocketLeagueRankStatus"
        );

    if (
        !statusElement
    ) {
        return;
    }

    statusElement.textContent =
        message;

    statusElement.dataset.state =
        state;
}

/* =========================================================
PROFILE COMPLETE
========================================================= */

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

/* =========================================================
PROFILE DISPLAY NAME
========================================================= */

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
        authUser?.EpicPreferredUsername
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

/* =========================================================
RENDER ROCKET LEAGUE PROFILE
========================================================= */

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

    const ranked =
        profile?.stats?.ranked
        || profile?.ranked
        || {};

    renderRocketLeagueRanks(
        ranked
    );

    const hasRankData =
        (
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

    setRankStatus(
        hasRankData
            ? "Current competitive playlist ratings"
            : "No competitive MMR found",
        hasRankData
            ? "ready"
            : "empty"
    );
}

/* =========================================================
READ RESPONSE BODY
========================================================= */

async function readResponseBody(
    response
) {
    try {
        const body =
            await response.json();

        if (
            body
            && typeof body ===
                "object"
            && !Array.isArray(
                body
            )
        ) {
            return body;
        }
    }
    catch {
        // Response body is optional.
    }

    return {};
}

/* =========================================================
HANDLE PROFILE REQUEST FAILURE
========================================================= */

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

    renderRocketLeagueRanks(
        {}
    );

    setRankStatus(
        "Profile data unavailable",
        "warning"
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

/* =========================================================
LOAD ROCKET LEAGUE PROFILE
========================================================= */

export async function loadRocketLeagueProfile(
    authUser
) {
    setPlayerName(
        ""
    );

    setProfileWarning(
        false
    );

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

        renderRocketLeagueRanks(
            {}
        );

        setRankStatus(
            "Profile data unavailable",
            "warning"
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
        (
            result.profile
            && typeof result.profile ===
                "object"
            && !Array.isArray(
                result.profile
            )
        )
            ? result.profile
            : {};

    renderRocketLeagueProfile(
        result,
        authUser,
        profile
    );

    /* =====================================================
    SERVER-DERIVED ROCKET LEAGUE STATE

    Do not reconstruct rocketLeagueAccess here.

    The Rocket League service is responsible for deciding
    whether the user currently has Rocket League access.
    ===================================================== */

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