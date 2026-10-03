"use strict";

const EDITABLE_FIELDS = [
    "autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "preferredMode", "otherMode",
    "availability", "email", "phone", "notificationsEnabled", "notificationMethod", "reminderMode"
];

function isNullableString(value) {
    return value === null || typeof value === "string";
}

export function getConfirmedSettings(profile) {
    return getSettingsConfirmationState(profile).canSave
        ? profile.settings
        : null;
}

const SETTING_LABELS = Object.freeze({
    autoDetectRegion: "region detection",
    showOnlineStatus: "online status sharing",
    findProfileEnabled: "Find Players visibility",
    preferredMode: "preferred mode",
    otherMode: "other mode details",
    availability: "weekly availability",
    email: "email",
    phone: "phone",
    notificationsEnabled: "match notifications",
    notificationMethod: "delivery method",
    reminderMode: "reminder timing"
});

function hasValidSettingValue(settings, key) {
    const value = settings?.[key];
    if (["autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "notificationsEnabled"].includes(key)) {
        return typeof value === "boolean";
    }
    if (key === "availability") return Array.isArray(value);
    return isNullableString(value);
}

export function isSettingConfirmed(profile, key) {
    const settings = profile?.settings;
    const availability = profile?.settingsAvailability;
    return Boolean(settings && availability
        && typeof settings === "object" && !Array.isArray(settings)
        && typeof availability === "object" && !Array.isArray(availability)
        && availability[key] === true && hasValidSettingValue(settings, key));
}

export function getSettingsConfirmationState(profile) {
    const settings = profile?.settings;
    const availability = profile?.settingsAvailability;
    const hasAvailability = availability && typeof availability === "object" && !Array.isArray(availability);
    const unconfirmedFields = EDITABLE_FIELDS.filter(key => !isSettingConfirmed(profile, key));
    const consentsConfirmed = hasAvailability
        && availability.ageConsent === true
        && availability.policyConsent === true
        && typeof profile?.ageConsent === "boolean"
        && typeof profile?.policyConsent === "boolean";

    return {
        unconfirmedFields,
        unconfirmedLabels: unconfirmedFields.map(key => SETTING_LABELS[key]),
        consentsConfirmed,
        canSave: unconfirmedFields.length === 0 && consentsConfirmed
    };
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
