"use strict";
const ROCKET_LEAGUE_PROFILE_URL =
    "/api/rocketleague/profile";
const ROCKET_LEAGUE_PROFILE_UPDATE_URL =
    "/api/rocketleague/profile";
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
function updateContactFields() {
    const method =
        document.querySelector(
            'input[name="contactMethod"]:checked'
        )?.value ||
        "email";
    const emailField =
        document.getElementById(
            "emailField"
        );
    const phoneField =
        document.getElementById(
            "phoneField"
        );
    const email =
        document.getElementById(
            "email"
        );
    const phone =
        document.getElementById(
            "phone"
        );
    const needsEmail =
        method === "email" ||
        method === "both";
    const needsPhone =
        method === "phone" ||
        method === "both";
    if (emailField) {
        emailField.hidden =
            !needsEmail;
    }
    if (phoneField) {
        phoneField.hidden =
            !needsPhone;
    }
    if (email) {
        email.required =
            needsEmail;
    }
    if (phone) {
        phone.required =
            needsPhone;
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
    const timingInputs =
        options.querySelectorAll(
            'input[name="reminderTiming"]'
        );
    options.hidden =
        !enabled;
    timingInputs.forEach(
        (input) => {
            input.required =
                false;
            if (!enabled) {
                input.checked =
                    false;
            }
        }
    );
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
                String(value)
            )}"]`
        );
    if (input) {
        input.checked =
            true;
    }
}
function populateAvailability(
    availability
) {
    if (!Array.isArray(availability)) {
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
function normalizeProfile(
    result
) {
    const profile =
        result?.profile &&
        typeof result.profile ===
        "object"
            ? result.profile
            : {};
    return {
        EpicUniqueId:
            profile.EpicUniqueId ||
            profile.epicUniqueId ||
            result?.user?.EpicUniqueId ||
            null,
        EpicDisplayName:
            profile.EpicDisplayName ||
            profile.epicDisplayName ||
            profile.displayName ||
            result?.user?.EpicDisplayName ||
            result?.user?.displayName ||
            "",
        EpicPreferredUsername:
            profile.EpicPreferredUsername ||
            profile.epicPreferredUsername ||
            result?.user?.EpicPreferredUsername ||
            null,
        displayName:
            profile.displayName ||
            profile.username ||
            profile.EpicDisplayName ||
            profile.epicDisplayName ||
            result?.user?.EpicDisplayName ||
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
            "",
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
function populateProfileForm(
    profile
) {
    setInputValue(
        "epicDisplayName",
        profile.EpicDisplayName ||
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
    const detectedTimezone =
        Intl
            .DateTimeFormat()
            .resolvedOptions()
            .timeZone ||
        "UTC";
    const timezone =
        profile.timezone ||
        detectedTimezone;
    setInputValue(
        "timezone",
        timezone
    );
    const detectedTimezoneElement =
        document.getElementById(
            "detectedTimezone"
        );
    if (detectedTimezoneElement) {
        detectedTimezoneElement.textContent =
            timezone;
    }
    populateAvailability(
        profile.availability
    );
    updateContactFields();
    updateModeField();
    updateReminderOptions();
}
async function loadRocketLeagueProfile() {
    const response =
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
    const result =
        await response
            .json()
            .catch(
                () => ({})
            );
    if (response.status === 401) {
        window.location.replace(
            "/RocketLeague"
        );
        return null;
    }
    if (
        !response.ok ||
        result.success !== true
    ) {
        throw new Error(
            result.message ||
            "Your Rocket League profile could not be loaded."
        );
    }
    return normalizeProfile(
        result
    );
}
async function submitRegistration(
    event
) {
    event.preventDefault();
    hideMessage();
    const form =
        event.currentTarget;
    const availability =
        getAvailability();
    if (!form.reportValidity()) {
        return;
    }
    if (
        availability.length ===
        0
    ) {
        showMessage(
            "Select at least one day when you are available.",
            "error"
        );
        return;
    }
    if (
        availability.some(
            ({ start, end }) =>
                start >= end
        )
    ) {
        showMessage(
            "Each availability end time must be later than its start time.",
            "error"
        );
        return;
    }
    const data =
        new FormData(
            form
        );
    const submitButton =
        document.getElementById(
            "registrationSubmit"
        );
    const payload = {
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
            data.get(
                "timezone"
            ),
        availability,
        matchReminders:
            data.get(
                "matchReminders"
            ) ===
            "on",
        reminderTiming:
            data.get(
                "reminderTiming"
            ) ||
            null
    };
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
            !response.ok ||
            result.success !== true
        ) {
            throw new Error(
                result.message ||
                "Profile could not be saved."
            );
        }
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
        if (submitButton) {
            submitButton.disabled =
                false;
            submitButton.textContent =
                "Save Profile";
        }
    } catch (error) {
        showMessage(
            error?.message ||
            "Profile could not be saved.",
            "error"
        );
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
    const detectedTimezone =
        Intl
            .DateTimeFormat()
            .resolvedOptions()
            .timeZone ||
        "UTC";
    setInputValue(
        "timezone",
        detectedTimezone
    );
    const detectedTimezoneElement =
        document.getElementById(
            "detectedTimezone"
        );
    if (detectedTimezoneElement) {
        detectedTimezoneElement.textContent =
            detectedTimezone;
    }
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
    try {
        const profile =
            await loadRocketLeagueProfile();
        if (!profile) {
            return;
        }
        populateProfileForm(
            profile
        );
    } catch (error) {
        showMessage(
            error?.message ||
            "Your profile could not be loaded.",
            "error"
        );
    }
}