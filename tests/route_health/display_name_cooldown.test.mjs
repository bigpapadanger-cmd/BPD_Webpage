import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { formatCooldownAvailableAt, formatCooldownRemaining, getCooldownState, getDisplayNameEditState, renderDisplayNameCooldown } from "../../public/Global/Settings/JS/display_name_cooldown.js";

const now = Date.UTC(2026, 9, 2, 12, 0, 0);
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test("cooldown remaining formatter rounds up long durations", () => {
    assert.equal(formatCooldownRemaining(now + 24 * day + 2 * hour, now), "25 days remaining");
    assert.equal(formatCooldownRemaining(now + 10 * day, now), "10 days remaining");
    assert.equal(formatCooldownRemaining(now + day + 5 * hour, now), "1 day remaining");
});

test("cooldown remaining formatter handles hours and minutes with singular forms", () => {
    assert.equal(formatCooldownRemaining(now + 3 * hour + 1, now), "4 hours remaining");
    assert.equal(formatCooldownRemaining(now + hour, now), "1 hour remaining");
    assert.equal(formatCooldownRemaining(now + 2 * minute + 1, now), "3 minutes remaining");
    assert.equal(formatCooldownRemaining(now + minute, now), "1 minute remaining");
    assert.equal(formatCooldownRemaining(now + minute - 1, now), "Less than a minute remaining");
});

test("expired and invalid timestamps are not represented as a zero change or locked state", () => {
    assert.equal(formatCooldownRemaining(now, now), null);
    assert.equal(formatCooldownRemaining(now - minute, now), null);
    assert.equal(formatCooldownRemaining("not-a-date", now), null);
    assert.deepEqual(getCooldownState(null, now), { known: false, locked: false, remaining: null, availableAt: null });
    assert.equal(getCooldownState(now + minute, now).locked, true);
});

test("existing-name edit policy distinguishes explicit no-cooldown null from missing or malformed authority", () => {
    assert.equal(getDisplayNameEditState({ displayName: "", availableAt: now + 30 * day, availabilityKnown: false, now }).editable, true);
    assert.equal(getDisplayNameEditState({ displayName: "Player", availableAt: null, availabilityKnown: true, now }).editable, true);
    assert.equal(getDisplayNameEditState({ displayName: "Player", availableAt: null, availabilityKnown: false, now }).editable, false);
    assert.equal(getDisplayNameEditState({ displayName: "Player", availableAt: "invalid", availabilityKnown: false, now }).cooldownUnknown, true);
    assert.equal(getDisplayNameEditState({ displayName: "Player", availableAt: now - minute, availabilityKnown: true, now }).editable, true);
    assert.equal(getDisplayNameEditState({ displayName: "Player", availableAt: now + 30 * day, availabilityKnown: true, now }).editable, false);
});

test("availability date uses local browser timezone formatting", () => {
    const timestamp = now + 10 * day;
    assert.equal(formatCooldownAvailableAt(timestamp), new Date(timestamp).toLocaleString([], { dateStyle: "long", timeStyle: "short" }));
});

test("Settings editor renders first-name, explicit-null, active, unknown, and post-save states", () => {
    const elements = {
        input: { disabled: false }, save: { disabled: false }, status: { textContent: "" },
        remaining: { textContent: "" }, available: { textContent: "" }
    };
    const noName = renderDisplayNameCooldown(elements, { displayName: "", proposed: "New Name", availableAt: now + 30 * day, availabilityKnown: false, now });
    assert.equal(noName.editable, true);
    assert.equal(elements.input.disabled, false);

    const legacyNoCooldown = renderDisplayNameCooldown(elements, { displayName: "Player", proposed: "Player 2", availableAt: null, availabilityKnown: true, now });
    assert.equal(legacyNoCooldown.editable, true);

    const locked = renderDisplayNameCooldown(elements, { displayName: "Player", proposed: "Player 2", availableAt: now + 10 * day, availabilityKnown: true, now });
    assert.equal(locked.editable, false);
    assert.equal(elements.input.disabled, true);
    assert.equal(elements.save.disabled, true);
    assert.equal(elements.remaining.textContent, "10 days remaining");
    assert.match(elements.available.textContent, /^Next change available:/);

    const unknown = renderDisplayNameCooldown(elements, { displayName: "Player", proposed: "Player 2", availableAt: null, availabilityKnown: false, now });
    assert.equal(unknown.cooldownUnknown, true);
    assert.equal(elements.input.disabled, true);

    const saved = renderDisplayNameCooldown(elements, { displayName: "Updated Name", proposed: "Updated Name", availableAt: now + 30 * day, availabilityKnown: true, now });
    assert.equal(saved.coolingDown, true);
    assert.equal(elements.status.textContent.includes("30-day cooldown"), true);
});

test("Settings uses authoritative cooldown state, explains it, and tears down the minute refresh after SPA navigation", async () => {
    const settings = await readFile(new URL("../../public/Global/Settings/JS/settings.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../../public/Global/Settings/HTML/settings.html", import.meta.url), "utf8");
    assert.match(settings, /renderDisplayNameCooldown\(/);
    assert.match(settings, /availabilityKnown: cooldownStateKnown/);
    assert.match(settings, /Math\.min\(60_000, changeAvailableAt - Date\.now\(\)\)/);
    assert.match(settings, /bpd:page-loaded/);
    assert.match(settings, /clearTimeout\(cooldownTimer\)/);
    assert.match(html, /displayNameCooldownRemaining/);
    assert.match(html, /displayNameCooldownAvailableAt/);
    assert.match(html, /changed once every 30 days/i);
});
