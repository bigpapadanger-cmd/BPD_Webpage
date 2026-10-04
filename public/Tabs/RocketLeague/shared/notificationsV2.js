"use strict";

export const NOTIFICATION_CHANNELS = Object.freeze(["email", "sms", "discord"]);
export const REMINDER_LIMITS = Object.freeze({ minMinutes: 15, maxMinutes: 11460, maxPerChannel: 3 });

export function isNotificationsV2(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && NOTIFICATION_CHANNELS.every(channel => {
            const setting = value[channel];
            return setting && typeof setting === "object" && typeof setting.enabled === "boolean"
                && Array.isArray(setting.reminders) && setting.reminders.length <= REMINDER_LIMITS.maxPerChannel
                && setting.reminders.every(minutes => Number.isInteger(minutes)
                    && minutes >= REMINDER_LIMITS.minMinutes && minutes <= REMINDER_LIMITS.maxMinutes);
        }));
}

export function reminderMinutesFromParts(days, hours, minutes) {
    const parts = [days, hours, minutes].map(value => String(value ?? "").trim());
    if (parts.every(value => value === "")) return { empty: true, minutes: null };
    if (parts.some(value => !/^\d+$/.test(value))) return { error: "Complete the days, hours, and minutes for each reminder you use." };
    const [dayCount, hourCount, minuteCount] = parts.map(Number);
    if (dayCount > 7 || hourCount > 23 || minuteCount > 59) return { error: "Reminder days, hours, or minutes are outside the allowed range." };
    const total = dayCount * 1440 + hourCount * 60 + minuteCount;
    if (total < REMINDER_LIMITS.minMinutes || total > REMINDER_LIMITS.maxMinutes) {
        return { error: "Reminder times must be between 15 minutes and 7 days 23 hours before a match." };
    }
    return { empty: false, minutes: total };
}

export function validateNotificationsV2(notifications, email, phone) {
    if (!isNotificationsV2(notifications)) return "Check the notification channel settings and reminder times.";
    if (notifications.email.enabled && !String(email || "").trim()) return "Add an email address to enable email reminders.";
    if (notifications.sms.enabled && !String(phone || "").trim()) return "Add a phone number to enable text reminders.";
    return null;
}

export function getDuplicateReminderChannels(notifications) {
    return NOTIFICATION_CHANNELS.filter(channel => {
        const reminders = notifications?.[channel]?.reminders;
        return Array.isArray(reminders) && new Set(reminders).size !== reminders.length;
    });
}
