/*
=========================================================
BPD GAMING NETWORK
SITEMAP GENERATOR
=========================================================

Run from DomainData:

    node scripts/repopulate_sitemap.js

=========================================================
*/

import fs from "node:fs";
import path from "node:path";
import {
    fileURLToPath
} from "node:url";

import {
    ROUTES
} from "../public/Framework/Shell/JS/routes.js";

const DOMAIN =
    "https://bpd-gaming-network.com";

const SCRIPT_FILE =
    fileURLToPath(import.meta.url);

const SCRIPT_DIRECTORY =
    path.dirname(SCRIPT_FILE);

const PROJECT_DIRECTORY =
    path.resolve(
        SCRIPT_DIRECTORY,
        ".."
    );

const OUTPUT_FILE =
    path.join(
        PROJECT_DIRECTORY,
        "public",
        "sitemap.xml"
    );

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

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

    if (routeConfig.sitemap === false) {
        return false;
    }

    if (routeConfig.requiresAuth === true) {
        return false;
    }

    return true;
}

function createSitemapEntry(route) {
    const url =
        new URL(
            route,
            DOMAIN
        ).href;

    return [
        "    <url>",
        `        <loc>${escapeXml(url)}</loc>`,
        "    </url>"
    ].join("\n");
}

function generateSitemap() {
    const urls =
        Object.entries(ROUTES)
            .filter(function(
                [route, routeConfig]
            ) {
                return shouldIncludeRoute(
                    route,
                    routeConfig
                );
            })
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
        `Sitemap generated at ${OUTPUT_FILE}`
    );
}

generateSitemap();