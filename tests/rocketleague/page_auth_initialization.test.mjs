import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    initializeRocketLeagueProtectedPage,
    isRocketLeagueProfileContract,
    isRocketLeagueSessionContract
} from "../../public/Tabs/RocketLeague/Index/JS/auth_terminal_state.js";

function element() {
    return {
        hidden: false, textContent: "", href: "", dataset: {},
        querySelector(selector) { return this.children?.[selector] || null; },
        classList: { remove() {} }
    };
}

function pageDocument() {
    const login = element();
    login.children = { h2: element(), p: element(), a: element() };
    const nodes = {
        rocketLeagueLoggedOut: login,
        rocketLeagueAuthenticatedContent: element(),
        rocketLeaguePlayerProfile: element(),
        rocketLeagueRankStatus: element()
    };
    return {
        body: { dataset: {} },
        getElementById(id) { return nodes[id] || null; },
        querySelectorAll() { return []; },
        nodes
    };
}

function session(overrides = {}) {
    return {
        success: true, authenticated: true, epicLinked: true, epicAuthorized: true,
        requiresEpicLogin: false, requiresEpicReauthorization: false,
        profileLoaded: true, registrationAccepted: true, profileComplete: true,
        rocketLeagueAccess: true, user: { active: true, displayName: "Player" },
        ...overrides
    };
}

function profile() {
    return { success: true, profileExists: true, profileLoaded: true, profileComplete: true,
        registrationAccepted: true, rocketLeagueAccess: true, profile: { stats: { ranked: {} } } };
}

function fetchSequence(responses) {
    const calls = [];
    const fetcher = async url => {
        calls.push(url);
        const value = responses.shift();
        if (value instanceof Error) throw value;
        if (value instanceof Response) return value;
        const response = value && Object.hasOwn(value, "body")
            ? value
            : { body: value, status: 200 };
        return Response.json(response.body, { status: response.status || 200 });
    };
    return { fetcher, calls };
}

