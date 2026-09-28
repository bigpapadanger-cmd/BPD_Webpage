import {
    resolveHumanPageRoute
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

    if (route.canonicalPath === "/") {
        return context.next();
    }

    url.pathname = PAGE_SHELL_PATH;
    return context.next(new Request(url, request));
}
