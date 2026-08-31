"use strict";

const ROCKET_LEAGUE_PROFILE_URL = "/api/auth/rocketleague/profile";
const ROCKET_LEAGUE_PROFILE_UPDATE_URL = "/api/auth/rocketleague/profile";
const REGISTRATION_DRAFT_KEY = "bpdRocketLeagueRegistrationDraft";

const REGISTRATION_CONFIG = {
    copy: {
        eyebrow: "BPD GAMING NETWORK",
        title: "Complete Your Rocket League Profile",
        intro: "Confirm your Epic account details and tell us how and when you prefer to play.",
        backendWarningTitle: "Profile service temporarily unavailable",
        backendWarningBody: "Your Epic sign-in is still active. You can continue filling out this form. If profile storage is unavailable, your entries will be preserved in this browser so you can retry later.",
        epicLegend: "Epic account",
        epicDescription: "These fields come from your authenticated Epic Games session.",
        epicUserLabel: "Epic user",
        platformLabel: "Platform",
        locationLabel: "Approximate location",
        locationHelp: "Estimated from your connection location.",
        timezoneLabel: "Time zone",
        eligibilityLegend: "Eligibility",
        eligibilityText: "I confirm that I am 18 or older, meet the applicable league age in my place of residence, or have permission from my parent or legal guardian.",
        playerProfileLegend: "Player profile",
        displayNameLabel: "Display name",
        displayNameHelp: "This is the name other BPD players will see.",
        rankLabel: "Current rank",
        rankPlaceholder: "Select your current rank",
        rankHelp: "Self-reported during registration. You can update it later.",
        onlineStatusLabel: "Online status",
        onlineStatusText: "Allow other players to see when I am online",
        onlineStatusHelp: "Disabled by default.",
        contactLegend: "Contact information",
        contactDescription: "Enter the contact methods you want available, then choose your preferred method.",
        emailLabel: "Email address",
        phoneLabel: "Phone number",
        contactMethodLabel: "Preferred contact method",
        contactEmail: "Email",
        contactPhone: "Phone",
        contactBoth: "Both",
        modeLegend: "Preferred mode",
        modeLabel: "Choose a preferred mode",
        modeCustoms: "Customs",
        modeOther: "Other",
        otherModeLabel: "Describe your preferred mode",
        availabilityLegend: "Weekly availability",
        availabilityDescription: "Select at least one day and a normal play window. Times are available in 30-minute increments from 5:00 PM through 11:00 PM in your local time zone.",
        notificationsLegend: "Match notifications & reminders",
        notificationsLabel: "Match notifications",
        notificationsOn: "Opt in",
        notificationsOff: "Opt out",
        notificationOptOutTitle: "Notifications are disabled",
        notificationOptOutBody: "WARNING: By opting out of match notifications, you are still responsible for joined matches and may be removed from joined matches after missing too many scheduled matches.",
        reminderModeLabel: "Reminder preference",
        reminder24: "24 hours before",
        reminder1: "1 hour before",
        reminderBoth: "Both",
        reminderSpecific: "Specific times",
        specificTimesTitle: "Specific reminder times",
        specificTimesBody: "Select one or more times from the 24-hour clock. Times are available every 30 minutes.",
        reminderNoteTitle: "Scheduling note",
        reminderNoteBody: "Automatic reminders normally run the day before a scheduled match. For Monday matches, the reminder may run earlier to account for weekend scheduling.",
        moreSettingsTitle: "More settings are available after registration.",
        moreSettingsBody: "Once your profile is created, open your Player Profile to configure additional matchmaking, privacy, contact, notification, reminder, and profile options.",
        submitButton: "Complete Registration",
        requiredFooter: "* Required information must be completed before registration can finish.",
        notificationModalTitle: "Turn off match notifications?",
        notificationModalBody: "WARNING: If you opt out, you remain responsible for joined matches. Missing too many scheduled matches may result in removal from joined matches.",
        keepNotificationsButton: "Keep notifications on",
        confirmNotificationsOffButton: "Turn notifications off"
    },
    availability: {
        start: "14:30",
        end: "23:00",
        incrementMinutes: 30
    },
    reminderTimes: {
        start: "00:00",
        end: "23:30",
        incrementMinutes: 30
    }
};

const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