test("all three page initializers use the shared auth/profile terminal lifecycle", async () => {
    for (const file of [
        "public/Tabs/RocketLeague/WeeklyMatches/JS/index.js",
        "public/Tabs/RocketLeague/MatchResults/JS/index.js",
        "public/Tabs/RocketLeague/PrivateMatches/JS/index.js"
    ]) {
        const source = await readFile(file, "utf8");
        assert.match(source, /initializeRocketLeagueProtectedPage/u, file);
        assert.match(source, /export async function initializePage\(\)/u, file);
        assert.doesNotMatch(source, /loadAuthenticatedRocketLeagueUser|ROCKET_LEAGUE_SESSION_URL/u, file);
        assert.doesNotMatch(source, /console\.(?:warn|error)\([^\n]*(?:profileError|error)/u, file);
    }
});

test("session contract rejects malformed and contradictory auth/reauthorization responses", () => {
    assert.equal(isRocketLeagueSessionContract(session()), true);
    assert.equal(isRocketLeagueSessionContract({ ...session(), authenticated: undefined }), false);
    assert.equal(isRocketLeagueSessionContract({ ...session(), epicLinked: false }), false);
    assert.equal(isRocketLeagueSessionContract({ ...session(), requiresEpicReauthorization: true }), false);
});

test("profile contract requires explicit server access fields and a profile object", () => {
    assert.equal(isRocketLeagueProfileContract(profile()), true);
    assert.equal(isRocketLeagueProfileContract({ ...profile(), rocketLeagueAccess: undefined }), false);
    assert.equal(isRocketLeagueProfileContract({ ...profile(), profile: null }), false);
});

test("successful session and profile validation unlock only server-confirmed protected content", async () => {
    const doc = pageDocument();
    const calls = [];
    let finishProfile;
    const fetcher = async url => {
        calls.push(url);
        if (calls.length === 1) return Response.json(session());
        await new Promise(resolve => { finishProfile = resolve; });
        return Response.json(profile());
    };
    let rendered = false;
    const pending = initializeRocketLeagueProtectedPage({ fetcher, documentRef: doc, windowRef: { location: { pathname: "/RocketLeague/WeeklyMatches" } }, renderProfile() { rendered = true; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doc.nodes.rocketLeagueAuthenticatedContent.hidden, true, "profile-pending page stays protected");
    finishProfile();
    const result = await pending;
    assert.equal(result.state, "validated");
    assert.equal(rendered, true);
    assert.equal(doc.nodes.rocketLeagueAuthenticatedContent.hidden, false);
    assert.equal(doc.body.dataset.rlAccess, "true");
    assert.equal(doc.body.dataset.rlValidationState, "settled");
    assert.equal(calls.length, 2);
});

test("auth HTTP failure and thrown initialization settle with protected content locked and recovery visible", async () => {
    for (const first of [{ status: 503, body: { success: false } }, new Error("offline")]) {
        const doc = pageDocument();
        const { fetcher } = fetchSequence([first]);
        const result = await initializeRocketLeagueProtectedPage({ fetcher, documentRef: doc, windowRef: { location: { pathname: "/RocketLeague/PrivateMatches" } }, renderUnavailableRanks() {} });
        assert.equal(result.state, "unavailable");
        assert.equal(doc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
        assert.equal(doc.nodes.rocketLeagueLoggedOut.hidden, false);
        assert.equal(doc.nodes.rocketLeagueLoggedOut.children.a.textContent, "Retry access check");
        assert.equal(doc.body.dataset.rlAccess, "false");
        assert.equal(doc.body.dataset.rlValidationState, "settled");
    }
});

test("malformed successful auth response is a validation failure, not falsely treated as signed out", async () => {
    const doc = pageDocument();
    const { fetcher, calls } = fetchSequence([{ success: true, authenticated: true }]);
    const result = await initializeRocketLeagueProtectedPage({ fetcher, documentRef: doc, windowRef: { location: { pathname: "/RocketLeague/MatchResults" } } });
    assert.equal(result.state, "validation-failed");
    assert.equal(calls.length, 1);
    assert.equal(doc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.match(doc.nodes.rocketLeagueLoggedOut.children.h2.textContent, /unavailable/u);
});

test("reauthorization-required keeps recovery action available and never unlocks protected content", async () => {
    const doc = pageDocument();
    const stale = session({ epicAuthorized: false, requiresEpicReauthorization: true, profileLoaded: false,
        registrationAccepted: false, profileComplete: false, rocketLeagueAccess: false });
    const { fetcher, calls } = fetchSequence([stale]);
    const result = await initializeRocketLeagueProtectedPage({ fetcher, documentRef: doc, windowRef: { location: { pathname: "/RocketLeague/WeeklyMatches" } }, renderUnavailableRanks() {} });
    assert.equal(result.state, "reauthorization-required");
    assert.equal(calls.length, 1);
    assert.equal(doc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.equal(doc.nodes.rocketLeagueLoggedOut.children.a.href, "/Account?reauthorize=epic");
    assert.equal(doc.nodes.rocketLeagueLoggedOut.children.a.textContent, "Verify Epic Again");
});

test("profile request failure locks protected content while rank rendering failure preserves validation but fails closed", async () => {
    const failedDoc = pageDocument();
    const failed = fetchSequence([session(), { status: 503, body: { success: false } }]);
    const profileFailure = await initializeRocketLeagueProtectedPage({ fetcher: failed.fetcher, documentRef: failedDoc, windowRef: { location: { pathname: "/RocketLeague/PrivateMatches" } }, renderUnavailableRanks() {} });
    assert.equal(profileFailure.state, "unavailable");
    assert.equal(failedDoc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.equal(failedDoc.body.dataset.rlAccess, "false");

    const malformedDoc = pageDocument();
    const malformed = fetchSequence([session(), { body: { success: true, profile: {} } }]);
    const malformedResult = await initializeRocketLeagueProtectedPage({ fetcher: malformed.fetcher, documentRef: malformedDoc, windowRef: { location: { pathname: "/RocketLeague/PrivateMatches" } } });
    assert.equal(malformedResult.state, "validation-failed");
    assert.equal(malformedDoc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.equal(malformedDoc.body.dataset.rlValidationState, "settled");

    const deniedDoc = pageDocument();
    const deniedProfile = { ...profile(), profileComplete: false, registrationAccepted: false, rocketLeagueAccess: false };
    const denied = fetchSequence([session(), deniedProfile]);
    const deniedResult = await initializeRocketLeagueProtectedPage({ fetcher: denied.fetcher, documentRef: deniedDoc, windowRef: { location: { pathname: "/RocketLeague/MatchResults" } } });
    assert.equal(deniedResult.state, "validated");
    assert.equal(deniedDoc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.equal(deniedDoc.body.dataset.rlAccess, "false");

    const renderDoc = pageDocument();
    const renderFail = fetchSequence([session(), profile()]);
    let rankFallback = "";
    const success = await initializeRocketLeagueProtectedPage({ fetcher: renderFail.fetcher, documentRef: renderDoc, windowRef: { location: { pathname: "/RocketLeague/MatchResults" } }, renderProfile() { throw new ReferenceError("missing CSS rank helper"); }, renderUnavailableRanks(message) { rankFallback = message; } });
    assert.equal(success.state, "validated");
    assert.equal(renderDoc.nodes.rocketLeagueAuthenticatedContent.hidden, true);
    assert.equal(renderDoc.body.dataset.rlAccess, "false");
    assert.equal(renderDoc.body.dataset.rlValidationState, "settled");
    assert.match(rankFallback, /Rank display/u);
});
