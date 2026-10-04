import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getProfileSettingsAvailability, mapProfileSettingsToRpcArgs, mapProfileSettingsToV2RpcArgs, normalizeNotificationsV2, normalizeProfileSettings, PROFILE_SETTING_FIELDS } from "../../functions/services/rl/profile_settings.js";
import { buildSettingsPayload, getConfirmedSettings, getDuplicateReminderChannels, getSettingsConfirmationState, isSettingConfirmed, reminderMinutesFromParts, validateNotificationsV2 } from "../../public/Tabs/RocketLeague/MyProfile/JS/settings_view.js";

const EMPTY_NOTIFICATIONS_V2 = Object.freeze({
    email: { enabled: false, reminders: [] },
    sms: { enabled: false, reminders: [] },
    discord: { enabled: false, reminders: [] }
});

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

test("nested Supabase settings recognize find_profile_enabled without coercing its boolean", () => {
    const source = { settings: { find_profile_enabled: false, show_online_status: true } };
    const settings = normalizeProfileSettings(source);
    const availability = getProfileSettingsAvailability(source);

    assert.equal(settings.findProfileEnabled, false);
    assert.equal(availability.findProfileEnabled, true);
    assert.equal(settings.showOnlineStatus, true);
    assert.equal(availability.showOnlineStatus, true);
});

test("Find Players true, false, and null remain distinct from online-status preference", () => {
    for (const findProfileEnabled of [true, false]) {
        const source = { settings: { find_profile_enabled: findProfileEnabled, show_online_status: !findProfileEnabled } };
        const settings = normalizeProfileSettings(source);
        const availability = getProfileSettingsAvailability(source);
        const rpcArgs = mapProfileSettingsToRpcArgs(settings);
        assert.equal(settings.findProfileEnabled, findProfileEnabled);
        assert.equal(availability.findProfileEnabled, true);
        assert.equal(rpcArgs.s_find_profile_enabled, findProfileEnabled);
        assert.equal(rpcArgs.s_show_online_status, !findProfileEnabled);
    }

    const unavailable = normalizeProfileSettings({ settings: { find_profile_enabled: null } });
    assert.equal(unavailable.findProfileEnabled, null);
    assert.equal(mapProfileSettingsToRpcArgs({ findProfileEnabled: null }).s_find_profile_enabled, null);
    const nullSetting = { settings: { find_profile_enabled: null } };
    assert.equal(getProfileSettingsAvailability(nullSetting).findProfileEnabled, true);
    assert.equal(getProfileSettingsAvailability({ settings: {} }).findProfileEnabled, false);
    const nullProfile = {
        ageConsent: true,
        policyConsent: true,
        settings: { ...unavailable, autoDetectRegion: false, showOnlineStatus: false, notificationsEnabled: false,
            preferredMode: null, otherMode: null, availability: [], email: null, phone: null,
            notificationMethod: null, reminderMode: null },
        settingsAvailability: Object.fromEntries([...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"].map(key => [key, true]))
    };
    assert.equal(getSettingsConfirmationState(nullProfile).canSave, false);
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
            : PROFILE_SETTING_FIELDS[key].type === "array" ? []
                : PROFILE_SETTING_FIELDS[key].type === "object" ? structuredClone(EMPTY_NOTIFICATIONS_V2) : ""
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
        availability: []
    });
    assert.equal(payload.phone, null);
    assert.equal(payload.email, "");
    assert.equal(payload.showOnlineStatus, false);
    assert.deepEqual(payload.notificationsV2, EMPTY_NOTIFICATIONS_V2);
    assert.equal(Object.hasOwn(payload, "notificationsEnabled"), false);
    assert.equal(Object.hasOwn(payload, "stats"), false);
    assert.equal(Object.hasOwn(payload, "provider"), false);
});

