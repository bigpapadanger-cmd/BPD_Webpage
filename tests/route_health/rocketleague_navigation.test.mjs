import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { ROUTES, resolveHumanPageRoute, getRocketLeagueSettingsContext, getRouteStyles } from "../../public/routes.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const publicRoot = resolve(repoRoot, "public");
const sidebarSource = readFileSync(resolve(publicRoot, "Framework/Shell/JS/Sidebar/sidebar.js"), "utf8");
// Exercise the actual shared functions without importing browser-root auth dependencies.
const setupActiveNavigation = new Function("resolveHumanPageRoute", "getRocketLeagueSettingsContext", "document", "window", `${sidebarSource.slice(
    sidebarSource.indexOf("function setupActiveNavigation()"), sidebarSource.indexOf("function setupDisabledNavigation()")
)}\nsetupActiveNavigation();`).bind(null, resolveHumanPageRoute, getRocketLeagueSettingsContext,
    { querySelectorAll: selector => globalThis.document.querySelectorAll(selector) },
    { get location() { return globalThis.window.location; } });

function htmlFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith(".html") ? [path] : [];
    });
}

test("UE6 is a public static opinion page without new external links or invented author views", () => {
    const route = ROUTES["/RocketLeague/UE6"];
    assert.equal(route.module, null); assert.equal(route.sitemap, true); assert.equal(route.auth, undefined);
    const html = readFileSync(resolve(publicRoot, route.body.slice(1)), "utf8");
    assert.match(html, /My perspective/); assert.match(html, /separate from official announcements/);
    assert.doesNotMatch(html, /href="https?:/);
    assert.doesNotMatch(html, /<script|<iframe/);
});

test("all local Rocket League links in public HTML resolve to registered pages", () => {
    const failures = [];
    for (const file of htmlFiles(publicRoot)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/href=["'](\/RocketLeague[^"']*)["']/g)) {
            const path = new URL(match[1], "https://bpd-gaming-network.com").pathname;
            if (!resolveHumanPageRoute(path)) failures.push(`${file.slice(publicRoot.length + 1)} -> ${path}`);
        }
    }
    assert.deepEqual(failures, []);
});

test("Rocket League destinations use the shared shell and route-specific access rules", () => {
    const menu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    for (const path of ["/RocketLeague/Shop", "/RocketLeague/MatchHistory", "/RocketLeague/Leaderboards", "/RocketLeague/MatchResults", "/RocketLeague/WeeklyMatches", "/RocketLeague/MyMatches", "/RocketLeague/PrivateMatches"]) {
        const route = ROUTES[path];
        assert.ok(route, `${path} has no route`);
        assert.equal(route.sidebar, "/Framework/Shell/HTML/Sidebar/rl_menu.html", `${path} does not use the Rocket League shell`);
        assert.ok(route.body.startsWith("/Tabs/RocketLeague/"), `${path} has a page outside the Rocket League area`);
        if (["/RocketLeague/Shop", "/RocketLeague/MatchHistory", "/RocketLeague/PrivateMatches"].includes(path)) {
            assert.match(menu, new RegExp(`href="${path.replaceAll("/", "\\/")}"`));
        }
    }
    assert.equal(ROUTES["/RocketLeague/Shop"].requiresAuth, undefined);
    assert.equal(ROUTES["/RocketLeague/Shop"].sitemap, true);
    assert.equal(ROUTES["/RocketLeague/MatchHistory"].requiresAuth, true);
    assert.deepEqual(ROUTES["/RocketLeague/MatchHistory"].auth, { required: true, provider: "epic", rocketLeague: true });
    assert.equal(ROUTES["/RocketLeague/WeeklyMatches"].requiresAuth, true);
    assert.match(menu, /href="\/RocketLeague\/WeeklyMatches"[^>]*[\s\S]*?data-auth="authenticated" data-rl-access="required" hidden/);
});

test("all three Rocket League dropdown groups use real controlled submenus", () => {
    const menu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    for (const group of ["player", "play", "community"]) {
        assert.match(menu, new RegExp(`aria-controls="${group}Submenu"`));
        assert.match(menu, new RegExp(`id="${group}Submenu"[\\s\\S]*?hidden`));
    }
    assert.match(menu, /href="\/RocketLeague\/MyProfile"[\s\S]*?data-rl-access="required"/);
    assert.doesNotMatch(menu, /competitionSubmenu|playersSubmenu|toolsSubmenu|Join Weekly Matches|Submit Scoreboard/);
});

