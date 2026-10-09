import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTES, getPageMetadata } from "../../public/routes.js";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, ".wrangler/public-build");
test("built browser modules retain route metadata and public projections", { skip: !existsSync(output) }, async () => {
    const builtRoutes = await import("../../.wrangler/public-build/routes.js");
    assert.deepEqual(builtRoutes.ROUTES, ROUTES);
    for (const path of Object.keys(ROUTES)) assert.deepEqual(builtRoutes.getPageMetadata(path), getPageMetadata(path));
    const builtView = await import("../../.wrangler/public-build/Tabs/RocketLeague/CustomMatches/JS/view.js");
    assert.deepEqual(builtView.basicLifecycleActions({ match: { state: "open" }, actor: { isHost: false } }), []);
    assert.equal(typeof builtView.renderRounds, "function");
});
test("built CSS callers flatten imports and retain root asset URLs", { skip: !existsSync(output) }, () => {
    for (const name of ["master", "master_rl", "master_admin", "master_mc", "master_ark"]) {
        const css = readFileSync(resolve(output, `Framework/Shell/CSS/Callers/${name}.css`), "utf8");
        assert.doesNotMatch(css, /@import/); assert.match(css, /\.site-content/); assert.match(css, /prefers-reduced-motion/);
        for (const [, url] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
            if (/^(https?:|data:|#)/.test(url)) continue;
            assert.ok(url.startsWith("/"), url);
            assert.ok(existsSync(resolve(output, "." + url.split(/[?#]/)[0])), url);
        }
    }
});
test("shell document keeps parser-blocking scripts out of the route-loading path", () => {
    const html = readFileSync(resolve(root, "public/index.html"), "utf8");
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html\b[^>]*\blang=["']en["']/i);
    assert.match(html, /<meta\b[^>]*name=["']viewport["']/i);
    assert.match(html, /<main\b[^>]*id=["']siteContent["']/i);
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
    assert.ok(scripts.length > 0);
    for (const [, attributes] of scripts) {
        assert.match(attributes, /\b(?:async|defer)\b|\btype=["']module["']/i,
            "shell scripts must be async, deferred, or JavaScript modules");
    }
});
test("sitemap follows public route metadata and excludes private routes and aliases", () => {
    const xml = readFileSync(resolve(root, "public/sitemap.xml"), "utf8");
    const paths = [...xml.matchAll(/<loc>https:\/\/bpd-gaming-network\.com([^<]+)<\/loc>/g)].map(match => match[1]);
    const expected = Object.entries(ROUTES).filter(([path, config]) => config.sitemap === true && !config.redirectTo && getPageMetadata(path).robots === "index, follow").map(([path]) => path).sort();
    assert.deepEqual(paths.sort(), expected);
    assert.ok(paths.includes("/RocketLeague/UE6"));
    assert.equal(getPageMetadata("/RocketLeague/UE6").robots, "index, follow");
    assert.equal(getPageMetadata("/Admin").robots, "noindex, nofollow");
});
