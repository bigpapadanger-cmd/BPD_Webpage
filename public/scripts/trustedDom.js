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

export function trustedHTMLFromStaticAsset(markup, assetUrl) {
    if (typeof markup !== "string") throw new TypeError("Static HTML must be text.");
    validatedLocalAsset(assetUrl, ".html");
    return getPolicy()?.createHTML(markup) ?? markup;
}

export function trustedScriptURLFromLocalAsset(assetUrl) {
    const validatedUrl = validatedLocalAsset(assetUrl, ".js");
    return getPolicy()?.createScriptURL(validatedUrl) ?? validatedUrl;
}