test("RL-context Settings initializes the same sidebar access view without changing the saved preference", () => {
    assert.match(sidebarSource, /const rlSettings = path === "\/settings" && getRocketLeagueSettingsContext\(window\.location\.search\)/);
    assert.match(sidebarSource, /path\.startsWith\("\/rocketleague\/"\) \|\| rlSettings/);
    assert.match(sidebarSource, /module\.initializeRocketLeagueAuthView\(\)/);
});

test("homepage has one network statistics card with honest unavailable counters", () => {
    const home = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/HTML/index.html"), "utf8");
    assert.equal((home.match(/Rocket League by the Numbers/g) || []).length, 1);
    assert.doesNotMatch(home, /class="rocket-league-stat-strip"/);
    assert.equal((home.match(/id="rocketLeaguePlayersOnline"/g) || []).length, 1);
    assert.equal((home.match(/id="rocketLeagueRegisteredPlayers"/g) || []).length, 1);
    assert.match(home, /Unavailable figures are shown as —, not estimated/);
    assert.ok(home.indexOf("rocketLeagueMmrHistoryGraph") < home.indexOf("rocketLeagueStatisticsTitle"));
    assert.ok(home.indexOf("rocketLeagueStatisticsTitle") < home.indexOf("rocketLeagueWelcomeTitle"));
});

test("approved RL groups and bot link use the shared shell without eligibility side effects", () => {
    const menu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    for (const [group, labels] of [["player", ["My Profile", "Match History", "My Matches"]],
        ["play", ["Find Custom Matches", "Private Matches", "Weekly Matches"]],
        ["community", ["Find Players", "Shop", "Global Leaderboards", "Match Results", "Add Discord Bot"]]]) {
        const submenu = menu.match(new RegExp(`<div[^>]*id="${group}Submenu"[^>]*>([\\s\\S]*?)</div>`))?.[1];
        assert.ok(submenu);
        for (const label of labels) assert.ok(submenu.includes(label));
        if (group === "play") assert.ok(!submenu.includes("Find Players"));
    }
    const bot = menu.match(/<a[^>]*href="https:\/\/discord.com\/oauth2\/authorize\?client_id=1549606323249877034"[^>]*>Add Discord Bot<\/a>/)?.[0];
    assert.ok(bot);
    assert.match(bot, /target="_blank"/);
    assert.match(bot, /rel="noopener noreferrer"/);
    assert.doesNotMatch(bot, /data-router-link|onclick|data-auth|eligib/i);
    assert.doesNotMatch(menu, /<script|onclick|localStorage|fetch\(/);
    for (const [path, route] of Object.entries(ROUTES)) {
        if (path.startsWith("/RocketLeague") && route.sidebar) {
            assert.equal(route.sidebar, "/Framework/Shell/HTML/Sidebar/rl_menu.html", path);
        }
    }
});

test("Find Custom Matches retains the shared shell with its scoped durable lobby module", () => {
    const route = resolveHumanPageRoute("/RocketLeague/FindCustomMatches");
    assert.ok(route);
    assert.equal(ROUTES["/RocketLeague/FindCustomMatches"].module, "/Tabs/RocketLeague/CustomMatches/JS/index.js");
    const page = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/CustomMatches/HTML/index.html"), "utf8");
    assert.match(page, /Public matches/);
    assert.match(page, /id="cmCreateFields" disabled/);
    assert.doesNotMatch(page, /<script|fetch\(|<iframe/);
});

test("Settings RL context is explicit, survives direct loads and rejects unsafe return targets", () => {
    assert.equal(getRocketLeagueSettingsContext(""), null);
    assert.equal(getRocketLeagueSettingsContext("?context=admin"), null);
    const valid = getRocketLeagueSettingsContext("?context=rocketleague&returnTo=%2FRocketLeague%2FMyProfile");
    assert.equal(valid.sidebar, ROUTES["/RocketLeague/MyProfile"].sidebar);
    assert.equal(valid.returnPath, "/RocketLeague/MyProfile");
    for (const target of ["https://evil.invalid", "//evil.invalid", "/Admin", "/RocketLeagueFake", "/RocketLeague/Unknown", "/RocketLeague?secret=value"]) {
        assert.equal(getRocketLeagueSettingsContext(`?context=rocketleague&returnTo=${encodeURIComponent(target)}`).returnPath, "/RocketLeague");
    }
    const router = readFileSync(resolve(publicRoot, "Framework/Shell/JS/router.js"), "utf8");
    assert.match(router, /humanRoute.canonicalPath === "\/Settings" && getRocketLeagueSettingsContext\(window.location.search\)/);
    assert.match(router, /routePath === "\/Settings" && getRocketLeagueSettingsContext\(window.location.search\)/);
    const menu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    assert.match(menu, /data-settings-context="rocketleague"/);
    const caller = readFileSync(resolve(publicRoot, "Framework/Shell/CSS/Callers/master_rl.css"), "utf8");
    assert.doesNotMatch(caller, /@import url\("\/Global\/Settings\/CSS\/settings-page.css"\)/);
    assert.match(readFileSync(resolve(publicRoot, "routes.js"), "utf8"), /\/Global\/Settings\/CSS\/settings-page.css/);
});

test("Home is exact-only and non-clickable on the hub; submenu active state follows direct and SPA routes", () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    function item(route, home = false) {
        const attributes = new Map([["href", route], ...(home ? [["data-nav-exact", ""], ["data-disable-on-active", ""]] : [])]);
        return { dataset: { navRoute: route }, active: false,
            classList: { toggle(name, value) { if (name === "active") this.owner.active = value; }, owner: null },
            hasAttribute: name => attributes.has(name), getAttribute: name => attributes.get(name),
            setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) };
    }
    const items = [item("/RocketLeague", true), item("/RocketLeague/MyProfile"), item("/RocketLeague/MatchHistory"),
        item("/RocketLeague/FindPlayers"), item("/RocketLeague/FindCustomMatches"), item("/RocketLeague/PrivateMatches"), item("/RocketLeague/Shop"), item("/Settings")];
    items.at(-1).dataset.settingsContext = "rocketleague";
    items.forEach(element => { element.classList.owner = element; });
    try {
        globalThis.document = { querySelectorAll(selector) {
            if (selector === "#sidebar [data-sidebar-menu]") return [];
            assert.ok(selector.includes(".submenu-item[data-nav-route]")); return items;
        } };
        for (const selected of items) {
            globalThis.window = { location: { pathname: selected.dataset.navRoute,
                search: selected.dataset.navRoute === "/Settings" ? "?context=rocketleague&returnTo=%2FRocketLeague%2FShop" : "" } };
            setupActiveNavigation();
            assert.deepEqual(items.filter(element => element.active), [selected]);
            assert.equal(selected.getAttribute("aria-current"), "page");
            assert.equal(items[0].getAttribute("href"), selected === items[0] ? undefined : "/RocketLeague");
            assert.equal(new URL(items.at(-1).getAttribute("href"), "https://bpd-gaming-network.com").searchParams.get("returnTo"),
                selected.dataset.navRoute === "/Settings" ? "/RocketLeague/Shop" : selected.dataset.navRoute);
        }
    } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});

