//RUN FROM DomainData
//node scripts/repopulate_sitemap.js

import fs from "fs";
import path from "path";
import { ROUTES, PRIORITY_MAP } from "../public/Framework/Shell/JS/routes.js";


const DOMAIN = "https://bpd-gaming-network.com";


function generateSitemap() {
    const urls = Object.keys(ROUTES).map(route => {
        const priority = PRIORITY_MAP[route] ?? 0.5;

        return `
            <url>
                <loc>${DOMAIN}${route}</loc>
                <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
                <changefreq>montly</changefreq>
                <priority>${priority}</priority>
            </url>`;
    }).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    const outputPath = path.resolve("./public/sitemap.xml");
    fs.writeFileSync(outputPath, xml);

    console.log("✔ Sitemap generated at public/sitemap.xml");
}

generateSitemap();

