import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { sanitizeLogMetadata } from "../../functions/services/http/diagnostics.js";
import { onRequest as secure } from "../../functions/_middleware.js";
import { faqRequest } from "../../public/Required/FAQ/JS/shared.js";
import { ROUTES, getPageMetadata } from "../../public/routes.js";

test("legacy logging permits operational fields and rejects secret-bearing payloads/errors/IDs", () => {
    const secret = "private@example.test bearer-secret 11111111-1111-4111-8111-111111111111";
    const debugId = "22222222-2222-4222-8222-222222222222";
    const fields = { debugId, status: 503, elapsedMs: 50, timeout: true, provider: "epic", code: "KNOWN_FAILURE",
        accountId: secret, requestedAccountId: secret, rlPlayerId: secret, message: secret, stack: secret,
        response: { email: secret, token: secret }, result: { userId: secret }, Authorization: secret,
        cookie: secret, service_role: secret, arbitrary: secret, upstreamCode: secret };
    assert.deepEqual(sanitizeLogMetadata(fields, ["KNOWN_FAILURE"]), {
        debugId, status: 503, elapsedMs: 50, timeout: true, provider: "epic", code: "KNOWN_FAILURE", upstreamCode: "UNRECOGNIZED_ERROR"
    });
    assert.equal(JSON.stringify(sanitizeLogMetadata(fields)).includes(secret), false);
    assert.deepEqual(sanitizeLogMetadata({ status: "private", debugId: "private", elapsedMs: -1, provider: secret }), {});
    assert.deepEqual(sanitizeLogMetadata(null), {});
});

test("security staging matches static/Function policies without enforcing Trusted Types or preload", async () => {
    const response = await secure({ request: new Request("https://bpd.example/FAQ"), next: async () => new Response("page") });
    const policy = response.headers.get("Content-Security-Policy-Report-Only");
    assert.match(policy, /object-src 'none'/); assert.match(policy, /require-trusted-types-for 'script'/);
    assert.equal(response.headers.has("Content-Security-Policy"), false);
    assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=300");
    const staticHeaders = await readFile("public/_headers", "utf8");
    assert.ok(staticHeaders.includes(`Content-Security-Policy-Report-Only: ${policy}`));
    assert.ok(staticHeaders.includes("Strict-Transport-Security: max-age=300"));
    assert.doesNotMatch(response.headers.get("Strict-Transport-Security"), /preload|includeSubDomains/);
    const local = await secure({ request: new Request("http://localhost/FAQ"), next: async () => new Response("page") });
    assert.equal(local.headers.has("Strict-Transport-Security"), false);
});

test("FAQ deadline includes stalled body decoding even when transport ignores abort", async t => {
    const originalFetch = globalThis.fetch;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
    try {
        const pending = faqRequest("/api/faq");
        const rejected = assert.rejects(pending, /timed out/i);
        await Promise.resolve(); t.mock.timers.tick(12000); await rejected;
    } finally { globalThis.fetch = originalFetch; t.mock.timers.reset(); }
});

test("FAQ successful/failed responses preserve its existing sanitized browser contract", async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (_url, options) => {
            assert.equal(options.cache, "no-store"); assert.equal(options.credentials, "same-origin");
            return Response.json({ success: true, faqs: [] });
        };
        assert.deepEqual(await faqRequest("/api/faq"), { success: true, faqs: [] });
        globalThis.fetch = async () => Response.json({ success: false, error: "FAQ_UNAVAILABLE", message: "FAQ services are temporarily unavailable. Please retry." }, { status: 503 });
        await assert.rejects(faqRequest("/api/faq"), { code: "FAQ_UNAVAILABLE", message: "FAQ services are temporarily unavailable. Please retry." });
    } finally { globalThis.fetch = originalFetch; }
});

test("all registered page metadata is complete, canonical and private-safe", () => {
    for (const [path, config] of Object.entries(ROUTES)) {
        const metadata = getPageMetadata(path, "?private=secret");
        assert.ok(metadata.title.length > 0, path); assert.ok(metadata.description.length > 0, path);
        const url = new URL(metadata.canonical); assert.equal(url.origin, "https://bpd-gaming-network.com");
        assert.equal(url.search, ""); assert.equal(url.hash, "");
        if (config.auth?.required || config.requiresAuth || path.startsWith("/Admin")) assert.equal(metadata.robots, "noindex, nofollow", path);
    }
});

