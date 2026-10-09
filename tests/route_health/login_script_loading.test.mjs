import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("failed or stalled Turnstile script is removed so login retry can make progress", async t => {
    const text = await readFile(new URL("../../public/Global/Login/JS/index.js", import.meta.url), "utf8");
    const start = text.indexOf("function loadTurnstileScript()");
    const end = text.indexOf("/* =========================================================", start);
    let script = null;
    let expire;
    let loads = 0;
    const context = vm.createContext({
        TURNSTILE_SCRIPT_ID: "fixture-turnstile", TURNSTILE_SCRIPT_URL: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        trustedScriptURLFromApprovedThirdParty: url => url,
        turnstileLoadingPromise: null,
        window: { setTimeout(callback, ms) { assert.equal(ms, 12000); expire = callback; return 1; }, clearTimeout() {} },
        document: {
            getElementById: () => script,
            createElement: () => ({ listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, remove() { script = null; } }),
            head: { appendChild(node) { script = node; loads++; } }
        }
    });
    vm.runInContext(text.slice(start, end), context);
    const first = context.loadTurnstileScript();
    script.listeners.error();
    await assert.rejects(first, /TURNSTILE_SCRIPT_LOAD_FAILED/);
    assert.equal(script, null);
    const retry = context.loadTurnstileScript();
    assert.equal(loads, 2);
    expire();
    await assert.rejects(retry, /TURNSTILE_SCRIPT_LOAD_FAILED/);
    assert.equal(script, null);
    const success = context.loadTurnstileScript();
    context.window.turnstile = { render() {} };
    script.listeners.load();
    assert.equal(await success, context.window.turnstile);
});
