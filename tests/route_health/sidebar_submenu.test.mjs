import assert from "node:assert/strict";
import test from "node:test";

import { initializeSidebarSubmenus } from "../../public/Framework/Shell/JS/Sidebar/submenu.js";

function createElement() {
    const listeners = new Map();
    const attributes = new Map();
    return {
        dataset: {},
        hidden: false,
        classList: {
            values: new Set(),
            toggle(name, force) {
                if (force) this.values.add(name);
                else this.values.delete(name);
            },
            contains(name) { return this.values.has(name); }
        },
        addEventListener(name, handler) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(handler);
        },
        dispatch(name, event = {}) {
            for (const handler of listeners.get(name) || []) handler(event);
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) ?? null; }
    };
}

function setupSidebar() {
    const button = createElement();
    const secondButton = createElement();
    const submenu = createElement();
    const secondSubmenu = createElement();
    const sidebar = createElement();
    const sidebarToggle = createElement();
    const body = createElement();
    const documentListeners = new Map();
    button.setAttribute("aria-controls", "testSubmenu");
    button.setAttribute("aria-expanded", "false");
    secondButton.setAttribute("aria-controls", "secondSubmenu");
    secondButton.setAttribute("aria-expanded", "false");
    submenu.hidden = true;
    secondSubmenu.hidden = true;
    sidebar.classList.values.add("collapsed");
    body.classList.values.add("sidebar-collapsed");
    body.dataset.sidebar = "collapsed";

    const elements = { sidebar, sidebarToggle, testSubmenu: submenu, secondSubmenu };
    globalThis.document = {
        body,
        getElementById(id) { return elements[id] || null; },
        addEventListener(name, handler) {
            if (!documentListeners.has(name)) documentListeners.set(name, []);
            documentListeners.get(name).push(handler);
        },
        querySelectorAll() { return [button, secondButton]; },
        dispatch(name, event) {
            for (const handler of documentListeners.get(name) || []) handler(event);
        }
    };
    sidebar.querySelectorAll = () => [button, secondButton];
    sidebar.dispatch = (name, event = {}) => {
        for (const handler of listenersForSidebar(name)) handler(event);
    };
    const sidebarListeners = new Map();
    sidebar.addEventListener = (name, handler) => {
        if (!sidebarListeners.has(name)) sidebarListeners.set(name, []);
        sidebarListeners.get(name).push(handler);
    };
    function listenersForSidebar(name) { return sidebarListeners.get(name) || []; }
    globalThis.localStorage = { getItem: () => "collapsed" };
    initializeSidebarSubmenus();
    return { button, secondButton, submenu, secondSubmenu, sidebar, sidebarToggle, body, document: globalThis.document };
}

const sidebarState = setupSidebar();

test("collapsed-sidebar submenu expands temporarily and restores state on outside click and Escape", () => {
    const { button, submenu, sidebar, body, document } = sidebarState;
    button.dispatch("click", { stopPropagation() {} });

    assert.equal(submenu.hidden, false);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(sidebar.classList.contains("collapsed"), false);
    assert.equal(body.dataset.sidebarTemporaryExpanded, "true");
    assert.equal(localStorage.getItem("bpdSidebar"), "collapsed");
    document.dispatch("click", { target: { closest: () => null } });

    assert.equal(submenu.hidden, true);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(sidebar.classList.contains("collapsed"), true);
    assert.equal(body.dataset.sidebar, "collapsed");
    assert.equal(body.dataset.sidebarTemporaryExpanded, undefined);

    button.dispatch("click", { stopPropagation() {} });
    document.dispatch("keydown", { key: "Escape" });

    assert.equal(submenu.hidden, true);
    assert.equal(sidebar.classList.contains("collapsed"), true);
});

test("switching collapsed sidebar dropdowns keeps the exact new group open until submenu navigation", () => {
    const { button, secondButton, submenu, secondSubmenu, sidebar, body } = sidebarState;
    button.dispatch("click", { stopPropagation() {} });
    secondButton.dispatch("click", { stopPropagation() {} });

    assert.equal(submenu.hidden, true);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(secondSubmenu.hidden, false);
    assert.equal(secondButton.getAttribute("aria-expanded"), "true");
    assert.equal(sidebar.classList.contains("collapsed"), false);
    assert.equal(localStorage.getItem("bpdSidebar"), "collapsed");

    sidebar.dispatch("click", { target: { closest: selector => selector === ".sidebar-submenu .submenu-item" ? {} : null } });
    assert.equal(secondSubmenu.hidden, true);
    assert.equal(secondButton.getAttribute("aria-expanded"), "false");
    assert.equal(sidebar.classList.contains("collapsed"), true);
    assert.equal(body.dataset.sidebarTemporaryExpanded, undefined);
    assert.equal(localStorage.getItem("bpdSidebar"), "collapsed");
});
