import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { ROUTES, buildHumanPageRouteIndex, resolveHumanPageRoute } from "../../public/routes.js";
import {
    PAGE_ROUTE_INVENTORY,
    API_ROUTE_INVENTORY,
    WORKER_ROUTE_INVENTORY,
    WORKER_SCHEDULE_INVENTORY,
    WORKER_QUEUE_INVENTORY
} from "../../functions/services/admin/generatedApiRouteInventory.js";
import { onRequest as routeRequest } from "../../functions/[[path]].js";
import { buildRouteHealthPayload, onRequestGet } from "../../functions/api/admin/page-settings/route-health.js";

const repoRoot = resolve(import.meta.dirname, "../..");

test("registered page targets exist and have lowercase lookup keys", () => {
    for (const [path, config] of Object.entries(ROUTES)) {
        assert.ok(resolveHumanPageRoute(path)?.canonicalPath === path, `${path} does not retain its canonical route`);
        for (const target of [config.body, config.header, config.sidebar, config.footer, config.module].filter(Boolean)) {
            assert.ok(existsSync(resolve(repoRoot, "public", `.${target}`)), `${path} target missing: ${target}`);
        }
    }
    assert.equal(PAGE_ROUTE_INVENTORY.length, Object.keys(ROUTES).length);
    for (const page of PAGE_ROUTE_INVENTORY) {
        assert.equal(page.lookupKey, page.path.toLowerCase());
        assert.equal(page.healthStatus, "registered");
        assert.ok(page.targets.every((target) => target.exists), `${page.path} has a missing generated target`);
    }
});

test("Rocket League setup and established My Profile routes stay distinct and gated", () => {
    const setup = ROUTES["/RocketLeague/Profile"];
    const mine = ROUTES["/RocketLeague/MyProfile"];
    assert.equal(setup.requiresAuth, true);
    assert.equal(setup.sidebar, null);
    assert.equal(setup.sitemap, false);
    assert.equal(mine.requiresAuth, true);
    assert.deepEqual(mine.auth, { required: true, provider: "epic", rocketLeague: true });
    assert.equal(mine.sidebar, "/Framework/Shell/HTML/Sidebar/rl_menu.html");
    assert.equal(mine.sitemap, false);
    assert.notEqual(mine.body, setup.body);
    assert.notEqual(mine.module, setup.module);
    assert.match(mine.body, /MyProfile/u);
    assert.match(mine.module, /MyProfile/u);

    const registration = readFileSync(resolve(repoRoot, "public/Tabs/RocketLeague/Registration/JS/index.js"), "utf8");
    const myProfile = readFileSync(resolve(repoRoot, "public", `.${mine.module}`), "utf8");
    const sidebar = readFileSync(resolve(repoRoot, "public/Framework/Shell/JS/Sidebar/RocketLeague/sidebar_auth.js"), "utf8");
    const menu = readFileSync(resolve(repoRoot, "public/Framework/Shell/HTML/Sidebar/rl_menu.html"), "utf8");
    assert.match(registration, /isSetupRoute && profileComplete && rocketLeagueAccess/);
    assert.match(myProfile, /ROCKET_LEAGUE_PROFILE_URL/);
    assert.match(myProfile, /profileComplete !== true \|\| result\.rocketLeagueAccess !== true/);
    assert.match(sidebar, /profileComplete && rocketLeagueAccess/);
    assert.match(menu, /href="\/RocketLeague\/MyProfile"[\s\S]*?data-rl-access="required"/);
});

test("generated API inventory is complete, exact-case, and points to real handlers", () => {
    const paths = new Set();
    for (const route of API_ROUTE_INVENTORY) {
        assert.equal(route.routeType, "api");
        assert.equal(route.casePolicy, "exact");
        assert.equal(route.healthStatus, route.methods.length > 0 ? "valid" : "missing-handler");
        assert.ok(!paths.has(route.path), `${route.path} appears more than once`);
        paths.add(route.path);
        assert.ok(existsSync(resolve(repoRoot, route.handler)), `${route.handler} is missing`);
    }
    assert.ok(API_ROUTE_INVENTORY.some((route) => route.path === "/api/admin/page-settings/route-health"));
    assert.ok(API_ROUTE_INVENTORY.some((route) => route.path === "/api/suggestions" && route.methods.includes("GET") && route.methods.includes("POST")));
    assert.ok(API_ROUTE_INVENTORY.some((route) => route.path === "/api/suggestions/:suggestionId/vote"));
    assert.ok(API_ROUTE_INVENTORY.some((route) => route.path === "/api/admin/suggestions/:suggestionId/review"));
    assert.equal(API_ROUTE_INVENTORY.find((route) => route.path === "/api/auth/discord/callback")?.healthStatus, "missing-handler");
});