test("OCR policy loads only with its consumers and shell does not duplicate page H1", async () => {
    const shell = await readFile("public/index.html", "utf8");
    assert.doesNotMatch(shell, /src="\/Framework\/Shell\/JS\/ocr_review_policy\.js"/);
    const runtime = await readFile("public/Framework/Shell/JS/ocr_runtime.js", "utf8");
    const page = await readFile("public/ocr/JS/index.js", "utf8");
    assert.match(runtime, /import "\.\/ocr_review_policy\.js"/);
    assert.match(page, /import "\/Framework\/Shell\/JS\/ocr_review_policy\.js"/);
    const router = await readFile("public/Framework/Shell/JS/router.js", "utf8");
    for (const key of ["rocketLeagueOcrActiveJobV1", "rocketLeagueOcrPendingReviewsV1", "rocketLeagueOcrPendingFailuresV1"]) assert.ok(router.includes(key));
    for (const path of ["public/Framework/Shell/JS/renderHeader.js", "public/Framework/Shell/HTML/Header/header.html"]) {
        assert.doesNotMatch(await readFile(path, "utf8"), /<h1/);
    }
});

test("successful Task edit clears submitting before close and preserves an underlying modal lock", async () => {
    const file = resolve("public/Global/Admin/TaskBoard/JS/task_edit.js");
    let source = await readFile(file, "utf8");
    source = source.replace('"../../Shared/JS/modal_focus.js"', JSON.stringify(pathToFileURL(resolve("public/Global/Admin/Shared/JS/modal_focus.js")).href));
    // Exercise the private event handler without adding production test hooks.
    source += '\nexport { handleTaskEditSubmit }; export function setFixtureTask(task) { taskEditState = { task, taskCode: task.taskCode, submitting: false, onUpdated: null }; }';
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const previous = { document: globalThis.document, FormData: globalThis.FormData, fetch: globalThis.fetch };
    const overlay = { hidden: false }, lower = { hidden: false }, button = { disabled: false, textContent: "" };
    const message = { hidden: true, dataset: {}, removeAttribute() {} };
    const nodes = { taskEditOverlay: overlay, taskEditForm: {}, taskEditSubmit: button, taskEditClose: { ...button }, taskEditCancel: { ...button }, taskEditMessage: message };
    let locked = false;
    globalThis.document = { getElementById: id => nodes[id] || null, querySelectorAll: () => [overlay, lower], documentElement: { classList: { toggle(_name, value) { locked = value; } } } };
    globalThis.FormData = class { get(key) { return { title: "Task", body: "Description", priority: "Low", timeline_days: "30" }[key]; } getAll() { return ["owner"]; } };
    globalThis.fetch = async (_url, options) => {
        assert.equal(options.method, "PATCH"); assert.equal(JSON.parse(options.body).expectedVersion, 1);
        assert.equal(button.disabled, true);
        return Response.json({ success: true, task: { taskCode: "TASK1", version: 2 } });
    };
    try {
        module.setFixtureTask({ taskCode: "TASK1", version: 1 });
        await module.handleTaskEditSubmit({ preventDefault() {} });
        assert.equal(overlay.hidden, true); assert.equal(button.disabled, false); assert.equal(locked, true);
    } finally { Object.assign(globalThis, previous); }
});

test("Suggestions review deadline also includes body decoding and preserves no-store", async t => {
    const file = resolve("public/Global/Admin/Suggestions/JS/index.js");
    let source = await readFile(file, "utf8");
    source = source.replace(/from "([^"]+)"/g, (_match, specifier) => {
        const target = specifier === "/Framework/Auth/auth.js"
            ? "data:text/javascript,export const getAuthState=()=>{};export const hasAdminPermission=()=>false;"
            : pathToFileURL(specifier.startsWith("/") ? resolve("public", "." + specifier) : resolve(file, "..", specifier)).href;
        return `from ${JSON.stringify(target)}`;
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const originalFetch = globalThis.fetch;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        globalThis.fetch = async (_url, options) => {
            assert.equal(options.cache, "no-store");
            return { ok: true, json: () => new Promise(() => {}) };
        };
        const rejected = assert.rejects(module.requestSuggestionReview("/api/admin/suggestions"), /timed out/i);
        await Promise.resolve(); t.mock.timers.tick(12000); await rejected;
    } finally { globalThis.fetch = originalFetch; t.mock.timers.reset(); }
});
