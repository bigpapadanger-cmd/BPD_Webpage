"use strict";

const policySlot = Symbol.for("bpd.trusted-dom.policy.v1");

function getPolicy() {
    if (!globalThis.trustedTypes) return null;
    if (!globalThis[policySlot]) {
        globalThis[policySlot] = globalThis.trustedTypes.createPolicy("bpd-static-assets", {
            // Markup is accepted only by the source-checking helper below, for
            // same-origin static HTML files maintained with the application.
            createHTML: value => value,
            createScriptURL: value => value
        });
    }
    return globalThis[policySlot];
}

function validatedLocalAsset(value, extension, origin = globalThis.location?.origin) {
    if (typeof value !== "string" || typeof origin !== "string") throw new TypeError("Static asset URL is invalid.");
    let url;
    try { url = new URL(value, origin); }
    catch { throw new TypeError("Static asset URL is invalid."); }
    const decodedPath = decodeURIComponent(url.pathname);
    const normalizedPath = decodedPath.toLowerCase();
    const allowedRoots = extension === ".html"
        ? ["/Framework/", "/Global/", "/Tabs/", "/Required/", "/ocr/"]
        : ["/Framework/", "/Global/", "/Tabs/", "/Required/", "/scripts/", "/ocr/"];
    const isKnownStaticRoot = allowedRoots.some(root => normalizedPath.startsWith(root.toLowerCase()));
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol)
        || url.username || url.password || url.hash || decodedPath.split("/").includes("..")
        || !normalizedPath.endsWith(extension) || !isKnownStaticRoot) {
        throw new TypeError("Static asset URL is not allowed.");
    }
    return url.href;
}

export function trustedHTMLFromStaticAsset(markup, assetUrl, responseUrl = assetUrl) {
    if (typeof markup !== "string") throw new TypeError("Static HTML must be text.");
    const expectedUrl = new URL(validatedLocalAsset(assetUrl, ".html"));
    const actualUrl = new URL(responseUrl || assetUrl, expectedUrl.origin);
    const actualPath = decodeURIComponent(actualUrl.pathname).toLowerCase();
    const expectedPath = decodeURIComponent(expectedUrl.pathname).toLowerCase();
    const expectedRedirectPath = expectedPath.slice(0, -".html".length);
    const allowedRoots = ["/Framework/", "/Global/", "/Tabs/", "/Required/", "/ocr/"];
    const isKnownStaticRoot = allowedRoots.some(root => actualPath.startsWith(root.toLowerCase()));
    if (actualUrl.origin !== expectedUrl.origin || !["https:", "http:"].includes(actualUrl.protocol)
        || actualUrl.username || actualUrl.password || actualUrl.hash || !isKnownStaticRoot
        || actualUrl.search !== expectedUrl.search
        || (actualPath !== expectedPath && actualPath !== expectedRedirectPath)) {
        throw new TypeError("Static HTML response URL is not an approved asset destination.");
    }
    return getPolicy()?.createHTML(markup) ?? markup;
}

// Callers must HTML-escape every dynamic text/attribute value and validate URL
// attributes before building this markup. This creates a TrustedHTML value; it
// is not a sanitizer.
export function trustedHTMLFromEscapedTemplate(markup) {
    if (typeof markup !== "string") throw new TypeError("Escaped HTML must be text.");
    return getPolicy()?.createHTML(markup) ?? markup;
}

export function trustedScriptURLFromLocalAsset(assetUrl) {
    const validatedUrl = validatedLocalAsset(assetUrl, ".js");
    return getPolicy()?.createScriptURL(validatedUrl) ?? validatedUrl;
}

export function trustedScriptURLFromApprovedThirdParty(assetUrl) {
    if (typeof assetUrl !== "string") throw new TypeError("Script URL is invalid.");
    let url;
    try { url = new URL(assetUrl); }
    catch { throw new TypeError("Script URL is invalid."); }
    const turnstile = url.origin === "https://challenges.cloudflare.com"
        && url.pathname === "/turnstile/v0/api.js"
        && url.search === "?render=explicit";
    const ads = url.origin === "https://pagead2.googlesyndication.com"
        && url.pathname === "/pagead/js/adsbygoogle.js"
        && /^\?client=ca-pub-\d{8,20}$/.test(url.search);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !(turnstile || ads)) {
        throw new TypeError("Third-party script URL is not approved.");
    }
    return getPolicy()?.createScriptURL(url.href) ?? url.href;
}
