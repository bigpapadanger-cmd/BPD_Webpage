import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { ROUTES } from "../../public/routes.js";
import { handleAccountMutation } from "../../functions/services/auth/account/mutations.js";
import { applyAppearancePreferences, hasReadableContrast } from "../../public/Framework/Shell/JS/preferences.js";
import { SIDEBAR_ICONS } from "../../public/Framework/Shell/JS/Sidebar/icons.js";

function createElement(value = "") {
    return {
        value,
        textContent: "",
        attributes: {},
        listeners: {},
        hidden: false,
        classList: {
            values: new Set(),
            toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); },
            contains(name) { return this.values.has(name); }
        },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        setAttribute(name, value) { this.attributes[name] = value; },
        style: {},
        querySelectorAll() { return this.previewSpans || []; }
    };
}

test("user Settings stays public and Page Settings remains an alias for unified admin diagnostics", () => {
    assert.equal(ROUTES["/Settings"].requiresAuth, false);
    assert.equal(ROUTES["/Settings"].body, "/Global/Settings/HTML/settings.html");
    assert.equal(ROUTES["/Admin/PageSettings"].requiresAuth, true);
    assert.equal(ROUTES["/Admin/PageSettings"].module, ROUTES["/Admin/WorkerStatus"].module);
    assert.equal(ROUTES["/Admin/PageSettings"].body, ROUTES["/Admin/WorkerStatus"].body);
});

test("admin navigation has one System Status entry and recognizes the legacy bookmark", async () => {
    const sidebar = await readFile(new URL("../../public/Framework/Shell/HTML/Sidebar/admin.html", import.meta.url), "utf8");
    const navigation = await readFile(new URL("../../public/Framework/Shell/JS/Admin/sidebar.js", import.meta.url), "utf8");
    assert.equal((sidebar.match(/data-tooltip="System Status"/g) || []).length, 1);
    assert.match(sidebar, /data-nav-aliases="\/Admin\/PageSettings"/);
    assert.match(navigation, /item\.dataset\.navAliases/);
});

