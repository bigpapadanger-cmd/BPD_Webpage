"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PROFILE CONTROLLER

File:
    /Tabs/RocketLeague/Index/JS/profile.js

Purpose:
    Loads and renders the authenticated user's Rocket League
    profile, player-submitted starting ranks, and current
    authoritative competitive rank/MMR information.

Responsibilities:
    - Loads Rocket League profile data.
    - Distinguishes missing profiles from service failures.
    - Resolves player display name.
    - Separates player-entered rank data from current
      authoritative rank/MMR data.
    - Passes both rank sources to ranks.js.
    - Returns normalized Rocket League profile/access state
      to auth.js.
    - Does not determine rank themes itself.
    - Does not trust browser input as current MMR.

Security:
    - Current rank/MMR must originate from server-returned
      profile data.
    - Player-entered ranks are informational only.
    - Client-side state controls UI visibility only.
    - Rocket League APIs remain authoritative.
========================================================= */

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

import { formatRocketLeagueTimestamp } from "../../shared/profilePresentation.js";
import { renderMmrHistory, renderMmrProgression } from "./mmr_dashboard.js";

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

/* =========================================================
PROFILE ERROR
========================================================= */

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

function renderProviderDisplayName(profile, primaryName) {
    const nameElement = document.getElementById("rocketLeagueProviderDisplayName");
    const freshnessElement = document.getElementById("rocketLeagueProviderFreshness");
    if (!nameElement || !freshnessElement) return;

    const providerName = normalizeString(profile?.provider?.displayUsername);
    const showProviderName = providerName && providerName !== primaryName;
    nameElement.textContent = showProviderName ? `Rocket League: ${providerName}` : "";
    nameElement.hidden = !showProviderName;

    const updatedAt = formatProfileTimestamp(profile?.provider?.providerUpdatedAt);
    freshnessElement.textContent = providerName && updatedAt ? `Rocket League name updated ${updatedAt}` : "";
    freshnessElement.hidden = !(providerName && updatedAt);
}

function formatProfileTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
}

function renderMmrFreshness(currentRanked) {
    const freshness = document.getElementById("rocketLeagueMmrFreshness");
    if (!freshness) return;

    const capturedAt = formatRocketLeagueTimestamp(currentRanked?.capturedAt);
    freshness.textContent = capturedAt ? `MMR last updated ${capturedAt}` : "";
    freshness.hidden = !capturedAt;
}

function renderCareerStats(profile) {
    const section = document.getElementById("rocketLeagueCareerStats");
    const grid = document.getElementById("rocketLeagueCareerStatsGrid");
    const freshness = document.getElementById("rocketLeagueCareerStatsFreshness");
    if (!section || !grid || !freshness) return;

    const labels = [
        ["wins", "Wins"], ["goals", "Goals"], ["assists", "Assists"],
        ["saves", "Saves"], ["shots", "Shots"], ["mvps", "MVPs"]
    ];
    grid.replaceChildren();
    for (const [key, label] of labels) {
        const value = profile?.stats?.career?.[key];
        if (!Number.isSafeInteger(value) || value < 0) continue;

        const item = document.createElement("div");
        item.className = "career-stat";
        const name = document.createElement("span");
        name.textContent = label;
        const total = document.createElement("strong");
        total.textContent = value.toLocaleString();
        item.append(name, total);
        grid.append(item);
    }

    section.hidden = grid.childElementCount === 0;
    const capturedAt = formatProfileTimestamp(profile?.stats?.career?.capturedAt);
    freshness.textContent = capturedAt ? `Career totals captured ${capturedAt}` : "";
    freshness.hidden = section.hidden || !capturedAt;
}

function renderProfilePrivacy(profile) {
    const summary = document.getElementById("rocketLeaguePrivacySummary");
    const findProfile = document.getElementById("rocketLeagueFindPlayersPrivacy");
    const presence = document.getElementById("rocketLeaguePresencePrivacy");
    if (!summary || !findProfile || !presence) return;

    findProfile.textContent = profile?.findProfileEnabled === true
        ? "Find Players: On"
        : "Find Players: Off — your profile is not listed.";
    presence.textContent = profile?.showOnlineStatus === true
        ? "Online presence sharing: On"
        : "Presence not shared";
    summary.hidden = false;
}

/* =========================================================
PROFILE EXISTENCE
========================================================= */