test("the public hub keeps incomplete profiles visible and offers an explicit setup notification", () => {
    const home = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/HTML/index.html"), "utf8");
    const auth = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/JS/auth.js"), "utf8");
    assert.equal(ROUTES["/RocketLeague"].requiresAuth, undefined);
    assert.match(home, /id="rocketLeagueProfileNotice"[\s\S]*?hidden/);
    assert.match(home, /href="\/RocketLeague\/Profile" data-router-link/);
    assert.match(auth, /profileNotice\.hidden = !\([\s\S]*?rocketLeagueSession\?\.profileLoaded === true[\s\S]*?!rocketLeagueAccess/);
    assert.doesNotMatch(auth, /redirectIncompleteHubProfile|shouldRedirectToRocketLeagueProfile/);
    assert.match(auth, /playerProfile\.hidden =\s*!authenticated\s*\|\| !epicLinked\s*\|\| !rocketLeagueAccess/);
    assert.match(home, /href="\/RocketLeague\/Profile"[\s\S]*?Complete profile/);
});

test("Rocket League fragment styles resolve through the master CSS caller", () => {
    const caller = readFileSync(resolve(publicRoot, "Framework/Shell/CSS/Callers/master_rl.css"), "utf8");
    for (const path of [
        "/Tabs/RocketLeague/FindPlayers/CSS/index.css",
        "/Tabs/RocketLeague/PublicProfile/CSS/index.css",
        "/Tabs/RocketLeague/MyProfile/CSS/index.css",
        "/Tabs/RocketLeague/Leaderboards/CSS/index.css",
        "/Tabs/RocketLeague/shared/featurePage.css",
        "/Tabs/RocketLeague/Shop/CSS/index.css"
    ]) assert.ok(readFileSync(resolve(publicRoot, "routes.js"), "utf8").includes(path), `${path} is not available through route-scoped styling`);

    for (const path of [
        "Tabs/RocketLeague/FindPlayers/HTML/index.html",
        "Tabs/RocketLeague/PublicProfile/HTML/index.html",
        "Tabs/RocketLeague/MyProfile/HTML/index.html"
    ]) {
        const html = readFileSync(resolve(publicRoot, path), "utf8");
        assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i, `${path} bypasses the CSS caller`);
        assert.doesNotMatch(html, /<!doctype|<html\b|<head\b|<body\b/i, `${path} is not a shell fragment`);
    }
});

