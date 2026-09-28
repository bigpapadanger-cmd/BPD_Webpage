import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../public/routes.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = join(root, "functions", "api");
const workerRoot = join(root, "workers");
const outputPath = join(root, "functions", "services", "admin", "generatedApiRouteInventory.js");
const reportDirectory = join(root, "_folder_structure", "route-health");
const reportPath = join(reportDirectory, "routes.json");

async function filesUnder(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
    }));
    return nested.flat().filter((path) => path.endsWith(".js"));
}

function routeForFile(filePath) {
    const relativePath = relative(apiRoot, filePath)
        .replaceAll("\\", "/")
        .replace(/\.js$/, "");
    const segments = relativePath.split("/").filter((segment) => segment !== "index");
    return `/api/${segments.map((segment) => segment.replace(/^\[(.+)\]$/, ":$1")).join("/")}`;
}

const records = [];
for (const filePath of (await filesUnder(apiRoot)).sort()) {
    const source = await readFile(filePath, "utf8");
    const declaredFunctions = [...source.matchAll(/export\s+(?:async\s+)?function\s+onRequest(?:(Get|Post|Put|Patch|Delete|Options|Head))?\s*\(/g)];
    const declaredBindings = [...source.matchAll(/export\s+(?:const|let|var)\s+onRequest(?:(Get|Post|Put|Patch|Delete|Options|Head))?\s*=/g)];
    const reExports = [...source.matchAll(/export\s*\{[^}]*?\bonRequest(?:(Get|Post|Put|Patch|Delete|Options|Head))?\b[^}]*?\}/gs)];
    const methods = [...declaredFunctions, ...declaredBindings, ...reExports]
        .map((match) => (match[1] || "ALL").toUpperCase());
    records.push({
        path: routeForFile(filePath),
        lookupKey: null,
        routeType: "api",
        casePolicy: "exact",
        sourceFiles: [relative(root, filePath).replaceAll("\\", "/")],
        handler: relative(root, filePath).replaceAll("\\", "/"),
        methods: [...new Set(methods)].sort(),
        authRequired: "handler-defined",
        healthStatus: methods.length ? "valid" : "missing-handler",
        deepLinkSupported: false
    });
}

const workerFiles = (await readdir(workerRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workerRoot, entry.name));
const workerRoutes = [];
const workerSchedules = [];
const workerQueues = [];

for (const directory of workerFiles.sort()) {
    const configPath = join(directory, "wrangler.jsonc");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const entrypointPath = join(directory, config.main || "");
    const entrypoint = await readFile(entrypointPath, "utf8");
    const hostname = config.routes?.find((route) => route.custom_domain)?.pattern || null;
    const routePatterns = [...entrypoint.matchAll(/request\.method\s*===\s*["'](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["']\s*&&\s*url\.pathname\s*===\s*["']([^"']+)["']/g)];

    for (const match of routePatterns) {
        workerRoutes.push({
            path: hostname ? `https://${hostname}${match[2]}` : match[2],
            lookupKey: null,
            routeType: "worker",
            casePolicy: "exact",
            sourceFiles: [relative(root, entrypointPath).replaceAll("\\", "/")],
            handler: relative(root, entrypointPath).replaceAll("\\", "/"),
            methods: [match[1]],
            authRequired: match[2] === "/wake",
            healthStatus: "handler-defined",
            deepLinkSupported: false,
            ownerSystem: config.name
        });
    }

    for (const cron of config.triggers?.crons || []) {
        workerSchedules.push({
            path: `cron: ${cron}`,
            routeType: "schedule",
            casePolicy: "not-applicable",
            sourceFiles: [relative(root, configPath).replaceAll("\\", "/")],
            handler: relative(root, entrypointPath).replaceAll("\\", "/"),
            methods: ["SCHEDULE"],
            authRequired: "platform-triggered",
            healthStatus: "configured",
            ownerSystem: config.name
        });
    }

    for (const consumer of config.queues?.consumers || []) {
        workerQueues.push({
            path: `queue: ${consumer.queue}`,
            routeType: "queue-consumer",
            casePolicy: "not-applicable",
            sourceFiles: [relative(root, configPath).replaceAll("\\", "/")],
            handler: relative(root, entrypointPath).replaceAll("\\", "/"),
            methods: ["MESSAGE"],
            authRequired: "platform-binding",
            healthStatus: "configured",
            ownerSystem: config.name
        });
    }

    if (hostname && routePatterns.length === 0) {
        workerRoutes.push({
            path: `https://${hostname}/*`,
            lookupKey: null,
            routeType: "worker",
            casePolicy: "exact",
            sourceFiles: [relative(root, entrypointPath).replaceAll("\\", "/")],
            handler: relative(root, entrypointPath).replaceAll("\\", "/"),
            methods: ["ALL"],
            authRequired: "not applicable",
            healthStatus: "returns 404 for all HTTP requests",
            deepLinkSupported: false,
            ownerSystem: config.name
        });
    }
}

const pageRecords = Object.entries(ROUTES).map(([path, config]) => ({
    path,
    lookupKey: path.toLowerCase(),
    canonicalPath: path,
    routeType: "page",
    casePolicy: "human-insensitive",
    sourceFiles: ["public/routes.js"],
    handler: "functions/[[path]].js",
    methods: ["GET", "HEAD"],
    authRequired: Boolean(config.requiresAuth || config.auth?.required),
    healthStatus: "registered",
    deepLinkSupported: true,
    targets: [config.body, config.header, config.sidebar, config.footer, config.module]
        .filter(Boolean)
        .map((target) => ({
            path: target,
            exists: existsSync(resolve(root, "public", `.${target}`))
        }))
}));

for (const page of pageRecords) {
    page.healthStatus = page.targets.every((target) => target.exists)
        ? "registered"
        : "missing-target";
}

const generatedWithPages = `// Generated by scripts/generate-api-route-inventory.mjs; do not hand-edit.\nexport const PAGE_ROUTE_INVENTORY = Object.freeze(${JSON.stringify(pageRecords, null, 2)});\nexport const API_ROUTE_INVENTORY = Object.freeze(${JSON.stringify(records, null, 2)});\nexport const WORKER_ROUTE_INVENTORY = Object.freeze(${JSON.stringify(workerRoutes, null, 2)});\nexport const WORKER_SCHEDULE_INVENTORY = Object.freeze(${JSON.stringify(workerSchedules, null, 2)});\nexport const WORKER_QUEUE_INVENTORY = Object.freeze(${JSON.stringify(workerQueues, null, 2)});\n`;
await writeFile(outputPath, generatedWithPages, "utf8");

await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    policy: {
        humanPagePaths: "case-insensitive lookup; canonical TitleCase path",
        apiAndAssetPaths: "exact-case; never normalized by the human-page router",
        unknownPaths: "real 404; no generic SPA fallback"
    },
    pages: pageRecords,
    apis: records,
    workerRoutes,
    workerSchedules,
    workerQueues
}, null, 2) + "\n", "utf8");

console.log(`Generated ${records.length} API routes, ${pageRecords.length} page routes, and ${workerRoutes.length} Worker endpoints.`);
