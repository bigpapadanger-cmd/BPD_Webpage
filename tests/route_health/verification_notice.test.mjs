import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { beginVerificationNotice, finishVerificationNotice, showVerificationOutcome } from "../../public/scripts/verificationNotice.js";

test("verification copy falls back after its short visible window", async () => {
    const element = { textContent: "" };
    beginVerificationNotice(element, { checkingText: "Validating…", fallbackText: "Account status", delayMs: 5 });
    assert.equal(element.textContent, "Validating…");
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(element.textContent, "Account status");
});

test("completed verification cancels the fallback", async () => {
    const element = { textContent: "" };
    beginVerificationNotice(element, { checkingText: "Validating…", fallbackText: "Default", delayMs: 5 });
    finishVerificationNotice(element, "Verified");
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(element.textContent, "Verified");
});

test("verification outcome uses state-specific notice styling and fades after its existing duration", () => {
    const originalDocument = globalThis.document;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled = new Map();
    let nextTimer = 1;
    const makeClassList = () => {
        const values = new Set();
        return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
    };
    const parent = { insertAdjacentElement(_position, element) { element.parentNode = parent; parent.inserted = element; } };
    const anchor = { parentNode: parent, parentElement: parent, closest: () => null, insertAdjacentElement(_position, element) { element.parentNode = parent; } };
    globalThis.document = { createElement: () => ({ dataset: {}, classList: makeClassList(), setAttribute() {}, hidden: true, textContent: "" }) };
    globalThis.setTimeout = (fn, delay) => { const id = nextTimer++; scheduled.set(id, { fn, delay }); return id; };
    globalThis.clearTimeout = id => scheduled.delete(id);
    try {
        for (const state of ["success", "warning", "error", "info"]) {
            showVerificationOutcome(anchor, `Result: ${state}`, { state, durationMs: 7000 });
            assert.equal(parent.inserted.dataset.state, state);
        }
        const record = [...scheduled.entries()][0];
        assert.equal(record[1].delay, 7000);
        assert.equal(parent.inserted.dataset.state, "info");
        assert.equal(parent.inserted.textContent, "Result: info");
        const timers = [...scheduled.values()];
        timers[0].fn();
        assert.equal(parent.inserted.classList.contains("is-fading"), true);
        const fade = [...scheduled.values()].at(-1);
        assert.equal(fade.delay, 250);
        fade.fn();
        assert.equal(parent.inserted.hidden, true);
    } finally {
        globalThis.document = originalDocument;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test("verification outcome CSS presents rounded success, warning, error, and info states", async () => {
    const css = await readFile("public/Framework/Shell/CSS/General/body.css", "utf8");
    assert.match(css, /\.verification-action-result\s*\{[^}]*border-radius/s);
    assert.match(css, /data-state="success"[^}]*--verification-border/s);
    assert.match(css, /data-state="warning"[^}]*--verification-border/s);
    assert.match(css, /data-state="error"[^}]*--verification-border/s);
    assert.match(css, /data-state="info"[^}]*--verification-border/s);
    assert.match(css, /\.verification-action-result\.is-fading\s*\{[^}]*opacity:\s*0/s);
});

test("shared timed verification is used by the site-wide account/admin surfaces", async () => {
    const files = [
        "public/Framework/Banner/JS/account_banner.js",
        "public/Global/Index/JS/index.js",
        "public/Global/Admin/Home/JS/index.js",
        "public/Global/Admin/WorkerStatus/JS/index.js",
        "public/Tabs/RocketLeague/Index/JS/auth.js"
    ];
    for (const path of files) {
        const source = await readFile(path, "utf8");
        assert.match(source, /verificationNotice\.js/);
        assert.match(source, /beginVerificationNotice/);
    }
});

test("Rocket League validation preserves its button contents and unavailable state", async () => {
    const source = await readFile("public/Tabs/RocketLeague/Index/JS/connect_epic.js", "utf8");
    assert.match(source, /button\.querySelector\("span:last-child"\)/);
    assert.doesNotMatch(source, /button\.textContent\s*=\s*"Validating\.\.\."/);
    assert.match(source, /button\.dataset\.action === "validating"/);
    assert.match(source, /action === "retry-validation"/);
});

test("route navigation shows a safe shell before authorization without injecting protected fragments", async () => {
    const source = await readFile("public/Framework/Shell/JS/router.js", "utf8");
    const bodyCss = await readFile("public/Framework/Shell/CSS/General/body.css", "utf8");
    assert.ok(source.indexOf("renderRouteLoadingShell();") < source.indexOf("await enforceRouteAuthentication("));
    assert.match(source, /content\.replaceChildren\(shell\)/);
    assert.match(source, /if \(!authCheck\.redirected && authCheck\.authEvaluation\?\.allowed === false\)/);
    assert.ok(source.indexOf("if (!authCheck.redirected && authCheck.authEvaluation?.allowed === false)") < source.lastIndexOf("injectRouteFragments("));
    assert.match(bodyCss, /body\.page-loading \.site-content\s*\{[^}]*opacity:\s*1/s);
    assert.match(bodyCss, /\.route-loading-shell/);
});

test("action feedback is time-bounded and Admin counter test has no browser Supabase access", async () => {
    const notice = await readFile("public/scripts/verificationNotice.js", "utf8");
    const admin = await readFile("public/Global/Admin/WorkerStatus/JS/index.js", "utf8");
    const api = await readFile("functions/api/admin/system-status.js", "utf8");
    assert.match(notice, /showVerificationOutcome/);
    assert.match(notice, /Math\.min\(10000, Math\.max\(5000/);
    assert.match(admin, /test-rl-counters/);
    assert.match(admin, /showVerificationOutcome\(currentButton \|\| button/);
    assert.doesNotMatch(admin, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_AUTH|supabase\.co/u);
    assert.match(api, /await authorize\(request, env\)/);
    assert.match(api, /\["refresh-shop", "test-rl-counters"\]/);
});

test("Rocket League page has no unresolved legacy rank helper and profile errors are sanitized", async () => {
    const auth = await readFile("public/Tabs/RocketLeague/Index/JS/auth.js", "utf8");
    const ranks = await readFile("public/Tabs/RocketLeague/Index/JS/ranks.js", "utf8");
    assert.doesNotMatch(auth, /\bgetRankClass\s*\(/);
    assert.match(ranks, /getRocketLeagueRankClass/);
    assert.doesNotMatch(auth, /message:\s*profileError\?\.message/);
    assert.doesNotMatch(auth, /code:\s*profileError\?\.code/);
    assert.match(auth, /retry-validation/);
});
