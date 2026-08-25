"use strict";

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

const RANK_THEMES = [
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

function getRankTheme(rankName) {
    const normalizedRank =
        String(rankName || "")
            .trim()
            .toLowerCase();

    if (
        normalizedRank.includes(
            "supersonic"
        )
    ) {
        return "rank-supersonic";
    }

    if (
        normalizedRank.includes(
            "grand champion"
        )
    ) {
        return "rank-grand-champion";
    }

    if (
        normalizedRank.includes(
            "champion"
        )
    ) {
        return "rank-champion";
    }

    if (
        normalizedRank.includes(
            "diamond"
        )
    ) {
        return "rank-diamond";
    }

    if (
        normalizedRank.includes(
            "platinum"
        )
    ) {
        return "rank-platinum";
    }

    if (
        normalizedRank.includes(
            "gold"
        )
    ) {
        return "rank-gold";
    }

    if (
        normalizedRank.includes(
            "silver"
        )
    ) {
        return "rank-silver";
    }

    if (
        normalizedRank.includes(
            "bronze"
        )
    ) {
        return "rank-bronze";
    }

    return "rank-unranked";
}

function normalizeRank(rankData) {
    const rawMmr =
        rankData?.mmr;

    const numericMmr =
        rawMmr !== null &&
        rawMmr !== undefined &&
        rawMmr !== ""
            ? Number(rawMmr)
            : null;

    return {
        tier: String(
            rankData?.rank?.tier?.name ||
            rankData?.tier ||
            "Unranked"
        ).trim(),

        division: String(
            rankData?.rank?.division?.name ||
            rankData?.division ||
            ""
        ).trim(),

        mmr:
            Number.isFinite(numericMmr)
                ? numericMmr
                : null
    };
}

function formatRankName(rank) {
    if (
        !rank.division ||
        rank.tier.toLowerCase() ===
            "unranked"
    ) {
        return rank.tier;
    }

    return `${rank.tier} ${rank.division}`;
}

function resetRankTheme(rankElement) {
    rankElement.classList.remove(
        ...RANK_THEMES
    );
}

function renderRocketLeagueRank(
    elementId,
    rankData
) {
    const rankElement =
        document.getElementById(
            elementId
        );

    if (!rankElement) {
        return;
    }

    const rank =
        normalizeRank(rankData);

    const rankName =
        formatRankName(rank);

    resetRankTheme(rankElement);

    rankElement.classList.add(
        getRankTheme(rankName)
    );

    const rankNameElement =
        rankElement.querySelector(
            ".rank-name"
        );

    const rankMmrElement =
        rankElement.querySelector(
            ".rank-mmr"
        );

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

export function renderRocketLeagueRanks(
    ranked
) {
    const rankedData =
        ranked &&
        typeof ranked === "object"
            ? ranked
            : {};

    ROCKET_LEAGUE_PLAYLISTS.forEach(
        function(playlist) {
            renderRocketLeagueRank(
                playlist.elementId,
                rankedData[playlist.key]
            );
        }
    );
}

export function renderUnavailableRanks(
    message
) {
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

        statusElement.dataset.state =
            "error";
    }
}