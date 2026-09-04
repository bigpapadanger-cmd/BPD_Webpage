"use strict";

import {
    ROCKET_LEAGUE_SESSION_URL
} from "/scripts/apiRoutes.js";

import {
    applySidebarAuthState
} from "./sidebar_auth.js";

import {
    loadRocketLeagueProfile
} from "./profile.js";

import {
    renderUnavailableRanks
} from "./ranks.js";
import { apiFetch } from "../../../../scripts/apiConnection.js";

const ROCKET_LEAGUE_PROFILE_PAGE =
    "/RocketLeague/Profile";

function normalizeAuthSession(
    authSession
) {
    return {
        authenticated:
            authSession?.authenticated ===
            true,

        user:
            authSession?.user ||
            null,

        registrationAccepted:
            authSession?.registrationAccepted ===
            true,

        profileComplete:
            authSession?.profileComplete ===
            true,

        rocketLeagueAccess:
            authSession?.rocketLeagueAccess ===
            true
    };
}

function applyRocketLeagueAuthView(
    authSession
) {
    const normalizedSession =
        normalizeAuthSession(
            authSession
        );

    const {
        authenticated
    } =
        normalizedSession;

    const loggedOutContent =
        document.getElementById(
            "rocketLeagueLoggedOut"
        );

    const authenticatedContent =
        document.getElementById(
            "rocketLeagueAuthenticatedContent"
        );

    const playerProfile =
        document.getElementById(
            "rocketLeaguePlayerProfile"
        );

    if (loggedOutContent) {
        loggedOutContent.hidden =
            authenticated;
    }

    if (authenticatedContent) {
        authenticatedContent.hidden =
            !authenticated;
    }

    if (playerProfile) {
        playerProfile.hidden =
            !authenticated;
    }

    document.body.dataset.authenticated =
        String(
            authenticated
        );

    applySidebarAuthState(
        normalizedSession
    );

    document.dispatchEvent(
        new CustomEvent(
            "bpd:auth-changed",
            {
                detail:
                    normalizedSession
            }
        )
    );

    return normalizedSession;
}

async function loadAuthenticatedUser() {
    if (
        window.BPDAuth &&
        typeof window.BPDAuth.getSession ===
            "function"
    ) {
        return window.BPDAuth.getSession();
    }

    const response =
        await apiFetch(
            ROCKET_LEAGUE_SESSION_URL,
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

    if (!response.ok) {
        throw new Error(
            `Authentication request failed with ${response.status}.`
        );
    }

    return response.json();
}

function openRequiredProfilePage() {
    if (
        window.location.pathname ===
        ROCKET_LEAGUE_PROFILE_PAGE
    ) {
        return;
    }

    if (
        window.BPDRouter &&
        typeof window.BPDRouter.navigate ===
            "function"
    ) {
        window.BPDRouter.navigate(
            ROCKET_LEAGUE_PROFILE_PAGE,
            {
                replace:
                    true
            }
        );

        return;
    }

    window.location.replace(
        ROCKET_LEAGUE_PROFILE_PAGE
    );
}

export async function initializeRocketLeagueAuthView() {
    try {
        const authSession =
            await loadAuthenticatedUser();

        const normalizedSession =
            applyRocketLeagueAuthView(
                authSession
            );

        if (
            !normalizedSession.authenticated
        ) {
            return;
        }

        try {
            const profileResult =
                await loadRocketLeagueProfile(
                    normalizedSession.user
                );

            const updatedSession = {
                ...normalizedSession,

                profileComplete:
                    profileResult.profileComplete ===
                    true,

                registrationAccepted:
                    profileResult.registrationAccepted ===
                    true,

                rocketLeagueAccess:
                    profileResult.rocketLeagueAccess ===
                    true
            };

            applySidebarAuthState(
                updatedSession
            );

            document.body.dataset.rlAccess =
                String(
                    updatedSession.rocketLeagueAccess
                );

            if (
                updatedSession.rocketLeagueAccess !==
                true
            ) {
                openRequiredProfilePage();

                return;
            }

        } catch (
            profileError
        ) {
            console.error(
                "ROCKET LEAGUE PROFILE: Unable to load profile.",
                {
                    name:
                        profileError?.name ||
                        "Error",

                    message:
                        profileError?.message ||
                        "Unknown error"
                }
            );

            renderUnavailableRanks(
                profileError?.message ||
                "Profile data unavailable."
            );
        }

    } catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE AUTH: Unable to load session.",
            {
                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error"
            }
        );

        applyRocketLeagueAuthView({
            authenticated:
                false,

            user:
                null,

            registrationAccepted:
                false,

            profileComplete:
                false,

            rocketLeagueAccess:
                false
        });
    }
}