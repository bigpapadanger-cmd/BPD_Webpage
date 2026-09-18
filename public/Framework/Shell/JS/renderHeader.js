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

    const navigation =
        tabs.length > 0
            ? `
                <nav
                    class="header-navigation"
                    aria-label="${title} navigation"
                >
                    ${tabs
                        .map(
                            tab => {
                                const tabPath =
                                    normalizePath(
                                        tab.href
                                    );

                                const isActive =
                                    currentPath ===
                                    tabPath;

                                return `
                                    <a
                                        href="${tab.href}"
                                        class="header-tab${isActive ? " active" : ""}"
                                        ${isActive ? 'aria-current="page"' : ""}
                                        data-router-link
                                    >
                                        ${tab.label}
                                    </a>
                                `;
                            }
                        )
                        .join("")}
                </nav>
            `
            : "";

    header.innerHTML = `
        <div class="header-content">
            <div class="header-box">
                <div class="header-title-row">
                    <div class="header-title-content">
                        <span class="header-eyebrow">
                            ${eyebrow}
                        </span>

                        <h1 class="header-title">
                            ${title}
                        </h1>
                    </div>
                </div>

                ${navigation}
            </div>
        </div>
    `;
}