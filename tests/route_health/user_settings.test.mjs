import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { ROUTES } from "../../public/routes.js";

function createElement(value = "") {
    return {
        value,
        textContent: "",
        attributes: {},
        listeners: {},
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
        privacySettingsStatus: createElement()
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
