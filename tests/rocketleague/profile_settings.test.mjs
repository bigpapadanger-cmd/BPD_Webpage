import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getProfileSettingsAvailability, mapProfileSettingsToRpcArgs, normalizeProfileSettings, PROFILE_SETTING_FIELDS } from "../../functions/services/rl/profile_settings.js";
import { buildSettingsPayload, getConfirmedSettings } from "../../public/Tabs/RocketLeague/MyProfile/JS/settings_view.js";

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

test("availability tracks missing separately from explicit null, false, and empty values", () => {
    const source = { show_online_status: false, email: "", phone: null };
    const known = getProfileSettingsAvailability(source);
    assert.equal(known.showOnlineStatus, true);
    assert.equal(known.email, true);
    assert.equal(known.phone, true);
    assert.equal(known.findProfileEnabled, false);
    const settings = normalizeProfileSettings(source);
    assert.equal(settings.showOnlineStatus, false);
    assert.equal(settings.email, "");
    assert.equal(settings.phone, null);
});

test("My Profile edits only confirmed values and preserves explicit nulls", () => {
    const fields = Object.keys(PROFILE_SETTING_FIELDS);
    const settings = Object.fromEntries(fields.map(key => [key,
        PROFILE_SETTING_FIELDS[key].type === "boolean" ? false
            : PROFILE_SETTING_FIELDS[key].type === "array" ? [] : ""
    ]));
    settings.phone = null;
    const profile = {
        ageConsent: true,
        policyConsent: true,
        settings,
        settingsAvailability: Object.fromEntries([...fields, "ageConsent", "policyConsent"].map(key => [key, true]))
    };
    assert.equal(getConfirmedSettings(profile), settings);
    const payload = buildSettingsPayload(profile, {
        ...settings,
        phone: "",
        email: "",
        notificationsEnabled: false,
        availability: []
    });
    assert.equal(payload.phone, null);
    assert.equal(payload.email, "");
    assert.equal(payload.showOnlineStatus, false);
    assert.equal(payload.notificationsEnabled, false);
    assert.equal(Object.hasOwn(payload, "stats"), false);
    assert.equal(Object.hasOwn(payload, "provider"), false);
});

test("My Profile fails closed when a setting or consent source is not confirmed", () => {
    const complete = {
        ageConsent: true,
        policyConsent: true,
        settings: { autoDetectRegion: false, showOnlineStatus: false, findProfileEnabled: false, notificationsEnabled: false,
            preferredMode: null, otherMode: null, availability: [], email: null, phone: null, notificationMethod: null, reminderMode: null },
        settingsAvailability: Object.fromEntries([...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"].map(key => [key, true]))
    };
    assert.ok(getConfirmedSettings(complete));
    assert.equal(getConfirmedSettings({ ...complete, settingsAvailability: { ...complete.settingsAvailability, email: false } }), null);
    assert.equal(getConfirmedSettings({ ...complete, policyConsent: undefined }), null);
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

test("setup redirects completed players to the standalone My Profile route", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    const myProfile = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /profileComplete && rocketLeagueAccess/);
    assert.match(source, /navigate\("\/RocketLeague\/MyProfile", \{ replace: true \}\)/);
    assert.doesNotMatch(source, /isMyProfileRoute|profileUpdateMode|renderMyProfileReadOnlyData/);
    assert.match(source, /const settings = profile\.settings \|\| profile/);
    assert.match(myProfile, /findProfileEnabled/);
    assert.match(myProfile, /showOnlineStatus/);
    const payloadBuilder = source.slice(source.indexOf("function buildRegistrationPayload"), source.indexOf("function validateRegistrationPayload"));
    assert.doesNotMatch(payloadBuilder, /provider|careerStats|stats|ranked/i);
});

test("private profile reads are persisted-data-only and never wake or call presence provider", async () => {
    const service = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    const readers = [
        "../../public/Tabs/RocketLeague/MyProfile/JS/index.js",
        "../../public/Tabs/RocketLeague/Registration/JS/index.js",
        "../../public/Tabs/RocketLeague/Index/JS/profile.js",
        "../../public/Tabs/RocketLeague/WeeklyMatches/JS/index.js",
        "../../public/Tabs/RocketLeague/MatchResults/JS/index.js",
        "../../public/Tabs/RocketLeague/PrivateMatches/JS/index.js"
    ];
    const getHandler = service.slice(service.indexOf("async function handleProfileGet"), service.indexOf("async function handleProfilePost"));
    assert.doesNotMatch(getHandler, /fetchRocketLeaguePresence|activateRocketLeaguePresenceMonitor|wakeRocketLeaguePresenceMonitor/);
    for (const file of readers) {
        const source = await readFile(new URL(file, import.meta.url), "utf8");
        if (file.includes("Index/JS/profile")) assert.match(source, /includePresence=false/);
    }
});
