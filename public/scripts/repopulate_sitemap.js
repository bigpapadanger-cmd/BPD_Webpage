/*
=========================================================
BPD GAMING NETWORK
SITEMAP GENERATOR
=========================================================

Run from DomainData:

    node public/scripts/repopulate_sitemap.js

=========================================================
*/

import fs from "node:fs";
import path from "node:path";

import {
    fileURLToPath
} from "node:url";

import {
    ROUTES,
    PRIORITY_MAP
} from "../routes.js";


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


/*
=========================================================
XML ESCAPING
=========================================================
*/

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}


/*
=========================================================
ROUTE FILTER
=========================================================
*/

function shouldIncludeRoute(
    route,
    routeConfig
) {
    if (!routeConfig) {
        return false;
    }

    if (route === "/Error") {
        return false;
    }

    if (
        routeConfig.sitemap !== true
    ) {
        return false;
    }

    if (
        routeConfig.requiresAuth === true
    ) {
        return false;
    }

    return true;
}


/*
=========================================================
CREATE URL ENTRY
=========================================================
*/

function createSitemapEntry(route) {
    const url =
        new URL(
            route,
            DOMAIN
        ).href;

    const priority =
        PRIORITY_MAP[route];

    const lines = [
        "    <url>",
        `        <loc>${escapeXml(url)}</loc>`
    ];

    if (
        typeof priority === "number"
    ) {
        lines.push(
            `        <priority>${priority.toFixed(1)}</priority>`
        );
    }

    lines.push(
        "    </url>"
    );

    return lines.join("\n");
}


/*
=========================================================
GENERATE SITEMAP
=========================================================
*/

function generateSitemap() {
    const sitemapRoutes =
        Object.entries(
            ROUTES
        )
        .filter(function(
            [route, routeConfig]
        ) {
            return shouldIncludeRoute(
                route,
                routeConfig
            );
        });

    const urls =
        sitemapRoutes
            .map(function([route]) {
                return createSitemapEntry(
                    route
                );
            })
            .join("\n");

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        "</urlset>",
        ""
    ].join("\n");

    fs.writeFileSync(
        OUTPUT_FILE,
        xml,
        "utf8"
    );

    console.log(
        `Sitemap generated with ${sitemapRoutes.length} routes at ${OUTPUT_FILE}`
    );
}


generateSitemap();