let currentLocation = {
    city: "",
    region: "",
    country: "",
    countryCode: "",
    timezone: ""
};

let notificationsOptOutConfirmed = false;

// ============================================================
// DYNAMIC COPY
// ============================================================

function applyDynamicCopy() {
    document.querySelectorAll("[data-copy]").forEach((element) => {
        const key = element.dataset.copy;
        if (
            key &&
            Object.prototype.hasOwnProperty.call(
                REGISTRATION_CONFIG.copy,
                key
            )
        ) {
            element.textContent = REGISTRATION_CONFIG.copy[key];
        }
    });

    document.querySelectorAll("[data-copy-option]").forEach((element) => {
        const key = element.dataset.copyOption;
        if (
            key &&
            Object.prototype.hasOwnProperty.call(
                REGISTRATION_CONFIG.copy,
                key
            )
        ) {
            element.textContent = REGISTRATION_CONFIG.copy[key];
        }
    });
}

// ============================================================
// TIME HELPERS
// ============================================================

function timeToMinutes(value) {
    const [hours, minutes] = String(value).split(":").map(Number);
    return (hours * 60) + minutes;
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0")
    );
}

function formatTimeLabel(value) {
    const [hourValue, minuteValue] = String(value).split(":").map(Number);

    const suffix = hourValue >= 12
        ? "PM"
        : "AM";

    const displayHour = hourValue % 12 === 0
        ? 12
        : hourValue % 12;

    return (
        `${displayHour}:` +
        String(minuteValue).padStart(2, "0") +
        ` ${suffix}`
    );
}

function buildTimeOptions(start, end, incrementMinutes) {
    const options = [];
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);

    for (
        let minute = startMinutes;
        minute <= endMinutes;
        minute += incrementMinutes
    ) {
        const value = minutesToTime(minute);

        options.push([
            value,
            formatTimeLabel(value)
        ]);
    }

    return options;
}

function getAvailabilityTimeOptions() {
    return buildTimeOptions(
        REGISTRATION_CONFIG.availability.start,
        REGISTRATION_CONFIG.availability.end,
        REGISTRATION_CONFIG.availability.incrementMinutes
    );
}

function getReminderTimeOptions() {
    return buildTimeOptions(
        REGISTRATION_CONFIG.reminderTimes.start,
        REGISTRATION_CONFIG.reminderTimes.end,
        REGISTRATION_CONFIG.reminderTimes.incrementMinutes
    );
}

function createTimeOptions(options, selectedValue) {
    return options
        .map(([value, label]) => `
            <option
                value="${value}"
                ${value === selectedValue ? "selected" : ""}
            >
                ${label}
            </option>
        `)
        .join("");
}

// ============================================================
// AVAILABILITY
// ============================================================

function renderAvailabilityRows() {
    const container = document.getElementById("availabilityRows");

    if (!container) {
        return;
    }

    const timeOptions = getAvailabilityTimeOptions();
    const defaultStart = REGISTRATION_CONFIG.availability.start;
    const defaultEnd = REGISTRATION_CONFIG.availability.end;

    container.innerHTML = DAYS.map((day) => {
        const key = day.toLowerCase();

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
    }).join("");

    container
        .querySelectorAll('input[name="availableDays"]')
        .forEach((checkbox) => {
            checkbox.addEventListener(
                "change",
                () => updateAvailabilityRow(checkbox)
            );
        });
}

function updateAvailabilityRow(checkbox) {
    const row = checkbox.closest(".availability-row");

    if (!row) {
        return;
    }

    row.classList.toggle(
        "enabled",
        checkbox.checked
    );

    row.querySelectorAll("select").forEach((select) => {
        select.disabled = !checkbox.checked;
    });
}

function getAvailability() {
    return [
        ...document.querySelectorAll(
            ".availability-row.enabled"
        )
    ].map((row) => ({
        day: row.dataset.day,
        start:
            row.querySelector(
                'select[name$="Start"]'
            )?.value || "",
        end:
            row.querySelector(
                'select[name$="End"]'
            )?.value || ""
    }));
}

