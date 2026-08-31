"use strict";
import {
    ROCKET_LEAGUE_PROFILE_URL
} from "/scripts/apiRoutes.js";
import {
    renderRocketLeagueRanks
} from "./ranks.js";

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


function getEpicDisplayName(
    authUser
) {
    return (
        authUser?.EpicDisplayName ||
        authUser?.EpicPreferredUsername ||
        authUser?.displayName ||
        authUser?.preferredUsername ||
        ""
    );
}
function setPlayerName(value) {
    const playerNameElement =
        document.getElementById(
            "rocketLeaguePlayerName"
        );
    if (!playerNameElement) {
        return;
    }
    playerNameElement.textContent =
        value ||
        "Epic Player";
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


function hasRocketLeagueAccess(
    result,
    profile
) {
    if (
        isProfileComplete(
            result,
            profile
        )
    ) {
        return true;
    }

    if (
        result?.registrationAccepted === true
    ) {
        return true;
    }

    return (
        localStorage.getItem(
            "bpdRocketLeagueRegistrationAccepted"
        ) === "true"
    );
}


function isProfileComplete(
    result,
    profile
) {
    if (
        result?.profileComplete === true ||
        result?.profileCompleted === true ||
        result?.registrationComplete === true ||
        profile?.profileComplete === true ||
        profile?.profileCompleted === true ||
        profile?.registrationComplete === true
    ) {
        return true;
    }
    return false;
}
function renderRocketLeagueProfile(
    authUser,
    profile
) {
    setPlayerName(
        profile?.username ||
        profile?.displayName ||
        getEpicDisplayName(
            authUser
        ) ||
        ""
    );
    const ranked =
        profile?.stats?.ranked ||
        profile?.ranked ||
        {};
    renderRocketLeagueRanks(
        ranked
    );
    const hasRankData =
        Object.keys(
            ranked
        ).length > 0;
    setRankStatus(
        hasRankData
            ? "Current competitive playlist ratings"
            : "No competitive MMR found",
        hasRankData
            ? "ready"
            : "empty"
    );
}

export async function loadRocketLeagueProfile(
    authUser
) {
    setPlayerName(
        getEpicDisplayName(
            authUser
        ) ||
        ""
    );

    setProfileWarning(
        false
    );

    const response =
        await fetch(
            ROCKET_LEAGUE_PROFILE_URL,
            {
                method:
                    "GET",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers: {
                    "accept":
                        "application/json"
                }
            }
        );

    const result =
        await response
            .json()
            .catch(
                function() {
                    return {};
                }
            );

    if (
        !response.ok ||
        result.success !== true
    ) {
        setProfileWarning(
            true,
            (
                result.message ||
                (
                    "Your Epic account is signed in, " +
                    "but your BPD Gaming Network profile " +
                    "could not be loaded."
                )
            )
        );

        renderRocketLeagueRanks(
            {}
        );

        setRankStatus(
            "Profile data unavailable",
            "warning"
        );

        return {
            profile:
                null,

            profileComplete:
                false,

            registrationAccepted:
                false,

            rocketLeagueAccess:
                false,

            profileSaved:
                false,

            profileLoaded:
                false
        };
    }

    const profile =
        result.profile ||
        {};

    renderRocketLeagueProfile(
        authUser,
        profile
    );

    const profileComplete =
        isProfileComplete(
            result,
            profile
        );

    const registrationAccepted =
        result?.registrationAccepted === true ||
        localStorage.getItem(
            "bpdRocketLeagueRegistrationAccepted"
        ) === "true";

    const rocketLeagueAccess =
        profileComplete ||
        registrationAccepted;

    return {
        profile,

        profileComplete,

        registrationAccepted,

        rocketLeagueAccess,

        profileSaved:
            result?.profileSaved === true,

        profileLoaded:
            true
    };
}