test("My Profile updates Find Players independently while preserving the saved boolean", () => {
    const baseSettings = {
        autoDetectRegion: false,
        showOnlineStatus: true,
        findProfileEnabled: false,
        preferredMode: "2s",
        otherMode: null,
        availability: [],
        email: null,
        phone: null,
        notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2)
    };
    const profile = {
        ageConsent: true,
        policyConsent: true,
        settings: baseSettings,
        settingsAvailability: Object.fromEntries([...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"].map(key => [key, true]))
    };

    const payload = buildSettingsPayload(profile, {
        autoDetectRegion: false,
        showOnlineStatus: true,
        findProfileEnabled: false,
        preferredMode: "2s",
        otherMode: "",
        availability: [],
        email: "",
        phone: "",
        notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2)
    });
    assert.equal(payload.findProfileEnabled, false);
    assert.equal(payload.showOnlineStatus, true);

    const enabledPayload = buildSettingsPayload({ ...profile, settings: { ...baseSettings, findProfileEnabled: true } }, {
        autoDetectRegion: false,
        showOnlineStatus: false,
        findProfileEnabled: true,
        preferredMode: "2s",
        otherMode: "",
        availability: [],
        email: "",
        phone: "",
        notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2)
    });
    assert.equal(enabledPayload.findProfileEnabled, true);
    assert.equal(enabledPayload.showOnlineStatus, false);
});

test("My Profile Find Players control stays native, fail-closed, keyboard-visible, and animation-aware", async () => {
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/HTML/index.html", import.meta.url), "utf8");
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const css = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/CSS/index.css", import.meta.url), "utf8");

    assert.match(html, /<input id="findProfileEnabled" type="checkbox">/);
    assert.match(html, /Allow my Rocket League profile to appear in Find Players/);
    assert.match(page, /findProfileEnabled: \["findProfileEnabled"\]/);
    assert.match(page, /control\.indeterminate = !confirmed \|\| profile\.settings\[key\] === null/);
    assert.match(page, /findProfileEnabled: document\.getElementById\("findProfileEnabled"\)\.checked/);
    assert.match(css, /\.my-profile-discovery-toggle:has\(input:checked\)/);
    assert.match(css, /\.my-profile-discovery-toggle:has\(input:focus-visible\)/);
    assert.match(css, /body\[data-animations="off"\] \.my-profile-discovery-toggle \{ transition: none; \}/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.my-profile-discovery-toggle \{ transition: none; \}/);
});

test("My Profile fails closed when a setting or consent source is not confirmed", () => {
    const complete = {
        ageConsent: true,
        policyConsent: true,
        settings: { primaryPlatform: null, autoDetectRegion: false, showOnlineStatus: false, findProfileEnabled: false,
            preferredMode: null, otherMode: null, availability: [], email: null, phone: null, notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2) },
        settingsAvailability: Object.fromEntries([...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"].map(key => [key, true]))
    };
    assert.ok(getConfirmedSettings(complete));
    assert.equal(getConfirmedSettings({ ...complete, settingsAvailability: { ...complete.settingsAvailability, email: false } }), null);
    assert.equal(getConfirmedSettings({ ...complete, policyConsent: undefined }), null);
});

test("a missing optional setting identifies only its own control while preserving the full-save safety gate", () => {
    const fields = Object.keys(PROFILE_SETTING_FIELDS);
    const settings = { primaryPlatform: null, autoDetectRegion: false, showOnlineStatus: false, findProfileEnabled: false,
        preferredMode: null, otherMode: null, availability: [], email: null, phone: null, notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2) };
    const profile = {
        ageConsent: true,
        policyConsent: true,
        settings,
        settingsAvailability: Object.fromEntries([...fields, "ageConsent", "policyConsent"].map(key => [key, true]))
    };
    delete profile.settingsAvailability.email;

    const state = getSettingsConfirmationState(profile);
    assert.deepEqual(state.unconfirmedFields, ["email"]);
    assert.equal(isSettingConfirmed(profile, "preferredMode"), true);
    assert.equal(isSettingConfirmed(profile, "email"), false);
    assert.equal(state.canSave, false);
    assert.equal(getConfirmedSettings(profile), null);
});

test("an unconfirmed read-only location field does not lock editable settings", () => {
    const settings = { primaryPlatform: null, autoDetectRegion: false, showOnlineStatus: false, findProfileEnabled: false,
        preferredMode: null, otherMode: null, availability: [], email: null, phone: null, notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2) };
    const availability = Object.fromEntries([...Object.keys(PROFILE_SETTING_FIELDS), "ageConsent", "policyConsent"].map(key => [key, true]));
    availability.region = false;
    const profile = { ageConsent: true, policyConsent: true, settings, settingsAvailability: availability };
    assert.equal(getSettingsConfirmationState(profile).canSave, true);
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
        notificationsV2: structuredClone(EMPTY_NOTIFICATIONS_V2),
        provider: { displayUsername: "read-only" },
        stats: { wins: 999 },
        injected: "never-save"
    });
    assert.equal(mapped.s_find_profile_enabled, false);
    assert.equal(mapped.s_show_online_status, false);
    assert.deepEqual(mapped.s_availability, []);
    assert.equal(Object.keys(mapped).length, Object.values(PROFILE_SETTING_FIELDS).filter(field => field.rpc?.startsWith("s_")).length);
    assert.equal(JSON.stringify(mapped).includes("read-only"), false);
    assert.equal(JSON.stringify(mapped).includes("999"), false);
    assert.equal(JSON.stringify(mapped).includes("never-save"), false);
});

