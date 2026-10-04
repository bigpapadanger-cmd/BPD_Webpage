import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { ROUTES, resolveHumanPageRoute } from "../../public/routes.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const publicRoot = resolve(repoRoot, "public");

function htmlFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith(".html") ? [path] : [];
    });
}

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
        assert.match(menu, new RegExp(`href="${path.replaceAll("/", "\\/")}"`));
    }
    assert.equal(ROUTES["/RocketLeague/Shop"].requiresAuth, undefined);
    assert.equal(ROUTES["/RocketLeague/Shop"].sitemap, true);
    assert.equal(ROUTES["/RocketLeague/MatchHistory"].requiresAuth, true);
    assert.deepEqual(ROUTES["/RocketLeague/MatchHistory"].auth, { required: true, provider: "epic", rocketLeague: true });
});

test("all three Rocket League dropdown groups use real controlled submenus", () => {
    const menu = readFileSync(resolve(publicRoot, "Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    for (const group of ["competition", "players", "tools"]) {
        assert.match(menu, new RegExp(`aria-controls="${group}Submenu"`));
        assert.match(menu, new RegExp(`id="${group}Submenu"[\\s\\S]*?hidden`));
    }
    assert.match(menu, /href="\/RocketLeague\/WeeklyMatches"[\s\S]*?data-rl-access="required"/);
    assert.match(menu, /href="\/RocketLeague\/SubmitMatchResults"[\s\S]*?data-rl-access="required"/);
});

test("the public hub keeps incomplete profiles visible and offers an explicit setup notification", () => {
    const home = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/HTML/index.html"), "utf8");
    const auth = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Index/JS/auth.js"), "utf8");
    assert.equal(ROUTES["/RocketLeague"].requiresAuth, undefined);
    assert.match(home, /id="rocketLeagueProfileNotice"[\s\S]*?hidden/);
    assert.match(home, /href="\/RocketLeague\/Profile" data-router-link/);
    assert.match(auth, /profileNotice\.hidden = !\([\s\S]*?rocketLeagueSession\?\.profileLoaded === true[\s\S]*?!rocketLeagueAccess/);
    assert.doesNotMatch(auth, /redirectIncompleteHubProfile|shouldRedirectToRocketLeagueProfile/);
    assert.match(auth, /playerProfile\.hidden =\s*!authenticated\s*\|\| !epicLinked\s*\|\| !epicAuthorized\s*\|\| !rocketLeagueAccess/);
    assert.match(home, /href="\/RocketLeague\/Profile"[\s\S]*?Complete profile/);
});

test("Rocket League fragment styles resolve through the master CSS caller", () => {
    const caller = readFileSync(resolve(publicRoot, "Framework/Shell/CSS/Callers/master_rl.css"), "utf8");
    for (const path of [
        "/Tabs/RocketLeague/FindPlayers/CSS/index.css",
        "/Tabs/RocketLeague/PublicProfile/CSS/index.css",
        "/Tabs/RocketLeague/MyProfile/CSS/index.css",
        "/Tabs/RocketLeague/Features/CSS/index.css"
    ]) assert.ok(caller.includes(path), `${path} is not loaded by master_rl.css`);

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

test("Shop reads cached public data and Match History does not invent matches", () => {
    const shop = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Features/HTML/shop.html"), "utf8");
    const shopModule = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Features/JS/shop.js"), "utf8");
    const history = readFileSync(resolve(publicRoot, "Tabs/RocketLeague/Features/HTML/match-history.html"), "utf8");
    assert.match(shop, /data-shop-items/);
    assert.match(shop, /does not sell items or make purchases/i);
    assert.match(shopModule, /fetch\("\/api\/rocketleague\/shop"/);
    assert.doesNotMatch(shopModule, /SUPABASE_AUTH|\/get-shop-data|Shops\/Get/);
    assert.match(history, /periodic snapshots, not individual matches/i);
    assert.equal(ROUTES["/RocketLeague/Shop"].module, "/Tabs/RocketLeague/Features/JS/shop.js");
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
