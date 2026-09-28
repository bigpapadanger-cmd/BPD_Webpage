import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequestGet as listPending } from "../../functions/api/admin/suggestions/index.js";
import { onRequestPost as reviewSuggestion } from "../../functions/api/admin/suggestions/[suggestionId]/review.js";
import { onRequestGet, onRequestPost } from "../../functions/api/suggestions/index.js";
import { onRequestPost as voteSuggestion } from "../../functions/api/suggestions/[suggestionId]/vote.js";
import { getPermissionsForDiscordRoles, ADMIN_PERMISSIONS } from "../../functions/services/admin/permissions.js";
import { callSuggestionsRpc, SUGGESTIONS_RPCS, SuggestionsServiceError } from "../../functions/services/supabase/suggestions.js";
import { readJsonBody } from "../../functions/services/http/json.js";

const UUID = "f3b7464e-8799-47a3-b386-9d32c020b42e";

test("suggestion RPC transport is allow-listed and sends credentials only server-to-server", async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return Response.json([{ id: UUID, status: "pending" }]);
    };

    try {
        const result = await callSuggestionsRpc({
            SUPABASE_URL: "https://database.example/rest/v1/",
            SUPABASE_AUTH: "server-only-test-key"
        }, SUGGESTIONS_RPCS.CREATE, { p_creator_account_id: UUID, p_title: "Test", p_description: "A sufficiently long idea." });
        assert.equal(request.url, "https://database.example/rest/v1/rpc/create_website_suggestion");
        assert.equal(request.options.headers.Authorization, "Bearer server-only-test-key");
        assert.equal(request.options.headers["Content-Profile"], "api");
        assert.equal(result[0].status, "pending");
        assert.equal(JSON.stringify(result).includes("server-only-test-key"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("suggestion RPC transport rejects arbitrary procedure names without making a request", async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; return Response.json({}); };
    try {
        await assert.rejects(
            callSuggestionsRpc({ SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "server-key" }, "drop_everything"),
            (error) => error instanceof SuggestionsServiceError && error.status === 500
        );
        assert.equal(called, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Supabase error payloads and credentials are not logged or returned", async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logs = [];
    globalThis.fetch = async () => new Response(JSON.stringify({
        message: "SUGGESTION_NOT_PENDING",
        detail: "private-key-body server-secret-test-key"
    }), { status: 400 });
    console.error = (...args) => logs.push(args);
    try {
        await assert.rejects(
            callSuggestionsRpc({ SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "server-secret-test-key" }, SUGGESTIONS_RPCS.REVIEW),
            (error) => error.code === "SUGGESTION_NOT_PENDING" && error.status === 409
        );
        assert.doesNotMatch(JSON.stringify(logs), /private-key-body|server-secret-test-key/);
    } finally {
        globalThis.fetch = originalFetch;
        console.error = originalError;
    }
});

test("public suggestions listing returns only the public RPC result shape", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json([{ id: UUID, title: "Approved", status: "approved" }]);
    try {
        const response = await onRequestGet({
            request: new Request("https://example.test/api/suggestions"),
            env: { SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "server-key" }
        });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).suggestions.map((item) => item.id), [UUID]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("suggestion mutations reject cross-origin and unauthenticated requests before persistence", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; return Response.json([]); };
    try {
        const crossOrigin = await onRequestPost({
            request: new Request("https://example.test/api/suggestions", {
                method: "POST",
                headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
                body: JSON.stringify({ title: "A valid title", description: "A sufficiently long description." })
            }),
            env: {}
        });
        assert.equal(crossOrigin.status, 403);
        assert.equal(called, false);

        const anonymousVote = await voteSuggestion({
            request: new Request(`https://example.test/api/suggestions/${UUID}/vote`, { method: "POST" }),
            params: { suggestionId: UUID },
            env: {}
        });
        assert.ok([401, 403, 503].includes(anonymousVote.status));
        assert.equal(called, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("pending moderation API is server-protected and does not return records to unauthenticated callers", async () => {
    const response = await listPending({
        request: new Request("https://example.test/api/admin/suggestions"),
        env: {}
    });
    assert.ok([401, 403, 503].includes(response.status));
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal("suggestions" in payload, false);

    const reviewResponse = await reviewSuggestion({
        request: new Request(`https://example.test/api/admin/suggestions/${UUID}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "approved" })
        }),
        params: { suggestionId: UUID },
        env: {}
    });
    assert.ok([401, 403, 503].includes(reviewResponse.status));
});

test("review permission is granted to admins and moderators but not league staff", () => {
    assert.ok(getPermissionsForDiscordRoles({ isAdmin: true }).includes(ADMIN_PERMISSIONS.SUGGESTIONS_MANAGE));
    assert.ok(getPermissionsForDiscordRoles({ isModerator: true }).includes(ADMIN_PERMISSIONS.SUGGESTIONS_MANAGE));
    assert.ok(!getPermissionsForDiscordRoles({ isLeagueStaff: true }).includes(ADMIN_PERMISSIONS.SUGGESTIONS_MANAGE));
});

test("suggestion request JSON reader rejects invalid objects and enforces streaming size limits", async () => {
    const valid = await readJsonBody(new Request("https://example.test", {
        method: "POST", body: JSON.stringify({ status: "approved" })
    }), 128);
    assert.equal(valid.success, true);
    assert.equal(valid.data.status, "approved");

    const tooLarge = await readJsonBody(new Request("https://example.test", {
        method: "POST", body: JSON.stringify({ description: "x".repeat(128) })
    }), 64);
    assert.equal(tooLarge.tooLarge, true);

    const invalid = await readJsonBody(new Request("https://example.test", {
        method: "POST", body: "[]"
    }), 64);
    assert.equal(invalid.success, false);
});

test("suggestion page keeps the approval flow explicit", async () => {
    const publicPage = await readFile(new URL("../../public/Global/Suggestions/HTML/index.html", import.meta.url), "utf8");
    assert.match(publicPage, /stay pending until staff approval/i);
});
