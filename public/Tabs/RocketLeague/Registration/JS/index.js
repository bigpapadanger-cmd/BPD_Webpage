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
                    const row =
                        checkbox.closest(
                            ".availability-row"
                        );

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
            );
        });
}

function updateContactFields() {
    const method =
        document.querySelector(
            'input[name="contactMethod"]:checked'
        )?.value || "email";

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

    emailField.hidden =
        !needsEmail;

    phoneField.hidden =
        !needsPhone;

    email.required =
        needsEmail;

    phone.required =
        needsPhone;
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

    field.hidden =
        !isOther;

    input.required =
        isOther;

    if (!isOther) {
        input.value = "";
    }
}

function updateReminderOptions() {
    const enabled =
        document.getElementById(
            "matchReminders"
        ).checked;

    const options =
        document.getElementById(
            "reminderOptions"
        );

    const timingInputs =
        options.querySelectorAll(
            'input[name="reminderTiming"]'
        );

    options.hidden =
        !enabled;

    timingInputs.forEach(
        (input, index) => {
            input.required =
                enabled &&
                index === 0;

            if (!enabled) {
                input.checked = false;
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
            ).value,

        end:
            row.querySelector(
                'select[name$="End"]'
            ).value
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

    element.textContent =
        message;

    element.dataset.state =
        state;

    element.hidden =
        false;

    element.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

async function loadEpicProfile() {
    const response =
        await fetch(
            "/api/auth/session",
            {
                credentials:
                    "same-origin",
                cache:
                    "no-store"
            }
        );

    if (!response.ok) {
        throw new Error(
            "Your Epic login session could not be loaded."
        );
    }

    const result =
        await response.json();

    const profile =
        result.session ||
        result.user ||
        result;

    document.getElementById(
        "epicDisplayName"
    ).value =
        profile.displayName ||
        profile.epicDisplayName ||
        "Epic Player";

    document.getElementById(
        "epicPlatform"
    ).value =
        profile.platform ||
        "Epic Games";

    document.getElementById(
        "displayName"
    ).value =
        profile.displayName ||
        profile.epicDisplayName ||
        "";
}

async function submitRegistration(
    event
) {
    event.preventDefault();

    const form =
        event.currentTarget;

    const availability =
        getAvailability();

    if (!form.reportValidity()) {
        return;
    }

    if (availability.length === 0) {
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
        new FormData(form);

    const submitButton =
        document.getElementById(
            "registrationSubmit"
        );

    const payload = {
        ageConsent:
            data.get("ageConsent") ===
            "on",

        displayName:
            String(
                data.get("displayName") ||
                ""
            ).trim(),

        showOnlineStatus:
            data.get("showOnlineStatus") ===
            "on",

        contactMethod:
            data.get("contactMethod"),

        email:
            String(
                data.get("email") ||
                ""
            ).trim(),

        phone:
            String(
                data.get("phone") ||
                ""
            ).trim(),

        preferredMode:
            data.get("preferredMode"),

        otherMode:
            String(
                data.get("otherMode") ||
                ""
            ).trim(),

        timezone:
            data.get("timezone"),

        availability,

        matchReminders:
            data.get("matchReminders") ===
            "on",

        reminderTiming:
            data.get(
                "reminderTiming"
            ) || null
    };

    submitButton.disabled =
        true;

    submitButton.textContent =
        "Saving…";

    try {
        const response =
            await fetch(
                "/api/auth/register",
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    headers: {
                        "Content-Type":
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
                .catch(() => ({}));

        if (
            !response.ok ||
            result.success === false
        ) {
            throw new Error(
                result.message ||
                "Registration could not be completed."
            );
        }

        showMessage(
            "Registration completed. Redirecting…",
            "success"
        );

        window.location.replace(
            result.redirectTo ||
            "/RocketLeague"
        );
    } catch (error) {
        showMessage(
            error.message ||
            "Registration could not be completed.",
            "error"
        );

        submitButton.disabled =
            false;

        submitButton.textContent =
            "Complete Registration";
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

    const timezone =
        Intl
            .DateTimeFormat()
            .resolvedOptions()
            .timeZone ||
        "UTC";

    document.getElementById(
        "timezone"
    ).value =
        timezone;

    document.getElementById(
        "detectedTimezone"
    ).textContent =
        timezone;

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
        .getElementById(
            "matchReminders"
        )
        .addEventListener(
            "change",
            updateReminderOptions
        );

    form.addEventListener(
        "submit",
        submitRegistration
    );

    updateContactFields();
    updateModeField();
    updateReminderOptions();

    try {
        await loadEpicProfile();
    } catch (error) {
        showMessage(
            error.message,
            "error"
        );
    }
}