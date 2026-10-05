"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { DISCORD_NOTIFICATION_STATUS_URL, ROCKET_LEAGUE_PROFILE_URL } from "/scripts/apiRoutes.js";
import { refreshAuthState } from "/Framework/Auth/auth.js";
import { buildSettingsPayload, getDuplicateReminderChannels, getFindProfileVisibilityState, getSettingsConfirmationState, isSettingConfirmed, NOTIFICATION_CHANNELS, reminderMinutesFromParts, validateNotificationsV2 } from "./settings_view.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NOTIFICATION_LABELS = Object.freeze({ email: "Email", sms: "Text / SMS", discord: "Discord" });
let profileSnapshot = null;
let discordEligibilityState = { checked: false, eligible: false, status: "unavailable" };
const DELETE_PROFILE_CONFIRMATION = "DELETE_ROCKETLEAGUE_PROFILE";
const DELETE_HOLD_DURATION_MS = 3000;
let deleteHoldTimer = null;
let deleteInProgress = false;

function updateDiscordNotificationAvailability() {
    const input = document.querySelector('[data-channel-enabled="discord"]');
    if (input) input.disabled = !discordEligibilityState.eligible && !input.checked;

    const status = document.getElementById("myProfileDiscordNotificationStatus");
    if (!status) return;
    status.dataset.state = discordEligibilityState.eligible ? "ready" : "unavailable";
    if (!discordEligibilityState.checked || discordEligibilityState.status === "unavailable" || discordEligibilityState.status === "partial" || discordEligibilityState.status === "refreshing") {
        status.textContent = "Discord eligibility cannot be verified right now. Existing reminder settings are preserved; new Discord reminders stay unavailable.";
    } else if (discordEligibilityState.status === "not_linked") {
        status.textContent = "Link Discord to your BPD account before enabling Discord reminders. Previously saved reminder times are preserved.";
    } else if (discordEligibilityState.eligible) {
        status.textContent = "Discord reminders are currently available.";
    } else {
        status.textContent = "Discord reminders are not currently eligible. Previously saved reminder times are preserved.";
    }
}

async function loadDiscordNotificationAvailability(force = false) {
    const checkButton = document.getElementById("myProfileDiscordCheckAgain");
    if (checkButton) checkButton.disabled = true;
    try {
        const response = await apiFetch(DISCORD_NOTIFICATION_STATUS_URL, {
            method: force ? "POST" : "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json", ...(force ? { "Content-Type": "application/json" } : {}) },
            ...(force ? { body: "{}" } : {})
        });
        const result = await response.json().catch(() => ({}));
        discordEligibilityState = {
            checked: response.ok && result?.success === true,
            eligible: response.ok && result?.success === true && result?.status === "available"
                && result?.stale !== true && result?.countComplete === true
                && result?.eligible === true && result?.matchBotAvailable === true,
            status: response.ok && result?.success === true ? String(result?.status || "unavailable") : "unavailable",
            stale: result?.stale === true
        };
    } catch {
        discordEligibilityState = { checked: false, eligible: false, status: "unavailable" };
    }
    updateDiscordNotificationAvailability();
    if (checkButton) checkButton.disabled = false;
}

