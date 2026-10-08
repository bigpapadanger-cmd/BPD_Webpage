import { normalizeAccountScope, migrateRegistrationDraft } from "/scripts/accountScope.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE REGISTRATION CLIENT

File:
    /Tabs/RocketLeague/Registration/JS/index.js

Purpose:
    Handles initial Rocket League profile setup.

Responsibilities:
    - Loads authenticated Epic identity.
    - Loads existing Rocket League profile state.
    - Handles eligibility and policy acknowledgements.
    - Handles strictly opt-in region/time-zone detection.
    - Never detects region/time-zone data until the user enables it.
    - Clears detected region/time-zone data when detection is disabled.
    - Handles Player Profile preferences.
    - Allows optional email and phone information.
    - Warns when no direct contact information is supplied.
    - Handles Email, Phone, and Discord notifications.
    - Verifies Discord notification eligibility server-side.
    - Provides MatchBot installation when required.
    - Handles weekly availability.
    - Preserves non-sensitive incomplete registration drafts locally.
    - Does not restore consent or location opt-in from local drafts.
    - Submits Rocket League profile setup to the server.

Discord Requirements:
    Discord notifications require:
        1. A linked Discord identity.
        2. At least one mutual Discord server with MatchBot.

    MatchBot install URL is supplied by the server from:
        DISCORD_MATCHBOT_INSTALL_URL

Security:
    - The browser does not determine Discord eligibility.
    - The browser does not supply canonical account IDs.
    - Epic identity is display-only on the client.
    - Consent is never restored from local draft storage.
    - Region detection is disabled by default.
    - Server APIs remain authoritative.
========================================================= */

import {
    TIMEZONE_DISPLAY_ALIASES
} from "./timezone.js";

import {
    BPD_LOGIN_PAGE_URL,
    BPD_ACCOUNT_PAGE_URL,
    ROCKET_LEAGUE_PAGE_URL,
    ROCKET_LEAGUE_PROFILE_PAGE_URL,
    ROCKET_LEAGUE_PROFILE_URL,
    DISCORD_NOTIFICATION_STATUS_URL
} from "../../../../scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../../scripts/apiConnection.js";

import {
    getDuplicateReminderChannels,
    isNotificationsV2,
    NOTIFICATION_CHANNELS,
    REMINDER_LIMITS,
    reminderMinutesFromParts,
    validateNotificationsV2
} from "../../shared/notificationsV2.js";

import {
    getAuthState,
    hasActiveAccount,
    hasLinkedProvider,
    hasAuthorizedProvider,
    requiresProviderReauthorization,
    getProvider
} from "../../../../Framework/Auth/auth.js";


/* =========================================================
CONFIGURATION
========================================================= */

const REGISTRATION_DRAFT_KEY =
    "bpdRocketLeagueRegistrationDraft";

let registrationDraftAccountScope = "";
let registrationDraftGeneration = 0;
document.addEventListener("bpd:auth-state-changed", event => {
    const scope = event.detail?.state?.authenticated === true ? normalizeAccountScope(event.detail.state.accountScope) : "";
    if (scope !== registrationDraftAccountScope) {
        registrationDraftGeneration += 1;
        registrationDraftAccountScope = "";
    }
});

function getRegistrationDraftKey() {
    return registrationDraftAccountScope
        ? `${REGISTRATION_DRAFT_KEY}:${registrationDraftAccountScope}`
        : null;
}

const REGISTRATION_CONFIG =
    Object.freeze({
        availability: {
            start:
                "17:00",

            end:
                "23:00",

            incrementMinutes:
                30
        }
    });

const DAYS =
    Object.freeze([
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday"
    ]);

/* =========================================================
STATE
========================================================= */

let currentLocation = {
    city:
        "",

    region:
        "",

    country:
        "",

    countryCode:
        "",

    timezone:
        ""
};

let discordNotificationState = {
    checked:
        false,

    status:
        "checking",

    discordLinked:
        false,

    matchBotAvailable:
        false,

    eligible:
        false,

    installUrl:
        null,

    reason:
        null
};
let registrationNotificationsConfirmed = true;


/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    return typeof value ===
        "string"
        ? value.trim()
        : "";
}

function normalizeObject(
    value
) {
    if (
        !value
        || typeof value !==
            "object"
        || Array.isArray(
            value
        )
    ) {
        return {};
    }

    return value;
}

/* =========================================================
TIMEZONE DISPLAY
========================================================= */

function getTimezoneDisplayName(
    timezone
) {
    const value =
        normalizeString(
            timezone
        );

    if (
        !value
    ) {
        return "";
    }

    return (
        TIMEZONE_DISPLAY_ALIASES[
            value
        ]
        || value
    );
}

/* =========================================================
TIME HELPERS
========================================================= */

function timeToMinutes(
    value
) {
    const [
        hours,
        minutes
    ] =
        String(
            value
        )
            .split(":")
            .map(
                Number
            );

    return (
        hours * 60
        + minutes
    );
}

function minutesToTime(
    totalMinutes
) {
    const hours =
        Math.floor(
            totalMinutes / 60
        );

    const minutes =
        totalMinutes % 60;

    return (
        String(
            hours
        ).padStart(
            2,
            "0"
        )
        + ":"
        + String(
            minutes
        ).padStart(
            2,
            "0"
        )
    );
}

function formatTimeLabel(
    value
) {
    const [
        hourValue,
        minuteValue
    ] =
        String(
            value
        )
            .split(":")
            .map(
                Number
            );

    const suffix =
        hourValue >= 12
            ? "PM"
            : "AM";

    const displayHour =
        hourValue % 12 === 0
            ? 12
            : hourValue % 12;

    return (
        `${displayHour}:`
        + String(
            minuteValue
        ).padStart(
            2,
            "0"
        )
        + ` ${suffix}`
    );
}

function buildTimeOptions(
    start,
    end,
    incrementMinutes
) {
    const options =
        [];

    const startMinutes =
        timeToMinutes(
            start
        );

    const endMinutes =
        timeToMinutes(
            end
        );

    for (
        let minute =
            startMinutes;
        minute <= endMinutes;
        minute += incrementMinutes
    ) {
        const value =
            minutesToTime(
                minute
            );

        options.push([
            value,
            formatTimeLabel(
                value
            )
        ]);
    }

    return options;
}

function getAvailabilityTimeOptions() {
    return buildTimeOptions(
        REGISTRATION_CONFIG
            .availability
            .start,

        REGISTRATION_CONFIG
            .availability
            .end,

        REGISTRATION_CONFIG
            .availability
            .incrementMinutes
    );
}

function createTimeOptions(
    options,
    selectedValue
) {
    return options
        .map(
            ([value, label]) => `
                <option
                    value="${value}"
                    ${
                        value === selectedValue
                            ? "selected"
                            : ""
                    }
                >
                    ${label}
                </option>
            `
        )
        .join("");
}

/* =========================================================
AVAILABILITY
========================================================= */

