import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { beginVerificationNotice, finishVerificationNotice } from "../../public/scripts/verificationNotice.js";

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
    assert.match(source, /button\.dataset\.action === "unavailable"/);
});