test("appearance preferences remain browser-local and preserve existing storage keys", async () => {
    const originalDocument = globalThis.document;
    const originalStorage = globalThis.localStorage;
    const originalWindow = globalThis.window;
    const store = new Map([["bpdTheme", "purple"], ["bpdBackgroundColor", "#121212"]]);
    const backgroundPreview = createElement();
    backgroundPreview.previewSpans = [createElement(), createElement()];
    const backgroundPreviewPending = createElement();
    backgroundPreviewPending.previewSpans = [createElement(), createElement()];
    backgroundPreviewPending.hidden = true;
    const hoverPreview = createElement();
    hoverPreview.previewSpans = [createElement(), createElement()];
    const hoverPreviewPending = createElement();
    hoverPreviewPending.previewSpans = [createElement(), createElement()];
    hoverPreviewPending.hidden = true;
    const elements = {
        themeSetting: createElement(),
        animationSetting: createElement(),
        sidebarSetting: createElement(),
        backgroundColorSetting: createElement(),
        hoverTextColorSetting: createElement(),
        applyColors: createElement(),
        applyColorsStatus: createElement(),
        backgroundColorPreview: backgroundPreview,
        backgroundColorPreviewPending: backgroundPreviewPending,
        hoverTextColorPreview: hoverPreview,
        hoverTextColorPreviewPending: hoverPreviewPending,
        resetSettings: createElement(),
        privacySettings: createElement(),
        privacySettingsStatus: createElement(),
        sidebar: createElement(),
        sidebarToggle: createElement()
    };
    elements.settingsRocketLeagueReturn = createElement();
    globalThis.document = {
        documentElement: { style: { values: {}, setProperty(name, value) { this.values[name] = value; } } },
        body: { dataset: {}, classList: { toggle() {} } },
        getElementById(id) { return elements[id] || null; }
    };
    globalThis.localStorage = {
        getItem(key) { return store.get(key) ?? null; },
        setItem(key, value) { store.set(key, String(value)); }
    };
    const callback = () => {};
    const callbackQueue = [];
    globalThis.window = { googlefc: { callbackQueue, showRevocationMessage: callback },
        location: { search: "?context=rocketleague&returnTo=%2FRocketLeague%2FMyProfile" } };

    try {
        const moduleUrl = pathToFileURL(resolve("public/Global/Settings/JS/settings.js"));
        moduleUrl.searchParams.set("test", String(Date.now()));
        const page = await import(moduleUrl.href);
        await page.initializePage();
        assert.equal(elements.settingsRocketLeagueReturn.hidden, false);
        assert.equal(elements.settingsRocketLeagueReturn.href, "/RocketLeague/MyProfile");

        assert.equal(elements.themeSetting.value, "purple");
        assert.equal(document.body.dataset.theme, "purple");
        assert.equal(elements.backgroundColorSetting.value, "#121212");
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#121212");
        elements.themeSetting.value = "green";
        elements.themeSetting.listeners.change();
        assert.equal(store.get("bpdTheme"), "green");
        for (const name of ["blue", "orange", "purple", "green", "cyan", "emerald"]) {
            elements.themeSetting.value = name;
            elements.themeSetting.listeners.change();
            assert.equal(store.get("bpdTheme"), name);
            await page.initializePage();
            assert.equal(elements.themeSetting.value, name);
            assert.equal(document.body.dataset.theme, name);
        }

        elements.backgroundColorSetting.value = "#ffffff";
        elements.backgroundColorSetting.listeners.input();
        assert.equal(elements.applyColors.disabled, false);
        elements.applyColors.listeners.click();
        assert.match(elements.applyColorsStatus.textContent, /Warning/);
        await page.initializePage();
        assert.equal(elements.backgroundColorSetting.value, "#ffffff");
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#ffffff");
        elements.backgroundColorSetting.value = "red; background: url(https://invalid.example)";
        elements.backgroundColorSetting.listeners.input();
        assert.equal(elements.applyColors.disabled, true);
        elements.applyColors.listeners.click();
        assert.equal(store.get("bpdBackgroundColor"), "#ffffff");
        elements.backgroundColorSetting.value = "#121212";
        elements.backgroundColorSetting.listeners.input();
        elements.applyColors.listeners.click();
        store.delete("bpdHoverTextColor");

        elements.backgroundColorSetting.value = "#223344";
        elements.backgroundColorSetting.listeners.input();
        elements.hoverTextColorSetting.value = "#eeeeee";
        elements.hoverTextColorSetting.listeners.input();
        assert.equal(store.get("bpdBackgroundColor"), "#121212");
        assert.equal(store.has("bpdHoverTextColor"), false);
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#121212");
        assert.equal(document.documentElement.style.values["--bpd-hover-text-color"], "#ffffff");
        assert.equal(backgroundPreview.previewSpans[1].textContent, "Current: #121212");
        assert.equal(backgroundPreviewPending.previewSpans[1].textContent, "Pending: #223344");
        assert.equal(backgroundPreviewPending.hidden, false);
        assert.equal(elements.applyColors.disabled, false);
        assert.equal(elements.backgroundColorSetting.listeners.blur, undefined);
        elements.animationSetting.listeners.click();
        assert.equal(store.get("bpdBackgroundColor"), "#121212");
        assert.equal(store.has("bpdHoverTextColor"), false);
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#121212");
        elements.applyColors.listeners.click();
        assert.equal(store.get("bpdBackgroundColor"), "#223344");
        assert.equal(store.get("bpdHoverTextColor"), "#eeeeee");
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#223344");
        assert.equal(document.documentElement.style.values["--bpd-hover-text-color"], "#eeeeee");
        assert.equal(backgroundPreview.previewSpans[1].textContent, "Current: #223344");
        assert.equal(backgroundPreviewPending.hidden, true);
        assert.equal(elements.applyColors.disabled, true);

        elements.privacySettings.listeners.click();
        assert.equal(callbackQueue[0], callback);

        elements.sidebarSetting.listeners.click();
        assert.equal(store.get("bpdSidebar"), "collapsed");
        assert.equal(elements.sidebar.classList.contains("collapsed"), true);
        assert.equal(document.body.dataset.sidebar, "collapsed");

        elements.resetSettings.listeners.click();
        assert.equal(store.get("bpdTheme"), "blue");
        assert.equal(store.get("bpdAnimations"), "on");
        assert.equal(store.get("bpdSidebar"), "open");
        assert.equal(store.get("bpdBackgroundColor"), "#0d0f13");
        assert.equal(store.get("bpdHoverTextColor"), "#ffffff");
        assert.equal(document.documentElement.style.values["--bpd-user-background"], "#0d0f13");
    } finally {
        globalThis.document = originalDocument;
        globalThis.localStorage = originalStorage;
        globalThis.window = originalWindow;
    }
});

