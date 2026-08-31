export async function getRocketLeagueProfileByEpicId(
    env,
    EpicUniqueId
) {
    // Supabase fetch/query here

    // Normalize DB result before returning it: 
    /**** CHANGE WHAT IS RETURNED AND THEN CALL THAT FOR THE RETURN */
    return {
        profileComplete: false,
        displayName: "...",
        ranked: {
            duel: {
                tier: "Unranked",
                division: "",
                mmr: null
            },
            double: {
                tier: "Unranked",
                division: "",
                mmr: null
            },
            standard: {
                tier: "Unranked",
                division: "",
                mmr: null
            }
        }
    };
}