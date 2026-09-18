"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE RANK RENDERER

File:
    /Tabs/RocketLeague/Index/JS/ranks.js

Purpose:
    Renders compact Rocket League competitive rank cards for
    the authenticated player's 1v1, 2v2, and 3v3 playlists.

Display:
    1V1
    Diamond II
    1048 MMR

Responsibilities:
    - Prefers current authoritative rank/MMR data.
    - Falls back to player-submitted starting rank data.
    - Reduces detailed rank names to their general rank.
    - Applies rank-specific presentation classes.
    - Displays unavailable state safely.
    - Does not load profile data itself.
    - Does not determine Rocket League access.

Security:
    - This module only renders data already returned to the
      authenticated client.
    - Server APIs remain authoritative for private MMR data.
========================================================= */

/* =========================================================
PLAYLIST CONFIGURATION
========================================================= */

const PLAYLISTS =
    Object.freeze([
        {
            key:
                "duel",

            aliases:
                [
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
            key:
                "double",

            aliases:
                [
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
            key:
                "standard",

            aliases:
                [
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
        value ===
            null
        || value ===
            undefined
        || value ===
            ""
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
            value !==
                undefined
            && value !==
                null
        ) {
            return normalizeObject(
                value
            );
        }
    }

    return {};
}

/* =========================================================
RANK NAME EXTRACTION
========================================================= */

function getRankName(
    rankData
) {
    const data =
        normalizeObject(
            rankData
        );

    const candidates =
        [
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
MMR EXTRACTION
========================================================= */

function getMmr(
    rankData
) {
    const data =
        normalizeObject(
            rankData
        );

    const candidates =
        [
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
            value !==
                null
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

    RANK_CLASSES.forEach(
        function(
            className
        ) {
            element.classList.remove(
                className
            );
        }
    );

    element.classList.remove(
        "rank-loading"
    );
}

/* =========================================================
RESOLVE DISPLAY DATA

Current server-derived data is preferred.

Input / registration data is only used when current data
does not contain a usable rank or MMR.
========================================================= */

function resolveRankData(
    currentRankData,
    inputRankData
) {
    const current =
        normalizeObject(
            currentRankData
        );

    const input =
        normalizeObject(
            inputRankData
        );

    const currentRank =
        getGeneralRank(
            getRankName(
                current
            )
        );

    const currentMmr =
        getMmr(
            current
        );

    const inputRank =
        getGeneralRank(
            getRankName(
                input
            )
        );

    const inputMmr =
        getMmr(
            input
        );

    const hasCurrent =
        Boolean(
            currentRank
        )
        || currentMmr !==
            null;

    if (
        hasCurrent
    ) {
        return {
            rank:
                currentRank
                || "Unranked",

            mmr:
                currentMmr,

            source:
                "current"
        };
    }

    const hasInput =
        Boolean(
            inputRank
        )
        || inputMmr !==
            null;

    if (
        hasInput
    ) {
        return {
            rank:
                inputRank
                || "Unranked",

            mmr:
                inputMmr,

            source:
                "input"
        };
    }

    return {
        rank:
            "Unranked",

        mmr:
            null,

        source:
            "none"
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
        return;
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

    const rankName =
        normalizeString(
            rankData?.rank
        )
        || "Unranked";

    const mmr =
        normalizeNumber(
            rankData?.mmr
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
            rankName;
    }

    if (
        mmrElement
    ) {
        mmrElement.textContent =
            mmr !==
                null
                ? `${Math.round(mmr)} MMR`
                : "— MMR";
    }

    element.classList.add(
        getRankClass(
            rankName
        )
    );

    element.dataset.rank =
        rankName;

    element.dataset.rankSource =
        normalizeString(
            rankData?.source
        )
        || "none";

    element.dataset.mmr =
        mmr !==
            null
            ? String(
                Math.round(
                    mmr
                )
            )
            : "";
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
        !statusElement
    ) {
        return;
    }

    statusElement.textContent =
        message;
}

/* =========================================================
RENDER ROCKET LEAGUE RANKS
========================================================= */

export function renderRocketLeagueRanks({
    input = {},
    current = {}
} = {}) {
    let currentCount =
        0;

    let fallbackCount =
        0;

    PLAYLISTS.forEach(
        function(
            playlist
        ) {
            const currentRankData =
                getPlaylistData(
                    current,
                    playlist
                );

            const inputRankData =
                getPlaylistData(
                    input,
                    playlist
                );

            const resolved =
                resolveRankData(
                    currentRankData,
                    inputRankData
                );

            if (
                resolved.source ===
                "current"
            ) {
                currentCount +=
                    1;
            }
            else if (
                resolved.source ===
                "input"
            ) {
                fallbackCount +=
                    1;
            }

            renderRankCard(
                playlist,
                resolved
            );
        }
    );

    if (
        currentCount ===
        PLAYLISTS.length
    ) {
        setRankStatus(
            "Current competitive ranks"
        );

        return;
    }

    if (
        currentCount > 0
    ) {
        setRankStatus(
            "Current ranks shown where available"
        );

        return;
    }

    if (
        fallbackCount > 0
    ) {
        setRankStatus(
            "Starting ranks shown until current MMR is available"
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
    PLAYLISTS.forEach(
        function(
            playlist
        ) {
            const element =
                document.getElementById(
                    playlist.elementId
                );

            if (
                !element
            ) {
                return;
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
    );

    setRankStatus(
        message
    );
}