test("V2 settings preserve explicit channel choices, disabled reminder values, and duplicate timings", () => {
    const notificationsV2 = normalizeNotificationsV2({
        email: { enabled: true, reminders: [60, 60, 1440] },
        sms: { enabled: false, reminders: [15] },
        discord: { enabled: true, reminders: [11460, 0, 20, 30] }
    });
    assert.deepEqual(notificationsV2, {
        email: { enabled: true, reminders: [60, 60, 1440] },
        sms: { enabled: false, reminders: [15] },
        discord: { enabled: true, reminders: [11460, 20, 30] }
    });

    const mapped = mapProfileSettingsToV2RpcArgs({
        autoDetectRegion: false,
        region: "ignored",
        countryCode: "US",
        displayTimezone: "America/New_York",
        primaryPlatform: "steam",
        notificationsV2
    });
    assert.equal(mapped.p_primary_platform, "steam");
    assert.equal(mapped.p_region, null);
    assert.equal(mapped.p_country_code, null);
    assert.equal(mapped.p_display_timezone, null);
    assert.deepEqual(mapped.p_notifications, notificationsV2);
});

test("My Profile notification V2 validates reminder boundaries, simultaneous channels, contacts, and duplicate warnings", () => {
    assert.deepEqual(reminderMinutesFromParts("", "", ""), { empty: true, minutes: null });
    assert.deepEqual(reminderMinutesFromParts("0", "0", "15"), { empty: false, minutes: 15 });
    assert.deepEqual(reminderMinutesFromParts("7", "23", "0"), { empty: false, minutes: 11460 });
    assert.match(reminderMinutesFromParts("0", "0", "14").error, /between 15 minutes/);
    assert.match(reminderMinutesFromParts("7", "23", "1").error, /between 15 minutes/);
    assert.match(reminderMinutesFromParts("1", "", "15").error, /Complete the days/);

    const allEnabled = {
        email: { enabled: true, reminders: [15, 60, 60] },
        sms: { enabled: true, reminders: [60] },
        discord: { enabled: true, reminders: [] }
    };
    assert.equal(validateNotificationsV2(allEnabled, "player@example.com", "+15555550123"), null);
    assert.match(validateNotificationsV2(allEnabled, "", "+15555550123"), /Add an email address/);
    assert.match(validateNotificationsV2({ ...allEnabled, email: { enabled: false, reminders: [] }, sms: { enabled: true, reminders: [] } }, "", ""), /Add a phone number/);
    assert.deepEqual(getDuplicateReminderChannels(allEnabled), ["email"]);
    assert.equal(validateNotificationsV2({ ...allEnabled, email: { enabled: true, reminders: [15, 30, 45, 60] } }, "player@example.com", "+15555550123"), "Check the notification channel settings and reminder times.");
});

test("setup redirects completed players to the standalone My Profile route", async () => {
    const source = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    const myProfile = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const profileService = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    assert.match(source, /profileComplete && rocketLeagueAccess/);
    assert.match(source, /navigate\("\/RocketLeague\/MyProfile", \{ replace: true \}\)/);
    assert.doesNotMatch(source, /isMyProfileRoute|profileUpdateMode|renderMyProfileReadOnlyData/);
    assert.match(source, /const settings = profile\.settings \|\| profile/);
    assert.match(myProfile, /findProfileEnabled/);
    assert.match(myProfile, /showOnlineStatus/);
    assert.match(source, /settingsAvailability: normalizeObject\(profile\.settingsAvailability\)/);
    assert.match(source, /settings\[snakeKey\]/);
    assert.match(source, /profileLookupConfirmed !== "true"/);
    assert.match(source, /findProfileEnabledConfirmed/);
    assert.match(source, /checkbox\.checked = confirmed && settings\.findProfileEnabled === true/);
    assert.match(source, /profileLookupConfirmed:?[\s\S]{0,100}true/);
    assert.match(profileService, /typeof body\.findProfileEnabled === "boolean"/);
    assert.match(profileService, /getProfileSettingsAvailability\(databaseProfile\)/);
    assert.match(source, /profileExists === true[\s\S]{0,360}settingsAvailability\?\.findProfileEnabled/);
    const payloadBuilder = source.slice(source.indexOf("function buildRegistrationPayload"), source.indexOf("function validateRegistrationPayload"));
    assert.doesNotMatch(payloadBuilder, /provider|careerStats|stats|ranked/i);
});

