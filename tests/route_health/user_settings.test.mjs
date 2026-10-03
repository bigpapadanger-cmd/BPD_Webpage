import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { ROUTES } from "../../public/routes.js";
import { handleAccountMutation } from "../../functions/services/auth/account/mutations.js";

function createElement(value = "") {
    return {
        value,
        textContent: "",
        attributes: {},
        listeners: {},
        classList: {
            values: new Set(),
            toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); },
            contains(name) { return this.values.has(name); }
        },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        setAttribute(name, value) { this.attributes[name] = value; }
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
    const store = new Map([["bpdTheme", "purple"]]);
    const elements = {
        themeSetting: createElement(),
        animationSetting: createElement(),
        sidebarSetting: createElement(),
        resetSettings: createElement(),
        privacySettings: createElement(),
        privacySettingsStatus: createElement(),
        sidebar: createElement(),
        sidebarToggle: createElement()
    };
    globalThis.document = {
        body: { dataset: {}, classList: { toggle() {} } },
        getElementById(id) { return elements[id] || null; }
    };
    globalThis.localStorage = {
        getItem(key) { return store.get(key) ?? null; },
        setItem(key, value) { store.set(key, String(value)); }
    };
    const callback = () => {};
    const callbackQueue = [];
    globalThis.window = { googlefc: { callbackQueue, showRevocationMessage: callback } };

    try {
        const moduleUrl = pathToFileURL(resolve("public/Global/Settings/JS/settings.js"));
        moduleUrl.searchParams.set("test", String(Date.now()));
        const page = await import(moduleUrl.href);
        await page.initializePage();

        assert.equal(elements.themeSetting.value, "purple");
        assert.equal(document.body.dataset.theme, "purple");
        elements.themeSetting.value = "green";
        elements.themeSetting.listeners.change();
        assert.equal(store.get("bpdTheme"), "green");

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
    } finally {
        globalThis.document = originalDocument;
        globalThis.localStorage = originalStorage;
        globalThis.window = originalWindow;
    }
});

test("FAQ is curated static content and Suggestions remains a separate destination", async () => {
    const html = await readFile(new URL("../../public/Required/FAQ/HTML/index.html", import.meta.url), "utf8");
    const routes = await readFile(new URL("../../public/routes.js", import.meta.url), "utf8");
    const apiRoutes = await readFile(new URL("../../public/scripts/apiRoutes.js", import.meta.url), "utf8");
    assert.equal(ROUTES["/FAQ"].module, null);
    assert.doesNotMatch(html, /\/api\/faq(?:\/upvote)?/i);
    assert.match(html, /href="\/Suggestions"/);
    assert.doesNotMatch(routes + apiRoutes, /FAQ_API_URL|FAQ_UPVOTE_URL/);
    assert.equal(existsSync(resolve("public/Required/FAQ/JS/index.js")), false);
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