function renderAvailabilityRows() {
    const container =
        document.getElementById(
            "availabilityRows"
        );

    if (
        !container
    ) {
        return;
    }

    const timeOptions =
        getAvailabilityTimeOptions();

    const defaultStart =
        REGISTRATION_CONFIG
            .availability
            .start;

    const defaultEnd =
        REGISTRATION_CONFIG
            .availability
            .end;

    container.innerHTML =
        DAYS
            .map(
                day => {
                    const key =
                        day.toLowerCase();

                    return `
                        <div
                            class="availability-row"
                            data-day="${key}"
                        >
                            <label class="availability-day">
                                <input
                                    type="checkbox"
                                    name="availableDays"
                                    value="${key}"
                                >

                                <span>
                                    ${day}
                                </span>
                            </label>

                            <select
                                class="availability-time"
                                name="${key}Start"
                                aria-label="${day} start time"
                                disabled
                            >
                                ${createTimeOptions(
                                    timeOptions,
                                    defaultStart
                                )}
                            </select>

                            <span class="availability-separator">
                                to
                            </span>

                            <select
                                class="availability-time"
                                name="${key}End"
                                aria-label="${day} end time"
                                disabled
                            >
                                ${createTimeOptions(
                                    timeOptions,
                                    defaultEnd
                                )}
                            </select>
                        </div>
                    `;
                }
            )
            .join("");

    container
        .querySelectorAll(
            'input[name="availableDays"]'
        )
        .forEach(
            checkbox => {
                checkbox.addEventListener(
                    "change",
                    () => {
                        updateAvailabilityRow(
                            checkbox
                        );
                    }
                );
            }
        );
}

function updateAvailabilityRow(
    checkbox
) {
    const row =
        checkbox.closest(
            ".availability-row"
        );

    if (
        !row
    ) {
        return;
    }

    row.classList.toggle(
        "enabled",
        checkbox.checked
    );

    row
        .querySelectorAll(
            "select"
        )
        .forEach(
            select => {
                select.disabled =
                    !checkbox.checked;
            }
        );
}

function getAvailability() {
    return [
        ...document.querySelectorAll(
            ".availability-row.enabled"
        )
    ].map(
        row => ({
            day:
                row.dataset.day,

            start:
                row.querySelector(
                    'select[name$="Start"]'
                )?.value
                || "",

            end:
                row.querySelector(
                    'select[name$="End"]'
                )?.value
                || ""
        })
    );
}

function populateAvailability(
    availability
) {
    const minimumTime =
        REGISTRATION_CONFIG
            .availability
            .start;

    const maximumTime =
        REGISTRATION_CONFIG
            .availability
            .end;

    document
        .querySelectorAll(
            'input[name="availableDays"]'
        )
        .forEach(
            checkbox => {
                checkbox.checked =
                    false;

                updateAvailabilityRow(
                    checkbox
                );
            }
        );

    if (
        !Array.isArray(
            availability
        )
    ) {
        return;
    }

    availability.forEach(
        item => {
            const day =
                normalizeString(
                    item?.day
                ).toLowerCase();

            if (
                !day
            ) {
                return;
            }

            const row =
                document.querySelector(
                    `.availability-row[data-day="${CSS.escape(
                        day
                    )}"]`
                );

            if (
                !row
            ) {
                return;
            }

            const checkbox =
                row.querySelector(
                    'input[name="availableDays"]'
                );

            const start =
                row.querySelector(
                    'select[name$="Start"]'
                );

            const end =
                row.querySelector(
                    'select[name$="End"]'
                );

            if (
                checkbox
            ) {
                checkbox.checked =
                    true;

                updateAvailabilityRow(
                    checkbox
                );
            }

            const savedStart =
                normalizeString(
                    item?.start
                );

            const savedEnd =
                normalizeString(
                    item?.end
                );

            if (
                start
            ) {
                start.value =
                    savedStart >= minimumTime
                    && savedStart <= maximumTime
                        ? savedStart
                        : minimumTime;
            }

            if (
                end
            ) {
                end.value =
                    savedEnd >= minimumTime
                    && savedEnd <= maximumTime
                        ? savedEnd
                        : maximumTime;
            }
        }
    );
}

/* =========================================================
GENERIC INPUT HELPERS
========================================================= */

function setInputValue(
    id,
    value
) {
    const element =
        document.getElementById(
            id
        );

    if (
        element
    ) {
        element.value =
            value
            ?? "";
    }
}

function setCheckboxValue(
    id,
    value
) {
    const element =
        document.getElementById(
            id
        );

    if (
        element
    ) {
        element.checked =
            value === true;
    }
}

function setRadioValue(
    name,
    value
) {
    const normalizedValue =
        normalizeString(
            value
        );

    if (
        !normalizedValue
    ) {
        return;
    }

    const input =
        document.querySelector(
            `input[name="${name}"][value="${CSS.escape(
                normalizedValue
            )}"]`
        );

    if (
        input
    ) {
        input.checked =
            true;
    }
}

/* =========================================================
UI MESSAGE
========================================================= */

function showMessage(
    message,
    state
) {
    const element =
        document.getElementById(
            "registrationMessage"
        );

    if (
        !element
    ) {
        return;
    }

    element.textContent =
        message;

    element.dataset.state =
        state;

    element.hidden =
        false;

    element.scrollIntoView({
        behavior:
            "smooth",

        block:
            "center"
    });
}

function hideMessage() {
    const element =
        document.getElementById(
            "registrationMessage"
        );

    if (
        !element
    ) {
        return;
    }

    element.hidden =
        true;

    element.textContent =
        "";

    element.dataset.state =
        "";
}

function setBackendWarning(
    visible,
    message = ""
) {
    const element =
        document.getElementById(
            "registrationBackendWarning"
        );

    if (
        !element
    ) {
        return;
    }

    element.hidden =
        !visible;

    if (
        !visible
        || !message
    ) {
        return;
    }

    const messageElement =
        element.querySelector(
            "span"
        );

    if (
        messageElement
    ) {
        messageElement.textContent =
            message;
    }
}

/* =========================================================
PREFERRED MODE
========================================================= */

function updateModeField() {
    const mode =
        document.querySelector(
            'input[name="preferredMode"]:checked'
        )?.value;

    const field =
        document.getElementById(
            "otherModeField"
        );

    const input =
        document.getElementById(
            "otherMode"
        );

    const isOther =
        mode ===
        "other";

    if (
        field
    ) {
        field.hidden =
            !isOther;
    }

    if (
        input
    ) {
        input.required =
            isOther;

        if (
            !isOther
        ) {
            input.value =
                "";
        }
    }
}

/* =========================================================
DIRECT CONTACT WARNING
========================================================= */

function updateDirectContactWarning() {
    const email =
        normalizeString(
            document.getElementById(
                "email"
            )?.value
        );

    const phone =
        normalizeString(
            document.getElementById(
                "phone"
            )?.value
        );

    const warning =
        document.getElementById(
            "noDirectContactWarning"
        );

    if (
        warning
    ) {
        warning.hidden =
            Boolean(
                email
                || phone
            );
    }
}

/* =========================================================
REGION + TIMEZONE

Detection is strictly opt-in.

Rules:
    - New registration sessions start with detection disabled.
    - A normal profile GET does not request location detection.
    - A fresh location request is made only when the user
      explicitly checks the detection toggle.
    - Unchecking immediately clears all client-side detected
      region/time-zone values and hides the display fields.
    - Saved server-side region preferences may be displayed
      when loading an existing profile, but loading the form
      does not perform a fresh location lookup.
========================================================= */

