import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../../public/Global/Admin/WorkerStatus/HTML/index.html", import.meta.url), "utf8");
const js = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/Global/Admin/WorkerStatus/CSS/index.css", import.meta.url), "utf8");

test("temporary session panel is hidden by default and explains health-check/test boundaries", () => {
    assert.match(html, /id="rlStagingIsolationPanel"[^>]*hidden/u);
    assert.match(html, /two fixed synthetic identities/u);
    assert.match(html, /does not use Epic credentials or contact PsyNet/u);
    assert.match(html, /staging-wide revocation/u);
    assert.match(html, /id="rlStagingConnectivityCheck"/u);
    assert.match(html, /Check staging connectivity/u);
    assert.match(css, /\.worker-status \.rl-staging-isolation/u);
    assert.match(css, /focus-visible/u);
});

test("panel is initialized only after Admin permission and posts an explicit same-origin confirmation", () => {
    const permissionCheck = js.indexOf("hasAdminPermission(REQUIRED_PERMISSION, auth)");
    const panelInitialization = js.indexOf("await initializeStagingIsolationPanel();");
    assert.ok(permissionCheck >= 0 && panelInitialization > permissionCheck);
    assert.match(js, /\/api\/admin\/rocketleague\/staging-isolation-test/u);
    assert.match(js, /staging-isolation-test\?health=1/u);
    assert.match(js, /payload\.runtimeFailureCode/u);
    for (const code of ["AUTH_REJECTED", "BINDING_UNAVAILABLE", "TIMEOUT", "INVALID_RESPONSE", "RUNTIME_ERROR"]) {
        assert.match(js, new RegExp(code, "u"));
    }
    assert.match(js, /No assertions or sessions were created/u);
    assert.match(js, /button\.hidden = true/u);
    assert.match(js, /button\.hidden = false/u);
    assert.match(js, /credentials: "same-origin", cache: "no-store"/u);
    assert.match(js, /RUN_STAGING_ISOLATION_TEST/u);
    assert.match(js, /window\.confirm\(/u);
    assert.match(js, /stagingIsolationInFlight/u);
});