function setStatus(message, state = "ready") {
    const status = document.getElementById("myProfileStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function renderAvailability(availability, editable) {
    const target = document.getElementById("myProfileAvailability");
    const byDay = new Map(availability.map(item => [String(item.day || "").toLowerCase(), item]));
    target.replaceChildren();
    for (const day of DAYS) {
        const saved = byDay.get(day.toLowerCase());
        const row = document.createElement("div");
        row.className = "my-profile-availability-row";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.day = day;
        checkbox.checked = Boolean(saved);
        checkbox.disabled = !editable;
        const dayName = document.createElement("span");
        dayName.textContent = day;
        label.append(checkbox, dayName);
        const start = document.createElement("input");
        Object.assign(start, { type: "time", min: "17:00", max: "23:00", step: 1800, value: saved?.start || "17:00" });
        start.dataset.start = day;
        const end = document.createElement("input");
        Object.assign(end, { type: "time", min: "17:00", max: "23:00", step: 1800, value: saved?.end || "23:00" });
        end.dataset.end = day;
        start.disabled = !editable || !checkbox.checked;
        end.disabled = !editable || !checkbox.checked;
        checkbox.addEventListener("change", () => {
            start.disabled = !editable || !checkbox.checked;
            end.disabled = !editable || !checkbox.checked;
        });
        row.append(label, start, end);
        target.append(row);
    }
}

function reminderParts(totalMinutes) {
    return {
        days: Math.floor(totalMinutes / 1440),
        hours: Math.floor(totalMinutes % 1440 / 60),
        minutes: totalMinutes % 60
    };
}

function createReminderField(channel, index, unit, max, value) {
    const label = document.createElement("label");
    label.className = "my-profile-reminder-field";
    const text = document.createElement("span");
    text.textContent = unit;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(max);
    input.step = "1";
    input.value = value === null ? "" : String(value);
    input.placeholder = "0";
    input.dataset.reminderUnit = unit;
    input.setAttribute("aria-label", `${NOTIFICATION_LABELS[channel]} reminder ${index} ${unit}`);
    label.append(text, input);
    return label;
}

function appendReminderRow(channel, container, totalMinutes = null) {
    if (container.children.length >= 3) return;
    const index = container.children.length + 1;
    const values = totalMinutes === null ? { days: null, hours: null, minutes: null } : reminderParts(totalMinutes);
    const row = document.createElement("div");
    row.className = "my-profile-reminder-row";
    row.dataset.reminderRow = "true";
    const fields = document.createElement("div");
    fields.className = "my-profile-reminder-fields";
    fields.append(
        createReminderField(channel, index, "days", 7, values.days),
        createReminderField(channel, index, "hours", 23, values.hours),
        createReminderField(channel, index, "minutes", 59, values.minutes)
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "my-profile-reminder-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${NOTIFICATION_LABELS[channel]} reminder ${index}`);
    remove.addEventListener("click", () => {
        row.remove();
        [...container.children].forEach((item, itemIndex) => {
            const number = itemIndex + 1;
            item.querySelectorAll("input").forEach(input => {
                const unit = input.dataset.reminderUnit;
                input.setAttribute("aria-label", `${NOTIFICATION_LABELS[channel]} reminder ${number} ${unit}`);
            });
            item.querySelector("button").setAttribute("aria-label", `Remove ${NOTIFICATION_LABELS[channel]} reminder ${number}`);
        });
        container.parentElement.querySelector(".my-profile-reminder-add").disabled = container.children.length >= 3;
        updateNotificationWarnings();
    });
    fields.addEventListener("input", updateNotificationWarnings);
    row.append(fields, remove);
    container.append(row);
}

function renderNotificationsV2(settings, profile) {
    const root = document.getElementById("notificationsV2Channels");
    const fieldset = document.getElementById("notificationsV2Fieldset");
    const confirmed = isSettingConfirmed(profile, "notificationsV2");
    const saved = settings.notificationsV2 && typeof settings.notificationsV2 === "object" ? settings.notificationsV2 : {};
    root.replaceChildren();
    fieldset.disabled = !confirmed;
    const notice = document.getElementById("notificationsV2Notice");
    notice.hidden = confirmed;
    notice.textContent = "Saved notification channels could not be confirmed. They are locked and won’t be changed.";

    for (const channel of NOTIFICATION_CHANNELS) {
        const value = saved[channel] && typeof saved[channel] === "object" ? saved[channel] : {};
        const section = document.createElement("section");
        section.className = "my-profile-notification-channel";
        section.setAttribute("aria-label", `${NOTIFICATION_LABELS[channel]} notification settings`);
        const label = document.createElement("label");
        label.className = "my-profile-toggle";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.channelEnabled = channel;
        checkbox.checked = value.enabled === true;
        checkbox.indeterminate = typeof value.enabled !== "boolean";
        if (channel === "discord") checkbox.disabled = !discordEligibilityState.eligible && !checkbox.checked;
        const text = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = `Enable ${NOTIFICATION_LABELS[channel]} reminders`;
        const description = document.createElement("small");
        description.textContent = channel === "discord"
            ? "Availability depends on current server-side Discord eligibility."
            : "You can keep reminder times saved while this channel is disabled.";
        text.append(title, description);
        label.append(checkbox, text);

        const reminders = document.createElement("div");
        reminders.className = "my-profile-reminders";
        reminders.dataset.channelReminders = channel;
        for (const minutes of Array.isArray(value.reminders) ? value.reminders.slice(0, 3) : []) {
            appendReminderRow(channel, reminders, minutes);
        }
        const add = document.createElement("button");
        add.type = "button";
        add.className = "my-profile-reminder-add";
        add.textContent = "Add reminder time";
        add.disabled = reminders.children.length >= 3;
        add.addEventListener("click", () => {
            appendReminderRow(channel, reminders, 15);
            add.disabled = reminders.children.length >= 3;
            updateNotificationWarnings();
        });
        section.append(label, reminders, add);
        root.append(section);
    }
    updateNotificationWarnings();
    updateDiscordNotificationAvailability();
}

function readNotificationsV2() {
    const settings = {};
    for (const channel of NOTIFICATION_CHANNELS) {
        const enabled = document.querySelector(`[data-channel-enabled="${channel}"]`);
        const container = document.querySelector(`[data-channel-reminders="${channel}"]`);
        const reminders = [];
        for (const row of container.querySelectorAll("[data-reminder-row]")) {
            const values = Object.fromEntries([...row.querySelectorAll("input[data-reminder-unit]")].map(input => [input.dataset.reminderUnit, input.value]));
            const parsed = reminderMinutesFromParts(values.days, values.hours, values.minutes);
            if (parsed.error) return { settings: null, error: parsed.error };
            if (!parsed.empty) reminders.push(parsed.minutes);
        }
        settings[channel] = { enabled: enabled.checked, reminders };
    }
    return { settings, error: null };
}

function updateNotificationWarnings() {
    const warning = document.getElementById("notificationsV2DuplicateWarning");
    if (!warning) return;
    const result = readNotificationsV2();
    warning.hidden = Boolean(result.error) || !getDuplicateReminderChannels(result.settings).length;
}

function validateNotificationForm(notificationsV2) {
    const email = document.getElementById("profileEmail");
    const phone = document.getElementById("profilePhone");
    const error = validateNotificationsV2(notificationsV2, email.value, phone.value);
    if (error) return error;
    if (notificationsV2.email.enabled && !email.checkValidity()) return "Enter a valid email address to enable email reminders.";
    const previouslyEnabled = profileSnapshot?.profile?.settings?.notificationsV2?.discord?.enabled === true;
    if (notificationsV2.discord.enabled && !previouslyEnabled && !discordEligibilityState.eligible) {
        return "Discord reminders can only be enabled after current Discord and MatchBot eligibility is confirmed.";
    }
    return null;
}

function displayLocation(settings, settingsAvailability, key) {
    if (settingsAvailability?.[key] !== true) return "Not confirmed";
    return settings[key] === null ? "Not recorded" : settings[key] || "Not recorded";
}

function applyEditableFieldAvailability(profile) {
    const fields = {
        primaryPlatform: ["primaryPlatform"],
        autoDetectRegion: ["autoDetectRegion"],
        showOnlineStatus: ["showOnlineStatus"],
        findProfileEnabled: ["findProfileEnabled"],
        preferredMode: ["preferredMode"],
        otherMode: ["otherMode"],
        email: ["profileEmail"],
        phone: ["profilePhone"],
        notificationsV2: ["notificationsV2Fieldset"]
    };
    for (const [key, ids] of Object.entries(fields)) {
        const confirmed = isSettingConfirmed(profile, key);
        for (const id of ids) {
            const control = document.getElementById(id);
            if (!control) continue;
            control.disabled = !confirmed;
            if (control.type === "checkbox") {
                control.indeterminate = !confirmed || profile.settings[key] === null;
            }
        }
    }
}

function renderProfile(result) {
    const profile = result.profile || {};
    const settings = profile.settings || {};
    profileSnapshot = result;

    const region = displayLocation(settings, profile.settingsAvailability, "region");
    const country = displayLocation(settings, profile.settingsAvailability, "countryCode");
    document.getElementById("myProfileRegion").textContent = country !== "Not recorded" && country !== "Not confirmed" ? `${region} (${country})` : region;
    document.getElementById("myProfileTimezone").textContent = displayLocation(settings, profile.settingsAvailability, "displayTimezone");
    document.getElementById("myProfileConsent").textContent = profile.ageConsent === true && profile.policyConsent === true ? "Confirmed" : "Not confirmed";

    document.getElementById("primaryPlatform").value = typeof settings.primaryPlatform === "string" ? settings.primaryPlatform : "";

    document.getElementById("autoDetectRegion").checked = settings.autoDetectRegion === true;
    document.getElementById("showOnlineStatus").checked = settings.showOnlineStatus === true;
    document.getElementById("findProfileEnabled").checked = getFindProfileVisibilityState(profile).checked;
    document.getElementById("preferredMode").value = typeof settings.preferredMode === "string" ? settings.preferredMode : "";
    document.getElementById("otherMode").value = typeof settings.otherMode === "string" ? settings.otherMode : "";
    document.getElementById("otherModeField").hidden = settings.preferredMode !== "other" && isSettingConfirmed(profile, "preferredMode");
    document.getElementById("profileEmail").value = typeof settings.email === "string" ? settings.email : "";
    document.getElementById("profilePhone").value = typeof settings.phone === "string" ? settings.phone : "";
    renderNotificationsV2(settings, profile);
    const availabilityEditable = isSettingConfirmed(profile, "availability");
    renderAvailability(Array.isArray(settings.availability) ? settings.availability : [], availabilityEditable);
    applyEditableFieldAvailability(profile);

    const confirmation = getSettingsConfirmationState(profile);
    const form = document.getElementById("myProfileSettingsForm");
    form.hidden = false;
    document.getElementById("myProfileSave").disabled = !confirmation.canSave;
    const notice = document.getElementById("myProfileVerificationNotice");
    notice.hidden = confirmation.canSave;
    notice.textContent = confirmation.unconfirmedLabels.length
        ? `Could not confirm: ${confirmation.unconfirmedLabels.join(", ")}. These controls are locked. The existing save replaces the complete settings set, so updates stay disabled until all saved values are available.`
        : "Consent verification is unavailable. Updates stay disabled because consent is server-managed.";
    if (!confirmation.canSave) setStatus("Your saved settings are shown below; unconfirmed controls and saving are locked to protect existing values.", "error");
    return confirmation.canSave;
}

function settingsPayload() {
    const profile = profileSnapshot.profile;
    if (!getSettingsConfirmationState(profile).canSave) throw new Error("Saved settings are not fully confirmed.");
    const notificationResult = readNotificationsV2();
    if (notificationResult.error) throw new Error(notificationResult.error);
    const availability = DAYS.flatMap(day => {
        if (!document.querySelector(`[data-day="${day}"]`)?.checked) return [];
        return [{ day, start: document.querySelector(`[data-start="${day}"]`).value, end: document.querySelector(`[data-end="${day}"]`).value }];
    });
    return buildSettingsPayload(profile, {
        primaryPlatform: document.getElementById("primaryPlatform").value || null,
        autoDetectRegion: document.getElementById("autoDetectRegion").checked,
        showOnlineStatus: document.getElementById("showOnlineStatus").checked,
        findProfileEnabled: document.getElementById("findProfileEnabled").checked,
        email: document.getElementById("profileEmail").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
        preferredMode: document.getElementById("preferredMode").value,
        otherMode: document.getElementById("otherMode").value.trim(),
        availability,
        notificationsV2: notificationResult.settings
    });
}

async function requestProfile(method = "GET", body) {
    const url = method === "GET" ? `${ROCKET_LEAGUE_PROFILE_URL}?includeLegacyFindProfile=true` : ROCKET_LEAGUE_PROFILE_URL;
    const response = await apiFetch(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) throw new Error("Profile request failed.");
    return result;
}

async function deleteRocketLeagueProfile() {
    if (deleteInProgress || document.getElementById("deleteRlProfileAcknowledgment").checked !== true) return;
    deleteInProgress = true;
    const button = document.getElementById("deleteRlProfileHold");
    button.disabled = true;
    const status = document.getElementById("deleteRlProfileStatus");
    status.textContent = "Deleting your Rocket League profile…";
    status.dataset.state = "working";
    let result;
    try {
        const response = await apiFetch(ROCKET_LEAGUE_PROFILE_URL, {
            method: "DELETE",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ confirmation: DELETE_PROFILE_CONFIRMATION })
        });
        result = await response.json().catch(() => ({}));
        if (!response.ok || result.success !== true || result.profileDeleted !== true) {
            throw new Error(result.message || "The Rocket League profile could not be deleted.");
        }
    } catch (error) {
        status.textContent = error.message || "The Rocket League profile could not be deleted. Please try again.";
        status.dataset.state = "error";
        button.disabled = false;
        button.textContent = "Press and hold to delete";
        deleteInProgress = false;
        return;
    }

    profileSnapshot = null;
    document.getElementById("myProfileSettingsForm").hidden = true;
    document.getElementById("deleteRlProfileAcknowledgment").checked = false;
    for (const key of ["rlEpicLinked", "rlEpicAuthorized", "rlEpicReauthorizationRequired", "rlProfileExists", "rlProfileComplete", "rlRegistrationAccepted", "rlAccess"]) {
        delete document.body.dataset[key];
    }
    status.textContent = result.epicLinkRemoved === true
        ? "Rocket League profile deleted and Epic unlinked. Returning to the Rocket League hub…"
        : "Rocket League profile deleted. Returning to the Rocket League hub…";
    status.dataset.state = "ready";
    try {
        await refreshAuthState({ force: true });
        if (window.BPDRouter?.navigate) {
            await window.BPDRouter.navigate("/RocketLeague", { replace: true });
        } else {
            window.location.replace("/RocketLeague");
        }
    } catch {
        window.location.replace("/RocketLeague");
    }
}

