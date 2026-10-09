import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initializeMobileSidebarDrawer, syncMobileSidebarDrawer } from "../../public/Framework/Shell/JS/Sidebar/mobile_drawer.js";
import { setSidebarCollapsed } from "../../public/Framework/Shell/JS/Sidebar/state.js";

function makeElement() {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set();
    return {
        attributes,
        dataset: {},
        hidden: false,
        inert: false,
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); },
            toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
        },
        addEventListener(name, handler) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(handler);
        },
        dispatch(name, event = {}) {
            for (const handler of listeners.get(name) || []) handler(event);
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
        closest(selector) { return selector.includes("[hidden]") ? null : null; },
        focus() { globalThis.document.activeElement = this; }
    };
}

test("mobile sidebar is an inert-background drawer with contained focus and safe close behavior", () => {
    const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
    const sidebar = makeElement();
    const toggle = makeElement();
    const backdrop = makeElement();
    const page = makeElement();
    const skip = makeElement();
    const siteContent = makeElement();
    const firstLink = makeElement();
    const lastLink = makeElement();
    const html = makeElement();
    const body = makeElement();
    const documentListeners = new Map();
    const stored = new Map();
    let mobile = true;
    sidebar.classList.remove("collapsed");
    sidebar.contains = element => [sidebar, toggle, firstLink, lastLink].includes(element);
    sidebar.querySelectorAll = () => [toggle, firstLink, lastLink];
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-controls", "sidebarNavigation");
    backdrop.hidden = true;
    page.inert = false;
    skip.inert = false;
    siteContent.focus = () => { globalThis.document.activeElement = siteContent; };

    globalThis.document = {
        activeElement: body,
        body,
        documentElement: html,
        getElementById(id) { return ({ sidebar, sidebarToggle: toggle, sidebarBackdrop: backdrop, siteContent }[id] || null); },
        querySelector(selector) { return selector === ".site-page" ? page : selector === ".skip-navigation" ? skip : null; },
        querySelectorAll() { return []; },
        addEventListener(name, handler) {
            if (!documentListeners.has(name)) documentListeners.set(name, []);
            documentListeners.get(name).push(handler);
        },
        dispatch(name, event) { for (const handler of documentListeners.get(name) || []) handler(event); }
    };
    globalThis.window = { innerWidth: 390, matchMedia: () => ({ matches: mobile }) };
    globalThis.localStorage = { setItem(key, value) { stored.set(key, value); } };

    try {
        initializeMobileSidebarDrawer();
        assert.equal(backdrop.hidden, false);
        assert.equal(sidebar.getAttribute("role"), "dialog");
        assert.equal(sidebar.getAttribute("aria-modal"), "true");
        assert.equal(page.inert, true);
        assert.equal(skip.inert, true);
        assert.equal(globalThis.document.activeElement, toggle);

        syncMobileSidebarDrawer();
        assert.equal(page.inert, true, "repeated route initialization must not lose the prior inert state");

        globalThis.document.activeElement = lastLink;
        let tabPrevented = false;
        globalThis.document.dispatch("keydown", { key: "Tab", shiftKey: false, preventDefault() { tabPrevented = true; } });
        assert.equal(tabPrevented, true);
        assert.equal(globalThis.document.activeElement, toggle);

        backdrop.dispatch("click");
        assert.equal(backdrop.hidden, true);
        assert.equal(sidebar.classList.contains("collapsed"), true);
        assert.equal(sidebar.getAttribute("aria-modal"), null);
        assert.equal(page.inert, false);
        assert.equal(skip.inert, false);
        assert.equal(stored.get("bpdSidebar"), "collapsed");

        setSidebarCollapsed(sidebar, toggle, false);
        syncMobileSidebarDrawer({ focusOnOpen: true });
        sidebar.dispatch("click", { target: { closest: () => ({}) } });
        assert.equal(backdrop.hidden, true);
        assert.equal(globalThis.document.activeElement, siteContent);

        setSidebarCollapsed(sidebar, toggle, false);
        mobile = false;
        assert.equal(syncMobileSidebarDrawer(), false);
        assert.equal(backdrop.hidden, true);
        assert.equal(page.inert, false);
    } finally {
        globalThis.document = prior.document;
        globalThis.window = prior.window;
        globalThis.localStorage = prior.localStorage;
    }
});

test("all sidebar variants connect the disclosure toggle to flexible labels and the mobile drawer", async () => {
    const htmlRoot = new URL("../../public/Framework/Shell/HTML/Sidebar/", import.meta.url);
    for (const name of ["mainmenu", "admin", "rl_menu"]) {
        const html = await readFile(new URL(`${name}.html`, htmlRoot), "utf8");
        assert.match(html, /id="sidebarToggle"[^>]*aria-controls="sidebarNavigation"/);
        assert.match(html, /id="sidebarNavigation"[^>]*class="sidebar-navigation/);
        assert.match(html, /class="nav-label"/);
    }
    const css = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/sidebar.css", import.meta.url), "utf8");
    assert.match(css, /\.site-sidebar \.nav-item\s*\{[\s\S]*?min-height:[\s\S]*?overflow:\s*visible/);
    assert.match(css, /\.site-sidebar \.nav-label\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(css, /body\.sidebar-collapsed \.site-sidebar \.sidebar-group-label,[\s\S]*?body\.sidebar-collapsed \.site-sidebar \.submenu-arrow\s*\{\s*display:\s*none/);
    assert.doesNotMatch(css.match(/\.site-sidebar\s*\{([^}]+)\}/)?.[1] || "", /transition:[\s\S]*?width/);
    assert.match(css, /\.sidebar-backdrop:not\(\[hidden\]\)[\s\S]*?z-index:\s*99/);
    const rlCss = await readFile(new URL("../../public/Framework/Shell/CSS/Sidebar/rl_AuthSidebar.css", import.meta.url), "utf8");
    assert.match(rlCss, /\.sidebar-view-rocketleague \.submenu-item\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/);
});