function profileExists(
    result,
    profile
) {
    if (
        result?.profileExists ===
        true
    ) {
        return true;
    }

    if (
        result?.profileExists ===
        false
    ) {
        return false;
    }

    return Object.keys(
        normalizeObject(
            profile
        )
    ).length > 0;
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

/* =========================================================
PLAYER-ENTERED RANKS
========================================================= */

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

/* =========================================================
CURRENT AUTHORITATIVE RANKS
========================================================= */

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

/* =========================================================
RANK DATA STATE
========================================================= */

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

function applyRankDatasets(
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

/* =========================================================
RENDER ROCKET LEAGUE PROFILE
========================================================= */

function renderRocketLeagueProfile(
    result,
    authUser,
    profile
) {
    const displayName = getProfileDisplayName(result, profile, authUser);
    setPlayerName(displayName);
    renderProviderDisplayName(profile, displayName);
    renderCareerStats(profile);
    renderMmrProgression(result.mmrProgression);
    renderMmrHistory(result.mmrHistory);

    const inputRanked =
        getInputRanked(
            profile
        );

    const currentRanked =
        getCurrentRanked(
            profile
        );

    renderMmrFreshness(currentRanked);

    applyRankDatasets(
        inputRanked,
        currentRanked
    );

    renderProfilePrivacy(profile);

    return {
        inputRanked,
        currentRanked
    };
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

        return normalizeObject(
            body
        );
    }
    catch {
        return {};
    }
}

/* =========================================================
RESET PROFILE DISPLAY
========================================================= */

function resetProfileDisplay(
    message =
        "Profile data unavailable"
) {
    renderProviderDisplayName({}, "");
    renderCareerStats({});
    renderMmrFreshness({});
    document.body.dataset.rlInputRankAvailable =
        "false";

    document.body.dataset.rlCurrentRankAvailable =
        "false";

    renderUnavailableRanks(
        message
    );
}

/* =========================================================
PROFILE-NOT-FOUND DETECTION

This must match the server response we verify next.

For now it accepts common transitional codes and 404.
========================================================= */

function isProfileNotFoundResponse(
    response,
    result
) {
    const code =
        normalizeString(
            result?.code
        )
            .toUpperCase();

    return (
        response.status ===
            404
        || code ===
            "ROCKET_LEAGUE_PROFILE_NOT_FOUND"
        || code ===
            "PROFILE_NOT_FOUND"
        || code ===
            "RL_PROFILE_NOT_FOUND"
    );
}

/* =========================================================
MISSING PROFILE STATE

This is not an error.

Epic may be linked successfully while the user has not yet
created/completed a Rocket League profile.
========================================================= */

function createMissingProfileResult(
    authUser
) {
    renderProviderDisplayName({}, "");
    renderCareerStats({});
    renderMmrFreshness({});
    setProfileWarning(
        false
    );

    setPlayerName(
        authUser?.displayName
        || ""
    );

    document.body.dataset.rlInputRankAvailable =
        "false";

    document.body.dataset.rlCurrentRankAvailable =
        "false";

    renderRocketLeagueRanks({
        input:
            {},
        current:
            {}
    });

    return {
        profile:
            {},

        ranks: {
            input:
                {},

            current:
                {}
        },

        rankState: {
            inputAvailable:
                false,

            currentAvailable:
                false
        },

        profileExists:
            false,

        profileComplete:
            false,

        registrationAccepted:
            false,

        rocketLeagueAccess:
            false,

        profileSaved:
            false,

        profileLoaded:
            true
    };
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

/* =========================================================
LOAD ROCKET LEAGUE PROFILE
========================================================= */

export async function loadRocketLeagueProfile(
    authUser
) {
    renderMmrFreshness({});
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
                `${ROCKET_LEAGUE_PROFILE_URL}?includePresence=false&includeMmrProgression=true&includeMmrHistory=true`,
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

    /* =====================================================
    PROFILE DOES NOT EXIST YET

    This is a valid setup state, not a service failure.
    ===================================================== */

    if (
        isProfileNotFoundResponse(
            response,
            result
        )
    ) {
        return createMissingProfileResult(
            authUser
        );
    }

    /* =====================================================
    ACTUAL REQUEST FAILURE
    ===================================================== */

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

    if (
        typeof result.profileExists !== "boolean"
        || typeof result.profileComplete !== "boolean"
        || typeof result.registrationAccepted !== "boolean"
        || typeof result.rocketLeagueAccess !== "boolean"
        || (result.profileExists && Object.keys(profile).length === 0)
    ) {
        handleProfileRequestFailure(response, { code: "ROCKET_LEAGUE_PROFILE_RESPONSE_INVALID" });
    }

    const exists =
        profileExists(
            result,
            profile
        );

    /*
     * A successful response may still explicitly indicate
     * that no profile exists.
     */
    if (
        !exists
    ) {
        return createMissingProfileResult(
            authUser
        );
    }

    const inputRanked = getInputRanked(profile);
    const currentRanked = getCurrentRanked(profile);
    try {
        renderRocketLeagueProfile(result, authUser, profile);
    } catch (error) {
        console.error("ROCKET LEAGUE PROFILE PRESENTATION: unavailable.", {
            name: error?.name || "Error"
        });
        setProfileWarning(true, "Some Rocket League profile details are temporarily unavailable.");
        try {
            renderUnavailableRanks("Rank display is temporarily unavailable.");
        } catch {
            // A failed display component must not invalidate server-confirmed profile state.
        }
    }

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

        profileExists:
            true,

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
