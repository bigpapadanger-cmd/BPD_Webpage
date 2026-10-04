"use strict";

import { getDuplicateReminderChannels, isNotificationsV2, NOTIFICATION_CHANNELS, REMINDER_LIMITS, reminderMinutesFromParts, validateNotificationsV2 } from "../../shared/notificationsV2.js";

export { getDuplicateReminderChannels, isNotificationsV2, NOTIFICATION_CHANNELS, REMINDER_LIMITS, reminderMinutesFromParts, validateNotificationsV2 };

const EDITABLE_FIELDS = [
    "primaryPlatform", "autoDetectRegion", "showOnlineStatus", "findProfileEnabled", "preferredMode", "otherMode",
    "availability", "email", "phone", "notificationsV2"
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
    primaryPlatform: "primary platform",
    autoDetectRegion: "region detection",
    showOnlineStatus: "online status sharing",
    findProfileEnabled: "Find Players visibility",
    notificationsV2: "notification channel settings",
    preferredMode: "preferred mode",
    otherMode: "other mode details",
    availability: "weekly availability",
    email: "email",
    phone: "phone"
});

function hasValidSettingValue(settings, key) {
    const value = settings?.[key];
    if (["autoDetectRegion", "showOnlineStatus", "findProfileEnabled"].includes(key)) {
        return typeof value === "boolean";
    }
    if (key === "availability") return Array.isArray(value);
    if (key === "notificationsV2") return isNotificationsV2(value);
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
    return {
        primaryPlatform: preserveNull(original.primaryPlatform, values.primaryPlatform),
        autoDetectRegion: values.autoDetectRegion === true,
        showOnlineStatus: values.showOnlineStatus === true,
        findProfileEnabled: values.findProfileEnabled === true,
        email: preserveNull(original.email, values.email),
        phone: preserveNull(original.phone, values.phone),
        preferredMode: preserveNull(original.preferredMode, values.preferredMode),
        otherMode: preserveNull(original.otherMode, values.otherMode),
        availability: values.availability,
        notificationsV2: values.notificationsV2
    };
}
