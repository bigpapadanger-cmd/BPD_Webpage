import assert from "node:assert/strict";
import test from "node:test";

import { getRocketLeagueAccessPresentation } from "../../public/Tabs/RocketLeague/Index/JS/access_presentation.js";

test("Player Hub distinguishes sign-in, Epic link, and Epic reauthorization states", () => {
    assert.match(getRocketLeagueAccessPresentation({ authenticated: false }).title, /Sign in/);
    assert.match(getRocketLeagueAccessPresentation({ authenticated: true, active: true, epicLinked: false }).title, /Connect your Epic/);

    const reauth = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: true,
        epicAuthorized: false,
        requiresEpicReauthorization: true
    });
    assert.match(reauth.title, /verification required/i);
    assert.match(reauth.message, /remains linked/i);
    assert.doesNotMatch(reauth.title, /connect epic/i);

    const disconnected = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: false,
        requiresEpicLogin: true
    });
    assert.match(disconnected.title, /Connect your Epic/i);
    assert.doesNotMatch(disconnected.title, /Verify Again/i);
});

test("incomplete profiles stay on the hub and receive a setup notice with an explicit destination", () => {
    const incomplete = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: true,
        epicAuthorized: true,
        profileLoaded: true,
        profileExists: true,
        profileComplete: false,
        registrationAccepted: true,
        rocketLeagueAccess: false
    });
    assert.match(incomplete.title, /Complete your Rocket League profile/i);
    assert.match(incomplete.message, /preferences, privacy, availability, and notification/i);
});

test("profile setup notice copy appears only after authorized profile validation", () => {
    const checking = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: true,
        epicAuthorized: true,
        profileLoaded: false
    });
    assert.match(checking.title, /Checking your Rocket League profile/);

    const incomplete = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: true,
        epicAuthorized: true,
        profileLoaded: true,
        profileExists: false,
        rocketLeagueAccess: false
    });
    assert.match(incomplete.title, /Complete your Rocket League profile/i);
    assert.match(incomplete.message, /preferences, privacy, availability, and notification/i);
});

test("profile-complete players receive the ready state", () => {
    const ready = getRocketLeagueAccessPresentation({
        authenticated: true,
        active: true,
        epicLinked: true,
        epicAuthorized: true,
        profileLoaded: true,
        rocketLeagueAccess: true
    });
    assert.match(ready.title, /profile ready/i);
});