function cancelDeleteHold() {
    if (deleteHoldTimer) {
        clearInterval(deleteHoldTimer);
        deleteHoldTimer = null;
        const button = document.getElementById("deleteRlProfileHold");
        if (button && !deleteInProgress) button.textContent = "Press and hold to delete";
    }
}

function startDeleteHold() {
    const acknowledgment = document.getElementById("deleteRlProfileAcknowledgment");
    const button = document.getElementById("deleteRlProfileHold");
    if (!acknowledgment.checked || button.disabled || deleteHoldTimer || deleteInProgress) return;
    const startedAt = Date.now();
    deleteHoldTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, Math.ceil((DELETE_HOLD_DURATION_MS - elapsed) / 1000));
        button.textContent = remaining ? `Keep holding… ${remaining}` : "Deleting…";
        if (elapsed >= DELETE_HOLD_DURATION_MS) {
            clearInterval(deleteHoldTimer);
            deleteHoldTimer = null;
            void deleteRocketLeagueProfile();
        }
    }, 100);
}

function lockSettings() {
    profileSnapshot = null;
    const form = document.getElementById("myProfileSettingsForm");
    form.querySelectorAll("input, select, button").forEach(control => { control.disabled = true; });
    document.getElementById("myProfileSave").disabled = true;
}

