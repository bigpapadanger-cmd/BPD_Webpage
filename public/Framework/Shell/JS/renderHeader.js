"use strict";

/* =========================================================
BPD GAMING NETWORK
HEADER RENDERER

File:
    /Framework/Shell/JS/renderHeader.js
Purpose:
    Renders the page header and optional route navigation.

Behavior:
    - Runs synchronously as part of critical page rendering.
    - Marks the current tab active.
    - Uses SPA router links.
    - Does not perform network requests or deferred work.
========================================================= */

function normalizePath(
    value
) {
    const path =
        String(
            value
            || "/"
        );

    if (
        path.length > 1
        && path.endsWith(
            "/"
        )
    ) {
        return path.slice(
            0,
            -1
        );
    }

    return path;
}

/* =========================================================
RENDER HEADER
========================================================= */

export function renderHeader({
    eyebrow = "BPD GAMING NETWORK",
    title = "",
    tabs = []
} = {}) {
    const header =
        document.getElementById(
            "header"
        );

    if (
        !header
    ) {
        return;
    }

    const currentPath =
        normalizePath(
            window.location.pathname
        );

    const headerContent = document.createElement("div");
    headerContent.className = "header-content";
    const headerBox = document.createElement("div");
    headerBox.className = "header-box";
    const titleRow = document.createElement("div");
    titleRow.className = "header-title-row";
    const titleContent = document.createElement("div");
    titleContent.className = "header-title-content";
    const eyebrowElement = document.createElement("span");
    eyebrowElement.className = "header-eyebrow";
    eyebrowElement.textContent = String(eyebrow);
    const titleElement = document.createElement("p");
    titleElement.className = "header-title";
    titleElement.textContent = String(title);
    titleContent.append(eyebrowElement, titleElement);
    titleRow.append(titleContent);
    headerBox.append(titleRow);

    if (Array.isArray(tabs) && tabs.length > 0) {
        const navigation = document.createElement("nav");
        navigation.className = "header-navigation";
        navigation.setAttribute("aria-label", `${String(title)} navigation`);
        for (const tab of tabs) {
            if (!tab || typeof tab.href !== "string") continue;
            let tabUrl;
            try { tabUrl = new URL(tab.href, window.location.origin); }
            catch { continue; }
            if (tabUrl.origin !== window.location.origin || !["https:", "http:"].includes(tabUrl.protocol)) continue;

            const isActive = currentPath === normalizePath(tabUrl.pathname);
            const link = document.createElement("a");
            link.href = `${tabUrl.pathname}${tabUrl.search}${tabUrl.hash}`;
            link.className = `header-tab${isActive ? " active" : ""}`;
            if (isActive) link.setAttribute("aria-current", "page");
            link.dataset.routerLink = "";
            link.textContent = String(tab.label ?? "");
            navigation.append(link);
        }
        if (navigation.childElementCount > 0) headerBox.append(navigation);
    }

    headerContent.append(headerBox);
    header.replaceChildren(headerContent);
}
