import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildMmrProgression,
    getRocketLeagueMmrProgression,
    getRocketLeagueMmrProgressionSafely
} from "../../functions/services/supabase/rocketleague/get_mmr_progression.js";
import { renderMmrProgression } from "../../public/Tabs/RocketLeague/Index/JS/mmr_dashboard.js";

function rpcResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function withFetch(fetchImpl, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try { return await callback(); } finally { globalThis.fetch = originalFetch; }
}

test("progression RPC uses the server service credential and maps the confirmed contract", async () => {
    const calls = [];
    const body = {
        current: { captured_at: "2026-09-30T20:41:00Z", ones_mmr: 134, twos_mmr: 200, threes_mmr: 300 },
        previous: { captured_at: "2026-09-29T20:41:00Z", ones_mmr: 100, twos_mmr: 210, threes_mmr: 300 }
    };
    const progression = await withFetch(async (url, init) => {
        calls.push({ url: new URL(url), init });
        return rpcResponse(body);
    }, () => getRocketLeagueMmrProgression({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "account-1"));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/rest/v1/rpc/get_rl_player_mmr_progression");
    assert.equal(calls[0].init.headers.Authorization, "Bearer server-only");
    assert.deepEqual(JSON.parse(calls[0].init.body), { p_account_id: "account-1" });
    assert.deepEqual(progression.playlists.map(item => item.delta), [34, -10, 0]);
    assert.equal(progression.current.capturedAt, body.current.captured_at);
});

test("positive, negative, and zero MMR deltas remain snapshot-to-snapshot values", () => {
    const result = buildMmrProgression(
        { ones: 134, twos: 188, threes: 250 },
        { ones: 100, twos: 200, threes: 250 }
    );
    assert.deepEqual(result.playlists.map(item => item.delta), [34, -12, 0]);
    assert.deepEqual(result.playlists.map(item => item.status), ["available", "available", "available"]);
});

test("missing previous capture is distinct from zero change", () => {
    const result = buildMmrProgression({ ones: 100, twos: 200, threes: 300 }, null);
    assert.equal(result.previous, null);
    assert.ok(result.playlists.every(item => item.status === "no_previous" && item.delta === null));
});

test("missing playlist values do not suppress progression for other playlists", () => {
    const result = buildMmrProgression(
        { ones: 120, twos: 210, threes: 330 },
        { ones: 100, twos: null, threes: 300 }
    );
    assert.equal(result.playlists[0].delta, 20);
    assert.equal(result.playlists[1].status, "unavailable");
    assert.equal(result.playlists[2].delta, 30);
});

test("homepage MMR change cards use snapshot wording and distinct signed/no-previous states", () => {
    const target = { children: [], replaceChildren(...nodes) { this.children = nodes; }, append(node) { this.children.push(node); } };
    const status = { textContent: "", hidden: false };
    const documentRef = {
        getElementById(id) { return id === "rocketLeagueMmrProgression" ? target : status; },
        createElement() {
            return { children: [], dataset: {}, append(...nodes) { this.children.push(...nodes); } };
        }
    };
    renderMmrProgression({
        previous: { capturedAt: "2026-09-29T00:00:00Z" },
        current: { ones: 134, twos: 188, threes: 250 },
        playlists: [
            { key: "ones", label: "1v1", status: "available", delta: 34 },
            { key: "twos", label: "2v2", status: "available", delta: -12 },
            { key: "threes", label: "3v3", status: "available", delta: 0 }
        ]
    }, documentRef);
    const rendered = target.children.flatMap(card => card.children.map(node => node.textContent)).join(" ");
    assert.match(rendered, /\+34 MMR/);
    assert.match(rendered, /-12 MMR/);
    assert.match(rendered, /No change/);
    assert.match(status.textContent, /^Compared with .+\.$/);

    renderMmrProgression({ previous: null, current: { ones: 100 }, playlists: [{ key: "ones", label: "1v1", status: "no_previous", delta: null }] }, documentRef);
    assert.match(status.textContent, /No previous capture yet/);
    assert.match(target.children[0].children[2].textContent, /No previous capture/);
});

test("malformed progression RPC response is rejected", async () => {
    await withFetch(async () => rpcResponse({ current: [], previous: null }), async () => {
        await assert.rejects(
            getRocketLeagueMmrProgression({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "account-1"),
            error => error.code === "MMR_PROGRESSION_INVALID"
        );
    });
});

test("progression RPC failures degrade to unavailable without failing profile data", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const result = await withFetch(async () => rpcResponse({ message: "private upstream detail" }, 503), () =>
            getRocketLeagueMmrProgressionSafely({ SUPABASE_URL: "https://db.example.test", SUPABASE_AUTH: "server-only" }, "account-1"));
        assert.equal(result, null);
    } finally {
        console.error = originalError;
    }

    const service = await readFile(new URL("../../functions/services/rl/profile.js", import.meta.url), "utf8");
    const getHandler = service.slice(service.indexOf("async function handleProfileGet"), service.indexOf("async function handleProfilePost"));
    assert.match(getHandler, /getRocketLeagueMmrProgressionSafely/);
    assert.match(getHandler, /includeMmrProgression/);
    assert.match(getHandler, /mmrProgression,/);
    assert.match(getHandler, /includeMmrProgression && rocketLeagueAccess/);
    assert.doesNotMatch(getHandler, /refreshProviderDataWithGate/);
});

test("Rocket League home requests progression and history as persisted data only", async () => {
    const page = await readFile(new URL("../../public/Tabs/RocketLeague/Index/JS/profile.js", import.meta.url), "utf8");
    assert.match(page, /includePresence=false&includeMmrProgression=true&includeMmrHistory=true/);
    assert.doesNotMatch(page, /MMR_API_URL|get-player-data|fetchProviderCapabilities|SUPABASE_AUTH/);
    const privateSettings = await readFile(new URL("../../public/Tabs/RocketLeague/MyProfile/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(privateSettings, /includeMmrProgression|includeMmrHistory/);
    assert.doesNotMatch(privateSettings, /MMR_API_URL|get-player-data|fetchProviderCapabilities|SUPABASE_AUTH/);
});