function populateAvailability(availability) {
    document
        .querySelectorAll(
            'input[name="availableDays"]'
        )
        .forEach((checkbox) => {
            checkbox.checked = false;
            updateAvailabilityRow(checkbox);
        });

    if (!Array.isArray(availability)) {
        return;
    }

    availability.forEach((item) => {
        const day = String(
            item?.day || ""
        )
            .trim()
            .toLowerCase();

        if (!day) {
            return;
        }

        const row = document.querySelector(
            `.availability-row[data-day="${CSS.escape(day)}"]`
        );

        if (!row) {
            return;
        }

        const checkbox = row.querySelector(
            'input[name="availableDays"]'
        );

        const start = row.querySelector(
            'select[name$="Start"]'
        );

        const end = row.querySelector(
            'select[name$="End"]'
        );

        if (checkbox) {
            checkbox.checked = true;
            updateAvailabilityRow(checkbox);
        }

        if (
            start &&
            item?.start
        ) {
            start.value = item.start;
        }

        if (
            end &&
            item?.end
        ) {
            end.value = item.end;
        }
    });
}

// ============================================================
// CONTACT METHOD
// ============================================================

function updateContactFields() {
    const method =
        document.querySelector(
            'input[name="contactMethod"]:checked'
        )?.value || "email";

    const email = document.getElementById("email");
    const phone = document.getElementById("phone");

    const emailMark =
        document.getElementById(
            "emailRequiredMark"
        );

    const phoneMark =
        document.getElementById(
            "phoneRequiredMark"
        );

    const emailRequired =
        method === "email" ||
        method === "both";

    const phoneRequired =
        method === "phone" ||
        method === "both";

    if (email) {
        email.required = emailRequired;
    }

    if (phone) {
        phone.required = phoneRequired;
    }

    if (emailMark) {
        emailMark.hidden = !emailRequired;
    }

    if (phoneMark) {
        phoneMark.hidden = !phoneRequired;
    }

    document
        .querySelectorAll(
            ".contact-method-row .choice-card"
        )
        .forEach((card) => {
            card.classList.remove(
                "related-selected"
            );
        });

    if (method === "both") {
        document
            .querySelectorAll(
                ".contact-method-row .choice-card"
            )
            .forEach((card) => {
                card.classList.add(
                    "related-selected"
                );
            });
    }
}

// ============================================================
// MODE
// ============================================================

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
        mode === "other";

    if (field) {
        field.hidden = !isOther;
    }

    if (input) {
        input.required = isOther;

        if (!isOther) {
            input.value = "";
        }
    }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function getNotificationsEnabled() {
    return (
        document.querySelector(
            'input[name="notificationsEnabled"]:checked'
        )?.value !== "false"
    );
}

function openNotificationOptOutModal() {
    const modal =
        document.getElementById(
            "notificationOptOutModal"
        );

    if (!modal) {
        return;
    }

    modal.hidden = false;

    document.body.classList.add(
        "registration-modal-open"
    );
}

function closeNotificationOptOutModal() {
    const modal =
        document.getElementById(
            "notificationOptOutModal"
        );

    if (!modal) {
        return;
    }

    modal.hidden = true;

    document.body.classList.remove(
        "registration-modal-open"
    );
}

function setNotificationsEnabled(enabled) {
    const value = enabled
        ? "true"
        : "false";

    const input = document.querySelector(
        `input[name="notificationsEnabled"][value="${value}"]`
    );

    if (input) {
        input.checked = true;
    }

    updateNotificationState();
}

function updateNotificationState() {
    const enabled =
        getNotificationsEnabled();

    const warning =
        document.getElementById(
            "notificationOptOutWarning"
        );

    const reminderOptions =
        document.getElementById(
            "reminderOptions"
        );

    if (warning) {
        warning.hidden = enabled;
    }

    if (reminderOptions) {
        reminderOptions.classList.toggle(
            "notifications-disabled",
            !enabled
        );

        reminderOptions
            .querySelectorAll("input")
            .forEach((input) => {
                input.disabled = !enabled;
            });
    }
}

function handleNotificationChoiceChange(event) {
    const input =
        event.currentTarget;

    if (
        input.value === "false" &&
        input.checked &&
        !notificationsOptOutConfirmed
    ) {
        setNotificationsEnabled(true);
        openNotificationOptOutModal();
        return;
    }

    updateNotificationState();
}

// ============================================================
// REMINDERS
// ============================================================