test("Rocket League feature routes use page-owned shell fragments and existing route-scoped styles", () => {
    const paths = [["/RocketLeague/Shop", "Shop"], ["/RocketLeague/UE6", "UE6"], ["/RocketLeague/Leaderboards", "Leaderboards"],
        ["/RocketLeague/MatchHistory", "MatchHistory"], ["/RocketLeague/MatchResults", "MatchResults"],
        ["/RocketLeague/FindCustomMatches", "CustomMatches"], ["/RocketLeague/WeeklyMatches", "WeeklyMatches"],
        ["/RocketLeague/MyMatches", "MyMatches"], ["/RocketLeague/PrivateMatches", "PrivateMatches"]];
    for (const [routePath, pageFolder] of paths) {
        const route = ROUTES[routePath];
        const body = readFileSync(resolve(publicRoot, route.body.slice(1)), "utf8");
        assert.equal(route.body, `/Tabs/RocketLeague/${pageFolder}/HTML/index.html`, routePath);
        assert.doesNotMatch(body, /<!doctype|<html\b|<head\b|<body\b|<link\b|<script\b/i, `${routePath} must be a shell fragment`);
        const styles = getRouteStyles(routePath);
        assert.ok(styles.length > 0, `${routePath} has no route-scoped styling`);
        for (const style of styles) assert.ok(existsSync(resolve(publicRoot, style.slice(1))), `${routePath} missing ${style}`);
    }
    assert.equal(ROUTES["/RocketLeague/Leaderboards"].module, "/Tabs/RocketLeague/Leaderboards/JS/index.js");
    assert.equal(ROUTES["/RocketLeague/FindCustomMatches"].module, "/Tabs/RocketLeague/CustomMatches/JS/index.js");
});

test("Shop reads cached public data and Match History does not invent matches", () => {
    const shop = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Shop/HTML/index.html"), "utf8");
    const shopModule = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Shop/JS/index.js"), "utf8");
    const history = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/MatchHistory/HTML/index.html"), "utf8");
    assert.match(shop, /data-shop-items/);
    assert.match(shop, /does not sell items or make purchases/i);
    assert.match(shopModule, /boundedJson\("\/api\/rocketleague\/shop"/);
    assert.doesNotMatch(shopModule, /SUPABASE_AUTH|\/get-shop-data|Shops\/Get/);
    assert.match(history, /periodic snapshots, not individual matches/i);
    assert.equal(ROUTES["/RocketLeague/Shop"].body, "/Tabs/RocketLeague/Shop/HTML/index.html");
    assert.equal(ROUTES["/RocketLeague/Shop"].module, "/Tabs/RocketLeague/Shop/JS/index.js");
    assert.equal(ROUTES["/RocketLeague/MatchHistory"].module, null);
});

test("Rocket League home keeps snapshot language and the public home describes current tools", () => {
    const home = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/HTML/index.html"), "utf8");
    const mainMenu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Body/body.html"), "utf8");
    assert.match(home, /Last 90 captures/);
    assert.match(home, /do not represent individual matches/);
    assert.match(home, /normal page visit reads saved data and does not trigger a provider refresh/i);
    assert.match(mainMenu, /linked-player ranks, saved MMR changes/i);
    assert.match(mainMenu, /profile privacy, and\s+opt-in player discovery/i);
});

test("generated sitemap lists public Shop and Find Players but excludes private routes", () => {
    const sitemap = readFileSync(resolve(publicRoot, "sitemap.xml"), "utf8");
    assert.match(sitemap, /https:\/\/bpd-gaming-network\.com\/RocketLeague\/Shop/);
    assert.match(sitemap, /https:\/\/bpd-gaming-network\.com\/RocketLeague\/FindPlayers/);
    assert.doesNotMatch(sitemap, /\/RocketLeague\/(?:MyProfile|MatchHistory|Profile)(?:<|\/)/);
});


test("Match History remains capability-gated and cannot reinterpret MMR captures", () => {
    const route = ROUTES["/RocketLeague/MatchHistory"];
    assert.equal(route.requiresAuth, true);
    assert.deepEqual(route.auth, { required: true, provider: "epic", rocketLeague: true });
    assert.equal(route.module, null); assert.equal(route.sitemap, false);
    const html = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/MatchHistory/HTML/index.html"), "utf8");
    assert.match(html, /does not have authoritative match-by-match history/);
    assert.match(html, /periodic snapshots, not individual matches/);
    assert.doesNotMatch(html, /<script|data-match-id|data-match-timestamp/);
});