test("Worker endpoints, schedules, and queue consumers are inventoried from their Wrangler configs", () => {
    assert.ok(WORKER_ROUTE_INVENTORY.some((route) => route.path === "https://status.bpd-gaming-network.com/health"));
    assert.ok(WORKER_ROUTE_INVENTORY.some((route) => route.path === "https://status.bpd-gaming-network.com/wake" && route.authRequired === true));
    assert.equal(WORKER_SCHEDULE_INVENTORY.length, 4);
    assert.deepEqual(WORKER_QUEUE_INVENTORY.map((queue) => queue.path), ["queue: bpd-ocr-jobs"]);
    for (const surface of [...WORKER_ROUTE_INVENTORY, ...WORKER_SCHEDULE_INVENTORY, ...WORKER_QUEUE_INVENTORY]) {
        assert.ok(existsSync(resolve(repoRoot, surface.handler)), `${surface.handler} is missing`);
    }
});

test("human page lookup keeps canonical TitleCase route and rejects collisions", () => {
    assert.equal(resolveHumanPageRoute("/rOcKeTlEaGuE/profile/")?.canonicalPath, "/RocketLeague/Profile");
    assert.throws(() => buildHumanPageRouteIndex({ "/About": {}, "/about": {} }), /route collision/i);
});

test("Pages route handler canonicalizes only registered human routes and preserves query", async () => {
    let rewrittenRequest;
    const response = await routeRequest({
        request: new Request("https://example.test/rOcKeTlEaGuE?tab=stats&x=1"),
        next: async (request) => {
            rewrittenRequest = request;
            return new Response("shell");
        }
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), "https://example.test/RocketLeague?tab=stats&x=1");

    const canonicalResponse = await routeRequest({
        request: new Request("https://example.test/RocketLeague?tab=stats"),
        next: async (request) => {
            rewrittenRequest = request;
            return new Response("shell");
        }
    });
    assert.equal(canonicalResponse.status, 200);
    assert.equal(new URL(rewrittenRequest.url).pathname, "/");
    assert.equal(new URL(rewrittenRequest.url).search, "?tab=stats");
});

test("unknown routes, APIs, and case-sensitive assets pass through unchanged", async () => {
    for (const path of ["/NoSuchPage", "/API/auth/login", "/Assets/Logo.png", "/api/auth/login"]) {
        let nextCalled = false;
        await routeRequest({
            request: new Request(`https://example.test${path}`),
            next: async () => {
                nextCalled = true;
                return new Response("next");
            }
        });
        assert.equal(nextCalled, true);
    }
});

test("favicon uses an existing local logo target", async () => {
    const response = await routeRequest({
        request: new Request("https://example.test/favicon.ico"),
        next: async () => new Response(null, { status: 404 })
    });
    assert.equal(response.status, 308);
    assert.match(response.headers.get("Location"), /\/Assets\/logo\/gaming_network_logo_128px\.png$/);
    assert.ok(existsSync(resolve(repoRoot, "public/Assets/logo/gaming_network_logo_128px.png")));
});

test("route-health diagnostics report binding presence only and no credential values", () => {
    const payload = buildRouteHealthPayload({ OCR_API_KEY: "do-not-return", SUPABASE_AUTH: "secret-value", OCR_STORAGE: {} }, "test-time");
    const serialized = JSON.stringify(payload);
    assert.equal(payload.readOnly, true);
    assert.equal(payload.generatedAt, "test-time");
    assert.ok(payload.routes.some((route) => route.path === "/Admin/PageSettings" && route.authRequired));
    assert.ok(payload.routes.some((route) => route.path === "/Settings" && !route.authRequired));
    assert.ok(payload.routes.some((route) => route.path === "/Suggestions" && !route.authRequired));
    assert.ok(payload.routes.some((route) => route.path === "/Admin/SuggestionReview" && route.authRequired));
    assert.doesNotMatch(serialized, /\/api\/faq(?:\/upvote)?/);
    assert.doesNotMatch(serialized, /do-not-return|secret-value/);
    assert.equal(payload.connections.find((item) => item.name === "OCR storage").status, "Configured");
});

test("Page Settings API is protected and returns generic auth failure", async () => {
    const response = await onRequestGet({ request: new Request("https://example.test/api/admin/page-settings/route-health"), env: {} });
    assert.ok([401, 403, 503].includes(response.status));
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal("connections" in body, false);
    assert.equal("routes" in body, false);
});

test("public Suggestions is indexable while Admin review remains out of the sitemap", () => {
    const sitemap = readFileSync(resolve(repoRoot, "public/sitemap.xml"), "utf8");
    assert.match(sitemap, /https:\/\/bpd-gaming-network\.com\/Settings/);
    assert.match(sitemap, /https:\/\/bpd-gaming-network\.com\/Suggestions/);
    assert.doesNotMatch(sitemap, /Admin\/SuggestionReview|Admin\/PageSettings/);
});