function getAutoDetectRegionEnabled() {
    return (
        document.getElementById(
            "autoDetectRegion"
        )?.checked ===
        true
    );
}

function normalizeLocation(
    result,
    profile
) {
    const source =
        result?.location
        || result?.geo
        || profile?.location
        || {};

    return {
        city:
            normalizeString(
                source.city
                || result?.city
            ),

        region:
            normalizeString(
                source.region
                || source.regionName
                || result?.region
            ),

        country:
            normalizeString(
                source.country
                || source.countryName
                || result?.country
            ),

        countryCode:
            normalizeString(
                source.countryCode
                || source.country_code
                || result?.countryCode
            ),

        timezone:
            normalizeString(
                source.timezone
                || result?.timezone
            )
    };
}

function hasLocationData(
    location
) {
    return Boolean(
        normalizeString(
            location?.region
        )
        || normalizeString(
            location?.country
        )
        || normalizeString(
            location?.countryCode
        )
        || normalizeString(
            location?.timezone
        )
    );
}

function formatLocation(
    location
) {
    const values =
        [
            location?.region,

            location?.country
            || location?.countryCode
        ]
            .map(
                normalizeString
            )
            .filter(
                Boolean
            );

    return values.length > 0
        ? values.join(
            ", "
        )
        : "Location unavailable";
}

function setDetectedRegionFieldsVisible(
    visible
) {
    const fields =
        document.getElementById(
            "detectedRegionFields"
        );

    if (
        fields
    ) {
        fields.hidden =
            !visible;
    }
}

function applyLocation(
    location
) {
    currentLocation = {
        city:
            normalizeString(
                location?.city
            ),

        region:
            normalizeString(
                location?.region
            ),

        country:
            normalizeString(
                location?.country
            ),

        countryCode:
            normalizeString(
                location?.countryCode
            ),

        timezone:
            normalizeString(
                location?.timezone
            )
    };

    setInputValue(
        "detectedLocation",
        formatLocation(
            currentLocation
        )
    );
}

function applyTimezone(
    timezone
) {
    const resolvedTimezone =
        normalizeString(
            timezone
        )
        || currentLocation.timezone;

    setInputValue(
        "timezone",
        resolvedTimezone
    );

    setInputValue(
        "timezoneDisplay",
        resolvedTimezone
            ? getTimezoneDisplayName(
                resolvedTimezone
            )
            : "Time zone unavailable"
    );
}

function clearDetectedRegion() {
    currentLocation = {
        city:
            "",

        region:
            "",

        country:
            "",

        countryCode:
            "",

        timezone:
            ""
    };

    setInputValue(
        "detectedLocation",
        ""
    );

    setInputValue(
        "timezoneDisplay",
        ""
    );

    setInputValue(
        "timezone",
        ""
    );

    setDetectedRegionFieldsVisible(
        false
    );
}

function showStoredRegion(
    location,
    timezone
) {
    if (
        !hasLocationData(
            location
        )
        && !normalizeString(
            timezone
        )
    ) {
        clearDetectedRegion();

        return;
    }

    setDetectedRegionFieldsVisible(
        true
    );

    applyLocation(
        location
    );

    applyTimezone(
        timezone
    );
}

