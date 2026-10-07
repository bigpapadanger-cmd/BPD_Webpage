import {
    resolveHumanPageRoute,
    getPageMetadata
} from "../public/routes.js";

const PAGE_SHELL_PATH = "/";
const FAVICON_PATH = "/Assets/logo/gaming_network_logo_128px.png";
const PAGE_METHODS = new Set(["GET", "HEAD"]);

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    if (!PAGE_METHODS.has(request.method)) {
        return context.next();
    }

    if (url.pathname === "/favicon.ico") {
        const faviconUrl = new URL(FAVICON_PATH, url.origin);
        return Response.redirect(faviconUrl, 308);
    }

    const route = resolveHumanPageRoute(url.pathname);
    if (!route) {
        return context.next();
    }

    if (url.pathname !== route.canonicalPath) {
        url.pathname = route.canonicalPath;
        return Response.redirect(url, 308);
    }

    const metadata = getPageMetadata(route.canonicalPath, url.search);
    if (url.hostname.endsWith(".pages.dev")) metadata.robots = "noindex, nofollow";
    url.pathname = PAGE_SHELL_PATH;
    const shell = await context.next(new Request(url, request));
    const escape = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const headers = new Headers(shell.headers);
    headers.set("X-Robots-Tag", metadata.robots);
    if (metadata.robots.startsWith("noindex")) headers.set("Cache-Control", "no-store");
    if (request.method === "HEAD") return new Response(null, { status: shell.status, headers });
    return new HTMLRewriter().on("title", { element(element) { element.setInnerContent(metadata.title); } })
        .on("head", { element(element) { element.append(`<meta name="description" content="${escape(metadata.description)}"><meta name="robots" content="${metadata.robots}"><link rel="canonical" href="${escape(metadata.canonical)}"><meta property="og:title" content="${escape(metadata.title)}"><meta property="og:description" content="${escape(metadata.description)}"><meta property="og:url" content="${escape(metadata.canonical)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(metadata.title)}"><meta name="twitter:description" content="${escape(metadata.description)}">`, { html: true }); } })
        .transform(new Response(shell.body, { status: shell.status, headers }));
}
