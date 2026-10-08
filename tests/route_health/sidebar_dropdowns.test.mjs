import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarRoot = new URL("../../public/Framework/Shell/HTML/Sidebar/", import.meta.url);
const cssPath = new URL("../../public/Framework/Shell/CSS/Sidebar/sidebar.css", import.meta.url);

for (const [file, groupIds] of [["admin.html", ["adminOperationsSubmenu", "adminReviewSubmenu", "adminSystemSubmenu"]],
    ["rl_menu.html", ["playerSubmenu", "playSubmenu", "communitySubmenu"]]]) {
    test(`${file} dropdown buttons expose controlled, initially hidden submenu groups`, async () => {
        const html = await readFile(new URL(file, sidebarRoot), "utf8");
        for (const id of groupIds) {
            const button = html.match(new RegExp(`<button[^>]*aria-controls="${id}"[\\s\\S]*?</button>`))?.[0];
            const submenu = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0];
            assert.ok(button, `${id} has a toggle button`);
            assert.match(button, /aria-expanded="false"/);
            assert.ok(submenu, `${id} exists`);
            assert.match(submenu, /role="group"/);
            assert.match(submenu, /aria-label=/);
            assert.match(submenu, /hidden/);
        }
    });
}

test("shared sidebar stylesheet gives dropdown links readable states and preserves hidden semantics", async () => {
    const css = await readFile(cssPath, "utf8");
    assert.match(css, /\.site-sidebar \.sidebar-submenu\s*\{[\s\S]*?display:\s*flex/);
    assert.match(css, /\.site-sidebar \.sidebar-submenu\[hidden\]\s*\{\s*display:\s*none !important/);
    assert.match(css, /\.site-sidebar \.submenu-item:hover,[\s\S]*?\.site-sidebar \.submenu-item:focus-visible/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.site-sidebar \.sidebar-submenu\s*\{\s*animation:\s*none/);
});