test("registration Find Players privacy is explicit opt-in and does not control Rocket League access", async () => {
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/HTML/index.html", import.meta.url), "utf8");
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    const css = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/CSS/index.css", import.meta.url), "utf8");
    const shellCss = await readFile(new URL("../../public/Framework/Shell/CSS/General/shell.css", import.meta.url), "utf8");
    const input = html.match(/<input\s+id="findProfileEnabled"[\s\S]*?>/i)?.[0];

    assert.ok(input, "registration should include the existing Find Players checkbox");
    assert.match(input, /type="checkbox"/);
    assert.doesNotMatch(input, /\bchecked\b/i, "new registrations must default to opt-out");
    assert.match(html, /Allow my Rocket League profile to appear in Find Players/);
    assert.match(html, /Optional and off by default[\s\S]*?does not affect access to Rocket League features/);
    assert.match(page, /findProfileEnabled:\s*data\.get\([\s\S]{0,120}"findProfileEnabled"[\s\S]{0,60}===\s*"on"/);
    assert.match(page, /const findProfileConfirmed = profile\.settingsAvailability\?\.findProfileEnabled === true/);
    assert.match(page, /findProfile\.checked = findProfileConfirmed \? settings\.findProfileEnabled : false/);
    assert.match(css, /\.toggle-control[\s\S]{0,260}transition:/);
    assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]{0,100}transition:\s*none/);
    assert.match(shellCss, /body\.animations-off[\s\S]{0,220}transition-duration:\s*0\.01ms/);
});

test("registration uses the shared V2 notification channels without the legacy single-channel contract", async () => {
    const html = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/HTML/index.html", import.meta.url), "utf8");
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    const helper = await readFile(new URL("../../public/Tabs/RocketLeague/shared/notificationsV2.js", import.meta.url), "utf8");

    assert.match(page, /from "\.\.\/\.\.\/shared\/notificationsV2\.js"/);
    assert.match(html, /registrationNotificationsV2Fieldset/);
    assert.match(html, /registrationNotificationChannels/);
    assert.match(page, /for \(const channel of NOTIFICATION_CHANNELS\)/);
    assert.match(page, /settings\.notificationsV2/);
    assert.match(page, /profile\.settingsAvailability\?\.notificationsV2 === true/);
    assert.match(page, /notificationsV2: notificationResult\.settings/);
    assert.match(page, /discordNotificationState\.eligible/);
    assert.match(helper, /maxPerChannel: 3/);
    assert.match(helper, /minMinutes: 15/);
    assert.match(helper, /maxMinutes: 11460/);
    assert.match(helper, /getDuplicateReminderChannels/);
    assert.doesNotMatch(html, /name="notificationsEnabled"|name="notificationMethod"|name="reminderMode"/);
    assert.doesNotMatch(page, /getNotificationsEnabled|getNotificationMethod|discordNotificationMethod/);
    assert.match(page, /registrationNotificationsConfirmed && !notificationResult\.error[\s\S]{0,120}\? \{ notificationsV2: notificationResult\.settings \}/);
});

test("My Profile uses the post-registration PATCH contract and does not resubmit setup consent", async () => {
    const view = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/settings_view.js", import.meta.url), "utf8");
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    const service = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    const route = await readFile(new URL("../../functions/api/auth/rocketleague/profile.js", import.meta.url), "utf8");
    assert.match(page, /requestProfile\("PATCH", payload\)/);
    assert.doesNotMatch(view.slice(view.indexOf("export function buildSettingsPayload")), /ageConsent:|policyConsent:/);
    assert.match(service, /request\.method === "PATCH"/);
    assert.match(service, /settings\.ageConsent = current\.ageConsent === true/);
    assert.match(service, /settings\.policyConsent = current\.policyConsent === true/);
    assert.match(route, /onRequestPatch/);
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