function renderReminderTimeSlots() {
    const container =
        document.getElementById(
            "reminderTimeSlots"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        getReminderTimeOptions()
            .map(([value, label]) => `
                <label class="reminder-slot">
                    <input
                        type="checkbox"
                        name="specificReminderTime"
                        value="${value}"
                    >
                    <span>
                        ${label}
                    </span>
                </label>
            `)
            .join("");
}

function updateReminderMode() {
    const mode =
        document.querySelector(
            'input[name="reminderMode"]:checked'
        )?.value || "24-hours";

    const specificTimes =
        document.getElementById(
            "specificReminderTimes"
        );

    if (specificTimes) {
        specificTimes.hidden =
            mode !== "specific-times";
    }
}

function getSpecificReminderTimes() {
    return [
        ...document.querySelectorAll(
            'input[name="specificReminderTime"]:checked'
        )
    ].map((input) => input.value);
}

function populateSpecificReminderTimes(times) {
    document
        .querySelectorAll(
            'input[name="specificReminderTime"]'
        )
        .forEach((input) => {
            input.checked =
                Array.isArray(times) &&
                times.includes(input.value);
        });
}

// ============================================================
// UI HELPERS
// ============================================================

function showMessage(message, state) {
    const element =
        document.getElementById(
            "registrationMessage"
        );

    if (!element) {
        return;
    }

    element.textContent = message;
    element.dataset.state = state;
    element.hidden = false;

    element.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

function hideMessage() {
    const element =
        document.getElementById(
            "registrationMessage"
        );

    if (!element) {
        return;
    }

    element.hidden = true;
    element.textContent = "";
    element.dataset.state = "";
}

function setBackendWarning(
    visible,
    message = ""
) {
    const element =
        document.getElementById(
            "registrationBackendWarning"
        );

    if (!element) {
        return;
    }

    element.hidden = !visible;

    if (
        visible &&
        message
    ) {
        const messageElement =
            element.querySelector("span");

        if (messageElement) {
            messageElement.textContent =
                message;
        }
    }
}

function setInputValue(id, value) {
    const element =
        document.getElementById(id);

    if (element) {
        element.value = value ?? "";
    }
}

function setSelectValue(id, value) {
    const element =
        document.getElementById(id);

    if (
        !element ||
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return;
    }

    element.value = String(value);
}

function setCheckboxValue(id, value) {
    const element =
        document.getElementById(id);

    if (element) {
        element.checked =
            value === true;
    }
}

function setRadioValue(name, value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return;
    }

    const input =
        document.querySelector(
            `input[name="${name}"][value="${CSS.escape(
                String(value)
            )}"]`
        );

    if (input) {
        input.checked = true;
    }
}

// ============================================================
// LOCATION + PROFILE NORMALIZATION
// ============================================================

function normalizeLocation(
    result,
    profile
) {
    const source =
        result?.location ||
        result?.geo ||
        profile?.location ||
        {};

    return {
        city:
            source.city ||
            result?.city ||
            "",

        region:
            source.region ||
            source.regionName ||
            result?.region ||
            "",

        country:
            source.country ||
            source.countryName ||
            result?.country ||
            "",

        countryCode:
            source.countryCode ||
            source.country_code ||
            result?.countryCode ||
            "",

        timezone:
            source.timezone ||
            result?.timezone ||
            ""
    };
}

function normalizeProfile(
    result,
    authUser = null
) {
    const profile =
        result?.profile &&
        typeof result.profile === "object"
            ? result.profile
            : {};

    const user =
        result?.user ||
        authUser ||
        {};

    const location =
        normalizeLocation(
            result,
            profile
        );

    return {
        EpicUniqueId:
            profile.EpicUniqueId ||
            profile.epicUniqueId ||
            user.EpicUniqueId ||
            user.epicUniqueId ||
            null,

        EpicDisplayName:
            profile.EpicDisplayName ||
            profile.epicDisplayName ||
            user.EpicDisplayName ||
            user.epicDisplayName ||
            user.displayName ||
            "",

        EpicPreferredUsername:
            profile.EpicPreferredUsername ||
            profile.epicPreferredUsername ||
            user.EpicPreferredUsername ||
            user.epicPreferredUsername ||
            null,

        displayName:
            profile.displayName ||
            profile.username ||
            profile.EpicDisplayName ||
            profile.epicDisplayName ||
            user.EpicDisplayName ||
            user.displayName ||
            "",

        currentRank:
            profile.currentRank ||
            profile.current_rank ||
            profile.rank ||
            "",

        contactMethod:
            profile.contactMethod ||
            profile.contact_method ||
            "email",

        email:
            profile.email ||
            "",

        phone:
            profile.phone ||
            "",

        preferredMode:
            profile.preferredMode ||
            profile.preferred_mode ||
            "",

        otherMode:
            profile.otherMode ||
            profile.other_mode ||
            "",

        timezone:
            profile.timezone ||
            location.timezone ||
            "",

        location,

        availability:
            Array.isArray(
                profile.availability
            )
                ? profile.availability
                : [],

        showOnlineStatus:
            profile.showOnlineStatus === true ||
            profile.show_online_status === true,

        notificationsEnabled:
            profile.notificationsEnabled !== false &&
            profile.notifications_enabled !== false,

        reminderMode:
            profile.reminderMode ||
            profile.reminder_mode ||
            profile.reminderTiming ||
            profile.reminder_timing ||
            "24-hours",

        specificReminderTimes:
            Array.isArray(
                profile.specificReminderTimes
            )
                ? profile.specificReminderTimes
                : Array.isArray(
                    profile.specific_reminder_times
                )
                    ? profile.specific_reminder_times
                    : [],

        ageConsent:
            profile.ageConsent === true ||
            profile.age_consent === true,

        profileComplete:
            result?.profileComplete === true ||
            profile.profileComplete === true ||
            profile.profile_complete === true
    };
}

function formatLocation(location) {
    const values = [
        location?.city,
        location?.region,
        location?.country ||
        location?.countryCode
    ]
        .map((value) =>
            String(
                value || ""
            ).trim()
        )
        .filter(Boolean);

    return values.length > 0
        ? values.join(", ")
        : "Location unavailable";
}

function applyLocation(location) {
    currentLocation = {
        city:
            location?.city || "",
        region:
            location?.region || "",
        country:
            location?.country || "",
        countryCode:
            location?.countryCode || "",
        timezone:
            location?.timezone || ""
    };

    setInputValue(
        "detectedLocation",
        formatLocation(
            currentLocation
        )
    );
}

function applyTimezone(timezone) {
    const browserTimezone =
        Intl
            .DateTimeFormat()
            .resolvedOptions()
            .timeZone ||
        "UTC";

    const resolvedTimezone =
        timezone ||
        currentLocation.timezone ||
        browserTimezone;

    setInputValue(
        "timezone",
        resolvedTimezone
    );

    setInputValue(
        "timezoneDisplay",
        resolvedTimezone
    );
}

function populateProfileForm(profile) {
    setInputValue(
        "epicDisplayName",
        profile.EpicDisplayName ||
        profile.EpicPreferredUsername ||
        "Epic Player"
    );

    setInputValue(
        "epicPlatform",
        "Epic Games"
    );

    setInputValue(
        "displayName",
        profile.displayName ||
        profile.EpicDisplayName ||
        profile.EpicPreferredUsername ||
        ""
    );

    setSelectValue(
        "currentRank",
        profile.currentRank
    );

    setRadioValue(
        "contactMethod",
        profile.contactMethod
    );

    setInputValue(
        "email",
        profile.email
    );

    setInputValue(
        "phone",
        profile.phone
    );

    if (profile.preferredMode) {
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
        profile.notificationsEnabled === false;

    setRadioValue(
        "reminderMode",
        profile.reminderMode
    );

    setCheckboxValue(
        "ageConsent",
        profile.ageConsent
    );

    applyLocation(
        profile.location
    );

    applyTimezone(
        profile.timezone
    );

    populateAvailability(
        profile.availability
    );

    populateSpecificReminderTimes(
        profile.specificReminderTimes
    );

    updateContactFields();
    updateModeField();
    updateNotificationState();
    updateReminderMode();
}

// ============================================================
// AUTH + PROFILE LOAD
// ============================================================

async function getAuthenticatedEpicUser() {
    try {
        if (
            window.BPDAuth &&
            typeof window.BPDAuth.getSession ===
                "function"
        ) {
            const session =
                await window.BPDAuth.getSession();

            return (
                session?.sessionData ||
                session?.user ||
                session ||
                null
            );
        }
    } catch (error) {
        console.warn(
            "Could not read Epic session from BPDAuth:",
            error
        );
    }

    return null;
}

async function loadRocketLeagueProfile() {
    const authUser =
        await getAuthenticatedEpicUser();

    if (authUser) {
        const authProfile =
            normalizeProfile(
                {
                    user: authUser
                },
                authUser
            );

        setInputValue(
            "epicDisplayName",
            authProfile.EpicDisplayName ||
            authProfile.EpicPreferredUsername ||
            "Epic Player"
        );

        const displayNameElement =
            document.getElementById(
                "displayName"
            );

        if (
            displayNameElement &&
            !displayNameElement.value
        ) {
            setInputValue(
                "displayName",
                authProfile.EpicDisplayName ||
                authProfile.EpicPreferredUsername ||
                ""
            );
        }
    }

    let response;

    try {
        response =
            await fetch(
                ROCKET_LEAGUE_PROFILE_URL,
                {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

    } catch {
        return {
            profile:
                normalizeProfile(
                    {
                        user: authUser
                    },
                    authUser
                ),

            profileLoaded:
                false,

            warning:
                REGISTRATION_CONFIG
                    .copy
                    .backendWarningBody
        };
    }

    const result =
        await response
            .json()
            .catch(
                () => ({})
            );

    if (
        response.status === 401
    ) {
        window.location.replace(
            "/RocketLeague"
        );

        return null;
    }

    const normalized =
        normalizeProfile(
            result,
            authUser
        );

    if (
        !response.ok ||
        result.success !== true
    ) {
        return {
            profile:
                normalized,

            profileLoaded:
                false,

            warning:
                result.message ||
                REGISTRATION_CONFIG
                    .copy
                    .backendWarningBody
        };
    }

    return {
        profile:
            normalized,

        profileLoaded:
            result.profileLoaded !== false,

        warning:
            result.warning || null
    };
}

// ============================================================
// LOCAL DRAFT
// ============================================================

function readRegistrationDraft() {
    try {
        const raw =
            localStorage.getItem(
                REGISTRATION_DRAFT_KEY
            );

        if (!raw) {
            return null;
        }

        const parsed =
            JSON.parse(raw);

        return (
            parsed &&
            typeof parsed === "object"
        )
            ? parsed
            : null;

    } catch {
        return null;
    }
}

function saveRegistrationDraft(payload) {
    try {
        localStorage.setItem(
            REGISTRATION_DRAFT_KEY,
            JSON.stringify(payload)
        );

    } catch (error) {
        console.warn(
            "Could not save registration draft:",
            error
        );
    }
}

function clearRegistrationDraft() {
    try {
        localStorage.removeItem(
            REGISTRATION_DRAFT_KEY
        );
    } catch {
        // No action required.
    }
}

// ============================================================
// PAYLOAD
// ============================================================

function buildRegistrationPayload(form) {
    const data =
        new FormData(form);

    return {
        ageConsent:
            data.get(
                "ageConsent"
            ) === "on",

        displayName:
            String(
                data.get(
                    "displayName"
                ) || ""
            ).trim(),

        currentRank:
            String(
                data.get(
                    "currentRank"
                ) || ""
            ).trim(),

        showOnlineStatus:
            data.get(
                "showOnlineStatus"
            ) === "on",

        contactMethod:
            data.get(
                "contactMethod"
            ),

        email:
            String(
                data.get(
                    "email"
                ) || ""
            ).trim(),

        phone:
            String(
                data.get(
                    "phone"
                ) || ""
            ).trim(),

        preferredMode:
            data.get(
                "preferredMode"
            ),

        otherMode:
            String(
                data.get(
                    "otherMode"
                ) || ""
            ).trim(),

        timezone:
            String(
                data.get(
                    "timezone"
                ) || ""
            ).trim(),

        location: {
            ...currentLocation
        },

        availability:
            getAvailability(),

        notificationsEnabled:
            getNotificationsEnabled(),

        reminderMode:
            data.get(
                "reminderMode"
            ) || "24-hours",

        specificReminderTimes:
            getSpecificReminderTimes()
    };
}

function validateRegistrationPayload(payload) {
    if (
        !Array.isArray(
            payload.availability
        ) ||
        payload.availability.length === 0
    ) {
        return (
            "Select at least one day when you are available."
        );
    }

    if (
        payload.availability.some(
            ({ start, end }) =>
                start >= end
        )
    ) {
        return (
            "Each availability end time must be later than its start time."
        );
    }

    if (
        payload.notificationsEnabled &&
        payload.reminderMode ===
            "specific-times" &&
        (
            !Array.isArray(
                payload.specificReminderTimes
            ) ||
            payload.specificReminderTimes.length === 0
        )
    ) {
        return (
            "Select at least one specific reminder time."
        );
    }

    return null;
}

// ============================================================
// SUBMIT
// ============================================================

async function submitRegistration(event) {
    event.preventDefault();

    hideMessage();

    const form =
        event.currentTarget;

    updateContactFields();
    updateModeField();
    updateNotificationState();
    updateReminderMode();

    if (!form.reportValidity()) {
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

    if (validationError) {
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

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            "Saving…";
    }

    try {
        const response =
            await fetch(
                ROCKET_LEAGUE_PROFILE_UPDATE_URL,
                {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "accept":
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

        if (
            response.status === 401
        ) {
            window.location.replace(
                "/RocketLeague"
            );

            return;
        }

        if (
            !response.ok ||
            result.success !== true
        ) {
            throw new Error(
                result.message ||
                "Profile could not be saved."
            );
        }

        clearRegistrationDraft();

        setBackendWarning(
            false
        );

        showMessage(
            result.profileComplete === true
                ? "Profile completed. Redirecting…"
                : "Profile saved.",
            "success"
        );

        if (
            result.profileComplete === true
        ) {
            window.location.replace(
                result.redirectTo ||
                "/RocketLeague"
            );

            return;
        }

    } catch (error) {
        saveRegistrationDraft(
            payload
        );

        setBackendWarning(
            true,
            REGISTRATION_CONFIG
                .copy
                .backendWarningBody
        );

        showMessage(
            (
                error?.message ||
                "Profile could not be saved."
            ) +
            " Your form has been preserved locally.",
            "warning"
        );

    } finally {
        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                REGISTRATION_CONFIG
                    .copy
                    .submitButton;
        }
    }
}

// ============================================================
// INITIALIZE
// ============================================================

export async function initializePage() {
    const form =
        document.getElementById(
            "rlRegistrationForm"
        );

    if (
        !form ||
        form.dataset.initialized === "true"
    ) {
        return;
    }

    form.dataset.initialized = "true";

    applyDynamicCopy();
    renderAvailabilityRows();
    renderReminderTimeSlots();

    setInputValue(
        "epicDisplayName",
        "Loading…"
    );

    setInputValue(
        "epicPlatform",
        "Epic Games"
    );

    setInputValue(
        "detectedLocation",
        "Detecting…"
    );

    applyTimezone("");

    document
        .querySelectorAll(
            'input[name="contactMethod"]'
        )
        .forEach((input) => {
            input.addEventListener(
                "change",
                updateContactFields
            );
        });

    document
        .querySelectorAll(
            'input[name="preferredMode"]'
        )
        .forEach((input) => {
            input.addEventListener(
                "change",
                updateModeField
            );
        });

    document
        .querySelectorAll(
            'input[name="notificationsEnabled"]'
        )
        .forEach((input) => {
            input.addEventListener(
                "change",
                handleNotificationChoiceChange
            );
        });

    document
        .querySelectorAll(
            'input[name="reminderMode"]'
        )
        .forEach((input) => {
            input.addEventListener(
                "change",
                updateReminderMode
            );
        });

    document
        .querySelectorAll(
            "[data-modal-close]"
        )
        .forEach((element) => {
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
        });

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

    form.addEventListener(
        "submit",
        submitRegistration
    );

    updateContactFields();
    updateModeField();
    updateNotificationState();
    updateReminderMode();

    const profileResult =
        await loadRocketLeagueProfile();

    if (!profileResult) {
        return;
    }

    populateProfileForm(
        profileResult.profile
    );

    if (
        profileResult.profileLoaded === false
    ) {
        setBackendWarning(
            true,
            profileResult.warning
        );

        const draft =
            readRegistrationDraft();

        if (draft) {
            populateProfileForm(
                normalizeProfile({
                    profile:
                        draft
                })
            );

            showMessage(
                "Saved profile data is unavailable, so your locally saved registration draft has been restored.",
                "warning"
            );
        }

    } else {
        setBackendWarning(
            false
        );
    }
}