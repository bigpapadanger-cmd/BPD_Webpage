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

let registrationDraftAccountId = "";

function getRegistrationDraftKey() {
    return registrationDraftAccountId
        ? `${REGISTRATION_DRAFT_KEY}:${registrationDraftAccountId}`
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

let notificationsOptOutConfirmed =
    false;

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

function getNotificationsEnabled() {
    return (
        document.querySelector(
            'input[name="notificationsEnabled"]:checked'
        )?.value !==
        "false"
    );
}

function getNotificationMethod() {
    return normalizeString(
        document.querySelector(
            'input[name="notificationMethod"]:checked'
        )?.value
    );
}

function openNotificationOptOutModal() {
    const modal =
        document.getElementById(
            "notificationOptOutModal"
        );

    if (
        !modal
    ) {
        return;
    }

    modal.hidden =
        false;

    document.body.classList.add(
        "registration-modal-open"
    );
}

function closeNotificationOptOutModal() {
    const modal =
        document.getElementById(
            "notificationOptOutModal"
        );

    if (
        !modal
    ) {
        return;
    }

    modal.hidden =
        true;

    document.body.classList.remove(
        "registration-modal-open"
    );
}

function setNotificationsEnabled(
    enabled
) {
    const value =
        enabled
            ? "true"
            : "false";

    const input =
        document.querySelector(
            `input[name="notificationsEnabled"][value="${value}"]`
        );

    if (
        input
    ) {
        input.checked =
            true;
    }

    updateNotificationState();
}

function updateNotificationFieldRequirements() {
    const enabled =
        getNotificationsEnabled();

    const method =
        getNotificationMethod();

    const email =
        document.getElementById(
            "email"
        );

    const phone =
        document.getElementById(
            "phone"
        );

    if (
        email
    ) {
        email.required =
            enabled
            && method ===
                "email";
    }

    if (
        phone
    ) {
        phone.required =
            enabled
            && method ===
                "phone";
    }
}

function updateNotificationState() {
    const enabled =
        getNotificationsEnabled();

    const warning =
        document.getElementById(
            "notificationOptOutWarning"
        );

    const deliveryOptions =
        document.getElementById(
            "notificationDeliveryOptions"
        );

    const reminderOptions =
        document.getElementById(
            "reminderOptions"
        );

    if (
        warning
    ) {
        warning.hidden =
            enabled;
    }

    if (
        deliveryOptions
    ) {
        deliveryOptions.classList.toggle(
            "notifications-disabled",
            !enabled
        );

        deliveryOptions
            .querySelectorAll(
                'input[name="notificationMethod"]'
            )
            .forEach(
                input => {
                    if (
                        input.value ===
                        "discord"
                    ) {
                        input.disabled =
                            !enabled
                            || !discordNotificationState
                                .eligible;
                    }
                    else {
                        input.disabled =
                            !enabled;
                    }

                    input.required =
                        enabled;
                }
            );
    }

    if (
        reminderOptions
    ) {
        reminderOptions.classList.toggle(
            "notifications-disabled",
            !enabled
        );

        reminderOptions
            .querySelectorAll(
                "input"
            )
            .forEach(
                input => {
                    input.disabled =
                        !enabled;

                    input.required =
                        enabled
                        && input.name ===
                            "reminderMode";
                }
            );
    }

    updateNotificationFieldRequirements();
    updateDirectContactWarning();
}

function handleNotificationChoiceChange(
    event
) {
    const input =
        event.currentTarget;

    if (
        input.value ===
            "false"
        && input.checked
        && !notificationsOptOutConfirmed
    ) {
        setNotificationsEnabled(
            true
        );

        openNotificationOptOutModal();

        return;
    }

    updateNotificationState();
}

/* =========================================================
DISCORD NOTIFICATION UI
========================================================= */

function resetDiscordNotificationUi() {
    const discordInput =
        document.getElementById(
            "discordNotificationMethod"
        );

    const choice =
        document.getElementById(
            "discordNotificationChoice"
        );

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
        choice
    ) {
        choice.dataset.discordEligible =
            "false";
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

    const discordInput =
        document.getElementById(
            "discordNotificationMethod"
        );

    const choice =
        document.getElementById(
            "discordNotificationChoice"
        );

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
        choice
    ) {
        choice.dataset.discordEligible =
            String(
                state.eligible
            );
    }

    if (
        discordInput
    ) {
        discordInput.disabled =
            !getNotificationsEnabled()
            || !state.eligible;
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
            !state.matchBotAvailable
        ) {
            status.textContent =
                "Your Discord account does not currently share a server with BPD MatchBot.";
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

    if (
        getNotificationMethod() ===
            "discord"
        && !state.eligible
    ) {
        const emailInput =
            document.getElementById(
                "notificationMethodEmail"
            );

        if (
            emailInput
            && !emailInput.disabled
        ) {
            emailInput.checked =
                true;
        }
    }

    updateNotificationState();
}

async function checkDiscordNotificationEligibility() {
    resetDiscordNotificationUi();

    try {
        const response =
            await apiFetch(
                DISCORD_NOTIFICATION_STATUS_URL,
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

        discordNotificationState = {
            checked:
                true,

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

    /*
     * Normal profile loading must use only previously stored
     * profile location data. Top-level request location is
     * reserved for the explicit detectLocation=true request.
     */
    const location =
        normalizeLocation(
            {},
            profile
        );

    return {
        EpicUniqueId:
            profile.EpicUniqueId
            || profile.epicUniqueId
            || profile.epicAccountId
            || user.EpicUniqueId
            || user.epicUniqueId
            || null,

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
                profile.email
            ),

        phone:
            normalizeString(
                profile.phone
            ),

        preferredMode:
            normalizeString(
                profile.preferredMode
                || profile.preferred_mode
            ),

        otherMode:
            normalizeString(
                profile.otherMode
                || profile.other_mode
            ),

        autoDetectRegion:
            profile.autoDetectRegion ===
                true
            || profile.auto_detect_region ===
                true,

        timezone:
            normalizeString(
                profile.timezone
                || profile.displayTimezone
                || profile.display_timezone
                || location.timezone
            ),

        location,

        availability:
            Array.isArray(
                profile.availability
            )
                ? profile.availability
                : [],

        showOnlineStatus:
            profile.showOnlineStatus ===
                true
            || profile.show_online_status ===
                true,

        notificationsEnabled:
            profile.notificationsEnabled !==
                false
            && profile.notifications_enabled !==
                false,

        notificationMethod:
            normalizeString(
                profile.notificationMethod
                || profile.notification_method
            ),

        reminderMode:
            normalizeString(
                profile.reminderMode
                || profile.reminder_mode
                || profile.reminderTiming
                || profile.reminder_timing
            )
            || "24-hours",

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
            || profile.profileComplete ===
                true
            || profile.profile_complete ===
                true
    };
}

/* =========================================================
POPULATE PROFILE
========================================================= */

function populateProfileForm(
    profile
) {
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

    /*
     * Region detection is session-explicit.
     *
     * Even if a previous profile had automatic detection
     * enabled, loading this registration page does not treat
     * that old setting as permission to perform another
     * location lookup.
     *
     * The user must explicitly check the box during the
     * current page session.
     */
    setCheckboxValue(
        "autoDetectRegion",
        false
    );

    clearDetectedRegion();

    setInputValue(
        "email",
        profile.email
    );

    setInputValue(
        "phone",
        profile.phone
    );

    if (
        profile.preferredMode
    ) {
        setRadioValue(
            "preferredMode",
            profile.preferredMode
        );
    }

    setInputValue(
        "otherMode",
        profile.otherMode
    );

    setCheckboxValue(
        "showOnlineStatus",
        profile.showOnlineStatus
    );

    setRadioValue(
        "notificationsEnabled",
        profile.notificationsEnabled
            ? "true"
            : "false"
    );

    notificationsOptOutConfirmed =
        profile.notificationsEnabled ===
        false;

    if (
        profile.notificationMethod
    ) {
        setRadioValue(
            "notificationMethod",
            profile.notificationMethod
        );
    }

    setRadioValue(
        "reminderMode",
        profile.reminderMode
    );

    populateAvailability(
        profile.availability
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

    registrationDraftAccountId = authState?.authenticated === true
        ? normalizeString(authState.userId) : "";

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
        EpicUniqueId:
            epicProvider.accountId
            || null,

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

    let response;

    try {
        response =
            await apiFetch(
                ROCKET_LEAGUE_PROFILE_URL,
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
        showOnlineStatus:
            payload?.showOnlineStatus ===
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

        notificationsEnabled:
            payload?.notificationsEnabled ===
            true,

        notificationMethod:
            normalizeString(
                payload?.notificationMethod
            )
            || null,

        reminderMode:
            normalizeString(
                payload?.reminderMode
            )
            || null
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

    setRadioValue(
        "notificationsEnabled",
        draft.notificationsEnabled
            ? "true"
            : "false"
    );

    notificationsOptOutConfirmed =
        draft.notificationsEnabled ===
        false;

    if (
        draft.notificationMethod
    ) {
        setRadioValue(
            "notificationMethod",
            draft.notificationMethod
        );
    }

    setRadioValue(
        "reminderMode",
        draft.reminderMode
    );

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

    const notificationsEnabled =
        getNotificationsEnabled();

    const autoDetectRegion =
        getAutoDetectRegionEnabled();

    return {
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

        notificationsEnabled,

        notificationMethod:
            notificationsEnabled
                ? getNotificationMethod()
                : null,

        reminderMode:
            notificationsEnabled
                ? (
                    normalizeString(
                        data.get(
                            "reminderMode"
                        )
                    )
                    || "24-hours"
                )
                : null
    };
}

/* =========================================================
VALIDATION
========================================================= */

function validateRegistrationPayload(
    payload
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

    if (
        payload.notificationsEnabled
    ) {
        if (
            !payload.notificationMethod
        ) {
            return (
                "Choose a notification method or opt out of match notifications."
            );
        }

        if (
            payload.notificationMethod ===
                "email"
            && !payload.email
        ) {
            return (
                "Enter an email address to use email notifications, choose another notification method, or opt out."
            );
        }

        if (
            payload.notificationMethod ===
                "phone"
            && !payload.phone
        ) {
            return (
                "Enter a phone number to use phone notifications, choose another notification method, or opt out."
            );
        }

        if (
            payload.notificationMethod ===
                "discord"
            && !discordNotificationState
                .eligible
        ) {
            return (
                "Discord notifications are not available until your linked Discord account shares a server with BPD MatchBot."
            );
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

    form.classList.add(
        "validation-attempted"
    );

    updateModeField();
    updateDirectContactWarning();
    updateNotificationState();

    if (
        !form.reportValidity()
    ) {
        return;
    }

    const payload =
        buildRegistrationPayload(
            form
        );

    const validationError =
        validateRegistrationPayload(
            payload
        );

    if (
        validationError
    ) {
        showMessage(
            validationError,
            "error"
        );

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
            || result.profileComplete !==
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

        window.location.replace(
            result.redirectTo
            || "/RocketLeague"
        );
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

            submitButton.textContent =
                "Complete Registration";
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

    registrationDraftAccountId = "";

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

    document
        .querySelectorAll(
            'input[name="notificationsEnabled"]'
        )
        .forEach(
            input => {
                input.addEventListener(
                    "change",
                    handleNotificationChoiceChange
                );
            }
        );

    document
        .querySelectorAll(
            'input[name="notificationMethod"]'
        )
        .forEach(
            input => {
                input.addEventListener(
                    "change",
                    () => {
                        updateNotificationState();

                        if (
                            input.value ===
                                "discord"
                            && input.checked
                            && !discordNotificationState
                                .eligible
                        ) {
                            applyDiscordNotificationState();
                        }
                    }
                );
            }
        );

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
            checkDiscordNotificationEligibility
        );

    /* =====================================================
    OPT-OUT MODAL
    ===================================================== */

    document
        .querySelectorAll(
            "[data-modal-close]"
        )
        .forEach(
            element => {
                element.addEventListener(
                    "click",
                    () => {
                        notificationsOptOutConfirmed =
                            false;

                        setNotificationsEnabled(
                            true
                        );

                        closeNotificationOptOutModal();
                    }
                );
            }
        );

    document
        .getElementById(
            "keepNotificationsButton"
        )
        ?.addEventListener(
            "click",
            () => {
                notificationsOptOutConfirmed =
                    false;

                setNotificationsEnabled(
                    true
                );

                closeNotificationOptOutModal();
            }
        );

    document
        .getElementById(
            "confirmNotificationsOffButton"
        )
        ?.addEventListener(
            "click",
            () => {
                notificationsOptOutConfirmed =
                    true;

                setNotificationsEnabled(
                    false
                );

                closeNotificationOptOutModal();
            }
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

    const [
        profileResult
    ] =
        await Promise.all([
            loadRocketLeagueProfile(),

            checkDiscordNotificationEligibility()
        ]);

    if (
        !profileResult
    ) {
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
    if (profileResult?.profile?.profileComplete === true) return false;
    const draft = readRegistrationDraft();
    if (!draft) return false;
    populateDraft(draft);
    showMessage("Your locally saved registration draft has been restored. Please review it and confirm the required consent fields.", "info");
    return true;
}