test("Appearance keeps account name first, existing contract, and scoped enabled-button glow", async () => {
    const html = await readFile(new URL("../../public/Global/Settings/HTML/settings.html", import.meta.url), "utf8");
    const css = await readFile(new URL("../../public/Global/Settings/CSS/settings-page.css", import.meta.url), "utf8");
    const js = await readFile(new URL("../../public/Global/Settings/JS/settings.js", import.meta.url), "utf8");
    assert.ok(html.indexOf('id="accountDisplayNameSettings"') < html.indexOf('id="themeSetting"'));
    assert.match(html, /Account Display Name/);
    assert.doesNotMatch(html, /BPD display name/i);
    for (const theme of ["purple", "cyan", "emerald"]) assert.match(html, new RegExp(`value="${theme}"`));
    assert.match(css, /button:not\(:disabled\):hover/);
    assert.match(css, /button:not\(:disabled\):focus-visible/);
    assert.match(css, /outline: 2px solid var\(--site-accent\)/);
    assert.match(js, /JSON.stringify\(\{ displayName: value \}\)/);
    assert.match(js, /finally \{\s*nameSaving = false/);
    assert.match(js, /showVerificationOutcome\(save/);
});

test("sidebar icons use the shared accessible icon slot and consistent dashboard symbol", async () => {
    const sidebarRoot = new URL("../../public/Framework/Shell/HTML/Sidebar/", import.meta.url);
    const sharedSidebars = await Promise.all(["mainmenu.html", "admin.html", "rl_menu.html"].map(name => readFile(new URL(name, sidebarRoot), "utf8")));
    for (const sidebar of sharedSidebars) {
        assert.match(sidebar, /class="nav-icon"[\s\S]*?aria-hidden="true"/);
        const navControls = [...sidebar.matchAll(/<(?:a|button)[^>]*class="nav-item[^"]*"[^>]*>[\s\S]*?<\/(?:a|button)>/g)];
        assert.ok(navControls.length > 0);
        for (const [, control] of navControls.entries()) {
            assert.match(control[0], /class="nav-icon"/);
            assert.match(control[0], /class="nav-text"[\s\S]*?class="nav-label"/);
        }
    }
    for (const sidebar of sharedSidebars) {
        assert.match(sidebar, /data-sidebar-icon="dashboard"/);
        assert.match(sidebar, /data-sidebar-icon="account"/);
    }
    assert.match(sharedSidebars[0], /data-sidebar-icon="rocketleague"/);
    assert.match(sharedSidebars[2], /data-nav-route="\/Dashboard"[\s\S]*?data-sidebar-icon="dashboard"/);
    const styles = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/sidebar.css", import.meta.url), "utf8");
    const rocketLeagueStyles = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/rl_AuthSidebar.css", import.meta.url), "utf8");
    assert.match(styles, /\.site-sidebar \.nav-icon[\s\S]*?font-size: 1\.15rem/);
    assert.doesNotMatch(rocketLeagueStyles, /\.sidebar-view-rocketleague\s+\.nav-icon\s*\{/);
});

test("global color customizations use neutral shared variables and preserve Rocket League hover branding", async () => {
    const preferences = await readFile(new URL("../../public/Framework/Shell/JS/preferences.js", import.meta.url), "utf8");
    const shell = await readFile(new URL("../../public/Framework/Shell/CSS/General/shell.css", import.meta.url), "utf8");
    const sidebar = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/sidebar.css", import.meta.url), "utf8");
    const rlSidebar = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/rl_AuthSidebar.css", import.meta.url), "utf8");
    const header = await readFile(new URL("../../public/Framework/Shell/CSS/General/header.css", import.meta.url), "utf8");
    const footer = await readFile(new URL("../../public/Framework/Shell/CSS/General/footer.css", import.meta.url), "utf8");
    const settings = await readFile(new URL("../../public/Global/Settings/HTML/settings.html", import.meta.url), "utf8");
    const settingsCss = await readFile(new URL("../../public/Global/Settings/CSS/settings-page.css", import.meta.url), "utf8");
    const hover = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/hover.css", import.meta.url), "utf8");
    const router = await readFile(new URL("../../public/Framework/Shell/JS/router.js", import.meta.url), "utf8");
    const sidebarCoordinator = await readFile(new URL("../../public/Framework/Shell/JS/Sidebar/sidebar.js", import.meta.url), "utf8");
    const rocketLeagueMaster = await readFile(new URL("../../public/Framework/Shell/CSS/Callers/master_rl.css", import.meta.url), "utf8");
    assert.match(preferences, /bpdBackgroundColor/);
    assert.match(preferences, /bpdHoverTextColor/);
    assert.match(preferences, /--bpd-user-background/);
    assert.match(shell, /background: var\(--bpd-user-background/);
    assert.match(sidebar, /color:\s*var\(--bpd-hover-text-color/);
    assert.match(sidebar, /\.site-sidebar \.nav-item:hover,[\s\S]*?\.site-sidebar \.nav-item:focus-visible \{\s*color: var\(--bpd-hover-text-color/);
    assert.match(sidebar, /\.site-sidebar \.nav-item\[aria-current="page"\][\s\S]*?color: var\(--site-accent\)/);
    assert.match(header, /\.header-tab:hover[\s\S]*?color: var\(--bpd-hover-text-color/);
    assert.match(footer, /\.footer-navigation a:hover[\s\S]*?var\(--bpd-hover-text-color/);
    assert.match(rlSidebar, /\.sidebar-view-rocketleague \.nav-item:hover[\s\S]*?color: #ffffff/);
    assert.match(rlSidebar, /\.sidebar-view-rocketleague \.submenu-item:hover[\s\S]*?color: #ffffff/);
    assert.ok(rocketLeagueMaster.indexOf("../Sidebar/sidebar.css") < rocketLeagueMaster.indexOf("../Sidebar/rl_AuthSidebar.css"));
    assert.doesNotMatch(rlSidebar, /--bpd-(?:user-background|hover-text-color)/);
    assert.match(settings, /Background Color/);
    assert.match(settings, /shared page background; Rocket League cards and branded accents stay the same/);
    assert.match(settings, /id="backgroundColorPreviewPending"[^>]*hidden/);
    assert.match(settings, /Hover Text Color/);
    assert.match(settings, /generic site navigation hover text/);
    assert.match(settings, /id="hoverTextColorPreviewPending"[^>]*hidden/);
    assert.match(settings, /id="applyColors"[^>]*>Apply Colors/);
    assert.match(hover, /#sidebarHoverText[\s\S]*?color:\s*inherit/);
    assert.match(hover, /\.sidebar-tooltip[\s\S]*?color:\s*var\(--bpd-hover-text-color/);
    assert.match(settingsCss, /#themeSetting option[\s\S]*?color:\s*#111827;[\s\S]*?background-color:\s*#ffffff/);
    assert.match(settingsCss, /#themeSetting option:checked,[\s\S]*?#themeSetting option:hover,[\s\S]*?#themeSetting option:focus \{\s*color: #ffffff;\s*background-color: #1d4ed8/);
    assert.match(shell, /a:focus-visible,[\s\S]*?select:focus-visible,[\s\S]*?\{\s*outline: 2px solid var\(--site-accent\)/);
    assert.match(router, /applyAppearancePreferences\(\)/);
    assert.match(sidebarCoordinator, /applyAppearancePreferences\(preferences\)/);
    assert.equal(hasReadableContrast("#ffffff", "#0d0f13"), true);
    assert.equal(hasReadableContrast("#eeeeee", "#24202f"), true);
    assert.equal(hasReadableContrast("#b9c2d1", "#24202f"), true);
    assert.equal(hasReadableContrast("#24202f", "#24202f"), false);
    assert.equal(hasReadableContrast("#ffffff", "#eeeeee"), false);
    const originalDocument = globalThis.document;
    globalThis.document = {
        body: { dataset: {}, classList: { toggle() {} } },
        documentElement: { style: { values: {}, setProperty(name, value) { this.values[name] = value; } } }
    };
    try {
        applyAppearancePreferences({ theme: "blue", animations: "on", backgroundColor: "#101820", hoverTextColor: "#b9c2d1" });
        assert.equal(globalThis.document.documentElement.style.values["--bpd-user-background"], "#101820");
        assert.equal(globalThis.document.documentElement.style.values["--bpd-hover-text-color"], "#b9c2d1");
        applyAppearancePreferences({ theme: "blue", animations: "on", backgroundColor: "#0d0f13", hoverTextColor: "#ffffff" });
        assert.equal(globalThis.document.documentElement.style.values["--bpd-user-background"], "#0d0f13");
        assert.equal(globalThis.document.documentElement.style.values["--bpd-hover-text-color"], "#ffffff");
    } finally {
        globalThis.document = originalDocument;
    }
});

test("FAQ retains curated answers alongside the published workflow and Suggestions stays separate", async () => {
    const html = await readFile(new URL("../../public/Required/FAQ/HTML/index.html", import.meta.url), "utf8");
    const routes = await readFile(new URL("../../public/routes.js", import.meta.url), "utf8");
    const apiRoutes = await readFile(new URL("../../public/scripts/apiRoutes.js", import.meta.url), "utf8");
    assert.equal(ROUTES["/FAQ"].module, "/Required/FAQ/JS/index.js");
    assert.doesNotMatch(html, /\/api\/faq(?:\/upvote)?/i);
    assert.match(html, /href="\/Suggestions"/);
    assert.doesNotMatch(routes + apiRoutes, /FAQ_API_URL|FAQ_UPVOTE_URL/);
    assert.equal(existsSync(resolve("public/Required/FAQ/JS/index.js")), true);
    assert.match(html, /id="faqCurated"/);
});

test("legacy ImageScanning resolves through a replace redirect to SubmitMatchResults", async () => {
    assert.equal(ROUTES["/RocketLeague/ImageScanning"].redirectTo, "/RocketLeague/SubmitMatchResults");
    assert.equal(ROUTES["/RocketLeague/ImageScanning"].sitemap, false);
    const router = await readFile(new URL("../../public/Framework/Shell/JS/router.js", import.meta.url), "utf8");
    assert.match(router, /route\.config\?\.redirectTo[\s\S]*?history\.replaceState[\s\S]*?resolveRoute\(redirectUrl\.pathname\)/);
});

test("display-name cooldown contract remains server-resolved and only exposes safe profile fields", async () => {
    const mutation = await readFile(new URL("../../functions/services/auth/account/mutations.js", import.meta.url), "utf8");
    const session = await readFile(new URL("../../functions/services/auth/account/get_session.js", import.meta.url), "utf8");
    const settings = await readFile(new URL("../../public/Global/Settings/JS/settings.js", import.meta.url), "utf8");
    for (const code of ["DISPLAY_NAME_REQUIRED", "DISPLAY_NAME_TOO_SHORT", "DISPLAY_NAME_TOO_LONG", "DISPLAY_NAME_INVALID", "DISPLAY_NAME_RESERVED", "DISPLAY_NAME_INAPPROPRIATE", "DISPLAY_NAME_TAKEN", "DISPLAY_NAME_CHANGE_COOLDOWN"]) {
        assert.match(mutation, new RegExp(code));
        assert.match(settings, new RegExp(code));
    }
    assert.match(session, /p_account_id:\s*normalizedAccountId/);
    assert.match(mutation, /p_account_id:\s*authorization\.accountId/);
    assert.match(mutation, /displayNameChangedAt/);
    assert.match(mutation, /displayNameChangeAvailableAt/);
    assert.doesNotMatch(settings, /accountId|userId/);
    assert.match(settings, /value === savedDisplayName/);
    assert.match(settings, /displayNameChangeAvailableAt/);
    assert.match(settings, /renderDisplayNameCooldown\(/);
    assert.match(settings, /renderDisplayNameCooldown\(/);
    assert.match(settings, /notifyAuthChanged\(\)/);
    assert.match(settings, /DISPLAY_NAME_INAPPROPRIATE: "That display name isn't allowed/);
});

test("display-name mutation rejects browser-supplied account IDs before any Supabase call", async () => {
    const request = new Request("https://bpd-gaming-network.com/api/auth/account/profile", {
        method: "POST",
        headers: { origin: "https://bpd-gaming-network.com", "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Player Name", accountId: "attacker-selected-id" })
    });
    const response = await handleAccountMutation(request, {}, "profile");
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(Object.hasOwn(body, "accountId"), false);
});

test("all referenced image fallbacks exist and Steam does not request a missing icon", async () => {
    for (const path of [
        "public/Assets/images/bad_image/fallback.png",
        "public/Assets/images/framework_icons/google-symbol-white.png",
        "public/Assets/images/framework_icons/discord-symbol-white.png",
        "public/Assets/images/framework_icons/epic-symbol-white.svg"
    ]) assert.equal(existsSync(resolve(path)), true, `${path} is missing`);
    const login = await readFile(new URL("../../public/Global/Login/JS/index.js", import.meta.url), "utf8");
    const account = await readFile(new URL("../../public/Global/Account/JS/index.js", import.meta.url), "utf8");
    const banner = await readFile(new URL("../../public/Framework/Banner/JS/account_banner.js", import.meta.url), "utf8");
    const accountHtml = await readFile(new URL("../../public/Global/Account/HTML/index.html", import.meta.url), "utf8");
    assert.doesNotMatch(login + account + banner + accountHtml, /src=["']\/images\/bad_image\/fallback\.png|steam-symbol-white\.png/);
    assert.match(accountHtml, /account-provider__icon--text/);
});