async function detectRegion() {
    if (
        !getAutoDetectRegionEnabled()
    ) {
        clearDetectedRegion();

        return;
    }

    setDetectedRegionFieldsVisible(
        true
    );

    setInputValue(
        "detectedLocation",
        "Detecting…"
    );

    setInputValue(
        "timezoneDisplay",
        "Detecting…"
    );

    setInputValue(
        "timezone",
        ""
    );

    try {
        const url =
            new URL(
                ROCKET_LEAGUE_PROFILE_URL,
                window.location.origin
            );

        url.searchParams.set(
            "detectLocation",
            "true"
        );
        url.searchParams.set("includePresence", "false");

        const response =
            await apiFetch(
                url.pathname
                + url.search,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        const result =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (
            !getAutoDetectRegionEnabled()
        ) {
            clearDetectedRegion();

            return;
        }

        if (
            !response.ok
            || result.success !==
                true
        ) {
            throw new Error(
                result.message
                || "Region detection failed."
            );
        }

        const detectedLocation =
            normalizeLocation(
                result,
                {}
            );

        if (
            !hasLocationData(
                detectedLocation
            )
        ) {
            throw new Error(
                "Region detection returned no usable location data."
            );
        }

        applyLocation(
            detectedLocation
        );

        applyTimezone(
            detectedLocation.timezone
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Region detection failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        if (
            !getAutoDetectRegionEnabled()
        ) {
            clearDetectedRegion();

            return;
        }

        currentLocation = {
            city:
                "",

            region:
                "",

            country:
                "",

            countryCode:
                "",

            timezone:
                ""
        };

        setDetectedRegionFieldsVisible(
            true
        );

        setInputValue(
            "detectedLocation",
            "Location unavailable"
        );

        setInputValue(
            "timezoneDisplay",
            "Time zone unavailable"
        );

        setInputValue(
            "timezone",
            ""
        );
    }
}

async function handleRegionDetectionChange() {
    if (
        !getAutoDetectRegionEnabled()
    ) {
        clearDetectedRegion();

        return;
    }

    await detectRegion();
}

/* =========================================================
NOTIFICATION STATE
========================================================= */

const NOTIFICATION_LABELS = Object.freeze({ email: "Email", sms: "Text / SMS", discord: "Discord" });

function notificationEnabled(channel) {
    return document.querySelector(`[data-notification-enabled="${channel}"]`)?.checked === true;
}

function reminderParts(totalMinutes) {
    return { days: Math.floor(totalMinutes / 1440), hours: Math.floor(totalMinutes % 1440 / 60), minutes: totalMinutes % 60 };
}

function createRegistrationReminderInput(channel, index, unit, max, value) {
    const label = document.createElement("label");
    label.className = "registration-reminder-field";
    const caption = document.createElement("span");
    caption.textContent = unit;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(max);
    input.step = "1";
    input.value = value === null ? "" : String(value);
    input.placeholder = "0";
    input.dataset.reminderUnit = unit;
    input.setAttribute("aria-label", `${NOTIFICATION_LABELS[channel]} reminder ${index} ${unit}`);
    label.append(caption, input);
    return label;
}

function appendRegistrationReminder(channel, container, totalMinutes = null) {
    if (container.children.length >= REMINDER_LIMITS.maxPerChannel) return;
    const number = container.children.length + 1;
    const parts = totalMinutes === null ? { days: null, hours: null, minutes: null } : reminderParts(totalMinutes);
    const row = document.createElement("div");
    row.className = "registration-reminder-row";
    row.dataset.reminderRow = "true";
    const fields = document.createElement("div");
    fields.className = "registration-reminder-fields";
    fields.append(
        createRegistrationReminderInput(channel, number, "days", 7, parts.days),
        createRegistrationReminderInput(channel, number, "hours", 23, parts.hours),
        createRegistrationReminderInput(channel, number, "minutes", 59, parts.minutes)
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary-button registration-reminder-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${NOTIFICATION_LABELS[channel]} reminder ${number}`);
    remove.addEventListener("click", () => {
        row.remove();
        [...container.children].forEach((item, itemIndex) => {
            const nextNumber = itemIndex + 1;
            item.querySelectorAll("input").forEach(input => input.setAttribute("aria-label", `${NOTIFICATION_LABELS[channel]} reminder ${nextNumber} ${input.dataset.reminderUnit}`));
            item.querySelector("button").setAttribute("aria-label", `Remove ${NOTIFICATION_LABELS[channel]} reminder ${nextNumber}`);
        });
        container.parentElement.querySelector(".registration-reminder-add").disabled = container.children.length >= REMINDER_LIMITS.maxPerChannel;
        updateRegistrationReminderWarning();
    });
    fields.addEventListener("input", updateRegistrationReminderWarning);
    row.append(fields, remove);
    container.append(row);
}

function renderRegistrationNotifications(notifications, profileExists = false, confirmed = true) {
    const fieldset = document.getElementById("registrationNotificationsV2Fieldset");
    const root = document.getElementById("registrationNotificationChannels");
    const valid = isNotificationsV2(notifications);
    registrationNotificationsConfirmed = !profileExists || (confirmed && valid);
    fieldset.disabled = profileExists && !registrationNotificationsConfirmed;
    const notice = document.getElementById("registrationNotificationsAvailabilityNotice");
    notice.hidden = !profileExists || registrationNotificationsConfirmed;
    root.replaceChildren();
    const values = valid ? notifications : { email: { enabled: false, reminders: [] }, sms: { enabled: false, reminders: [] }, discord: { enabled: false, reminders: [] } };

    for (const channel of NOTIFICATION_CHANNELS) {
        const card = document.createElement("section");
        card.className = "registration-notification-card";
        const label = document.createElement("label");
        label.className = "toggle-row registration-notification-toggle";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.notificationEnabled = channel;
        checkbox.checked = values[channel].enabled === true;
        checkbox.indeterminate = profileExists && !registrationNotificationsConfirmed;
        checkbox.setAttribute("aria-label", `Enable ${NOTIFICATION_LABELS[channel]} reminders`);
        if (channel === "discord") checkbox.setAttribute("aria-describedby", "discordNotificationStatus");
        const switchVisual = document.createElement("span");
        switchVisual.className = "toggle-control";
        switchVisual.setAttribute("aria-hidden", "true");
        const title = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = `Enable ${NOTIFICATION_LABELS[channel]} reminders`;
        const description = document.createElement("small");
        description.textContent = channel === "discord"
            ? "Requires current server-side Discord eligibility."
            : "Reminder times remain saved while this channel is off.";
        title.append(strong, description);
        label.append(checkbox, switchVisual, title);
        const reminders = document.createElement("div");
        reminders.className = "registration-reminders";
        reminders.dataset.reminderChannel = channel;
        for (const minutes of values[channel].reminders.slice(0, REMINDER_LIMITS.maxPerChannel)) appendRegistrationReminder(channel, reminders, minutes);
        const add = document.createElement("button");
        add.type = "button";
        add.className = "secondary-button registration-reminder-add";
        add.textContent = "Add reminder time";
        add.disabled = reminders.children.length >= REMINDER_LIMITS.maxPerChannel;
        add.addEventListener("click", () => {
            appendRegistrationReminder(channel, reminders, 15);
            add.disabled = reminders.children.length >= REMINDER_LIMITS.maxPerChannel;
            updateRegistrationReminderWarning();
        });
        card.append(label, reminders, add);
        root.append(card);
    }
    updateRegistrationReminderWarning();
    updateNotificationState();
}

function readRegistrationNotifications() {
    const settings = {};
    for (const channel of NOTIFICATION_CHANNELS) {
        const reminders = [];
        for (const row of document.querySelectorAll(`[data-reminder-channel="${channel}"] [data-reminder-row]`)) {
            const parts = Object.fromEntries([...row.querySelectorAll("input[data-reminder-unit]")].map(input => [input.dataset.reminderUnit, input.value]));
            const parsed = reminderMinutesFromParts(parts.days, parts.hours, parts.minutes);
            if (parsed.error) return { settings: null, error: parsed.error };
            if (!parsed.empty) reminders.push(parsed.minutes);
        }
        settings[channel] = { enabled: notificationEnabled(channel), reminders };
    }
    return { settings, error: null };
}

function updateRegistrationReminderWarning() {
    const warning = document.getElementById("registrationReminderDuplicateWarning");
    if (!warning) return;
    const result = readRegistrationNotifications();
    warning.hidden = Boolean(result.error) || !getDuplicateReminderChannels(result.settings).length;
}

function updateNotificationFieldRequirements() {
    const email = document.getElementById("email");
    const phone = document.getElementById("phone");
    if (email) email.required = notificationEnabled("email");
    if (phone) phone.required = notificationEnabled("sms");
}

function updateNotificationState() {
    const discordInput = document.querySelector('[data-notification-enabled="discord"]');
    if (discordInput && !document.getElementById("registrationNotificationsV2Fieldset").disabled) {
        discordInput.disabled = !discordNotificationState.eligible && !discordInput.checked;
    }
    updateNotificationFieldRequirements();
    updateDirectContactWarning();
}

/* =========================================================
DISCORD NOTIFICATION UI
========================================================= */

function resetDiscordNotificationUi() {
    const discordInput = document.querySelector('[data-notification-enabled="discord"]');

    const status =
        document.getElementById(
            "discordNotificationStatusText"
        );

    const accountRequired =
        document.getElementById(
            "discordAccountRequired"
        );

    const botRequired =
        document.getElementById(
            "discordMatchBotRequired"
        );

    const ready =
        document.getElementById(
            "discordNotificationReady"
        );

    const installButton =
        document.getElementById(
            "installDiscordMatchBotButton"
        );

    if (
        discordInput
    ) {
        discordInput.disabled =
            true;
    }

    if (
        status
    ) {
        status.textContent =
            "Checking Discord notification availability...";
    }

    if (
        accountRequired
    ) {
        accountRequired.hidden =
            true;
    }

    if (
        botRequired
    ) {
        botRequired.hidden =
            true;
    }

    if (
        ready
    ) {
        ready.hidden =
            true;
    }

    if (
        installButton
    ) {
        installButton.hidden =
            true;
    }
}

function applyDiscordNotificationState() {
    const state =
        discordNotificationState;

    const discordInput = document.querySelector('[data-notification-enabled="discord"]');

    const status =
        document.getElementById(
            "discordNotificationStatusText"
        );

    const accountRequired =
        document.getElementById(
            "discordAccountRequired"
        );

    const botRequired =
        document.getElementById(
            "discordMatchBotRequired"
        );

    const ready =
        document.getElementById(
            "discordNotificationReady"
        );

    const installButton =
        document.getElementById(
            "installDiscordMatchBotButton"
        );

    const selectedDiscord = discordInput?.checked === true;
    if (
        discordInput
    ) {
        discordInput.disabled =
            !state.eligible && !selectedDiscord;
    }

    if (
        accountRequired
    ) {
        accountRequired.hidden =
            state.discordLinked
            || !state.checked;
    }

    if (
        botRequired
    ) {
        botRequired.hidden =
            !state.checked
            || !state.discordLinked
            || !notificationEnabled("discord")
            || state.status !== "available"
            || state.matchBotAvailable;
    }

    if (
        ready
    ) {
        ready.hidden =
            !state.eligible;
    }

    if (
        installButton
    ) {
        installButton.hidden =
            !(
                state.checked
                && state.discordLinked
                && notificationEnabled("discord")
                && state.status === "available"
                && state.reason === "MATCHBOT_REQUIRED"
                && !state.matchBotAvailable
                && state.installUrl
            );
    }

    if (
        status
    ) {
        if (
            !state.checked
        ) {
            status.textContent =
                "Checking Discord notification availability...";
        }
        else if (
            !state.discordLinked
        ) {
            status.textContent =
                "Discord is not linked to this BPD account.";
        }
        else if (
            state.status === "unavailable"
            || state.status === "partial"
        ) {
            status.textContent =
                "Discord availability could not be verified right now. Your profile settings remain available; notification delivery may be delayed until Discord can be checked.";
        }
        else if (
            !state.matchBotAvailable
        ) {
            status.textContent =
                "MatchBot is no longer available in a Discord server you share. Add MatchBot to a server again to continue using Discord match notifications.";
        }
        else if (
            state.eligible
        ) {
            status.textContent =
                "Discord notifications are available.";
        }
        else {
            status.textContent =
                "Discord notifications are currently unavailable.";
        }
    }

    updateNotificationState();
}

async function checkDiscordNotificationEligibility(force = false) {
    resetDiscordNotificationUi();

    try {
        const response =
            await apiFetch(
                DISCORD_NOTIFICATION_STATUS_URL,
                {
                    method:
                        force ? "POST" : "GET",

                    ...(force ? { body: "{}" } : {}),

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        ...(force ? { "Content-Type": "application/json" } : {}),
                        "Accept":
                            "application/json"
                    }
                }
            );

        const result =
            await response
                .json()
                .catch(
                    () => ({})
                );

        discordNotificationState = {
            checked:
                true,

            status:
                response.ok && result?.success === true
                    ? normalizeString(result?.status) || "available"
                    : "unavailable",

            discordLinked:
                result?.discordLinked ===
                true,

            matchBotAvailable:
                result?.matchBotAvailable ===
                true,

            eligible:
                response.ok
                && result?.success ===
                    true
                && result?.eligible ===
                    true,

            installUrl:
                normalizeString(
                    result?.installUrl
                )
                || null,

            reason:
                normalizeString(
                    result?.reason
                )
                || null
        };
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Discord notification check failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        discordNotificationState = {
            checked:
                true,

            status:
                "unavailable",

            discordLinked:
                false,

            matchBotAvailable:
                false,

            eligible:
                false,

            installUrl:
                null,

            reason:
                "CHECK_FAILED"
        };
    }

    applyDiscordNotificationState();
}

function openMatchBotInstall() {
    const installUrl =
        discordNotificationState
            .installUrl;

    if (
        !installUrl
    ) {
        return;
    }

    window.open(
        installUrl,
        "_blank",
        "noopener,noreferrer"
    );
}

/* =========================================================
PROFILE NORMALIZATION
========================================================= */

function normalizeProfile(
    result,
    authUser = null
) {
    const profile =
        normalizeObject(
            result?.profile
        );

    const user =
        normalizeObject(
            result?.user
            || authUser
        );
    const settings = normalizeObject(profile.settings);
    const setting = (key, legacyKey = key) => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) return settings[key];
        const snakeKey = key.replace(/[A-Z]/gu, letter => `_${letter.toLowerCase()}`);
        if (Object.prototype.hasOwnProperty.call(settings, snakeKey)) return settings[snakeKey];
        return profile[legacyKey];
    };

    /*
     * Normal profile loading must use only previously stored
     * profile location data. Top-level request location is
     * reserved for the explicit detectLocation=true request.
     */
    const location = normalizeLocation({}, { location: {
        region: setting("region"),
        countryCode: setting("countryCode"),
        timezone: setting("displayTimezone")
    } });

    return {
        EpicDisplayName:
            profile.EpicDisplayName
            || profile.epicDisplayName
            || user.EpicDisplayName
            || user.epicDisplayName
            || "",

        EpicPreferredUsername:
            profile.EpicPreferredUsername
            || profile.epicPreferredUsername
            || user.EpicPreferredUsername
            || user.epicPreferredUsername
            || null,

        email:
            normalizeString(
                setting("email")
            ),

        phone:
            normalizeString(
                setting("phone")
            ),

        preferredMode:
            normalizeString(
                setting("preferredMode")
            ),

        otherMode:
            normalizeString(
                setting("otherMode")
            ),

        autoDetectRegion:
            setting("autoDetectRegion", "autoDetectRegion") === true,

        timezone:
            normalizeString(
                setting("displayTimezone")
                || location.timezone
            ),

        location,

        availability:
            Array.isArray(
                setting("availability")
            )
                ? setting("availability")
                : [],

        showOnlineStatus:
            setting("showOnlineStatus") === true,

        findProfileEnabled:
            typeof setting("findProfileEnabled", "find_profile_enabled") === "boolean"
                ? setting("findProfileEnabled", "find_profile_enabled")
                : null,
        notificationsV2: normalizeObject(setting("notificationsV2", "notifications_v2")),

        ageConsent:
            profile.ageConsent ===
                true
            || profile.age_consent ===
                true,

        policyConsent:
            profile.policyConsent ===
                true
            || profile.policy_consent ===
                true,

        profileComplete:
            result?.profileComplete ===
                true
            || profile.profileComplete === true
            || profile.profile_complete === true,

        profileExists:
            result?.profileExists === true
            || profile.profileExists === true,

        provider: normalizeObject(profile.provider),
        stats: normalizeObject(profile.stats),
        ranks: normalizeObject(profile.ranks),
        latestMmr: normalizeObject(result?.latestMmr),

        settingsAvailability: normalizeObject(profile.settingsAvailability),

        settings
    };
}

/* =========================================================
POPULATE PROFILE
========================================================= */

function populateProfileForm(
    profile
) {
    const settings = profile.settings || profile;
    setInputValue("primaryPlatform", settings.primaryPlatform);
    setInputValue(
        "epicDisplayName",
        profile.EpicDisplayName
        || profile.EpicPreferredUsername
        || "Epic Player"
    );

    setInputValue(
        "epicPlatform",
        "Epic Games"
    );

    /*
     * Required acknowledgements come only from persisted
     * server-authoritative profile state.
     */
    setCheckboxValue(
        "ageConsent",
        profile.ageConsent
    );

    setCheckboxValue(
        "policyConsent",
        profile.policyConsent
    );

    if (typeof settings.autoDetectRegion === "boolean") setCheckboxValue("autoDetectRegion", settings.autoDetectRegion);

    clearDetectedRegion();
    if (settings.autoDetectRegion === true && hasLocationData(profile.location)) {
        applyLocation(profile.location);
        applyTimezone(settings.displayTimezone);
        setDetectedRegionFieldsVisible(true);
    }

    setInputValue(
        "email",
        settings.email
    );

    setInputValue(
        "phone",
        settings.phone
    );

    if (
        settings.preferredMode
    ) {
        setRadioValue(
            "preferredMode",
            settings.preferredMode
        );
    }

    setInputValue(
        "otherMode",
        settings.otherMode
    );

    if (typeof settings.showOnlineStatus === "boolean") setCheckboxValue("showOnlineStatus", settings.showOnlineStatus);

    const findProfile = document.getElementById("findProfileEnabled");
    const findProfileConfirmed = profile.settingsAvailability?.findProfileEnabled === true
        && typeof settings.findProfileEnabled === "boolean";
    findProfile.checked = findProfileConfirmed ? settings.findProfileEnabled : false;
    findProfile.indeterminate = !findProfileConfirmed && profile.profileExists === true;
    findProfile.disabled = !findProfileConfirmed && profile.profileExists === true;
    const findProfileNotice = document.getElementById("findProfileAvailabilityNotice");
    if (findProfileNotice) {
        findProfileNotice.hidden = findProfileConfirmed || profile.profileExists !== true;
        findProfileNotice.textContent = "Your saved Find Players preference could not be confirmed. It is locked and won’t be changed while you complete setup.";
    }

    renderRegistrationNotifications(
        settings.notificationsV2,
        profile.profileExists === true,
        profile.settingsAvailability?.notificationsV2 === true
    );

    populateAvailability(
        settings.availability
    );

    updateModeField();
    updateDirectContactWarning();
    updateNotificationState();
}

/* =========================================================
AUTHENTICATED EPIC USER
========================================================= */

function preserveRegistrationDraft(payload = null) {
    const form = document.getElementById("rlRegistrationForm");
    if (payload) saveRegistrationDraft(payload);
    else if (form?.dataset.draftDirty === "true") saveRegistrationDraft(buildRegistrationPayload(form));
}

function handleRegistrationAuthFailure(response, result, payload = null) {
    if (response.status >= 500 || result.available === false) return false;
    let destination = null;
    if (result.requiresEpicReauthorization || result.code === "PROVIDER_REAUTHORIZATION_REQUIRED") {
        destination = "/Account?reauthorize=epic";
    } else if (response.status === 401) {
        destination = "/Login?returnTo=" + encodeURIComponent("/RocketLeague/Profile");
    } else if (result.requiresEpicLogin || ["PROVIDER_REQUIRED", "EPIC_ACCOUNT_REQUIRED", "ACCOUNT_INACTIVE", "PROFILE_PROVIDER_REAUTHORIZATION_REQUIRED"].includes(result.code)) {
        destination = "/Account";
    }
    if (!destination) return false;
    preserveRegistrationDraft(payload);
    window.location.replace(destination);
    return true;
}

document.addEventListener("bpd:before-auth-redirect", () => preserveRegistrationDraft());

async function getAuthenticatedEpicUser() {
    const authState =
        await getAuthState();

    const generation = ++registrationDraftGeneration;
    const scope = authState?.authenticated === true ? normalizeAccountScope(authState.accountScope) : "";
    registrationDraftAccountScope = "";
    await migrateRegistrationDraft(localStorage, REGISTRATION_DRAFT_KEY, scope,
        () => registrationDraftGeneration === generation);
    if (registrationDraftGeneration !== generation) return null;
    registrationDraftAccountScope = scope;

    if (
        authState?.available !==
            true
        || !hasActiveAccount(
            authState
        )
        || !hasAuthorizedProvider( "epic",
            authState
        )
    ) {
        return null;
    }

    const epicProvider =
        getProvider(
            "epic",
            authState
        );

    if (
        !epicProvider
    ) {
        return null;
    }

    return {
        EpicDisplayName:
            epicProvider.displayName
            || "",

        EpicPreferredUsername:
            epicProvider.preferredUsername
            || null
    };
}

/* =========================================================
LOAD PROFILE
========================================================= */

async function loadRocketLeagueProfile() {
    const authUser =
        await getAuthenticatedEpicUser();

    if (
        authUser
    ) {
        setInputValue(
            "epicDisplayName",
            authUser.EpicDisplayName
            || authUser.EpicPreferredUsername
            || "Epic Player"
        );
    }

    const draftGeneration = registrationDraftGeneration;
    let response;

    try {
        response =
            await apiFetch(
                `${ROCKET_LEAGUE_PROFILE_URL}?includePresence=false&includeLegacyFindProfile=true`,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Profile request failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return {
            profile:
                normalizeProfile(
                    {
                        user:
                            authUser
                    },
                    authUser
                ),

            profileLoaded:
                false,

            profileLookupConfirmed:
                false,

            warning:
                "Profile authorization or storage is currently unavailable, so your entries will be preserved locally."
        };
    }

    const result =
        await response
            .json()
            .catch(
                () => ({})
            );

    if (registrationDraftGeneration !== draftGeneration) return null;
    if (handleRegistrationAuthFailure(response, result)) return null;

    const normalized =
        normalizeProfile(
            result,
            authUser
        );

    if (
        !response.ok
        || result.success !==
            true
    ) {
        return {
            profile:
                normalized,

            profileLoaded:
                false,

            profileLookupConfirmed:
                false,

            warning:
                result.message
                || "Profile authorization or storage is currently unavailable."
        };
    }

    return {
        profile:
            normalized,

        profileLoaded:
            result.profileLoaded !==
            false,

        profileLookupConfirmed:
            true,

        warning:
            result.warning
            || null
    };
}

/* =========================================================
LOCAL DRAFT
========================================================= */

function readRegistrationDraft() {
    const draftKey = getRegistrationDraftKey();
    if (!draftKey) return null;
    try {
        const raw =
            localStorage.getItem(
                draftKey
            );

        if (
            !raw
        ) {
            return null;
        }

        const parsed =
            JSON.parse(
                raw
            );

        return normalizeObject(
            parsed
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Draft read failed.",
            error
        );

        return null;
    }
}

function saveRegistrationDraft(
    payload
) {
    const draftKey = getRegistrationDraftKey();
    if (!draftKey) return;
    /*
     * Consent and location opt-in are deliberately excluded.
     *
     * A local draft must never manufacture or restore:
     *     ageConsent
     *     policyConsent
     *     autoDetectRegion
     *     location
     *     timezone
     */
    const draft = {
        primaryPlatform: normalizeString(payload?.primaryPlatform),
        showOnlineStatus:
            payload?.showOnlineStatus ===
            true,

        findProfileEnabled:
            payload?.findProfileEnabled ===
            true,

        email:
            normalizeString(
                payload?.email
            ),

        phone:
            normalizeString(
                payload?.phone
            ),

        preferredMode:
            normalizeString(
                payload?.preferredMode
            ),

        otherMode:
            normalizeString(
                payload?.otherMode
            ),

        availability:
            Array.isArray(
                payload?.availability
            )
                ? payload.availability
                : [],
        ...(registrationNotificationsConfirmed && isNotificationsV2(payload?.notificationsV2)
            ? { notificationsV2: JSON.parse(JSON.stringify(payload.notificationsV2)) }
            : {})
    };

    try {
        localStorage.setItem(
            draftKey,
            JSON.stringify(
                draft
            )
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Draft save failed.",
            error
        );
    }
}

function clearRegistrationDraft() {
    const draftKey = getRegistrationDraftKey();
    if (!draftKey) return;
    try {
        localStorage.removeItem(
            draftKey
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Draft clear failed.",
            error
        );
    }
}

function populateDraft(
    draft
) {
    if (
        !draft
    ) {
        return;
    }

    /*
     * Draft restoration never changes:
     *     ageConsent
     *     policyConsent
     *     autoDetectRegion
     *     location
     *     timezone
     *
     * Those values must come from the server or from an
     * explicit user action during the current form session.
     */

    setInputValue(
        "email",
        draft.email
    );

    setInputValue("primaryPlatform", draft.primaryPlatform);

    setInputValue(
        "phone",
        draft.phone
    );

    setRadioValue(
        "preferredMode",
        draft.preferredMode
    );

    setInputValue(
        "otherMode",
        draft.otherMode
    );

    setCheckboxValue(
        "showOnlineStatus",
        draft.showOnlineStatus
    );

    setCheckboxValue(
        "findProfileEnabled",
        draft.findProfileEnabled
    );

    renderRegistrationNotifications(draft.notificationsV2, false, true);

    populateAvailability(
        draft.availability
    );

    updateModeField();
    updateDirectContactWarning();
    updateNotificationState();
}

/* =========================================================
PAYLOAD
========================================================= */

function buildRegistrationPayload(
    form
) {
    const data =
        new FormData(
            form
        );

    const autoDetectRegion =
        getAutoDetectRegionEnabled();

    const notificationResult = readRegistrationNotifications();

    return {
        primaryPlatform: normalizeString(data.get("primaryPlatform")),
        ageConsent:
            data.get(
                "ageConsent"
            ) ===
            "on",

        policyConsent:
            data.get(
                "policyConsent"
            ) ===
            "on",

        autoDetectRegion,

        showOnlineStatus:
            data.get(
                "showOnlineStatus"
            ) ===
            "on",

        findProfileEnabled:
            data.get(
                "findProfileEnabled"
            ) ===
            "on",

        email:
            normalizeString(
                data.get(
                    "email"
                )
            ),

        phone:
            normalizeString(
                data.get(
                    "phone"
                )
            ),

        preferredMode:
            normalizeString(
                data.get(
                    "preferredMode"
                )
            ),

        otherMode:
            normalizeString(
                data.get(
                    "otherMode"
                )
            ),

        timezone:
            autoDetectRegion
                ? normalizeString(
                    data.get(
                        "timezone"
                    )
                )
                : "",

        location:
            autoDetectRegion
                ? {
                    ...currentLocation
                }
                : null,

        availability:
            getAvailability(),

        ...(registrationNotificationsConfirmed && !notificationResult.error
            ? { notificationsV2: notificationResult.settings }
            : {})
    };
}

/* =========================================================
VALIDATION
========================================================= */

function validateRegistrationPayload(
    payload,
    form
) {
    if (
        payload.ageConsent !==
        true
    ) {
        return (
            "You must confirm the eligibility requirement before registration can finish."
        );
    }

    if (
        payload.policyConsent !==
        true
    ) {
        return (
            "You must acknowledge the Terms of Service and Privacy Policy before registration can finish."
        );
    }

    if (
        !payload.preferredMode
    ) {
        return (
            "Select your preferred Rocket League mode."
        );
    }

    if (
        payload.preferredMode ===
            "other"
        && !payload.otherMode
    ) {
        return (
            "Describe your preferred Rocket League mode."
        );
    }

    if (
        !Array.isArray(
            payload.availability
        )
        || payload.availability.length ===
            0
    ) {
        return (
            "Select at least one day when you are available."
        );
    }

    const minimumTime =
        REGISTRATION_CONFIG
            .availability
            .start;

    const maximumTime =
        REGISTRATION_CONFIG
            .availability
            .end;

    if (
        payload.availability.some(
            ({start, end}) =>
                start < minimumTime
                || start > maximumTime
                || end < minimumTime
                || end > maximumTime
        )
    ) {
        return (
            "Availability must be between 5:00 PM and 11:00 PM."
        );
    }

    if (
        payload.availability.some(
            ({start, end}) =>
                start >= end
        )
    ) {
        return (
            "Each availability end time must be later than its start time."
        );
    }

    if (payload.notificationsV2) {
        const notificationError = validateNotificationsV2(payload.notificationsV2, payload.email, payload.phone);
        if (notificationError) return notificationError;
        if (payload.notificationsV2.email.enabled && !document.getElementById("email").checkValidity()) {
            return "Enter a valid email address to enable email reminders.";
        }
        if (payload.notificationsV2.discord.enabled
            && form?.dataset.discordPreviouslyEnabled !== "true"
            && !discordNotificationState.eligible) {
            return "Discord notifications are not available until your linked Discord account shares a server with BPD MatchBot.";
        }
    }

    return null;
}

/* =========================================================
SUBMIT
========================================================= */

async function submitRegistration(
    event
) {
    event.preventDefault();

    hideMessage();

    const form =
        event.currentTarget;

    if (form.dataset.profileLookupConfirmed !== "true") {
        showMessage("We couldn’t confirm your saved Rocket League profile. Your entries remain in this browser; reload and try again before submitting.", "error");
        return;
    }

    if (form.dataset.profileExists === "true" && form.dataset.findProfileEnabledConfirmed !== "true") {
        showMessage("Your saved Find Players preference is unavailable right now. It has been protected from accidental changes; reload and try again before submitting.", "error");
        return;
    }

    form.classList.add(
        "validation-attempted"
    );

    updateModeField();
    updateDirectContactWarning();
    updateNotificationState();

    const notificationInputs = readRegistrationNotifications();
    if (registrationNotificationsConfirmed && notificationInputs.error) {
        showMessage(notificationInputs.error, "error");
        return;
    }

    const payload = buildRegistrationPayload(form);
    const validationError = validateRegistrationPayload(payload, form);
    if (validationError) {
        showMessage(validationError, "error");
        return;
    }

    if (
        !form.reportValidity()
    ) {
        return;
    }

    const submitButton =
        document.getElementById(
            "registrationSubmit"
        );

    if (
        submitButton
    ) {
        submitButton.disabled =
            true;

        submitButton.textContent =
            "Saving…";
    }

    try {
        const response =
            await apiFetch(
                ROCKET_LEAGUE_PROFILE_URL,
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        const result =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (handleRegistrationAuthFailure(response, result, payload)) return;

        if (
            !response.ok
            || result.success !==
                true
        ) {
            throw new Error(
                result.message
                || "Profile could not be processed."
            );
        }

        if (
            result.profileSaved !==
            true
        ) {
            saveRegistrationDraft(
                payload
            );

            setBackendWarning(
                true,
                result.message
                || "Your registration could not be confirmed as saved."
            );

            showMessage(
                "Your Rocket League profile could not be confirmed as saved.",
                "warning"
            );

            return;
        }

        if (
            result.registrationAccepted !==
                true
            || result.rocketLeagueAccess !==
                true
        ) {
            saveRegistrationDraft(
                payload
            );

            setBackendWarning(
                false
            );

            showMessage(
                result.message
                || "Your profile was saved, but registration requirements are still incomplete.",
                "warning"
            );

            return;
        }

        clearRegistrationDraft();

        setBackendWarning(
            false
        );

        showMessage(
            "Rocket League registration completed. Redirecting…",
            "success"
        );

        try { sessionStorage.setItem("bpdRlRegistrationCompleted", String(Date.now())); } catch { /* Notice only; no access state. */ }
        window.location.replace("/RocketLeague/MyProfile");
    }
    catch (
        error
    ) {
        saveRegistrationDraft(
            payload
        );

        setBackendWarning(
            true,
            "Profile storage is currently unavailable. Your entries have been preserved in this browser."
        );

        showMessage(
            (
                error?.message
                || "Profile could not be saved."
            )
            + " Your form has been preserved locally.",
            "warning"
        );
    }
    finally {
        if (
            submitButton
        ) {
            submitButton.disabled =
                false;

            submitButton.textContent = "Complete Registration";
        }
    }
}

/* =========================================================
INITIALIZE
========================================================= */

export async function initializePage() {
    const form =
        document.getElementById(
            "rlRegistrationForm"
        );

    if (
        !form
    ) {
        console.error(
            "ROCKET LEAGUE REGISTRATION: Form was not found."
        );

        return;
    }

    if (
        form.dataset.initialized ===
            "true"
    ) {
        return;
    }

    form.dataset.initialized =
        "true";

    registrationDraftAccountScope = "";
    registrationDraftGeneration += 1;

    renderAvailabilityRows();

    setInputValue(
        "epicDisplayName",
        "Loading…"
    );

    setInputValue(
        "epicPlatform",
        "Epic Games"
    );

    /*
     * Region detection starts disabled and empty.
     * No location/time-zone lookup occurs during initialization.
     */
    setCheckboxValue(
        "autoDetectRegion",
        false
    );

    clearDetectedRegion();

    /* =====================================================
    REGION DETECTION
    ===================================================== */

    document
        .getElementById(
            "autoDetectRegion"
        )
        ?.addEventListener(
            "change",
            handleRegionDetectionChange
        );

    /* =====================================================
    CONTACT INFORMATION
    ===================================================== */

    document
        .getElementById(
            "email"
        )
        ?.addEventListener(
            "input",
            () => {
                updateDirectContactWarning();
                updateNotificationFieldRequirements();
            }
        );

    document
        .getElementById(
            "phone"
        )
        ?.addEventListener(
            "input",
            () => {
                updateDirectContactWarning();
                updateNotificationFieldRequirements();
            }
        );

    /* =====================================================
    PREFERRED MODE
    ===================================================== */

    document
        .querySelectorAll(
            'input[name="preferredMode"]'
        )
        .forEach(
            input => {
                input.addEventListener(
                    "change",
                    updateModeField
                );
            }
        );

    /* =====================================================
    NOTIFICATIONS
    ===================================================== */

    const notificationRoot = document.getElementById("registrationNotificationChannels");
    notificationRoot?.addEventListener("change", event => {
        if (event.target.matches("[data-notification-enabled]")) {
            updateRegistrationReminderWarning();
            updateNotificationState();
            applyDiscordNotificationState();
        }
    });
    notificationRoot?.addEventListener("input", updateRegistrationReminderWarning);

    /* =====================================================
    MATCHBOT
    ===================================================== */

    document
        .getElementById(
            "installDiscordMatchBotButton"
        )
        ?.addEventListener(
            "click",
            openMatchBotInstall
        );

    document
        .getElementById(
            "recheckDiscordMatchBotButton"
        )
        ?.addEventListener(
            "click",
            () => checkDiscordNotificationEligibility(true)
        );

    form.addEventListener("input", () => { form.dataset.draftDirty = "true"; });
    form.addEventListener("change", () => { form.dataset.draftDirty = "true"; });
    form.addEventListener(
        "submit",
        submitRegistration
    );

    updateModeField();
    updateDirectContactWarning();
    updateNotificationState();

    /* =====================================================
    LOAD PROFILE + DISCORD STATUS
    ===================================================== */

    const [profileOutcome] = await Promise.allSettled([
        loadRocketLeagueProfile(),
        checkDiscordNotificationEligibility()
    ]);

    if (profileOutcome.status === "rejected") throw profileOutcome.reason;
    const profileResult = profileOutcome.value;

    if (
        !profileResult
    ) {
        return;
    }

    form.dataset.profileLookupConfirmed = profileResult.profileLookupConfirmed === true ? "true" : "false";
    form.dataset.profileExists = profileResult.profileExists === true || profileResult.profile?.profileExists === true ? "true" : "false";
    form.dataset.findProfileEnabledConfirmed = profileResult.profile?.settingsAvailability?.findProfileEnabled === true
        && typeof profileResult.profile?.settings?.findProfileEnabled === "boolean" ? "true" : "false";
    const savedNotificationsV2 = profileResult.profile?.settings?.notificationsV2;
    form.dataset.discordPreviouslyEnabled = profileResult.profile?.settingsAvailability?.notificationsV2 === true
        && savedNotificationsV2?.discord?.enabled === true ? "true" : "false";

    const rocketLeagueAccess = profileResult.rocketLeagueAccess === true;
    const path = window.location.pathname.replace(/\/+$/u, "").toLowerCase();
    const isSetupRoute = path === "/rocketleague/profile";

    if (isSetupRoute && profileResult.registrationAccepted === true && rocketLeagueAccess) {
        if (window.BPDRouter?.navigate) {
            await window.BPDRouter.navigate("/RocketLeague/MyProfile", { replace: true });
        } else {
            window.location.replace("/RocketLeague/MyProfile");
        }
        return;
    }

    populateProfileForm(
        profileResult.profile
    );

    if (
        profileResult.profileLoaded ===
            false
    ) {
        setBackendWarning(
            true,
            profileResult.warning
        );


    }
    else {
        setBackendWarning(
            false
        );
    }

    restoreRegistrationDraft(profileResult);

    applyDiscordNotificationState();
    updateDirectContactWarning();
    updateNotificationState();
}
function restoreRegistrationDraft(profileResult) {
    if (profileResult?.registrationAccepted === true && profileResult?.rocketLeagueAccess === true) return false;
    const draft = readRegistrationDraft();
    if (!draft) return false;
    populateDraft(draft);
    const profile = profileResult?.profile || {};
    if (profile.profileExists === true) {
        const settings = profile.settings || {};
        const checkbox = document.getElementById("findProfileEnabled");
        const confirmed = profile.settingsAvailability?.findProfileEnabled === true
            && typeof settings.findProfileEnabled === "boolean";
        checkbox.checked = confirmed && settings.findProfileEnabled === true;
        checkbox.indeterminate = !confirmed;
        checkbox.disabled = !confirmed;
        renderRegistrationNotifications(
            settings.notificationsV2,
            true,
            profile.settingsAvailability?.notificationsV2 === true
        );
    }
    showMessage("Your locally saved registration draft has been restored. Please review it and confirm the required consent fields.", "info");
    return true;
}
