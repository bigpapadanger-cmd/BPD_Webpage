export async function getRocketLeagueProfileByEpicId(
    env,
    EpicUniqueId
) {
    // Supabase fetch/query here

    // Normalize DB result before returning it:
    return {
        profileComplete: true,
        displayName: "PlayerName",
        ranked: {
            duel: {
                tier: "Champion 1",
                division: "Division II",
                mmr: 1100
            },
            double: {
                tier: "Champion 2",
                division: "Division III",
                mmr: 1250
            },
            standard: {
                tier: "Champion 1",
                division: "Division IV",
                mmr: 1180
            }
        }
    };
}