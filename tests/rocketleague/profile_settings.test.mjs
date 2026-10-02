import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mapProfileSettingsToRpcArgs, normalizeProfileSettings, PROFILE_SETTING_FIELDS } from "../../functions/services/rl/profile_settings.js";

test("central settings mapping preserves false, empty, null, and availability values", () => {
    const settings = normalizeProfileSettings({
        auto_detect_region: false,
        region: "",
        country_code: null,
        display_timezone: "",
        preferred_mode: "2s",
        other_mode: null,
        show_online_status: false,
        find_profile_enabled: false,
        email: "",
        phone: null,
        availability: [{ day: "Monday", start: "18:00", end: "20:00" }],
        notifications_enabled: false,
        notification_method: null,
        reminder_mode: null
    });
    assert.equal(settings.autoDetectRegion, false);
    assert.equal(settings.region, "");
    assert.equal(settings.countryCode, null);
    assert.equal(settings.displayTimezone, "");
    assert.equal(settings.showOnlineStatus, false);
    assert.equal(settings.findProfileEnabled, false);
    assert.deepEqual(settings.availability, [{ day: "Monday", start: "18:00", end: "20:00" }]);
    assert.equal(settings.notificationsEnabled, false);
});

test("missing privacy setting remains unavailable rather than silently becoming false", () => {
    assert.equal(normalizeProfileSettings({ show_online_status: false }).findProfileEnabled, null);
    assert.equal(normalizeProfileSettings({ find_profile_enabled: true }).findProfileEnabled, true);
});

test("RPC projection is explicit and excludes read-only provider, stats, and unknown fields", () => {
    const mapped = mapProfileSettingsToRpcArgs({
        autoDetectRegion: false,
        region: null,
        countryCode: null,
        displayTimezone: null,
        preferredMode: "3s",
        otherMode: "",
        showOnlineStatus: false,
        findProfileEnabled: false,
        email: "",
        phone: null,
        availability: [],
        notificationsEnabled: false,
        notificationMethod: null,
        reminderMode: null,
        provider: { displayUsername: "read-only" },
        stats: { wins: 999 },
        injected: "never-save"
    });
    assert.equal(mapped.s_find_profile_enabled, false);
    assert.equal(mapped.s_show_online_status, false);
    assert.deepEqual(mapped.s_availability, []);
    assert.equal(Object.keys(mapped).length, Object.keys(PROFILE_SETTING_FIELDS).length);
    assert.equal(JSON.stringify(mapped).includes("read-only"), false);
    assert.equal(JSON.stringify(mapped).includes("999"), false);
    assert.equal(JSON.stringify(mapped).includes("never-save"), false);
});

test("completed registration switches to Update Profile and profile form reads normalized settings", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /profileUpdateMode = profileResult\.profile\?\.profileComplete === true/);
    assert.match(source, /profileUpdateMode \? "Update Profile" : "Complete Registration"/);
    assert.match(source, /const settings = profile\.settings \|\| profile/);
    assert.match(source, /missingBooleanSettings/);
    const payloadBuilder = source.slice(source.indexOf("function buildRegistrationPayload"), source.indexOf("function validateRegistrationPayload"));
    assert.doesNotMatch(payloadBuilder, /provider|careerStats|stats|ranked/i);
});
