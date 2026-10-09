import test from "node:test";
import assert from "node:assert/strict";
import {
    trustedHTMLFromEscapedTemplate,
    trustedHTMLFromStaticAsset,
    trustedScriptURLFromApprovedThirdParty,
    trustedScriptURLFromLocalAsset
} from "../public/scripts/trustedDom.js";
import { ROUTES } from "../public/routes.js";

const previousLocation = globalThis.location;
Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://bpd.example/Player") });

test("Trusted Types helpers accept same-origin static HTML and script assets", () => {
    assert.equal(trustedHTMLFromStaticAsset("<p>Static page</p>", "/Tabs/RocketLeague/Player/HTML/index.html"), "<p>Static page</p>");
    assert.equal(trustedHTMLFromStaticAsset(
        "<p>Static page</p>",
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        "https://bpd.example/Framework/Shell/HTML/Sidebar/mainmenu"
    ), "<p>Static page</p>");
    assert.equal(trustedScriptURLFromLocalAsset("/Tabs/RocketLeague/Player/JS/index.js?v=abc"), "https://bpd.example/Tabs/RocketLeague/Player/JS/index.js?v=abc");
});

test("approved script URL helper accepts only the fixed Turnstile and AdSense assets", () => {
    assert.equal(
        trustedScriptURLFromApprovedThirdParty("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"),
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    );
    assert.equal(
        trustedScriptURLFromApprovedThirdParty("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9161533706304827"),
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9161533706304827"
    );
    assert.equal(trustedHTMLFromEscapedTemplate("<p>already escaped &amp; safe</p>"), "<p>already escaped &amp; safe</p>");
    assert.throws(() => trustedScriptURLFromApprovedThirdParty("https://attacker.example/main.js"), /not approved/);
    assert.throws(() => trustedScriptURLFromApprovedThirdParty("https://challenges.cloudflare.com.evil/turnstile/v0/api.js?render=explicit"), /not approved/);
    assert.throws(() => trustedScriptURLFromApprovedThirdParty("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=other"), /not approved/);
});

test("Trusted Types helpers reject remote, API, wrong-type, and malformed assets", () => {
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "https://attacker.example/page.html"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/api/notifications.html"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/API/notifications.html"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/Framework/Shell/HTML/Sidebar/mainmenu.html", "https://bpd.example/Dashboard"), /response URL/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/Framework/Shell/HTML/Sidebar/mainmenu.html", "https://attacker.example/Framework/Shell/HTML/Sidebar/mainmenu"), /response URL/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/Framework/Shell/HTML/Sidebar/mainmenu.html", "https://bpd.example/Framework/Shell/HTML/Sidebar/mainmenu?unexpected=1"), /response URL/);
    assert.throws(() => trustedScriptURLFromLocalAsset("/api/payload.js"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/uploads/user-content.html"), /not allowed/);
    assert.throws(() => trustedScriptURLFromLocalAsset("/uploads/user-content.js"), /not allowed/);
    assert.throws(() => trustedScriptURLFromLocalAsset("javascript:alert(1)"), /not allowed/);
    assert.throws(() => trustedHTMLFromStaticAsset("<p>bad</p>", "/Pages/%E0%A4%A.html"));
});

test("every configured page fragment accepts only its exact extensionless same-origin redirect", () => {
    const assets = new Set();
    for (const route of Object.values(ROUTES)) {
        for (const asset of [route.body, route.header, route.sidebar, route.footer]) {
            if (asset) assets.add(asset);
        }
    }

    assert.ok(assets.size > 0);
    for (const asset of assets) {
        const redirectedPath = asset.slice(0, -".html".length);
        assert.equal(trustedHTMLFromStaticAsset("<section>fragment</section>", asset, `https://bpd.example${redirectedPath}`), "<section>fragment</section>");
    }
});

test.after(() => {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
});
