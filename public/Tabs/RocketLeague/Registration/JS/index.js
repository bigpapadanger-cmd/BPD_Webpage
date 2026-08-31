"use strict";

const ROCKET_LEAGUE_PROFILE_URL =
    "/api/auth/rocketleague/profile";

const ROCKET_LEAGUE_PROFILE_UPDATE_URL =
    "/api/auth/rocketleague/profile";

const REGISTRATION_DRAFT_KEY =
    "bpdRocketLeagueRegistrationDraft";

const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

const TIME_OPTIONS = [
    ["17:00", "5:00 PM"],
    ["17:30", "5:30 PM"],
    ["18:00", "6:00 PM"],
    ["18:30", "6:30 PM"],
    ["19:00", "7:00 PM"],
    ["19:30", "7:30 PM"],
    ["20:00", "8:00 PM"],
    ["20:30", "8:30 PM"],
    ["21:00", "9:00 PM"],
    ["21:30", "9:30 PM"],
    ["22:00", "10:00 PM"]
];

let currentLocation = {
    city: "",
    region: "",
    country: "",
    countryCode: "",
    timezone: ""
};

function createTimeOptions(
    selectedValue
) {
    return TIME_OPTIONS
        .map(([value, label]) => `
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
        `)
        .join("");
}

function renderAvailabilityRows() {
    const container =
        document.getElementById(
            "availabilityRows"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        DAYS
            .map((day) => {
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
                                "17:00"
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
                                "22:00"
                            )}
                        </select>
                    </div>
                `;
            })
            .join("");

    container
        .querySelectorAll(
            'input[name="availableDays"]'
        )
        .forEach((checkbox) => {
            checkbox.addEventListener(
                "change",
                () => {
                    updateAvailabilityRow(
                        checkbox
                    );
                }
            );
        });
}

function updateAvailabilityRow(
    checkbox
) {
    const row =
        checkbox.closest(
            ".availability-row"
        );

    if (!row) {
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
        .forEach((select) => {
            select.disabled =
                !checkbox.checked;
        });
}

function renderReminderScheduleRows() {
    const container =
        document.getElementById(
            "reminderScheduleRows"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        DAYS
            .map((day) => {
                const key =
                    day.toLowerCase();

                const slots =
                    TIME_OPTIONS
                        .map(([value, label]) => `
                            <label class="reminder-slot">
                                <input
                                    type="checkbox"
                                    name="reminderSlot"
                                    value="${key}|${value}"
                                >
                                <span>
                                    ${label}
                                </span>
                            </label>
                        `)
                        .join("");

                return `
                    <div
                        class="reminder-day-row"
                        data-reminder-day="${key}"
                    >
                        <strong>
                            ${day}
                        </strong>

                        <div class="reminder-slot-grid">
                            ${slots}
                        </div>
                    </div>
                `;
            })
            .join("");
}

function updateContactFields() {
    const method =
        document.querySelector(
            'input[name="contactMethod"]:checked'
        )?.value ||
        "email";

    const email =
        document.getElementById(
            "email"
        );

    const phone =
        document.getElementById(
            "phone"
        );

    if (email) {
        email.required =
            method === "email" ||
            method === "both";
    }

    if (phone) {
        phone.required =
            method === "phone" ||
            method === "both";
    }
}

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
        field.hidden =
            !isOther;
    }

    if (input) {
        input.required =
            isOther;

        if (!isOther) {
            input.value =
                "";
        }
    }
}

function updateReminderOptions() {
    const checkbox =
        document.getElementById(
            "matchReminders"
        );

    const options =
        document.getElementById(
            "reminderOptions"
        );

    if (
        !checkbox ||
        !options
    ) {
        return;
    }

    const enabled =
        checkbox.checked;

    options.hidden =
        !enabled;

    options
        .querySelectorAll(
            'input[name="reminderTiming"]'
        )
        .forEach((input) => {
            input.required =
                enabled;
        });

    if (!enabled) {
        options
            .querySelectorAll(
                'input[type="radio"], input[type="checkbox"]'
            )
            .forEach((input) => {
                input.checked =
                    false;
            });
    }
}

function getAvailability() {
    return [
        ...document.querySelectorAll(
            ".availability-row.enabled"
        )
    ].map((row) => ({
        day:
            row.dataset.day,

        start:
            row.querySelector(
                'select[name$="Start"]'
            )?.value ||
            "",

        end:
            row.querySelector(
                'select[name$="End"]'
            )?.value ||
            ""
    }));
}

function getReminderSchedule() {
    const grouped =
        new Map();

    document
        .querySelectorAll(
            'input[name="reminderSlot"]:checked'
        )
        .forEach((input) => {
            const [
                day,
                time
            ] =
                String(
                    input.value ||
                    ""
                ).split("|");

            if (
                !day ||
                !time
            ) {
                return;
            }

            if (
                !grouped.has(
                    day
                )
            ) {
                grouped.set(
                    day,
                    []
                );
            }

            grouped
                .get(
                    day
                )
                .push(
                    time
                );
        });

    return [
        ...grouped.entries()
    ].map(([day, times]) => ({
        day,
        times
    }));
}

function showMessage(
    message,
    state
) {
    const element =
        document.getElementById(
            "registrationMessage"
        );

    if (!element) {
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

    if (!element) {
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

    if (!element) {
        return;
    }

    element.hidden =
        !visible;

    if (
        visible &&
        message
    ) {
        const messageElement =
            element.querySelector(
                "span"
            );

        if (messageElement) {
            messageElement.textContent =
                message;
        }
    }
}

function setInputValue(
    id,
    value
) {
    const element =
        document.getElementById(
            id
        );

    if (!element) {
        return;
    }

    element.value =
        value ??
        "";
}

function setSelectValue(
    id,
    value
) {
    const element =
        document.getElementById(
            id
        );

    if (
        !element ||
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return;
    }

    element.value =
        String(
            value
        );
}

function setCheckboxValue(
    id,
    value
) {
    const element =
        document.getElementById(
            id
        );

    if (!element) {
        return;
    }

    element.checked =
        value === true;
}

function setRadioValue(
    name,
    value
) {
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
                String(
                    value
                )
            )}"]`
        );

    if (input) {
        input.checked =
            true;
    }
}

