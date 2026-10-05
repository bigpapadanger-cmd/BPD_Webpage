import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { settleUnresolvedRocketLeagueValidation } from "../../public/Tabs/RocketLeague/Index/JS/auth_terminal_state.js";

function node() {
    return {
        dataset: {}, hidden: false, disabled: true, textContent: "Validating...", attributes: {},
        querySelector() { return this.child || null; },
        querySelectorAll() { return this.children || []; },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; }
    };
}

function pendingUi() {
    const button = node();
    button.dataset.action = "validating";
    button.child = node();
    button.child.textContent = "Validating...";
    const protectedLink = node();
    const sidebar = { querySelectorAll: () => [protectedLink] };
    const body = { dataset: { rlAccess: "unknown" } };
    const callout = node();
    callout.hidden = true;
    const heading = node();
    const message = node();
    const authenticatedContent = node();
    const playerProfile = node();
    const loggedOutContent = node();
    return { button, protectedLink, sidebar, body, callout, heading, message, authenticatedContent, playerProfile, loggedOutContent };
}

test("successful validation is not overwritten by the terminal failure fallback", () => {
    const ui = pendingUi();
    ui.button.dataset.action = "profile-access";
    ui.button.disabled = false;
    assert.equal(settleUnresolvedRocketLeagueValidation(ui), false);
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.button.dataset.action, "profile-access");
});

test("auth/profile validation failure ends checking and keeps protected navigation locked", () => {
    const ui = pendingUi();
    assert.equal(settleUnresolvedRocketLeagueValidation(ui), true);
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.button.dataset.action, "retry-validation");
    assert.equal(ui.button.attributes["aria-busy"], undefined);
    assert.equal(ui.button.child.textContent, "Retry access check");
    assert.equal(ui.body.dataset.rlAccess, "false");
    assert.equal(ui.protectedLink.hidden, true);
    assert.equal(ui.callout.hidden, false);
    assert.match(ui.message.textContent, /couldn’t verify access/u);
});

test("initialization has terminal fallback for auth throws, profile failures, and rendering failures", async () => {
    const auth = await readFile("public/Tabs/RocketLeague/Index/JS/auth.js", "utf8");
    const profile = await readFile("public/Tabs/RocketLeague/Index/JS/profile.js", "utf8");
    const page = await readFile("public/Tabs/RocketLeague/Index/JS/index.js", "utf8");
    assert.match(auth, /catch\s*\(\s*error\s*\)[\s\S]*?applyRocketLeagueUnavailableView\(\)[\s\S]*?finally\s*\{/u);
    assert.match(auth, /catch \(profileError\)[\s\S]*?setRocketLeagueAccessButtonUnavailable\("Profile validation unavailable"\)/u);
    assert.match(auth, /settleUnresolvedRocketLeagueValidation\(/u);
    assert.match(page, /finally\s*\{[\s\S]*?releaseMainRocketLeagueAction\(\)/u);
    assert.match(profile, /catch \(error\)[\s\S]*?ROCKET LEAGUE PROFILE PRESENTATION/u);
    assert.match(profile, /renderUnavailableRanks\("Rank display is temporarily unavailable\."\)/u);
});

test("invalid auth and profile contracts fail closed instead of becoming signed-out or setup states", async () => {
    const auth = await readFile("public/Tabs/RocketLeague/Index/JS/auth.js", "utf8");
    const profile = await readFile("public/Tabs/RocketLeague/Index/JS/profile.js", "utf8");
    assert.match(auth, /typeof authState\.authenticated !== "boolean"/u);
    assert.match(profile, /typeof result\.profileExists !== "boolean"[\s\S]*?typeof result\.rocketLeagueAccess !== "boolean"/u);
    assert.match(profile, /ROCKET_LEAGUE_PROFILE_RESPONSE_INVALID/u);
});

test("reauthorization stays actionable while protected access is not granted", async () => {
    const auth = await readFile("public/Tabs/RocketLeague/Index/JS/auth.js", "utf8");
    assert.match(auth, /authenticated\s*&&\s*epicLinked\s*&&\s*requiresEpicReauthorization/u);
    assert.match(auth, /button\.dataset\.action\s*=\s*"epic-reauthorize"/u);
    assert.match(auth, /redirectProtectedRouteToEpicReauthorization\(\)/u);
});

test("current rank renderer uses the shared rank-class helper, not an undefined local helper", async () => {
    const auth = await readFile("public/Tabs/RocketLeague/Index/JS/auth.js", "utf8");
    const ranks = await readFile("public/Tabs/RocketLeague/Index/JS/ranks.js", "utf8");
    assert.doesNotMatch(auth, /\bgetRankClass\s*\(/u);
    assert.match(ranks, /import \{ getRocketLeagueRankClass \} from "\.\.\/\.\.\/shared\/profilePresentation\.js"/u);
    assert.match(ranks, /getRocketLeagueRankClass\(/u);
});
