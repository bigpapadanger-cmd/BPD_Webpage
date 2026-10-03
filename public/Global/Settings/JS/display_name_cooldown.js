"use strict";

function parseAvailableAt(value) {
    if (value === null || value === undefined || value === "") return null;
    const timestamp = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatCooldownRemaining(availableAt, now = Date.now()) {
    const unlockAt = parseAvailableAt(availableAt);
    if (unlockAt === null || unlockAt <= now) return null;
    const remainingMs = unlockAt - now;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (remainingMs >= 2 * day) return `${Math.ceil(remainingMs / day)} days remaining`;
    if (remainingMs >= day) return "1 day remaining";
    if (remainingMs >= 2 * hour) return `${Math.ceil(remainingMs / hour)} hours remaining`;
    if (remainingMs >= hour) return "1 hour remaining";
    if (remainingMs >= 2 * minute) return `${Math.ceil(remainingMs / minute)} minutes remaining`;
    if (remainingMs >= minute) return "1 minute remaining";
    return "Less than a minute remaining";
}

export function formatCooldownAvailableAt(availableAt) {
    const timestamp = parseAvailableAt(availableAt);
    return timestamp === null ? "" : new Date(timestamp).toLocaleString([], { dateStyle: "long", timeStyle: "short" });
}

export function getCooldownState(availableAt, now = Date.now()) {
    const timestamp = parseAvailableAt(availableAt);
    if (timestamp === null) return { known: false, locked: false, remaining: null, availableAt: null };
    return {
        known: true,
        locked: timestamp > now,
        remaining: formatCooldownRemaining(timestamp, now),
        availableAt: formatCooldownAvailableAt(timestamp)
    };
}

export function getDisplayNameEditState({ displayName, availableAt, availabilityKnown, cooldownForced = false, now = Date.now() }) {
    const cooldown = getCooldownState(availableAt, now);
    const hasSavedName = Boolean(String(displayName ?? "").trim());
    const cooldownUnknown = hasSavedName && availabilityKnown !== true;
    const locked = hasSavedName && (cooldownForced === true || cooldown.locked || cooldownUnknown);
    return { editable: !locked, locked, cooldownUnknown, remaining: cooldown.remaining, availableAt: cooldown.availableAt };
}

export function renderDisplayNameCooldown(elements, { displayName, proposed, availableAt, availabilityKnown, cooldownForced = false, saving = false, now = Date.now() }) {
    const state = getDisplayNameEditState({ displayName, availableAt, availabilityKnown, cooldownForced, now });
    const cooldown = getCooldownState(availableAt, now);
    const coolingDown = Boolean(String(displayName ?? "").trim()) && (cooldownForced === true || cooldown.locked);
    if (elements.input) elements.input.disabled = !state.editable || saving;
    if (elements.save) elements.save.disabled = !state.editable || saving || !String(proposed ?? "").trim() || String(proposed).trim() === String(displayName ?? "");
    if (elements.status) {
        elements.status.textContent = coolingDown
            ? "Your display name can’t be changed again until the 30-day cooldown ends."
            : state.cooldownUnknown
                ? "Display-name availability could not be confirmed. Refresh account status before editing."
                : displayName
                    ? "You can update your BPD display name. Use 3–32 characters; names must be unique."
                    : "Choose a BPD display name for your account.";
    }
    if (elements.remaining) elements.remaining.textContent = coolingDown ? cooldown.remaining || "Your cooldown is active." : "";
    if (elements.available) elements.available.textContent = coolingDown && cooldown.availableAt ? `Next change available: ${cooldown.availableAt}` : "";
    return { ...state, coolingDown };
}