function clearAvailability() {
    document
        .querySelectorAll(
            'input[name="availableDays"]'
        )
        .forEach((checkbox) => {
            checkbox.checked =
                false;

            updateAvailabilityRow(
                checkbox
            );
        });
}

function populateAvailability(
    availability
) {
    clearAvailability();

    if (
        !Array.isArray(
            availability
        )
    ) {
        return;
    }

    availability.forEach(
        (item) => {
            const day =
                String(
                    item?.day ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            if (!day) {
                return;
            }

            const row =
                document.querySelector(
                    `.availability-row[data-day="${CSS.escape(
                        day
                    )}"]`
                );

            if (!row) {
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

            if (checkbox) {
                checkbox.checked =
                    true;

                updateAvailabilityRow(
                    checkbox
                );
            }

            if (
                start &&
                item?.start
            ) {
                start.value =
                    item.start;
            }

            if (
                end &&
                item?.end
            ) {
                end.value =
                    item.end;
            }
        }
    );
}

function populateReminderSchedule(
    schedule
) {
    document
        .querySelectorAll(
            'input[name="reminderSlot"]'
        )
        .forEach((input) => {
            input.checked =
                false;
        });

    if (
        !Array.isArray(
            schedule
        )
    ) {
        return;
    }

    schedule.forEach(
        (item) => {
            const day =
                String(
                    item?.day ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            const times =
                Array.isArray(
                    item?.times
                )
                    ? item.times
                    : [];

            times.forEach(
                (time) => {
                    const input =
                        document.querySelector(
                            `input[name="reminderSlot"][value="${CSS.escape(
                                `${day}|${time}`
                            )}"]`
                        );

                    if (input) {
                        input.checked =
                            true;
                    }
                }
            );
        }
    );
}

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
        typeof result.profile ===
            "object"
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
            profile.showOnlineStatus ===
            true ||
            profile.show_online_status ===
            true,

        matchReminders:
            profile.matchReminders ===
            true ||
            profile.match_reminders ===
            true,

        reminderTiming:
            profile.reminderTiming ||
            profile.reminder_timing ||
            null,

        reminderSchedule:
            Array.isArray(
                profile.reminderSchedule
            )
                ? profile.reminderSchedule
                : Array.isArray(
                    profile.reminder_schedule
                )
                    ? profile.reminder_schedule
                    : [],

        ageConsent:
            profile.ageConsent ===
            true ||
            profile.age_consent ===
            true,

        profileComplete:
            result?.profileComplete ===
            true ||
            profile.profileComplete ===
            true ||
            profile.profile_complete ===
            true
    };
}

function formatLocation(
    location
) {
    const values =
        [
            location?.city,
            location?.region,
            location?.country ||
            location?.countryCode
        ]
            .map(
                (value) =>
                    String(
                        value ||
                        ""
                    ).trim()
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

function applyLocation(
    location
) {
    currentLocation = {
        city:
            location?.city ||
            "",

        region:
            location?.region ||
            "",

        country:
            location?.country ||
            "",

        countryCode:
            location?.countryCode ||
            "",

        timezone:
            location?.timezone ||
            ""
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

function populateProfileForm(
    profile
) {
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

    setCheckboxValue(
        "matchReminders",
        profile.matchReminders
    );

    setCheckboxValue(
        "ageConsent",
        profile.ageConsent
    );

    if (
        profile.reminderTiming
    ) {
        setRadioValue(
            "reminderTiming",
            profile.reminderTiming
        );
    }

    applyLocation(
        profile.location
    );

    applyTimezone(
        profile.timezone
    );

    populateAvailability(
        profile.availability
    );

    populateReminderSchedule(
        profile.reminderSchedule
    );

    updateContactFields();
    updateModeField();
    updateReminderOptions();
}

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
    } catch (
        error
    ) {
        console.warn(
            "Could not read Epic session from BPDAuth:",
            error
        );
    }

    return null;
}

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
            JSON.parse(
                raw
            );

        return (
            parsed &&
            typeof parsed ===
                "object"
        )
            ? parsed
            : null;

    } catch {
        return null;
    }
}

function saveRegistrationDraft(
    payload
) {
    try {
        localStorage.setItem(
            REGISTRATION_DRAFT_KEY,
            JSON.stringify(
                payload
            )
        );
    } catch (
        error
    ) {
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

function populateDraft(
    draft
) {
    if (
        !draft ||
        typeof draft !==
            "object"
    ) {
        return;
    }

    setInputValue(
        "displayName",
        draft.displayName
    );

    setSelectValue(
        "currentRank",
        draft.currentRank
    );

    setRadioValue(
        "contactMethod",
        draft.contactMethod
    );

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

    setCheckboxValue(
        "matchReminders",
        draft.matchReminders
    );

    setCheckboxValue(
        "ageConsent",
        draft.ageConsent
    );

    setRadioValue(
        "reminderTiming",
        draft.reminderTiming
    );

    if (
        draft.location &&
        typeof draft.location ===
            "object"
    ) {
        applyLocation(
            draft.location
        );
    }

    if (
        draft.timezone
    ) {
        applyTimezone(
            draft.timezone
        );
    }

    populateAvailability(
        draft.availability
    );

    populateReminderSchedule(
        draft.reminderSchedule
    );

    updateContactFields();
    updateModeField();
    updateReminderOptions();
}

async function loadRocketLeagueProfile() {
    const authUser =
        await getAuthenticatedEpicUser();

    if (authUser) {
        const authProfile =
            normalizeProfile(
                {
                    user:
                        authUser
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
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

    } catch (
        error
    ) {
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
                (
                    "Your Epic sign-in is active, but the saved profile service "
                    + "could not be reached. You can continue filling out this form."
                )
        };
    }

    const result =
        await response
            .json()
            .catch(
                () => ({})
            );

    if (
        response.status ===
        401
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
        result.success !==
            true
    ) {
        return {
            profile:
                normalized,

            profileLoaded:
                false,

            warning:
                result.message ||
                (
                    "Your Epic sign-in is active, but your saved BPD profile "
                    + "could not be loaded. You can continue filling out this form."
                )
        };
    }

    return {
        profile:
            normalized,

        profileLoaded:
            result.profileLoaded !==
            false,

        warning:
            result.profileLoaded ===
            false
                ? (
                    result.warning ||
                    "Your Epic account loaded, but saved profile data is temporarily unavailable."
                )
                : null
    };
}

function buildRegistrationPayload(
    form
) {
    const data =
        new FormData(
            form
        );

    return {
        ageConsent:
            data.get(
                "ageConsent"
            ) ===
            "on",

        displayName:
            String(
                data.get(
                    "displayName"
                ) ||
                ""
            ).trim(),

        currentRank:
            String(
                data.get(
                    "currentRank"
                ) ||
                ""
            ).trim(),

        showOnlineStatus:
            data.get(
                "showOnlineStatus"
            ) ===
            "on",

        contactMethod:
            data.get(
                "contactMethod"
            ),

        email:
            String(
                data.get(
                    "email"
                ) ||
                ""
            ).trim(),

        phone:
            String(
                data.get(
                    "phone"
                ) ||
                ""
            ).trim(),

        preferredMode:
            data.get(
                "preferredMode"
            ),

        otherMode:
            String(
                data.get(
                    "otherMode"
                ) ||
                ""
            ).trim(),

        timezone:
            String(
                data.get(
                    "timezone"
                ) ||
                ""
            ).trim(),

        location: {
            ...currentLocation
        },

        availability:
            getAvailability(),

        matchReminders:
            data.get(
                "matchReminders"
            ) ===
            "on",

        reminderTiming:
            data.get(
                "reminderTiming"
            ) ||
            null,

        reminderSchedule:
            getReminderSchedule()
    };
}

function validateRegistrationPayload(
    payload
) {
    if (
        !Array.isArray(
            payload.availability
        ) ||
        payload.availability.length ===
            0
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
        payload.matchReminders &&
        !payload.reminderTiming
    ) {
        return (
            "Choose when scheduled-match reminders should be sent."
        );
    }

    if (
        payload.matchReminders &&
        (
            !Array.isArray(
                payload.reminderSchedule
            ) ||
            payload.reminderSchedule.length ===
                0
        )
    ) {
        return (
            "Choose at least one preferred reminder day and time."
        );
    }

    return null;
}

async function submitRegistration(
    event
) {
    event.preventDefault();

    hideMessage();

    const form =
        event.currentTarget;

    updateContactFields();
    updateModeField();
    updateReminderOptions();

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

    if (submitButton) {
        submitButton.disabled =
            true;

        submitButton.textContent =
            "Saving…";
    }

    try {
        const response =
            await fetch(
                ROCKET_LEAGUE_PROFILE_UPDATE_URL,
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
            response.status ===
            401
        ) {
            window.location.replace(
                "/RocketLeague"
            );

            return;
        }

        if (
            !response.ok ||
            result.success !==
                true
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
            result.profileComplete ===
            true
                ? "Profile completed. Redirecting…"
                : "Profile saved.",
            "success"
        );

        if (
            result.profileComplete ===
            true
        ) {
            window.location.replace(
                result.redirectTo ||
                "/RocketLeague"
            );

            return;
        }

    } catch (
        error
    ) {
        saveRegistrationDraft(
            payload
        );

        setBackendWarning(
            true,
            (
                "Your Epic sign-in is still active, but the BPD profile service "
                + "could not save this form yet. Your entries have been preserved "
                + "in this browser so you can retry."
            )
        );

        showMessage(
            (
                error?.message ||
                "Profile could not be saved."
            )
            + " Your form has been preserved locally.",
            "warning"
        );

    } finally {
        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                "Complete Registration";
        }
    }
}

export async function initializeRegistrationPage() {
    const form =
        document.getElementById(
            "rlRegistrationForm"
        );

    if (
        !form ||
        form.dataset.initialized ===
            "true"
    ) {
        return;
    }

    form.dataset.initialized =
        "true";

    renderAvailabilityRows();
    renderReminderScheduleRows();

    applyTimezone(
        ""
    );

    setInputValue(
        "epicPlatform",
        "Epic Games"
    );

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

    const matchReminders =
        document.getElementById(
            "matchReminders"
        );

    if (matchReminders) {
        matchReminders.addEventListener(
            "change",
            updateReminderOptions
        );
    }

    form.addEventListener(
        "submit",
        submitRegistration
    );

    updateContactFields();
    updateModeField();
    updateReminderOptions();

    const profileResult =
        await loadRocketLeagueProfile();

    if (!profileResult) {
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

        const draft =
            readRegistrationDraft();

        if (draft) {
            populateDraft(
                draft
            );

            showMessage(
                (
                    "Saved profile data is unavailable, "
                    + "so your locally saved registration "
                    + "draft has been restored."
                ),
                "warning"
            );
        }

    } else {
        setBackendWarning(
            false
        );
    }
}