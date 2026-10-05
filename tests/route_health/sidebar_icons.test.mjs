import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SIDEBAR_ICONS, initializeSidebarIcons } from "../../public/Framework/Shell/JS/Sidebar/icons.js";

test("all sidebar variants use valid shared artwork keys without inline copies", async () => {
    for (const name of ["mainmenu", "dashboard", "admin", "rl_menu"]) {
        const html = await readFile(new URL(`../../public/Framework/Shell/HTML/Sidebar/${name}.html`, import.meta.url), "utf8");
        const slots = [...html.matchAll(/<span class="(?:nav-icon|submenu-arrow)"([^>]*)>([\s\S]*?)<\/span>/g)];
        assert.ok(slots.length > 0, name);
        for (const [, attributes, content] of slots) {
            const key = attributes.match(/data-sidebar-icon="([^"]+)"/)?.[1];
            assert.ok(Object.hasOwn(SIDEBAR_ICONS, key), `${name}: ${key}`);
            assert.match(attributes, /aria-hidden="true"/);
            assert.equal(content.trim(), "");
        }
    }
});

test("shared artwork initializes repeated slots safely on every sidebar load", () => {
    const nodes = ["settings", "settings", "dashboard", "toString", "unknown"].map(key => ({
        dataset: { sidebarIcon: key }, textContent: "old", attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
    }));
    const root = { querySelectorAll(selector) { assert.equal(selector, "[data-sidebar-icon]"); return nodes; } };
    initializeSidebarIcons(null);
    initializeSidebarIcons(root);
    initializeSidebarIcons(root);
    assert.deepEqual(nodes.map(node => node.textContent), ["⚙️", "⚙️", "📊", "", ""]);
    assert.ok(nodes.every(node => node.attributes["aria-hidden"] === "true"));
});

test("RL Dashboard return link uses existing SPA navigation and shared icon", async () => {
    const html = await readFile(new URL("../../public/Framework/Shell/HTML/Sidebar/rl_menu.html", import.meta.url), "utf8");
    assert.match(html, /<a href="\/Dashboard"[^>]*data-router-link[^>]*data-nav-route="\/Dashboard"[\s\S]*?data-sidebar-icon="dashboard"/);
    const source = await readFile(new URL("../../public/Framework/Shell/JS/Sidebar/sidebar.js", import.meta.url), "utf8");
    assert.match(source, /function initializeCriticalSidebar\(\)\s*\{\s*initializeSidebarIcons\(document.getElementById\("sidebar"\)\)/);
});
