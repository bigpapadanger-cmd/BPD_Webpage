"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE RANK RENDERER

File:
    /Tabs/RocketLeague/Index/JS/ranks.js

Purpose:
    Renders the authenticated player's current competitive
    Rocket League rank/MMR for:

    - Competitive 1v1
    - Competitive 2v2
    - Competitive 3v3

Responsibilities:
    - Uses current server-derived rank/MMR data only.
    - Supports common playlist naming aliases.
    - Reduces detailed rank names to their general rank.
    - Applies rank-specific presentation classes.
    - Displays unavailable state safely.
    - Does not fetch profile/MMR data itself.
    - Does not determine Rocket League access.

Important:
    - Initial registration no longer collects rank data.
    - There is no user-submitted rank fallback.
    - Server APIs remain authoritative for MMR/rank data.
========================================================= */

/* =========================================================
PLAYLIST CONFIGURATION
========================================================= */

const PLAYLISTS =
    Object.freeze([
        {
            aliases: [
                "duel",
                "ones",
                "one",
                "1v1",
                "1s"
            ],

            elementId:
                "rocketLeagueRank1",

            label:
                "1V1"
        },

        {
            aliases: [
                "double",
                "doubles",
                "twos",
                "two",
                "2v2",
                "2s"
            ],

            elementId:
                "rocketLeagueRank2",

            label:
                "2V2"
        },

        {
            aliases: [
                "standard",
                "threes",
                "three",
                "3v3",
                "3s"
            ],

            elementId:
                "rocketLeagueRank3",

            label:
                "3V3"
        }
    ]);

/* =========================================================
RANK PRESENTATION CLASSES
========================================================= */

const RANK_CLASSES =
    Object.freeze([
        "rank-unranked",
        "rank-bronze",
        "rank-silver",
        "rank-gold",
        "rank-platinum",
        "rank-diamond",
        "rank-champion",
        "rank-grand-champion",
        "rank-supersonic-legend",
        "rank-unavailable"
    ]);

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

function normalizeNumber(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const number =
        Number(
            value
        );

    return Number.isFinite(
        number
    )
        ? number
        : null;
}

/* =========================================================
PLAYLIST LOOKUP
========================================================= */

function getPlaylistData(
    collection,
    playlist
) {
    const source =
        normalizeObject(
            collection
        );

    for (
        const alias
        of playlist.aliases
    ) {
        const value =
            source[
                alias
            ];

        if (
            value !== undefined
            && value !== null
        ) {
            return normalizeObject(
                value
            );
        }
    }

    return {};
}

/* =========================================================
RANK NAME
========================================================= */

