"use strict";
const ROCKET_LEAGUE_SESSION_URL = "/api/auth/session";
const ROCKET_LEAGUE_PROFILE_URL = "/api/rocketleague/profile";
const ROCKET_LEAGUE_PLAYLISTS = [
    {
        key: "duel",
        elementId: "rocketLeagueRank1"
    },
    {
        key: "double",
        elementId: "rocketLeagueRank2"
    },
    {
        key: "standard",
        elementId: "rocketLeagueRank3"
    }
];
function applyRocketLeagueAuthView(authSession) {
    const authenticated =
        authSession?.authenticated === true;
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
        String(authenticated);
}
async function loadAuthenticatedRocketLeagueUser() {
    if (
        window.BPDAuth &&
        typeof window.BPDAuth.getSession === "function"
    ) {
        return window.BPDAuth.getSession();
    }
    const response = await fetch(
        ROCKET_LEAGUE_SESSION_URL,
        {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "accept": "application/json"
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
function getRankTheme(rankName) {
    const normalizedRank =
        String(rankName || "")
            .trim()
            .toLowerCase();
    if (normalizedRank.includes("supersonic")) {
        return "rank-supersonic";
    }
    if (normalizedRank.includes("grand champion")) {
        return "rank-grand-champion";
    }
    if (normalizedRank.includes("champion")) {
        return "rank-champion";
    }
    if (normalizedRank.includes("diamond")) {
        return "rank-diamond";
    }
    if (normalizedRank.includes("platinum")) {
        return "rank-platinum";
    }
    if (normalizedRank.includes("gold")) {
        return "rank-gold";
    }
    if (normalizedRank.includes("silver")) {
        return "rank-silver";
    }
    if (normalizedRank.includes("bronze")) {
        return "rank-bronze";
    }
    return "rank-unranked";
}
function normalizeRank(rankData) {
    return {
        tier:
            String(
                rankData?.rank?.tier?.name ||
                rankData?.tier ||
                "Unranked"
            ).trim(),
        division:
            String(
                rankData?.rank?.division?.name ||
                rankData?.division ||
                ""
            ).trim(),
        mmr:
            Number.isFinite(
                Number(rankData?.mmr)
            )
                ? Number(rankData.mmr)
                : null
    };
}
function formatRankName(rank) {
    if (
        !rank.division ||
        rank.tier.toLowerCase() === "unranked"
    ) {
        return rank.tier;
    }
    return `${rank.tier} ${rank.division}`;
}
function resetRankTheme(rankElement) {
    const rankThemes = [
        "rank-loading",
        "rank-unranked",
        "rank-bronze",
        "rank-silver",
        "rank-gold",
        "rank-platinum",
        "rank-diamond",
        "rank-champion",
        "rank-grand-champion",
        "rank-supersonic"
    ];
    rankElement.classList.remove(
        ...rankThemes
    );
}
function renderRocketLeagueRank(
    elementId,
    rankData
) {
    const rankElement =
        document.getElementById(elementId);
    if (!rankElement) {
        return;
    }
    const rank = normalizeRank(rankData);
    const rankName = formatRankName(rank);
    resetRankTheme(rankElement);
    rankElement.classList.add(
        getRankTheme(rankName)
    );
    const rankNameElement =
        rankElement.querySelector(".rank-name");
    const rankMmrElement =
        rankElement.querySelector(".rank-mmr");
    if (rankNameElement) {
        rankNameElement.textContent =
            rankName;
    }
    if (rankMmrElement) {
        rankMmrElement.textContent =
            rank.mmr !== null
                ? `${Math.round(
                    rank.mmr
                ).toLocaleString()} MMR`
                : "— MMR";
    }
}
function renderUnavailableRocketLeagueRanks(message) {
    ROCKET_LEAGUE_PLAYLISTS.forEach(
        function(playlist) {
            renderRocketLeagueRank(
                playlist.elementId,
                {
                    tier: "Unavailable",
                    division: "",
                    mmr: null
                }
            );
        }
    );
    const statusElement =
        document.getElementById(
            "rocketLeagueRankStatus"
        );
    if (statusElement) {
        statusElement.textContent =
            message ||
            "Competitive ranks are temporarily unavailable.";
        statusElement.dataset.state = "error";
    }
}
function renderRocketLeagueProfile(
    authUser,
    profile
) {
    const playerNameElement =
        document.getElementById(
            "rocketLeaguePlayerName"
        );
    const statusElement =
        document.getElementById(
            "rocketLeagueRankStatus"
        );
    if (playerNameElement) {
        playerNameElement.textContent =
            profile?.username ||
            authUser?.displayName ||
            "Epic Player";
    }
    const ranked =
        profile?.stats?.ranked || {};
    ROCKET_LEAGUE_PLAYLISTS.forEach(
        function(playlist) {
            renderRocketLeagueRank(
                playlist.elementId,
                ranked[playlist.key]
            );
        }
    );
    if (statusElement) {
        statusElement.textContent =
            "Current competitive playlist ratings";
        statusElement.dataset.state = "ready";
    }
}
async function loadRocketLeagueProfile(authUser) {
    const playerNameElement =
        document.getElementById(
            "rocketLeaguePlayerName"
        );
    if (playerNameElement) {
        playerNameElement.textContent =
            authUser?.displayName ||
            "Epic Player";
    }
    const response = await fetch(
        ROCKET_LEAGUE_PROFILE_URL,
        {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "accept": "application/json"
            }
        }
    );
    const result =
        await response.json().catch(
            function() {
                return {};
            }
        );
    if (!response.ok || result.success !== true) {
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
async function initializeRocketLeagueAuthView() {
    try {
        const authSession =
            await loadAuthenticatedRocketLeagueUser();
        applyRocketLeagueAuthView(authSession);
        if (!authSession?.authenticated) {
            return;
        }
        try {
            await loadRocketLeagueProfile(
                authSession.user
            );
        } catch (profileError) {
            console.warn(
                "ROCKET LEAGUE PROFILE: Unable to load ranks.",
                profileError
            );
            renderUnavailableRocketLeagueRanks(
                profileError.message
            );
        }
    } catch (error) {
        console.warn(
            "ROCKET LEAGUE AUTH: Unable to load session.",
            error
        );
        applyRocketLeagueAuthView({
            authenticated: false,
            user: null
        });
    }
}
document.addEventListener(
    "DOMContentLoaded",
    initializeRocketLeagueAuthView,
    {
        once: true
    }
);