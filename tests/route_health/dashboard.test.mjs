import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ROUTES } from "../../public/routes.js";

test("public main menu and personal dashboard use distinct content", async () => {
    const mainMenu = await readFile(new URL("../../public/Framework/Shell/HTML/Body/body.html", import.meta.url), "utf8");
    const dashboard = await readFile(new URL("../../public/Global/Index/HTML/home.html", import.meta.url), "utf8");
    const dashboardModule = await readFile(new URL("../../public/Global/Index/JS/index.js", import.meta.url), "utf8");

    assert.equal(ROUTES["/"].body, "/Framework/Shell/HTML/Body/body.html");
    assert.equal(ROUTES["/Dashboard"].body, "/Global/Index/HTML/home.html");
    assert.match(mainMenu, /Main Menu/);
    assert.match(dashboard, /Your dashboard/);
    assert.match(dashboard, /Account overview/);
    assert.doesNotMatch(dashboard, /WELCOME TO|Future/);
    assert.match(dashboardModule, /getAuthState/);
    assert.match(dashboardModule, /hasActiveAccount/);
    assert.match(dashboard, /dashboardUpdatesList/);
    assert.match(dashboardModule, /bpd:notifications-updated/);
    assert.match(dashboardModule, /bpd:notifications-refresh/);
    assert.doesNotMatch(dashboardModule, /fetch\(/);
});

test("Admin Match Management resolves to a guarded placeholder page", async () => {
    const route = ROUTES["/Admin/MatchManagement"];
    const html = await readFile(new URL(`../../public${route.body}`, import.meta.url), "utf8");
    const module = await readFile(new URL(`../../public${route.module}`, import.meta.url), "utf8");
    assert.equal(route.requiresAuth, true);
    assert.equal(route.sitemap, false);
    assert.match(html, /This page has not been developed yet\./);
    assert.match(module, /hasAdminAccess\(state\)/);
    assert.match(module, /Admin access could not be verified\./);
});

test("Admin shortcut on the main menu stays hidden until server authorization", async () => {
    const mainMenu = await readFile(new URL("../../public/Framework/Shell/HTML/Body/body.html", import.meta.url), "utf8");
    const sidebar = await readFile(new URL("../../public/Framework/Shell/HTML/Sidebar/mainmenu.html", import.meta.url), "utf8");
    const authorization = await readFile(new URL("../../public/Framework/Shell/JS/Sidebar/admin_navigation.js", import.meta.url), "utf8");

    assert.match(mainMenu, /id="adminHomeCard"[\s\S]*?href="\/Admin"[\s\S]*?hidden/);
    assert.match(sidebar, /id="adminNavItem"[\s\S]*?href="\/Admin"[\s\S]*?hidden/);
    assert.match(authorization, /hasAdminAccess\(authState\)/);
    assert.match(authorization, /peekAuthState\(\)/);
    assert.doesNotMatch(authorization, /fetch\(/);
    assert.match(authorization, /setAdminNavigationVisible\(item, true\)/);
});

test("dashboard stylesheet is included only as scoped dashboard styling", async () => {
    const master = await readFile(new URL("../../public/Framework/Shell/CSS/Callers/master.css", import.meta.url), "utf8");
    const dashboardCss = await readFile(new URL("../../public/Global/Index/CSS/dashboard.css", import.meta.url), "utf8");

    assert.doesNotMatch(master, /\/Global\/Index\/CSS\/dashboard\.css/);
    const routes = await readFile(new URL("../../public/routes.js", import.meta.url), "utf8");
    assert.match(routes, /\/Global\/Index\/CSS\/dashboard\.css/);
    assert.match(dashboardCss, /\.user-dashboard/);
    assert.doesNotMatch(dashboardCss, /\.home-page\s*\{/);
});