export async function initializePage() {
    const form = document.getElementById("myProfileSettingsForm");
    if (!form) return;
    document.getElementById("myProfileSave").textContent = "Update Profile";
    const preferredMode = document.getElementById("preferredMode");
    preferredMode.addEventListener("change", () => {
        document.getElementById("otherModeField").hidden = preferredMode.value !== "other";
    });
    document.getElementById("notificationsV2Channels").addEventListener("change", event => {
        if (event.target.matches('[data-channel-enabled="discord"]')) updateDiscordNotificationAvailability();
    });
    const deleteAcknowledgment = document.getElementById("deleteRlProfileAcknowledgment");
    const deleteButton = document.getElementById("deleteRlProfileHold");
    deleteAcknowledgment.addEventListener("change", () => {
        deleteButton.disabled = !deleteAcknowledgment.checked;
        if (!deleteAcknowledgment.checked) cancelDeleteHold();
    });
    deleteButton.addEventListener("pointerdown", startDeleteHold);
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) {
        deleteButton.addEventListener(eventName, cancelDeleteHold);
    }
    deleteButton.addEventListener("keydown", event => {
        if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            startDeleteHold();
        }
    });
    deleteButton.addEventListener("keyup", event => {
        if (event.key === " " || event.key === "Enter") cancelDeleteHold();
    });
    deleteButton.addEventListener("click", event => event.preventDefault());
    document.getElementById("myProfileDiscordCheckAgain")?.addEventListener("click", () => loadDiscordNotificationAvailability(true));
    form.addEventListener("submit", async event => {
        event.preventDefault();
        let payload;
        try {
            payload = settingsPayload();
        } catch (error) {
            setStatus(error.message || "Check your notification reminder times.", "error");
            return;
        }
        const notificationError = validateNotificationForm(payload.notificationsV2);
        if (notificationError) {
            setStatus(notificationError, "error");
            return;
        }
        const save = document.getElementById("myProfileSave");
        save.disabled = true;
        save.textContent = "Saving…";
        try {
            const saved = await requestProfile("PATCH", payload);
            const refreshed = await requestProfile();
            const settingsConfirmed = renderProfile(refreshed);
            setStatus(saved.profileSaved === true && settingsConfirmed ? "Profile settings updated." : "The saved settings could not be confirmed; editing is locked.", saved.profileSaved === true && settingsConfirmed ? "ready" : "error");
            if (saved.profileSaved !== true || !settingsConfirmed) lockSettings();
        } catch {
            lockSettings();
            setStatus("Your settings could not be confirmed after saving. Editing is locked until the profile can be reloaded.", "error");
        } finally {
            save.textContent = "Update Profile";
            if (!form.hidden && profileSnapshot) save.disabled = false;
        }
    });

    try {
        const [profileResult] = await Promise.all([requestProfile(), loadDiscordNotificationAvailability()]);
        const result = profileResult;
        if (result.profileComplete !== true || result.rocketLeagueAccess !== true) {
            window.BPDRouter?.navigate ? await window.BPDRouter.navigate("/RocketLeague/Profile", { replace: true }) : window.location.replace("/RocketLeague/Profile");
            return;
        }
        const confirmed = renderProfile(result);
        if (confirmed) setStatus("Manage your Rocket League profile settings and privacy.");
    } catch {
        lockSettings();
        setStatus("Your profile could not be loaded right now. Settings remain locked.", "error");
    }
}
