"use strict";

/*
=========================================================
BPD GAMING NETWORK
SITEMAP GENERATOR

File:
    public/scripts/repopulate_sitemap.js

Purpose:
    Generates the public XML sitemap from the centralized
    route registry.

Run from DomainData:
    node public/scripts/repopulate_sitemap.js

Google Search guidelines:
    - Include canonical URLs only.
    - Include publicly accessible/indexable pages only.
    - Do not include authentication-required routes.
    - Do not include error/system routes.
    - Do not emit <priority>; Google ignores it.
    - Do not emit <changefreq>; Google ignores it.
    - Only emit <lastmod> when the value can be kept
      consistently accurate.

Output:
    public/sitemap.xml
=========================================================
*/

import fs from "node:fs";
import path from "node:path";

import {
    fileURLToPath
} from "node:url";

import {
    ROUTES
} from "../routes.js";

/* =========================================================
SITE CONFIGURATION
========================================================= */

const DOMAIN =
    "https://bpd-gaming-network.com";

const SCRIPT_FILE =
    fileURLToPath(
        import.meta.url
    );

const SCRIPT_DIRECTORY =
    path.dirname(
        SCRIPT_FILE
    );

const PUBLIC_DIRECTORY =
    path.resolve(
        SCRIPT_DIRECTORY,
        ".."
    );

const OUTPUT_FILE =
    path.join(
        PUBLIC_DIRECTORY,
        "sitemap.xml"
    );

/* =========================================================
EXCLUDED SYSTEM ROUTES
========================================================= */

const EXCLUDED_ROUTES =
    new Set([
        "/Error"
    ]);

/* =========================================================
XML ESCAPING
========================================================= */

function escapeXml(
    value
) {
    return String(
        value
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&apos;"
        );
}

/* =========================================================
NORMALIZE ROUTE
========================================================= */

function normalizeRoute(
    route
) {
    let normalized =
        String(
            route
            || ""
        )
            .trim();

    if (
        !normalized
    ) {
        return "";
    }

    if (
        !normalized.startsWith(
            "/"
        )
    ) {
        normalized =
            `/${normalized}`;
    }

    /*
     * The root route remains "/".
     *
     * Other routes have trailing slashes removed so the
     * sitemap contains one consistent canonical form.
     */
    if (
        normalized.length >
            1
        && normalized.endsWith(
            "/"
        )
    ) {
        normalized =
            normalized.replace(
                /\/+$/,
                ""
            );
    }

    return normalized;
}

/* =========================================================
ROUTE FILTER
========================================================= */

function shouldIncludeRoute(
    route,
    routeConfig
) {
    if (
        !routeConfig
        || typeof routeConfig !==
            "object"
    ) {
        return false;
    }

    const normalizedRoute =
        normalizeRoute(
            route
        );

    if (
        !normalizedRoute
    ) {
        return false;
    }

    /*
     * Explicit system exclusions.
     */
    if (
        EXCLUDED_ROUTES.has(
            normalizedRoute
        )
    ) {
        return false;
    }

    /*
     * Routes must explicitly opt into the sitemap.
     */
    if (
        routeConfig.sitemap !==
        true
    ) {
        return false;
    }

    /*
     * Authentication-required pages should not be submitted
     * as public search-result destinations.
     */
    if (
        routeConfig.requiresAuth ===
        true
    ) {
        return false;
    }

    /*
     * Optional compatibility with route definitions that
     * explicitly identify non-indexable pages.
     */
    if (
        routeConfig.noindex ===
        true
    ) {
        return false;
    }

    /*
     * Optional compatibility with route definitions that
     * explicitly disable indexing.
     */
    if (
        routeConfig.indexable ===
        false
    ) {
        return false;
    }

    return true;
}

/* =========================================================
CREATE CANONICAL URL
========================================================= */

function createCanonicalUrl(
    route
) {
    const normalizedRoute =
        normalizeRoute(
            route
        );

    return new URL(
        normalizedRoute,
        DOMAIN
    ).href;
}

/* =========================================================
CREATE URL ENTRY
========================================================= */

function createSitemapEntry(
    route
) {
    const url =
        createCanonicalUrl(
            route
        );

    return [
        "    <url>",
        `        <loc>${escapeXml(url)}</loc>`,
        "    </url>"
    ]
        .join(
            "\n"
        );
}

/* =========================================================
COLLECT ROUTES
========================================================= */

function collectSitemapRoutes() {
    const seenUrls =
        new Set();

    const routes =
        [];

    for (
        const [
            route,
            routeConfig
        ] of Object.entries(
            ROUTES
        )
    ) {
        if (
            !shouldIncludeRoute(
                route,
                routeConfig
            )
        ) {
            continue;
        }

        const normalizedRoute =
            normalizeRoute(
                route
            );

        const canonicalUrl =
            createCanonicalUrl(
                normalizedRoute
            );

        /*
         * Protect against duplicate canonical URLs appearing
         * in the centralized route registry.
         */
        if (
            seenUrls.has(
                canonicalUrl
            )
        ) {
            console.warn(
                `Sitemap duplicate skipped: ${canonicalUrl}`
            );

            continue;
        }

        seenUrls.add(
            canonicalUrl
        );

        routes.push(
            normalizedRoute
        );
    }

    /*
     * Stable output makes source-control changes easier
     * to review and prevents meaningless sitemap churn.
     */
    routes.sort(
        function(
            a,
            b
        ) {
            if (
                a ===
                "/"
            ) {
                return -1;
            }

            if (
                b ===
                "/"
            ) {
                return 1;
            }

            return a.localeCompare(
                b,
                "en",
                {
                    sensitivity:
                        "base"
                }
            );
        }
    );

    return routes;
}

/* =========================================================
GENERATE SITEMAP
========================================================= */

function generateSitemap() {
    const sitemapRoutes =
        collectSitemapRoutes();

    const urls =
        sitemapRoutes
            .map(
                createSitemapEntry
            )
            .join(
                "\n"
            );

    const xml =
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            urls,
            "</urlset>",
            ""
        ]
            .join(
                "\n"
            );

    fs.writeFileSync(
        OUTPUT_FILE,
        xml,
        "utf8"
    );

    console.log(
        `Sitemap generated with ${sitemapRoutes.length} public routes.`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

/* =========================================================
RUN
========================================================= */

generateSitemap();