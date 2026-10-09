"use strict";

import { fetchSameOriginRedirects } from "../http/upstream.js";

const RESOURCE_PATH = /^[a-z0-9_]+(?:\/[a-z0-9_]+)*$/i;

// Keep the configured REST base intact. Both the project root and an existing
// /rest/v1 endpoint are accepted, and all resource paths append below it.
export function supabaseRestBase(value) {
    const raw = typeof value === "string" ? value.trim() : value instanceof URL ? value.href : "";
    let base;
    try { base = new URL(raw); }
    catch { throw new TypeError("SUPABASE_URL_INVALID"); }
    const path = base.pathname.replace(/\/+$/, "") || "/";
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
        || !["/", "/rest/v1"].includes(path.toLowerCase())) {
        throw new TypeError("SUPABASE_URL_INVALID");
    }
    base.pathname = "/rest/v1/";
    return base;
}

export function supabaseRestUrl(value, resourcePath, parameters = {}) {
    if (typeof resourcePath !== "string" || !RESOURCE_PATH.test(resourcePath)) {
        throw new TypeError("SUPABASE_RESOURCE_PATH_INVALID");
    }
    const url = new URL(resourcePath, supabaseRestBase(value));
    for (const [key, parameter] of Object.entries(parameters)) url.searchParams.set(key, String(parameter));
    return url;
}

// A redirect may be followed only when it stays on the configured Supabase
// origin and inside its REST API path. Authorization headers never cross hosts.
export function fetchSupabase(input, init, fetcher = fetch) {
    return fetchSameOriginRedirects(input, init, fetcher, { pathPrefix: "/rest/v1/" });
}
