"use strict";

import {
    ROCKET_LEAGUE_PROFILE_URL
} from "/scripts/apiRoutes.js";

import {
    renderRocketLeagueRanks
} from "./ranks.js";

function setPlayerName(value) {
    const playerNameElement =
        document.getElementById(
            "rocketLeaguePlayerName"
        );

    if (!playerNameElement) {
        return;
    }

    playerNameElement.textContent =
        value || "Epic Player";
}

function setRankStatus(
    message,
    state
) {
    const statusElement =
        document.getElementById(
            "rocketLeagueRankStatus"
        );

    if (!statusElement) {
        return;
    }

    statusElement.textContent =
        message;

    statusElement.dataset.state =
        state;
}

function renderRocketLeagueProfile(
    authUser,
    profile
) {
    setPlayerName(
        profile?.username ||
        authUser?.displayName ||
        "Epic Player"
    );

    const ranked =
        profile?.stats?.ranked || {};

    renderRocketLeagueRanks(ranked);

    setRankStatus(
        "Current competitive playlist ratings",
        "ready"
    );
}

export async function loadRocketLeagueProfile(
    authUser
) {
    setPlayerName(
        authUser?.displayName ||
        "Epic Player"
    );

    const response =
        await fetch(
            ROCKET_LEAGUE_PROFILE_URL,
            {
                method: "GET",
                credentials: "same-origin",
                cache: "no-store",
                headers: {
                    "accept":
                        "application/json"
                }
            }
        );

    const result =
        await response.json().catch(
            function() {
                return {};
            }
        );

    if (
        !response.ok ||
        result.success !== true
    ) {
        throw new Error(
            result.message ||
            "Rocket League profile could not be loaded."
        );
    }

    renderRocketLeagueProfile(
        authUser,
        result.profile
    );
}