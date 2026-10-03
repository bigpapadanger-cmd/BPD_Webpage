"use strict";

/*
 * Canonical allow-list for user-editable Rocket League profile settings.
 * Provider, MMR, and career-stat fields intentionally do not appear here.
 */
export const PROFILE_SETTING_FIELDS = Object.freeze({
    primaryPlatform: { group: "platform", db: "primary_platform", aliases: ["primaryPlatform"], rpc: "p_primary_platform", type: "nullable-string" },
    notificationsV2: { group: "notifications", db: "notifications_v2", aliases: ["notificationsV2"], rpc: "p_notifications", type: "object" },
    autoDetectRegion: { group: "location", db: "auto_detect_region", aliases: ["autoDetectRegion"], rpc: "s_auto_detect_region", type: "boolean" },
    region: { group: "location", db: "region", aliases: ["location.region"], rpc: "s_region", type: "nullable-string" },
    countryCode: { group: "location", db: "country_code", aliases: ["countryCode", "location.countryCode", "location.country_code"], rpc: "s_country_code", type: "nullable-string" },
    displayTimezone: { group: "location", db: "display_timezone", aliases: ["displayTimezone", "timezone", "location.timezone"], rpc: "s_display_timezone", type: "nullable-string" },
    preferredMode: { group: "play", db: "preferred_mode", aliases: ["preferredMode"], rpc: "s_preferred_mode", type: "nullable-string" },
    otherMode: { group: "play", db: "other_mode", aliases: ["otherMode"], rpc: "s_other_mode", type: "nullable-string" },
    showOnlineStatus: { group: "privacy", db: "show_online_status", aliases: ["showOnlineStatus"], rpc: "s_show_online_status", type: "boolean" },
    findProfileEnabled: { group: "privacy", db: "find_profile_enabled", aliases: ["findProfileEnabled"], rpc: "s_find_profile_enabled", type: "boolean" },
    email: { group: "notifications", db: "email", aliases: ["email_address"], rpc: "s_email_address", type: "nullable-string" },
    phone: { group: "notifications", db: "phone", aliases: ["phone_number"], rpc: "s_phone_number", type: "nullable-string" },
    availability: { group: "notifications", db: "availability", aliases: [], rpc: "s_availability", type: "array" },
    notificationsEnabled: { group: "notifications", db: "notifications_enabled", aliases: ["notificationsEnabled"], rpc: "s_notifications_enabled", type: "boolean" },
    notificationMethod: { group: "notifications", db: "notification_method", aliases: ["notificationMethod"], rpc: "s_notification_method", type: "nullable-string" },
    reminderMode: { group: "notifications", db: "reminder_mode", aliases: ["reminderMode"], rpc: "s_reminder_mode", type: "nullable-string" }
});

export const NOTIFICATION_CHANNELS = Object.freeze(["email", "sms", "discord"]);
export const REMINDER_LIMITS = Object.freeze({ minMinutes: 15, maxMinutes: 11460, maxPerChannel: 3 });

function getPath(source, path) {
    return String(path).split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, source);
}

export function getProfileSettingsAvailability(source) {
    const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const availability = Object.fromEntries(Object.entries(PROFILE_SETTING_FIELDS).map(([key, definition]) => {
        const paths = [`settings.${key}`, `settings.${definition.db}`, key, definition.db, ...(definition.aliases || [])];
        return [key, paths.some(path => getPath(input, path) !== undefined)];
    }));
    availability.ageConsent = ["ageConsent", "age_consent"].some(path => getPath(input, path) !== undefined);
    availability.policyConsent = ["policyConsent", "policy_consent"].some(path => getPath(input, path) !== undefined);
    return availability;
}

function normalizeField(value, type) {
    if (type === "boolean") return typeof value === "boolean" ? value : null;
    if (type === "array") return Array.isArray(value) ? value : null;
    if (type === "nullable-string") return typeof value === "string" ? value.trim() : null;
    return value ?? null;
}

export function normalizeProfileSettings(source) {
    const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const settings = {};
    for (const [key, definition] of Object.entries(PROFILE_SETTING_FIELDS)) {
        const paths = [`settings.${key}`, `settings.${definition.db}`, key, definition.db, ...(definition.aliases || [])];
        let value;
        for (const path of paths) {
            const candidate = getPath(input, path);
            if (candidate !== undefined) {
                value = candidate;
                break;
            }
        }
        settings[key] = normalizeField(value, definition.type);
    }
    return settings;
}

export function mapProfileSettingsToRpcArgs(settings) {
    const normalized = normalizeProfileSettings({ settings });
    return Object.fromEntries(Object.entries(PROFILE_SETTING_FIELDS).filter(([, definition]) => typeof definition.rpc === "string" && definition.rpc.startsWith("s_")).map(([key, definition]) => {
        const value = normalized[key];
        const mapped = definition.type === "boolean" ? value
            : definition.type === "array" ? (Array.isArray(value) ? value : [])
                : value;
        return [definition.rpc, mapped];
    }));
}

export function normalizeNotificationsV2(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(NOTIFICATION_CHANNELS.map(channel => {
        const entry = source[channel] && typeof source[channel] === "object" && !Array.isArray(source[channel])
            ? source[channel]
            : {};
        const reminders = Array.isArray(entry.reminders)
            ? entry.reminders.filter(value => Number.isInteger(value) && value >= REMINDER_LIMITS.minMinutes && value <= REMINDER_LIMITS.maxMinutes).slice(0, REMINDER_LIMITS.maxPerChannel)
            : [];
        return [channel, { enabled: typeof entry.enabled === "boolean" ? entry.enabled : null, reminders }];
    }));
}

export function mapProfileSettingsToV2RpcArgs(settings) {
    const normalized = normalizeProfileSettings({ settings });
    return {
        p_auto_detect_region: normalized.autoDetectRegion,
        p_region: normalized.autoDetectRegion ? normalized.region : null,
        p_country_code: normalized.autoDetectRegion ? normalized.countryCode : null,
        p_display_timezone: normalized.autoDetectRegion ? normalized.displayTimezone : null,
        p_show_online_status: normalized.showOnlineStatus,
        p_find_profile_enabled: normalized.findProfileEnabled,
        p_email_address: normalized.email,
        p_phone_number: normalized.phone,
        p_preferred_mode: normalized.preferredMode,
        p_other_mode: normalized.otherMode,
        p_availability: Array.isArray(normalized.availability) ? normalized.availability : [],
        p_primary_platform: normalized.primaryPlatform,
        p_notifications: normalizeNotificationsV2(settings?.notificationsV2)
    };
}
