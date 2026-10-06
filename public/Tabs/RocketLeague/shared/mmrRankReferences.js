// Observed Division I minimums, not official promotion guarantees.
// Update all playlist values together after reviewing the source distribution.
export const MMR_RANK_REFERENCE_SOURCE = "https://rocketleague.tracker.network/rocket-league/distribution";
export const MMR_RANK_REFERENCE_DATE = "2026-10-06";
const RANKS = ["Bronze I", "Bronze II", "Bronze III", "Silver I", "Silver II", "Silver III",
    "Gold I", "Gold II", "Gold III", "Platinum I", "Platinum II", "Platinum III",
    "Diamond I", "Diamond II", "Diamond III", "Champion I", "Champion II", "Champion III",
    "Grand Champion I", "Grand Champion II", "Grand Champion III", "Supersonic Legend"];
const MINIMUMS = {
    ones: [-100, 155, 200, 260, 320, 380, 440, 500, 560, 620, 680, 740, 800, 875, 935, 995, 1055, 1100, 1163, 1226, 1285, 1353],
    twos: [-100, 170, 229, 294, 355, 415, 475, 535, 594, 655, 715, 773, 835, 915, 995, 1075, 1195, 1315, 1435, 1575, 1715, 1867],
    threes: [-100, 175, 220, 280, 340, 400, 460, 520, 580, 640, 715, 760, 835, 915, 980, 1075, 1195, 1315, 1435, 1575, 1707, 1868]
};
export const MMR_RANK_REFERENCES = Object.fromEntries(Object.entries(MINIMUMS).map(([playlist, values]) =>
    [playlist, RANKS.map((rank, index) => ({ rank, mmr: values[index] }))]));

export function getMmrRankReferences(playlist, configuration = MMR_RANK_REFERENCES) {
    const rows = configuration?.[playlist];
    if (!Array.isArray(rows) || rows.length > 30) return [];
    if (rows.some(row => !row || typeof row.rank !== "string" || row.rank.length > 40
        || !Number.isSafeInteger(row.mmr) || row.mmr < -100 || row.mmr > 10000)) return [];
    return rows.slice().sort((a, b) => a.mmr - b.mmr);
}
