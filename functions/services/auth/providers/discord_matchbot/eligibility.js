"use strict";

/*
 * MatchBot eligibility needs an authoritative current-guild source. DomainData
 * has REST operations but no persistent Gateway runtime or shared guild
 * registry writer. Do not use /users/@me/guilds with the bot token: that route
 * is an OAuth2 user-guild endpoint, not a bot guild inventory.
 *
 * Keep this check explicitly unavailable until the owning Gateway runtime and
 * registry contract are identified. This scoped result allows profile reads
 * and settings to remain usable without claiming Discord eligibility.
 */
export async function getDiscordMatchBotEligibility(_env, discordUserId) {
    const linkedDiscordId = typeof discordUserId === "string"
        ? discordUserId.trim()
        : "";
    const checkedAt = new Date().toISOString();

    if (!/^\d{16,22}$/u.test(linkedDiscordId)) {
        return {
            eligible: false,
            status: "not_linked",
            reason: "DISCORD_USER_ID_REQUIRED",
            mutualGuildCount: 0,
            countComplete: true,
            checkedAt,
            lastEligibleAt: null,
            eligibilityLost: false
        };
    }

    return {
        eligible: false,
        status: "unavailable",
        reason: "MATCHBOT_GUILD_REGISTRY_UNAVAILABLE",
        mutualGuildCount: null,
        countComplete: false,
        checkedAt,
        lastEligibleAt: null,
        eligibilityLost: false
    };
}
