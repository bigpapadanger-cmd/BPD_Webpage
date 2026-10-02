"use strict";

const EDITABLE_FIELDS = [
    "autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "preferredMode", "otherMode",
    "availability", "email", "phone", "notificationsEnabled", "notificationMethod", "reminderMode"
];

function isNullableString(value) {
    return value === null || typeof value === "string";
}

export function getConfirmedSettings(profile) {
    const settings = profile?.settings;
    const availability = profile?.settingsAvailability;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)
        || !availability || typeof availability !== "object" || Array.isArray(availability)
        || !EDITABLE_FIELDS.every(key => availability[key] === true)
        || availability.ageConsent !== true || availability.policyConsent !== true
        || typeof profile.ageConsent !== "boolean" || typeof profile.policyConsent !== "boolean") return null;

    if (!["autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "notificationsEnabled"].every(key => typeof settings[key] === "boolean")
        || !Array.isArray(settings.availability)
        || !["preferredMode", "otherMode", "email", "phone", "notificationMethod", "reminderMode"].every(key => isNullableString(settings[key]))) return null;

    return settings;
}

function preserveNull(original, value) {
    return original === null && value === "" ? null : value;
}

export function buildSettingsPayload(profile, values) {
    const original = profile.settings;
    const notificationsEnabled = values.notificationsEnabled === true;
    return {
        ageConsent: profile.ageConsent,
        policyConsent: profile.policyConsent,
        autoDetectRegion: values.autoDetectRegion === true,
        showOnlineStatus: values.showOnlineStatus === true,
        findProfileEnabled: values.findProfileEnabled === true,
        email: preserveNull(original.email, values.email),
        phone: preserveNull(original.phone, values.phone),
        preferredMode: preserveNull(original.preferredMode, values.preferredMode),
        otherMode: preserveNull(original.otherMode, values.otherMode),
        availability: values.availability,
        notificationsEnabled,
        notificationMethod: notificationsEnabled ? preserveNull(original.notificationMethod, values.notificationMethod) : null,
        reminderMode: notificationsEnabled ? preserveNull(original.reminderMode, values.reminderMode) : null
    };
}
