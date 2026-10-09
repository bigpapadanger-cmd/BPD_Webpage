import test from "node:test";
import assert from "node:assert/strict";
import { trustedHTMLFromStaticAsset, trustedScriptURLFromLocalAsset } from "../public/scripts/trustedDom.js";

const previousLocation = globalThis.location;
Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://bpd.example/Player") });

test("Trusted Types helpers accept same-origin static HTML and script assets", () => {
    assert.equal(trustedHTMLFromStaticAsset("<p>Static page</p>", "/Tabs/RocketLeague/Player/HTML/index.html"), "<p>Static page</p>");
    assert.equal(trustedScriptURLFromLocalAsset("/Tabs/RocketLeague/Player/JS/index.js?v=abc"), "https://bpd.example/Tabs/RocketLeague/Player/JS/index.js?v=abc");
});

test("Trusted Types helpers reject remote, API, wrong-type, and malformed assets", () => {
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "https://attacker.example/page.html"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/api/notifications.html"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/API/notifications.html"), /not allowed/);
    assert.throws(() => trustedScriptURLFromLocalAsset("/api/payload.js"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/uploads/user-content.html"), /not allowed/);
    assert.throws(() => trustedScriptURLFromLocalAsset("/uploads/user-content.js"), /not allowed/);
    assert.throws(() => trustedScriptURLFromLocalAsset("javascript:alert(1)"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/Pages/%E0%A4%A.html"));
});

test.after(() => {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
});
