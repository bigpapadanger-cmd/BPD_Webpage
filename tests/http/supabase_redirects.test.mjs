import test from "node:test";
import assert from "node:assert/strict";

import { fetchSameOriginRedirects } from "../../functions/services/http/upstream.js";
import { supabaseRestBase, supabaseRestUrl } from "../../functions/services/supabase/rest.js";

test("Supabase REST URLs retain the configured /rest/v1 base and append resources", () => {
    const configured = "https://project.supabase.co/rest/v1/";
    assert.equal(supabaseRestBase(configured).pathname, "/rest/v1/");
    assert.equal(supabaseRestUrl(configured, "notification_events", { limit: 10 }).href,
        "https://project.supabase.co/rest/v1/notification_events?limit=10");
    assert.equal(supabaseRestUrl(configured, "rpc/get_users").pathname, "/rest/v1/rpc/get_users");
    assert.equal(supabaseRestUrl("https://project.supabase.co", "rpc/get_users").pathname, "/rest/v1/rpc/get_users");
    assert.throws(() => supabaseRestUrl(configured, "/rpc/get_users"), /SUPABASE_RESOURCE_PATH_INVALID/);
});

test("same-origin HTTPS redirects inside REST are followed manually", async () => {
    const requests = [];
    const fetcher = async (input, init) => {
        requests.push({ url: new URL(input), init });
        return requests.length === 1
            ? new Response(null, { status: 307, headers: { Location: "/rest/v1/rpc/final" } })
            : new Response("ok", { status: 200 });
    };
    const response = await fetchSameOriginRedirects("https://project.supabase.co/rest/v1/rpc/start", {
        method: "POST", headers: { Authorization: "secret" }, body: "{}"
    }, fetcher, { pathPrefix: "/rest/v1/" });

    assert.equal(response.status, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].init.redirect, "manual");
    assert.equal(requests[1].init.redirect, "manual");
    assert.equal(requests[1].url.pathname, "/rest/v1/rpc/final");
    assert.equal(requests[1].init.headers.Authorization, "secret");
});

test("cross-origin, out-of-scope, and method-changing redirects are returned without following", async () => {
    for (const [method, status, location] of [
        ["GET", 302, "https://other.supabase.co/rest/v1/rpc/x"],
        ["GET", 301, "/auth/v1/authorize"],
        ["POST", 301, "/rest/v1/rpc/next"]
    ]) {
        let calls = 0;
        const response = await fetchSameOriginRedirects("https://project.supabase.co/rest/v1/rpc/start", { method }, async () => {
            calls++;
            return new Response(null, { status, headers: { Location: location } });
        }, { pathPrefix: "/rest/v1/" });
        assert.equal(response.status, status);
        assert.equal(calls, 1);
    }
});