function getRankName(
    rankData
) {
    const data =
        normalizeObject(
            rankData
        );

    const candidates = [
        data.rank,
        data.rankName,
        data.rank_name,
        data.tier,
        data.tierName,
        data.tier_name,
        data.name,
        data.displayRank,
        data.display_rank
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
MMR
========================================================= */

function getMmr(
    rankData
) {
    const data =
        normalizeObject(
            rankData
        );

    const candidates = [
        data.mmr,
        data.MMR,
        data.rating,
        data.skillRating,
        data.skill_rating,
        data.matchmakingRating,
        data.matchmaking_rating
    ];

    for (
        const candidate
        of candidates
    ) {
        const value =
            normalizeNumber(
                candidate
            );

        if (
            value !== null
        ) {
            return Math.round(
                value
            );
        }
    }

    return null;
}

/* =========================================================
GENERAL RANK

Examples:

    Diamond II Division III
        -> Diamond II

    Champion I Div 4
        -> Champion I

    Grand Champion II Division I
        -> Grand Champion II

    Supersonic Legend
        -> Supersonic Legend
========================================================= */

function getGeneralRank(
    value
) {
    let rank =
        normalizeString(
            value
        );

    if (
        !rank
    ) {
        return "";
    }

    rank =
        rank
            .replace(
                /\s+division\s+(?:i{1,3}|iv|[1-4])$/iu,
                ""
            )
            .replace(
                /\s+div\.?\s*(?:i{1,3}|iv|[1-4])$/iu,
                ""
            )
            .trim();

    return rank;
}

/* =========================================================
RANK THEME
========================================================= */

function getRankClass(
    rankName
) {
    const normalized =
        normalizeString(
            rankName
        )
            .toLowerCase();

    if (
        !normalized
        || normalized.includes(
            "unranked"
        )
    ) {
        return "rank-unranked";
    }

    if (
        normalized.includes(
            "supersonic legend"
        )
        || normalized ===
            "ssl"
    ) {
        return "rank-supersonic-legend";
    }

    if (
        normalized.includes(
            "grand champion"
        )
        || normalized.startsWith(
            "gc "
        )
        || normalized ===
            "gc"
    ) {
        return "rank-grand-champion";
    }

    if (
        normalized.includes(
            "champion"
        )
    ) {
        return "rank-champion";
    }

    if (
        normalized.includes(
            "diamond"
        )
    ) {
        return "rank-diamond";
    }

    if (
        normalized.includes(
            "platinum"
        )
    ) {
        return "rank-platinum";
    }

    if (
        normalized.includes(
            "gold"
        )
    ) {
        return "rank-gold";
    }

    if (
        normalized.includes(
            "silver"
        )
    ) {
        return "rank-silver";
    }

    if (
        normalized.includes(
            "bronze"
        )
    ) {
        return "rank-bronze";
    }

    return "rank-unranked";
}

/* =========================================================
CLEAR RANK CLASSES
========================================================= */

function clearRankClasses(
    element
) {
    if (
        !element
    ) {
        return;
    }

    for (
        const className
        of RANK_CLASSES
    ) {
        element.classList.remove(
            className
        );
    }

    element.classList.remove(
        "rank-loading"
    );
}

/* =========================================================
RESOLVE CURRENT RANK
========================================================= */

function resolveCurrentRank(
    rankData
) {
    const data =
        normalizeObject(
            rankData
        );

    const rank =
        getGeneralRank(
            getRankName(
                data
            )
        );

    const mmr =
        getMmr(
            data
        );

    if (
        !rank
        && mmr === null
    ) {
        return {
            available:
                false,

            rank:
                "Unranked",

            mmr:
                null
        };
    }

    return {
        available:
            true,

        rank:
            rank
            || "Unranked",

        mmr
    };
}

/* =========================================================
RENDER SINGLE RANK
========================================================= */

function renderRankCard(
    playlist,
    rankData
) {
    const element =
        document.getElementById(
            playlist.elementId
        );

    if (
        !element
    ) {
        return false;
    }

    const playlistElement =
        element.querySelector(
            ".rank-playlist"
        );

    const rankElement =
        element.querySelector(
            ".rank-name"
        );

    const mmrElement =
        element.querySelector(
            ".rank-mmr"
        );

    clearRankClasses(
        element
    );

    const resolved =
        resolveCurrentRank(
            rankData
        );

    if (
        playlistElement
    ) {
        playlistElement.textContent =
            playlist.label;
    }

    if (
        rankElement
    ) {
        rankElement.textContent =
            resolved.rank;
    }

    if (
        mmrElement
    ) {
        mmrElement.textContent =
            resolved.mmr !==
                null
                ? `${resolved.mmr} MMR`
                : "— MMR";
    }

    element.classList.add(
        getRankClass(
            resolved.rank
        )
    );

    element.dataset.rank =
        resolved.rank;

    element.dataset.rankSource =
        resolved.available
            ? "current"
            : "none";

    element.dataset.mmr =
        resolved.mmr !==
            null
            ? String(
                resolved.mmr
            )
            : "";

    return resolved.available;
}

/* =========================================================
RANK STATUS
========================================================= */

function setRankStatus(
    message
) {
    const statusElement =
        document.getElementById(
            "rocketLeagueRankStatus"
        );

    if (
        statusElement
    ) {
        statusElement.textContent =
            message;
    }
}

/* =========================================================
RENDER ROCKET LEAGUE RANKS
========================================================= */

export function renderRocketLeagueRanks({
    current = {}
} = {}) {
    let availableCount =
        0;

    for (
        const playlist
        of PLAYLISTS
    ) {
        const rankData =
            getPlaylistData(
                current,
                playlist
            );

        if (
            renderRankCard(
                playlist,
                rankData
            )
        ) {
            availableCount +=
                1;
        }
    }

    if (
        availableCount ===
        PLAYLISTS.length
    ) {
        setRankStatus(
            "Current competitive ranks"
        );

        return;
    }

    if (
        availableCount > 0
    ) {
        setRankStatus(
            "Current ranks shown where available"
        );

        return;
    }

    setRankStatus(
        "Competitive rank data is not available yet"
    );
}

/* =========================================================
UNAVAILABLE RANKS
========================================================= */

export function renderUnavailableRanks(
    message =
        "Competitive rank data is unavailable."
) {
    for (
        const playlist
        of PLAYLISTS
    ) {
        const element =
            document.getElementById(
                playlist.elementId
            );

        if (
            !element
        ) {
            continue;
        }

        const playlistElement =
            element.querySelector(
                ".rank-playlist"
            );

        const rankElement =
            element.querySelector(
                ".rank-name"
            );

        const mmrElement =
            element.querySelector(
                ".rank-mmr"
            );

        clearRankClasses(
            element
        );

        element.classList.add(
            "rank-unavailable"
        );

        if (
            playlistElement
        ) {
            playlistElement.textContent =
                playlist.label;
        }

        if (
            rankElement
        ) {
            rankElement.textContent =
                "Unavailable";
        }

        if (
            mmrElement
        ) {
            mmrElement.textContent =
                "— MMR";
        }

        element.dataset.rank =
            "";

        element.dataset.rankSource =
            "unavailable";

        element.dataset.mmr =
            "";
    }

    setRankStatus(
        message
    );
}